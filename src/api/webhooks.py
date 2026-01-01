"""Webhook endpoints for Twilio SMS and voice callbacks."""

import logging

from fastapi import APIRouter, Form, Query, Response
from sqlalchemy.orm import Session

from src.database import SessionLocal
from src.models import Item, ReminderState, UserNotificationSettings
from src.models.enums import ReminderStatus
from src.tasks.reminders import process_reminder_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])


@router.post("/twilio/sms")
async def handle_sms_response(
    From: str = Form(...),  # noqa: N803 - Twilio param name
    Body: str = Form(...),  # noqa: N803 - Twilio param name
) -> Response:
    """Handle incoming SMS responses from Twilio.

    Twilio sends POST with form data:
    - From: phone number that sent the SMS
    - Body: SMS text content
    """
    db: Session = SessionLocal()

    try:
        logger.info(f"Received SMS from {From}: {Body}")

        # Look up user by phone number
        user_settings = (
            db.query(UserNotificationSettings)
            .filter(UserNotificationSettings.phone_number == From)
            .first()
        )

        if not user_settings:
            logger.warning(f"No user found with phone number {From}")
            return _twiml_response("Sorry, your phone number is not registered.")

        # Find active reminder for this user
        # We need to find the most recent pending reminder for any list owned by this user
        from src.models import List

        user_lists = db.query(List).filter(List.owner_id == user_settings.user_id).all()
        list_ids = [lst.id for lst in user_lists]

        if not list_ids:
            return _twiml_response("No active reminders found.")

        # Find items in those lists with pending reminders
        reminder = (
            db.query(ReminderState)
            .join(Item, ReminderState.item_id == Item.id)
            .filter(
                Item.list_id.in_(list_ids),
                ReminderState.status == ReminderStatus.PENDING,
            )
            .order_by(ReminderState.last_escalation_at.desc())
            .first()
        )

        if not reminder:
            return _twiml_response("No active reminders found.")

        # Queue the response for processing
        process_reminder_response.delay(reminder.id, "sms", Body)

        # Acknowledge receipt
        return _twiml_response("Got it! Processing your response.")

    except Exception as e:
        logger.error(f"Error handling SMS: {e}", exc_info=True)
        return _twiml_response("Sorry, there was an error processing your response.")

    finally:
        db.close()


@router.post("/twilio/voice/twiml")
async def get_voice_twiml(
    item_id: int = Query(...),
) -> Response:
    """Generate TwiML for voice call that reads the task and records response.

    This endpoint is called by Twilio when initiating a call.
    """
    db: Session = SessionLocal()

    try:
        item = db.query(Item).filter(Item.id == item_id).first()
        if not item:
            return _twiml_voice_response("Sorry, this task was not found.", record=False)

        # Get user settings for safe word
        user_settings = (
            db.query(UserNotificationSettings)
            .filter(UserNotificationSettings.user_id == item.list.owner_id)
            .first()
        )
        safe_word = user_settings.escape_safe_word if user_settings else "abort"

        message = (
            f"Reminder: {item.name}. "
            f"Please say your response after the beep. "
            f"Say done if you completed it, or give me a specific time to reschedule. "
            f"Say {safe_word} to escape."
        )

        return _twiml_voice_response(message, record=True, item_id=item_id)

    except Exception as e:
        logger.error(f"Error generating voice TwiML: {e}", exc_info=True)
        return _twiml_voice_response("Sorry, there was an error.", record=False)

    finally:
        db.close()


@router.post("/twilio/voice/status")
async def handle_voice_status(
    CallSid: str = Form(None),  # noqa: N803 - Twilio param name
    CallStatus: str = Form(None),  # noqa: N803 - Twilio param name
    RecordingUrl: str = Form(None),  # noqa: N803 - Twilio param name
    RecordingSid: str = Form(None),  # noqa: N803 - Twilio param name
) -> Response:
    """Handle voice call status callbacks from Twilio."""
    logger.info(f"Voice call status: {CallStatus}, SID: {CallSid}")

    if RecordingUrl:
        logger.info(f"Recording available: {RecordingUrl}")
        # TODO: Fetch transcription and process response

    return Response(content="", media_type="text/xml")


@router.post("/twilio/voice/transcription")
async def handle_voice_transcription(
    TranscriptionText: str = Form(None),  # noqa: N803 - Twilio param name
    RecordingSid: str = Form(None),  # noqa: N803 - Twilio param name
    item_id: int = Query(None),
) -> Response:
    """Handle voice transcription callbacks from Twilio.

    Note: Twilio's built-in transcription is deprecated. This endpoint is
    kept for compatibility but may need updating to use a different
    transcription service.
    """
    if not TranscriptionText or not item_id:
        logger.warning("Missing transcription text or item_id")
        return Response(content="", media_type="text/xml")

    db: Session = SessionLocal()

    try:
        logger.info(f"Voice transcription for item {item_id}: {TranscriptionText}")

        # Find active reminder for this item
        reminder = (
            db.query(ReminderState)
            .filter(
                ReminderState.item_id == item_id,
                ReminderState.status == ReminderStatus.PENDING,
            )
            .first()
        )

        if reminder:
            process_reminder_response.delay(reminder.id, "call", TranscriptionText)

    except Exception as e:
        logger.error(f"Error handling transcription: {e}", exc_info=True)

    finally:
        db.close()

    return Response(content="", media_type="text/xml")


def _twiml_response(message: str) -> Response:
    """Generate TwiML response for SMS."""
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>{message}</Message>
</Response>"""
    return Response(content=twiml, media_type="text/xml")


def _twiml_voice_response(
    message: str,
    record: bool = False,
    item_id: int | None = None,
) -> Response:
    """Generate TwiML response for voice call."""
    if record:
        # Note: Twilio's transcribe feature is deprecated
        # Consider using a speech-to-text service instead
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">{message}</Say>
    <Record maxLength="60" playBeep="true"
            action="/api/v1/webhooks/twilio/voice/recorded?item_id={item_id}"
            transcribe="false"/>
    <Say voice="alice">I didn't hear anything. Goodbye.</Say>
</Response>"""
    else:
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">{message}</Say>
    <Hangup/>
</Response>"""
    return Response(content=twiml, media_type="text/xml")


@router.post("/twilio/voice/recorded")
async def handle_voice_recorded(
    RecordingUrl: str = Form(None),  # noqa: N803 - Twilio param name
    RecordingSid: str = Form(None),  # noqa: N803 - Twilio param name
    item_id: int = Query(None),
) -> Response:
    """Handle recording completion callback.

    Since Twilio's built-in transcription is deprecated, we would need to:
    1. Fetch the recording audio
    2. Send it to a transcription service (Whisper, Google STT, etc.)
    3. Process the transcribed text

    For now, log the recording URL for manual processing.
    """
    logger.info(f"Voice recording for item {item_id}: {RecordingUrl}")

    # TODO: Implement transcription service integration
    # For now, just acknowledge the recording

    twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Thank you. I'll process your response shortly.</Say>
    <Hangup/>
</Response>"""
    return Response(content=twiml, media_type="text/xml")
