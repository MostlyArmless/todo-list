"""Celery tasks for voice input processing."""

import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.list import List
from src.models.pending_confirmation import PendingConfirmation
from src.models.user import User
from src.models.voice_input import VoiceInput
from src.services.categorization import CategorizationService
from src.services.llm import LLMService
from src.services.llm_prompts import (
    GROCERY_VOICE_PARSING_SYSTEM_PROMPT,
    TASK_VOICE_PARSING_SYSTEM_PROMPT,
    VOICE_CLASSIFICATION_SYSTEM_PROMPT,
    get_grocery_voice_parsing_prompt,
    get_task_voice_parsing_prompt,
    get_voice_classification_prompt,
)

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def process_voice_input(self, voice_input_id: int) -> dict:
    """Process voice input asynchronously with LLM using two-stage approach.

    Stage 1: Classify input as grocery or task (simple binary decision)
    Stage 2: Route to type-specific parser with appropriate lists

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

        llm_service = LLMService()

        # Get user's lists separated by type
        lists = db.query(List).filter(List.owner_id == voice_input.user_id).all()
        task_lists = [lst for lst in lists if lst.list_type == "task"]
        grocery_lists = [lst for lst in lists if lst.list_type != "task"]

        # Get user info for task list selection
        user = db.query(User).filter(User.id == voice_input.user_id).first()
        username = user.name if user and user.name else None

        # Stage 1: Classify input as grocery or task
        input_type = _classify_voice_input(llm_service, voice_input.raw_text)
        logger.info(f"Classified voice input as: {input_type}")

        # Stage 2: Route to type-specific parser
        if input_type == "task":
            if not task_lists:
                voice_input.status = "failed"
                voice_input.error_message = "No task lists available"
                db.commit()
                return {"error": "No task lists available"}

            parsed_data = _parse_task_voice_input(
                llm_service, voice_input.raw_text, task_lists, username
            )
            if not parsed_data:
                voice_input.status = "failed"
                voice_input.error_message = "Failed to parse task input"
                db.commit()
                return {"error": "Failed to parse task input"}

            # Find target list from task lists only
            target_list = _find_target_list_from_set(task_lists, parsed_data.get("list_name", ""))
            if not target_list:
                target_list = task_lists[0]  # Default to first task list

            # Build task items with date/reminder fields
            items_with_task_fields = []
            for item_data in parsed_data.get("items", []):
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
            # Grocery flow
            if not grocery_lists:
                voice_input.status = "failed"
                voice_input.error_message = "No grocery lists available"
                db.commit()
                return {"error": "No grocery lists available"}

            parsed_data = _parse_grocery_voice_input(
                llm_service, voice_input.raw_text, grocery_lists
            )
            if not parsed_data:
                voice_input.status = "failed"
                voice_input.error_message = "Failed to parse grocery input"
                db.commit()
                return {"error": "Failed to parse grocery input"}

            # Find target list from grocery lists only
            target_list = _find_target_list_from_set(
                grocery_lists, parsed_data.get("list_name", "")
            )
            if not target_list:
                target_list = grocery_lists[0]  # Default to first grocery list

            # Categorize grocery items
            categorization_service = CategorizationService(db, llm_service)
            items_with_categories = []

            for item_name in parsed_data.get("items", []):
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
                "action": parsed_data.get("action", "add"),
                "list_id": target_list.id,
                "list_name": target_list.name,
                "list_type": "grocery",
                "items": items_with_categories,
            }

        # Create pending confirmation
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


# Set to True to use fast heuristic classification, False for LLM classification
USE_HEURISTIC_CLASSIFICATION = True


def _classify_voice_input_heuristic(raw_text: str) -> str:
    """Classify voice input using keyword heuristics (fast, no LLM).

    Returns 'task' if text contains task-related keywords, otherwise 'grocery'.
    """
    text_lower = raw_text.lower()

    # Task indicators: reminders, time references, action verbs
    task_keywords = [
        # Reminder patterns
        "remind me",
        "reminder",
        "don't forget",
        "dont forget",
        # Time references
        "tomorrow",
        "today",
        "tonight",
        "this evening",
        "this morning",
        "this afternoon",
        "next week",
        "next month",
        "on monday",
        "on tuesday",
        "on wednesday",
        "on thursday",
        "on friday",
        "on saturday",
        "on sunday",
        # Relative time
        "in 5 min",
        "in 10 min",
        "in 15 min",
        "in 30 min",
        "in an hour",
        "in 1 hour",
        "in 2 hour",
        "in a few",
        " at ",  # "at 3pm", "at noon"
        # Action verbs common in tasks
        "call ",
        "email ",
        "text ",
        "message ",
        "schedule ",
        "book ",
        "pay ",
        "submit ",
        "finish ",
        "complete ",
        "check on",
        "follow up",
        "meeting",
    ]

    if any(keyword in text_lower for keyword in task_keywords):
        return "task"

    return "grocery"


def _classify_voice_input_llm(llm_service: LLMService, raw_text: str) -> str:
    """Classify voice input using LLM (slower but more accurate)."""
    try:
        prompt = get_voice_classification_prompt(raw_text)
        result = llm_service.generate_json(
            prompt=prompt,
            system_prompt=VOICE_CLASSIFICATION_SYSTEM_PROMPT,
            temperature=0.0,  # Deterministic for classification
        )
        input_type = result.get("type", "grocery").lower()
        return input_type if input_type in ("grocery", "task") else "grocery"
    except Exception as e:
        logger.error(f"Error classifying voice input: {e}", exc_info=True)
        return "grocery"  # Default to grocery on error


def _classify_voice_input(llm_service: LLMService, raw_text: str) -> str:
    """Stage 1: Classify voice input as 'grocery' or 'task'.

    Uses heuristic or LLM classification based on USE_HEURISTIC_CLASSIFICATION flag.
    """
    if USE_HEURISTIC_CLASSIFICATION:
        return _classify_voice_input_heuristic(raw_text)
    return _classify_voice_input_llm(llm_service, raw_text)


def _parse_grocery_voice_input(
    llm_service: LLMService, raw_text: str, grocery_lists: list[List]
) -> dict | None:
    """Stage 2a: Parse grocery voice input with grocery-specific prompt."""
    try:
        list_names = [lst.name for lst in grocery_lists]
        prompt = get_grocery_voice_parsing_prompt(raw_text, list_names)
        result = llm_service.generate_json(
            prompt=prompt,
            system_prompt=GROCERY_VOICE_PARSING_SYSTEM_PROMPT,
            temperature=0.1,
        )
        logger.info(f"Parsed grocery voice input: {result}")
        return result
    except Exception as e:
        logger.error(f"Error parsing grocery voice input: {e}", exc_info=True)
        return None


def _parse_task_voice_input(
    llm_service: LLMService,
    raw_text: str,
    task_lists: list[List],
    username: str | None = None,
) -> dict | None:
    """Stage 2b: Parse task voice input with task-specific prompt for dates/reminders."""
    try:
        list_names = [lst.name for lst in task_lists]
        current_datetime = datetime.now(UTC).isoformat()

        prompt = get_task_voice_parsing_prompt(
            raw_text,
            list_names,
            current_datetime,
            username,
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


def _find_target_list_from_set(lists: list[List], list_name: str) -> List | None:
    """Find target list by name from a pre-filtered set (fuzzy matching)."""
    if not list_name:
        return None

    # Try exact match first
    for lst in lists:
        if lst.name == list_name:
            return lst

    # Try case-insensitive match
    list_name_lower = list_name.lower()
    for lst in lists:
        if lst.name.lower() == list_name_lower:
            return lst

    return None


@celery_app.task(bind=True, max_retries=2)
def refine_voice_items(self, item_ids: list[int], raw_text: str, user_id: int) -> dict:
    """Background task to refine heuristically-created items using LLM.

    This task:
    1. Gets the items from DB
    2. Runs LLM parsing on the original voice text
    3. Updates items with refined data (name, category, dates)
    4. Sets refinement_status to 'complete'
    """
    db: Session = SessionLocal()
    try:
        from src.models.item import Item

        items = db.query(Item).filter(Item.id.in_(item_ids)).all()
        if not items:
            return {"error": "No items found"}

        # Determine list type from first item
        first_item = items[0]
        list_obj = db.query(List).filter(List.id == first_item.list_id).first()
        is_task_list = list_obj.list_type == "task"

        llm_service = LLMService()

        if is_task_list:
            # Get all task lists for context
            task_lists = (
                db.query(List).filter(List.owner_id == user_id, List.list_type == "task").all()
            )

            user = db.query(User).filter(User.id == user_id).first()
            username = user.name if user and user.name else None

            parsed_data = _parse_task_voice_input(llm_service, raw_text, task_lists, username)

            if (
                parsed_data
                and parsed_data.get("items")
                and len(items) == 1
                and len(parsed_data["items"]) >= 1
            ):
                # For single item, just refine it
                item = items[0]
                llm_item = parsed_data["items"][0]

                # Update name if LLM provided a better one
                if isinstance(llm_item, dict) and llm_item.get("name"):
                    item.name = llm_item["name"]

                # Update dates if LLM parsed them and heuristic didn't
                if isinstance(llm_item, dict):
                    if llm_item.get("due_date") and not item.due_date:
                        due_date_str = llm_item["due_date"]
                        item.due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
                    if llm_item.get("reminder_offset") and not item.reminder_offset:
                        item.reminder_offset = llm_item["reminder_offset"]
                    if llm_item.get("recurrence_pattern") and not item.recurrence_pattern:
                        item.recurrence_pattern = llm_item["recurrence_pattern"]
        else:
            # Grocery refinement - name cleanup and category assignment
            grocery_lists = (
                db.query(List).filter(List.owner_id == user_id, List.list_type != "task").all()
            )

            # Run LLM parsing to get cleaned item names
            parsed_data = _parse_grocery_voice_input(llm_service, raw_text, grocery_lists)

            # Build a map of heuristic name -> LLM cleaned name
            llm_item_names = parsed_data.get("items", []) if parsed_data else []

            categorization_service = CategorizationService(db, llm_service)

            for i, item in enumerate(items):
                # Update name if LLM provided a cleaner version
                if i < len(llm_item_names) and llm_item_names[i]:
                    llm_name = llm_item_names[i]
                    if llm_name != item.name:
                        logger.info(f"Refining item name: '{item.name}' -> '{llm_name}'")
                        item.name = llm_name

                # Categorize if not already categorized
                if not item.category_id:
                    result = categorization_service.categorize_item(
                        item_name=item.name,
                        list_id=item.list_id,
                        user_id=user_id,
                    )
                    if result["category_id"]:
                        item.category_id = result["category_id"]
                        # Record to history for future fast lookups
                        categorization_service.record_categorization(
                            item.name, result["category_id"], item.list_id, user_id
                        )

        # Mark all items as refined
        for item in items:
            item.refinement_status = "complete"

        db.commit()

        logger.info(f"Refined {len(items)} items from voice input")
        return {"success": True, "refined_count": len(items)}

    except Exception as e:
        logger.error(f"Error refining voice items: {e}", exc_info=True)
        db.rollback()

        # Mark items as complete anyway (don't leave them stuck)
        try:
            from src.models.item import Item

            for item_id in item_ids:
                item = db.query(Item).filter(Item.id == item_id).first()
                if item:
                    item.refinement_status = "complete"
            db.commit()
        except Exception as cleanup_error:
            logger.warning(
                f"Failed to mark items as complete after refinement error: {cleanup_error}"
            )

        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=30) from e

        return {"error": str(e)}
    finally:
        db.close()
