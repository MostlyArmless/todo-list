"""Celery tasks for voice input processing."""

import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.list import List
from src.models.pending_confirmation import PendingConfirmation
from src.models.voice_input import VoiceInput
from src.services.categorization import CategorizationService
from src.services.llm import LLMService
from src.services.llm_prompts import (
    TASK_VOICE_PARSING_SYSTEM_PROMPT,
    VOICE_PARSING_SYSTEM_PROMPT,
    get_task_voice_parsing_prompt,
    get_voice_parsing_prompt,
)

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def process_voice_input(self, voice_input_id: int) -> dict:
    """Process voice input asynchronously with LLM.

    Args:
        voice_input_id: ID of the VoiceInput record to process

    Returns:
        dict with processing result
    """
    db: Session = SessionLocal()
    try:
        # Get voice input record
        voice_input = db.query(VoiceInput).filter(VoiceInput.id == voice_input_id).first()
        if not voice_input:
            logger.error(f"Voice input {voice_input_id} not found")
            return {"error": "Voice input not found"}

        # Update status to processing
        voice_input.status = "processing"
        db.commit()

        logger.info(f"Processing voice input {voice_input_id}: '{voice_input.raw_text}'")

        # Step 1: Parse voice input with LLM (grocery-style first to get list name)
        llm_service = LLMService()
        parsed_data = _parse_voice_input(db, llm_service, voice_input)

        if not parsed_data:
            voice_input.status = "failed"
            voice_input.error_message = "Failed to parse voice input"
            db.commit()
            return {"error": "Failed to parse voice input"}

        # Step 2: Find the target list
        target_list = _find_target_list(db, voice_input.user_id, parsed_data["list_name"])

        if not target_list:
            voice_input.status = "failed"
            voice_input.error_message = f"List '{parsed_data['list_name']}' not found"
            db.commit()
            return {"error": f"List '{parsed_data['list_name']}' not found"}

        # Step 3: Process based on list type
        if target_list.list_type == "task":
            # Task list: re-parse with task-aware prompt for dates/reminders
            task_parsed = _parse_task_voice_input(db, llm_service, voice_input)
            if task_parsed:
                parsed_data = task_parsed

            # Task items don't need categorization
            items_with_task_fields = []
            for item_data in parsed_data.get("items", []):
                # Handle both formats: string items or dict items
                if isinstance(item_data, str):
                    items_with_task_fields.append({"name": item_data})
                else:
                    items_with_task_fields.append(
                        {
                            "name": item_data.get("name", ""),
                            "due_date": item_data.get("due_date"),
                            "reminder_offset": item_data.get("reminder_offset"),
                            "recurrence_pattern": item_data.get("recurrence_pattern"),
                        }
                    )

            proposed_changes = {
                "action": parsed_data.get("action", "add"),
                "list_id": target_list.id,
                "list_name": target_list.name,
                "list_type": "task",
                "items": items_with_task_fields,
            }
        else:
            # Grocery list: categorize items
            categorization_service = CategorizationService(db, llm_service)
            items_with_categories = []

            for item_name in parsed_data["items"]:
                result = categorization_service.categorize_item(
                    item_name=item_name,
                    list_id=target_list.id,
                    user_id=voice_input.user_id,
                )
                items_with_categories.append(
                    {
                        "name": item_name,
                        "category_id": result["category_id"],
                        "confidence": result["confidence"],
                        "reasoning": result["reasoning"],
                    }
                )

            proposed_changes = {
                "action": parsed_data["action"],
                "list_id": target_list.id,
                "list_name": target_list.name,
                "list_type": "grocery",
                "items": items_with_categories,
            }

        # Step 4: Create pending confirmation
        pending = PendingConfirmation(
            user_id=voice_input.user_id,
            voice_input_id=voice_input.id,
            proposed_changes=proposed_changes,
            status="pending",
        )
        db.add(pending)

        # Update voice input as completed
        voice_input.status = "completed"
        voice_input.result_json = proposed_changes
        voice_input.processed_at = datetime.now(UTC)
        db.commit()

        logger.info(f"Voice input {voice_input_id} processed successfully")

        return {
            "success": True,
            "pending_confirmation_id": pending.id,
            "proposed_changes": proposed_changes,
        }

    except Exception as e:
        logger.error(f"Error processing voice input {voice_input_id}: {e}", exc_info=True)
        db.rollback()

        # Update voice input as failed
        voice_input = db.query(VoiceInput).filter(VoiceInput.id == voice_input_id).first()
        if voice_input:
            voice_input.status = "failed"
            voice_input.error_message = str(e)
            db.commit()

        # Retry if not exhausted
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60) from e

        return {"error": str(e)}

    finally:
        db.close()


def _parse_voice_input(
    db: Session, llm_service: LLMService, voice_input: VoiceInput
) -> dict | None:
    """Parse voice input text into structured data."""
    try:
        # Get user's available lists
        lists = db.query(List).filter(List.owner_id == voice_input.user_id).all()
        list_names = [lst.name for lst in lists]

        prompt = get_voice_parsing_prompt(voice_input.raw_text, list_names)
        result = llm_service.generate_json(
            prompt=prompt,
            system_prompt=VOICE_PARSING_SYSTEM_PROMPT,
            temperature=0.1,
        )

        logger.info(f"Parsed voice input: {result}")
        return result

    except Exception as e:
        logger.error(f"Error parsing voice input: {e}", exc_info=True)
        return None


def _parse_task_voice_input(
    db: Session, llm_service: LLMService, voice_input: VoiceInput
) -> dict | None:
    """Parse voice input text into structured task data with dates/reminders."""
    try:
        # Get user's task lists only
        lists = (
            db.query(List)
            .filter(
                List.owner_id == voice_input.user_id,
                List.list_type == "task",
            )
            .all()
        )
        list_names = [lst.name for lst in lists]

        if not list_names:
            list_names = ["todo"]

        # Get current datetime for relative date parsing
        current_datetime = datetime.now(UTC).isoformat()

        prompt = get_task_voice_parsing_prompt(
            voice_input.raw_text,
            list_names,
            current_datetime,
        )
        result = llm_service.generate_json(
            prompt=prompt,
            system_prompt=TASK_VOICE_PARSING_SYSTEM_PROMPT,
            temperature=0.1,
        )

        logger.info(f"Parsed task voice input: {result}")
        return result

    except Exception as e:
        logger.error(f"Error parsing task voice input: {e}", exc_info=True)
        return None


def _find_target_list(db: Session, user_id: int, list_name: str) -> List | None:
    """Find target list by name (fuzzy matching)."""
    # Try exact match first
    target_list = db.query(List).filter(List.owner_id == user_id, List.name == list_name).first()

    if target_list:
        return target_list

    # Try case-insensitive match
    target_list = (
        db.query(List).filter(List.owner_id == user_id, List.name.ilike(list_name)).first()
    )

    return target_list
