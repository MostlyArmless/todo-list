"""Celery tasks for reminder processing and escalation."""

import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models import Item, ReminderResponse, ReminderState, UserNotificationSettings
from src.models.enums import NotificationChannel, ReminderStatus
from src.services.llm import LLMService
from src.services.llm_prompts import ACCOUNTABILITY_SYSTEM_PROMPT, get_accountability_prompt
from src.services.notification_service import NotificationService

logger = logging.getLogger(__name__)


@celery_app.task
def process_escalations() -> dict:
    """Process reminder escalations for all pending reminders.

    This task runs every minute via celery-beat.
    It finds reminders that need escalation and sends the appropriate notification.

    Returns:
        dict with processing statistics
    """
    db: Session = SessionLocal()
    notification_service = NotificationService()

    try:
        now = datetime.now(UTC)
        stats = {"processed": 0, "push_sent": 0, "sms_sent": 0, "calls_initiated": 0}

        # Find pending reminders whose next_escalation_at has passed
        pending_reminders = (
            db.query(ReminderState)
            .filter(
                ReminderState.status == ReminderStatus.PENDING,
                ReminderState.next_escalation_at <= now,
            )
            .all()
        )

        for reminder in pending_reminders:
            # Get the item and user settings
            item = db.query(Item).filter(Item.id == reminder.item_id).first()
            if not item or item.checked or item.deleted_at:
                # Item was completed or deleted, mark reminder as done
                reminder.status = ReminderStatus.COMPLETED
                db.commit()
                continue

            # Get the list to find the owner
            list_obj = item.list
            user_id = list_obj.owner_id

            # Get user notification settings
            user_settings = notification_service.get_user_settings(db, user_id)

            # Check quiet hours
            if user_settings and _is_in_quiet_hours(user_settings, now):
                # Skip but don't escalate - will retry next minute
                logger.info(f"Skipping reminder {reminder.id} - user in quiet hours")
                continue

            # Get escalation timing
            timing = _get_escalation_timing(user_settings)

            # Get user timezone
            user_tz = user_settings.quiet_hours_timezone if user_settings else "America/Toronto"

            # Process based on current escalation level
            if reminder.current_escalation_level == 0:
                # Send push notification
                success = notification_service.send_push(
                    db=db,
                    user_id=user_id,
                    title=f"Reminder: {item.name}",
                    body=_get_reminder_body(item, user_tz),
                    item_id=item.id,
                    url=f"/list/{list_obj.id}?respond={item.id}",
                )
                if success:
                    stats["push_sent"] += 1
                    logger.info(f"Push sent for item {item.id}")

                reminder.current_escalation_level = 1
                reminder.last_escalation_at = now
                reminder.next_escalation_at = now + timedelta(minutes=timing["push_to_sms"])

            elif reminder.current_escalation_level == 1:
                # Send SMS
                if user_settings and user_settings.phone_number:
                    message = f"Reminder: {item.name}. Reply with when you'll do it, or '{user_settings.escape_safe_word or 'abort'}' to escape."
                    success = notification_service.send_sms(
                        phone_number=user_settings.phone_number,
                        message=message,
                        item_id=item.id,
                    )
                    if success:
                        stats["sms_sent"] += 1
                        logger.info(f"SMS sent for item {item.id}")
                else:
                    logger.warning(f"No phone number for user {user_id}, skipping SMS")

                reminder.current_escalation_level = 2
                reminder.last_escalation_at = now
                reminder.next_escalation_at = now + timedelta(minutes=timing["sms_to_call"])

            elif reminder.current_escalation_level == 2:
                # Initiate phone call
                if user_settings and user_settings.phone_number:
                    # TODO: Get actual base URL from config or request
                    base_url = "https://thiemnet.ca"
                    success = notification_service.initiate_call(
                        phone_number=user_settings.phone_number,
                        task_name=item.name,
                        item_id=item.id,
                        base_url=base_url,
                    )
                    if success:
                        stats["calls_initiated"] += 1
                        logger.info(f"Call initiated for item {item.id}")
                else:
                    logger.warning(f"No phone number for user {user_id}, skipping call")

                # Stay at level 2, keep calling
                reminder.last_escalation_at = now
                reminder.next_escalation_at = now + timedelta(minutes=timing["call_repeat"])

            reminder.last_escalation_at = now
            db.commit()
            stats["processed"] += 1

        logger.info(f"Escalation processing complete: {stats}")
        return stats

    except Exception as e:
        logger.error(f"Error processing escalations: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e)}

    finally:
        db.close()


@celery_app.task(bind=True, max_retries=3)
def process_reminder_response(
    self,
    reminder_state_id: int,
    channel: str,
    raw_response: str,
) -> dict:
    """Process a user's response to a reminder using LLM.

    Args:
        reminder_state_id: ID of the ReminderState record
        channel: Channel the response came from (push, sms, call, app)
        raw_response: User's raw response text

    Returns:
        dict with the action taken
    """
    db: Session = SessionLocal()
    llm_service = LLMService()
    notification_service = NotificationService()

    try:
        reminder = db.query(ReminderState).filter(ReminderState.id == reminder_state_id).first()
        if not reminder:
            logger.error(f"Reminder state {reminder_state_id} not found")
            return {"error": "Reminder state not found"}

        item = db.query(Item).filter(Item.id == reminder.item_id).first()
        if not item:
            logger.error(f"Item {reminder.item_id} not found")
            return {"error": "Item not found"}

        # Get user settings for safe word
        list_obj = item.list
        user_id = list_obj.owner_id
        user_settings = notification_service.get_or_create_user_settings(db, user_id)
        safe_word = user_settings.escape_safe_word or "abort"

        # Get current datetime for LLM
        current_datetime = datetime.now(UTC).isoformat()

        # Call LLM to evaluate response
        prompt = get_accountability_prompt(
            task_name=item.name,
            due_date=item.due_date.isoformat() if item.due_date else None,
            raw_response=raw_response,
            safe_word=safe_word,
            current_datetime=current_datetime,
        )

        try:
            llm_result = llm_service.generate_json(
                prompt=prompt,
                system_prompt=ACCOUNTABILITY_SYSTEM_PROMPT,
                temperature=0.3,
            )
        except Exception as e:
            logger.error(f"LLM error processing reminder response: {e}")
            llm_result = {
                "action": "pushback",
                "pushback_message": "I didn't understand. When will you do this task?",
            }

        # Log the response
        response_record = ReminderResponse(
            reminder_state_id=reminder.id,
            channel=NotificationChannel(channel),
            raw_response=raw_response,
            llm_interpretation=llm_result,
        )
        db.add(response_record)

        action = llm_result.get("action", "pushback")
        result = {"action": action}

        if action == "complete":
            reminder.status = ReminderStatus.COMPLETED
            item.checked = True
            item.completed_at = datetime.now(UTC)
            logger.info(f"Item {item.id} marked complete via {channel}")

            # Handle recurrence
            if item.recurrence_pattern:
                _create_next_recurrence(db, item)

        elif action == "reschedule":
            new_time_str = llm_result.get("new_reminder_at")
            if new_time_str:
                try:
                    new_time = datetime.fromisoformat(new_time_str.replace("Z", "+00:00"))
                    reminder.next_escalation_at = new_time
                    reminder.current_escalation_level = 0  # Reset escalation
                    result["new_reminder_at"] = new_time_str
                    logger.info(f"Reminder {reminder.id} rescheduled to {new_time}")
                except ValueError:
                    logger.warning(f"Invalid datetime from LLM: {new_time_str}")
                    action = "pushback"
                    llm_result["pushback_message"] = (
                        "I couldn't understand that time. When exactly will you do it?"
                    )

        elif action == "escape":
            reminder.status = ReminderStatus.ESCAPED
            logger.info(f"User escaped reminder {reminder.id}")

            # Notify accountability partner via SMS
            if user_settings.accountability_partner_phone:
                notification_service.send_accountability_sms(
                    partner_phone=user_settings.accountability_partner_phone,
                    task_name=item.name,
                    original_due=item.due_date.isoformat() if item.due_date else "No due date",
                    user_name=list_obj.owner.name or list_obj.owner.email,
                )

        if action == "pushback":
            pushback_msg = llm_result.get("pushback_message", "When will you do this?")
            result["pushback_message"] = pushback_msg

            # Send pushback via same channel
            if channel == "sms" and user_settings.phone_number:
                notification_service.send_sms(
                    phone_number=user_settings.phone_number,
                    message=pushback_msg,
                )
            elif channel in ("push", "app"):
                notification_service.send_push(
                    db=db,
                    user_id=user_id,
                    title=item.name,
                    body=pushback_msg,
                    item_id=item.id,
                )

        db.commit()
        return result

    except Exception as e:
        logger.error(f"Error processing reminder response: {e}", exc_info=True)
        db.rollback()

        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=30) from e

        return {"error": str(e)}

    finally:
        db.close()


@celery_app.task
def schedule_reminder(item_id: int) -> dict:
    """Schedule a reminder for a task item.

    Creates or updates a ReminderState record for the item.

    Args:
        item_id: ID of the Item to schedule reminder for

    Returns:
        dict with reminder info
    """
    db: Session = SessionLocal()

    try:
        item = db.query(Item).filter(Item.id == item_id).first()
        if not item:
            return {"error": "Item not found"}

        # Calculate when to send first notification
        if item.reminder_at:
            reminder_time = item.reminder_at
        elif item.due_date and item.reminder_offset:
            reminder_time = _calculate_reminder_time(item.due_date, item.reminder_offset)
        elif item.due_date:
            # Default: remind at due time
            reminder_time = item.due_date
        else:
            return {"error": "No due date or reminder time set"}

        # Check for existing reminder
        existing = (
            db.query(ReminderState)
            .filter(
                ReminderState.item_id == item_id,
                ReminderState.status == ReminderStatus.PENDING,
            )
            .first()
        )

        if existing:
            existing.next_escalation_at = reminder_time
            existing.current_escalation_level = 0
            db.commit()
            logger.info(f"Updated reminder for item {item_id} to {reminder_time}")
            return {"reminder_id": existing.id, "next_escalation_at": reminder_time.isoformat()}

        # Create new reminder
        reminder = ReminderState(
            item_id=item_id,
            current_escalation_level=0,
            next_escalation_at=reminder_time,
            status=ReminderStatus.PENDING,
        )
        db.add(reminder)
        db.commit()

        logger.info(f"Created reminder for item {item_id} at {reminder_time}")
        return {"reminder_id": reminder.id, "next_escalation_at": reminder_time.isoformat()}

    except Exception as e:
        logger.error(f"Error scheduling reminder for item {item_id}: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e)}

    finally:
        db.close()


def _is_in_quiet_hours(settings: UserNotificationSettings, now: datetime) -> bool:
    """Check if the current time is within user's quiet hours."""
    if not settings.quiet_hours_start or not settings.quiet_hours_end:
        return False

    try:
        user_tz = ZoneInfo(settings.quiet_hours_timezone or "UTC")
    except Exception:
        user_tz = ZoneInfo("UTC")

    local_time = now.astimezone(user_tz).time()
    start = settings.quiet_hours_start
    end = settings.quiet_hours_end

    # Handle overnight quiet hours (e.g., 23:00-07:00)
    if start > end:
        return local_time >= start or local_time < end

    return start <= local_time < end


def _get_escalation_timing(settings: UserNotificationSettings | None) -> dict:
    """Get escalation timing from user settings or defaults."""
    default_timing = {"push_to_sms": 5, "sms_to_call": 15, "call_repeat": 30}

    if not settings or not settings.escalation_timing:
        return default_timing

    timing = settings.escalation_timing
    return {
        "push_to_sms": timing.get("push_to_sms", 5),
        "sms_to_call": timing.get("sms_to_call", 15),
        "call_repeat": timing.get("call_repeat", 30),
    }


def _get_reminder_body(item: Item, timezone: str = "America/Toronto") -> str:
    """Generate reminder notification body."""
    if item.due_date:
        try:
            tz = ZoneInfo(timezone)
            local_time = item.due_date.astimezone(tz)
            due_str = local_time.strftime("%I:%M %p").lstrip("0")
        except Exception:
            due_str = item.due_date.strftime("%I:%M %p").lstrip("0")
        return f"Due at {due_str}"
    return "Time to complete this task"


def _calculate_reminder_time(due_date: datetime, offset: str) -> datetime:
    """Calculate reminder time from due date and offset string.

    Args:
        due_date: The due datetime
        offset: Offset string like "1h", "30m", "1d"

    Returns:
        Reminder datetime
    """
    if not offset:
        return due_date

    # Parse offset
    unit = offset[-1].lower()
    try:
        value = int(offset[:-1])
    except ValueError:
        return due_date

    if unit == "m":
        delta = timedelta(minutes=value)
    elif unit == "h":
        delta = timedelta(hours=value)
    elif unit == "d":
        delta = timedelta(days=value)
    else:
        return due_date

    return due_date - delta


def _create_next_recurrence(db: Session, item: Item) -> Item | None:
    """Create the next occurrence for a recurring task."""
    if not item.recurrence_pattern or not item.due_date:
        return None

    pattern = (
        item.recurrence_pattern.value
        if hasattr(item.recurrence_pattern, "value")
        else item.recurrence_pattern
    )

    if pattern == "daily":
        next_due = item.due_date + timedelta(days=1)
    elif pattern == "weekly":
        next_due = item.due_date + timedelta(weeks=1)
    elif pattern == "monthly":
        # Approximate: add 30 days
        next_due = item.due_date + timedelta(days=30)
    else:
        return None

    # Create new item
    new_item = Item(
        list_id=item.list_id,
        name=item.name,
        description=item.description,
        due_date=next_due,
        reminder_offset=item.reminder_offset,
        recurrence_pattern=item.recurrence_pattern,
        recurrence_parent_id=item.recurrence_parent_id or item.id,
        created_by=item.created_by,
    )
    db.add(new_item)
    db.commit()

    # Schedule reminder for new item
    schedule_reminder.delay(new_item.id)

    logger.info(f"Created recurring item {new_item.id} from {item.id}")
    return new_item
