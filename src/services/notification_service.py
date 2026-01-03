"""Notification service for push, SMS, and voice calls."""

import logging

from sqlalchemy.orm import Session

from src.config import get_settings
from src.models import PushSubscription, UserNotificationSettings

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for sending notifications via various channels."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self._twilio_client = None
        self._webpush_available = False
        self._init_twilio()
        self._init_webpush()

    def _init_twilio(self) -> None:
        """Initialize Twilio client if credentials are available."""
        if (
            self.settings.twilio_account_sid
            and self.settings.twilio_auth_token
            and self.settings.twilio_phone_number
        ):
            try:
                from twilio.rest import Client

                self._twilio_client = Client(
                    self.settings.twilio_account_sid,
                    self.settings.twilio_auth_token,
                )
                logger.info("Twilio client initialized")
            except ImportError:
                logger.warning("Twilio package not installed, SMS/voice disabled")
        else:
            logger.info("Twilio credentials not configured, SMS/voice disabled")

    def _init_webpush(self) -> None:
        """Check if webpush is available."""
        if (
            self.settings.vapid_public_key
            and self.settings.vapid_private_key
            and self.settings.vapid_email
        ):
            try:
                import pywebpush  # noqa: F401

                self._webpush_available = True
                logger.info("Web push notifications initialized")
            except ImportError:
                logger.warning("pywebpush package not installed, push disabled")
        else:
            logger.info("VAPID credentials not configured, push disabled")

    def send_push(
        self,
        db: Session,
        user_id: int,
        title: str,
        body: str,
        item_id: int | None = None,
        url: str | None = None,
    ) -> bool:
        """
        Send push notification to all user's subscribed devices.

        Returns True if at least one notification was sent successfully.
        """
        if not self._webpush_available:
            logger.warning("Push notifications not available")
            return False

        from pywebpush import WebPushException, webpush

        subscriptions = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()

        if not subscriptions:
            logger.info(f"No push subscriptions for user {user_id}")
            return False

        data = {
            "title": title,
            "body": body,
            "tag": f"reminder-{item_id}" if item_id else "notification",
            "url": url or "/",
            "item_id": item_id,
        }

        success_count = 0
        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {
                            "p256dh": sub.p256dh_key,
                            "auth": sub.auth_key,
                        },
                    },
                    data=str(data),
                    vapid_private_key=self.settings.vapid_private_key,
                    vapid_claims={
                        "sub": f"mailto:{self.settings.vapid_email}",
                    },
                )
                success_count += 1
            except WebPushException as e:
                logger.error(f"Push failed for subscription {sub.id}: {e}")
                # If subscription is invalid (410 Gone), delete it
                if e.response and e.response.status_code == 410:
                    logger.info(f"Removing expired subscription {sub.id}")
                    db.delete(sub)
                    db.commit()

        logger.info(f"Sent push to {success_count}/{len(subscriptions)} devices for user {user_id}")
        return success_count > 0

    def send_sms(
        self,
        phone_number: str,
        message: str,
        item_id: int | None = None,
    ) -> bool:
        """
        Send SMS via Twilio.

        Returns True if the SMS was sent successfully.
        """
        if not self.settings.twilio_sms_enabled:
            logger.info("SMS disabled via TWILIO_SMS_ENABLED setting")
            return False

        if not self._twilio_client:
            logger.warning("Twilio not available, cannot send SMS")
            return False

        try:
            sms = self._twilio_client.messages.create(
                body=message,
                from_=self.settings.twilio_phone_number,
                to=phone_number,
                status_callback=None,  # Will add webhook URL later
            )
            logger.info(f"SMS sent to {phone_number}, SID: {sms.sid}")
            return True
        except Exception as e:
            logger.error(f"Failed to send SMS to {phone_number}: {e}")
            return False

    def initiate_call(
        self,
        phone_number: str,
        task_name: str,
        item_id: int,
        base_url: str,
    ) -> bool:
        """
        Initiate a voice call via Twilio that will read the task and record response.

        Returns True if the call was initiated successfully.
        """
        if not self.settings.twilio_calls_enabled:
            logger.info("Voice calls disabled via TWILIO_CALLS_ENABLED setting")
            return False

        if not self._twilio_client:
            logger.warning("Twilio not available, cannot initiate call")
            return False

        # TwiML URL that will return the voice prompt
        twiml_url = f"{base_url}/api/v1/webhooks/twilio/voice/twiml?item_id={item_id}"

        try:
            call = self._twilio_client.calls.create(
                url=twiml_url,
                to=phone_number,
                from_=self.settings.twilio_phone_number,
                status_callback=f"{base_url}/api/v1/webhooks/twilio/voice/status",
                record=True,
            )
            logger.info(f"Call initiated to {phone_number}, SID: {call.sid}")
            return True
        except Exception as e:
            logger.error(f"Failed to initiate call to {phone_number}: {e}")
            return False

    def send_accountability_sms(
        self,
        partner_phone: str,
        task_name: str,
        original_due: str,
        user_name: str,
    ) -> bool:
        """
        Send escape notification to accountability partner via SMS.

        Uses Twilio to text the partner when the user abandons a task.
        """
        message = (
            f"{user_name} used their safe word to abandon task: '{task_name}' "
            f"(was due: {original_due})"
        )
        return self.send_sms(partner_phone, message)

    def get_user_settings(self, db: Session, user_id: int) -> UserNotificationSettings | None:
        """Get notification settings for a user."""
        return (
            db.query(UserNotificationSettings)
            .filter(UserNotificationSettings.user_id == user_id)
            .first()
        )

    def get_or_create_user_settings(self, db: Session, user_id: int) -> UserNotificationSettings:
        """Get or create notification settings for a user."""
        settings = self.get_user_settings(db, user_id)
        if not settings:
            settings = UserNotificationSettings(user_id=user_id)
            db.add(settings)
            db.commit()
            db.refresh(settings)
        return settings


def get_notification_service() -> NotificationService:
    """Get a notification service instance."""
    return NotificationService()
