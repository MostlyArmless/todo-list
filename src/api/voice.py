"""Voice input API endpoints."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.api.items import lookup_category_from_history
from src.database import get_db
from src.models.list import List
from src.models.pending_confirmation import PendingConfirmation
from src.models.user import User
from src.models.voice_input import VoiceInput
from src.schemas.item import ItemResponse
from src.schemas.voice import (
    ConfirmationAction,
    InProgressVoiceJob,
    PendingConfirmationResponse,
    VoiceInputCreate,
    VoiceInputResponse,
    VoiceInputRetry,
    VoiceQueueResponse,
)
from src.tasks.reminders import schedule_reminder
from src.tasks.voice_processing import (
    _classify_voice_input_heuristic,
    process_voice_input,
    refine_voice_items,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


def _calculate_reminder_at(due_date: datetime | None, offset: str | None) -> datetime | None:
    """Calculate reminder_at from due_date and optional offset.

    Args:
        due_date: The due datetime
        offset: Offset string like "1h", "30m", "1d" or None

    Returns:
        Reminder datetime: due_date - offset if offset provided, else due_date
    """
    if not due_date:
        return None

    if not offset:
        # No offset means remind at the due time
        return due_date

    # Parse offset string
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


@router.post("", response_model=VoiceInputResponse, status_code=status.HTTP_201_CREATED)
def create_voice_input(
    voice_data: VoiceInputCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Submit voice input for async processing."""
    # Create voice input record
    voice_input = VoiceInput(
        user_id=current_user.id,
        raw_text=voice_data.raw_text,
        status="pending",
    )
    db.add(voice_input)
    db.commit()
    db.refresh(voice_input)

    # Trigger async processing
    process_voice_input.delay(voice_input.id)

    logger.info(f"Created voice input {voice_input.id} for user {current_user.id}")

    return voice_input


@router.post("/instant", response_model=list[ItemResponse], status_code=status.HTTP_201_CREATED)
def create_voice_items_instant(
    voice_data: VoiceInputCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create items immediately using heuristics, queue LLM refinement in background.

    This endpoint:
    1. Uses deterministic heuristics to parse voice input
    2. Creates items immediately on the appropriate list
    3. Queues a background task to refine items with LLM
    4. Returns created items (with refinement_status='pending')
    """
    from src.models.item import Item
    from src.services.heuristic_parser import HeuristicParser

    parser = HeuristicParser()
    raw_text = voice_data.raw_text

    # Get user's lists
    lists = db.query(List).filter(List.owner_id == current_user.id).all()
    task_lists = [lst for lst in lists if lst.list_type == "task"]
    grocery_lists = [lst for lst in lists if lst.list_type != "task"]

    # Step 1: Classify as task or grocery using existing heuristic
    input_type = _classify_voice_input_heuristic(raw_text)

    created_items: list[Item] = []
    now = datetime.now(UTC)

    if input_type == "task":
        if not task_lists:
            raise HTTPException(status_code=400, detail="No task lists available")

        # Find target list
        target_list_id = parser.parse_list_reference(raw_text, lists, "task")
        if not target_list_id:
            # Try to find user's personal list (matching their name)
            user_name = current_user.name.lower() if current_user.name else None
            for lst in task_lists:
                if user_name and lst.name.lower() == user_name:
                    target_list_id = lst.id
                    break
            if not target_list_id:
                target_list_id = task_lists[0].id

        # Parse task details
        task_name = parser.parse_task_name(raw_text)
        due_date = parser.parse_task_due_date(raw_text, now)
        reminder_info = parser.parse_reminder(raw_text)
        recurrence = parser.parse_recurrence(raw_text)

        # Calculate reminder_at
        reminder_at = None
        reminder_offset = None
        if reminder_info["is_immediate"] and due_date:
            reminder_at = due_date
        elif reminder_info["offset"] and due_date:
            reminder_offset = reminder_info["offset"]
            reminder_at = _calculate_reminder_at(due_date, reminder_offset)

        # Get target list name for debug info
        target_list = next((lst for lst in task_lists if lst.id == target_list_id), None)
        target_list_name = target_list.name if target_list else "unknown"

        # Build heuristic debug info
        heuristic_debug = {
            "input_type": "task",
            "list_id": target_list_id,
            "list_name": target_list_name,
            "name": task_name or raw_text,
            "due_date": due_date.isoformat() if due_date else None,
            "reminder_offset": reminder_offset,
            "recurrence_pattern": recurrence,
            "parsed_at": now.isoformat(),
        }

        # Create the task item
        item = Item(
            list_id=target_list_id,
            name=task_name or raw_text,  # Fallback to raw text if parsing fails
            due_date=due_date,
            reminder_at=reminder_at,
            reminder_offset=reminder_offset,
            recurrence_pattern=recurrence,
            created_by=current_user.id,
            refinement_status="pending",
            raw_voice_text=raw_text,
            voice_debug_info={"heuristic": heuristic_debug},
        )
        db.add(item)
        created_items.append(item)

    else:  # grocery
        if not grocery_lists:
            raise HTTPException(status_code=400, detail="No grocery lists available")

        # Find target list
        target_list_id = parser.parse_list_reference(raw_text, lists, "grocery")
        if not target_list_id:
            target_list_id = grocery_lists[0].id

        # Get target list name for debug info
        target_list = next((lst for lst in grocery_lists if lst.id == target_list_id), None)
        target_list_name = target_list.name if target_list else "unknown"

        # Parse items
        item_names = parser.parse_grocery_items(raw_text)
        if not item_names:
            item_names = [raw_text]  # Fallback to raw text as single item

        for item_name in item_names:
            # Try to get category from history (fast, no LLM)
            category_id = lookup_category_from_history(db, item_name, target_list_id)

            # Build heuristic debug info
            heuristic_debug = {
                "input_type": "grocery",
                "list_id": target_list_id,
                "list_name": target_list_name,
                "name": item_name,
                "category_id": category_id,
                "parsed_at": now.isoformat(),
            }

            item = Item(
                list_id=target_list_id,
                name=item_name,
                category_id=category_id,
                created_by=current_user.id,
                refinement_status="pending",
                raw_voice_text=raw_text,
                voice_debug_info={"heuristic": heuristic_debug},
            )
            db.add(item)
            created_items.append(item)

    db.commit()
    for item in created_items:
        db.refresh(item)

    # Queue background refinement task
    item_ids = [item.id for item in created_items]
    refine_voice_items.delay(item_ids, raw_text, current_user.id)

    # Schedule reminders for any task items with due_date or reminder_at
    for item in created_items:
        if item.due_date or item.reminder_at:
            schedule_reminder.delay(item.id)

    logger.info(f"Created {len(created_items)} items via instant voice for user {current_user.id}")

    return created_items


@router.get("/{voice_input_id}", response_model=VoiceInputResponse)
def get_voice_input(
    voice_input_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get voice input by ID."""
    voice_input = db.query(VoiceInput).filter(VoiceInput.id == voice_input_id).first()
    if not voice_input:
        raise HTTPException(status_code=404, detail="Voice input not found")

    if voice_input.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return voice_input


@router.get("/pending/list", response_model=VoiceQueueResponse)
def list_pending_confirmations(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """List in-progress voice jobs and pending confirmations for the current user."""
    # Get in-progress and failed voice inputs
    in_progress = (
        db.query(VoiceInput)
        .filter(
            VoiceInput.user_id == current_user.id,
            VoiceInput.status.in_(["pending", "processing", "failed"]),
        )
        .order_by(VoiceInput.created_at.desc())
        .all()
    )

    # Get pending confirmations with their voice input raw_text
    confirmations = (
        db.query(PendingConfirmation)
        .filter(
            PendingConfirmation.user_id == current_user.id,
            PendingConfirmation.status == "pending",
        )
        .order_by(PendingConfirmation.created_at.desc())
        .all()
    )

    # Build confirmation responses with raw_text from linked VoiceInput
    confirmation_responses = []
    for conf in confirmations:
        voice_input = db.query(VoiceInput).filter(VoiceInput.id == conf.voice_input_id).first()
        raw_text = voice_input.raw_text if voice_input else ""
        confirmation_responses.append(
            PendingConfirmationResponse(
                id=conf.id,
                user_id=conf.user_id,
                voice_input_id=conf.voice_input_id,
                raw_text=raw_text,
                proposed_changes=conf.proposed_changes,
                status=conf.status,
                created_at=conf.created_at,
            )
        )

    return VoiceQueueResponse(
        in_progress=[InProgressVoiceJob.model_validate(vi) for vi in in_progress],
        pending_confirmations=confirmation_responses,
    )


@router.get("/pending/{confirmation_id}", response_model=PendingConfirmationResponse)
def get_pending_confirmation(
    confirmation_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get a specific pending confirmation."""
    confirmation = (
        db.query(PendingConfirmation).filter(PendingConfirmation.id == confirmation_id).first()
    )
    if not confirmation:
        raise HTTPException(status_code=404, detail="Pending confirmation not found")

    if confirmation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Fetch raw_text from VoiceInput
    voice_input = db.query(VoiceInput).filter(VoiceInput.id == confirmation.voice_input_id).first()
    raw_text = voice_input.raw_text if voice_input else ""

    return PendingConfirmationResponse(
        id=confirmation.id,
        user_id=confirmation.user_id,
        voice_input_id=confirmation.voice_input_id,
        raw_text=raw_text,
        proposed_changes=confirmation.proposed_changes,
        status=confirmation.status,
        created_at=confirmation.created_at,
    )


@router.post("/pending/{confirmation_id}/action", response_model=PendingConfirmationResponse)
def action_pending_confirmation(
    confirmation_id: int,
    action_data: ConfirmationAction,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Confirm or reject a pending confirmation."""
    from src.models.item import Item
    from src.services.categorization import CategorizationService

    confirmation = (
        db.query(PendingConfirmation).filter(PendingConfirmation.id == confirmation_id).first()
    )
    if not confirmation:
        raise HTTPException(status_code=404, detail="Pending confirmation not found")

    if confirmation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if confirmation.status != "pending":
        raise HTTPException(status_code=400, detail="Confirmation already processed")

    if action_data.action == "confirm":
        # Apply the proposed changes, with optional edits
        proposed = confirmation.proposed_changes
        action = proposed["action"]
        list_type = proposed.get("list_type", "grocery")

        # Use edited list_id if provided, otherwise use proposed
        list_id = (
            action_data.edits.list_id
            if action_data.edits and action_data.edits.list_id
            else proposed["list_id"]
        )

        # Verify the list belongs to the user
        target_list = db.query(List).filter(List.id == list_id).first()
        if not target_list or target_list.owner_id != current_user.id:
            raise HTTPException(status_code=400, detail="Invalid target list")

        if action == "add":
            # Use edited items if provided, otherwise use proposed
            items_to_add = proposed["items"]
            if action_data.edits and action_data.edits.items:
                items_to_add = [
                    {
                        "name": edit.name,
                        "category_id": edit.category_id,
                        "due_date": edit.due_date.isoformat() if edit.due_date else None,
                        "reminder_offset": edit.reminder_offset,
                        "recurrence_pattern": edit.recurrence_pattern,
                    }
                    for edit in action_data.edits.items
                ]

            items_needing_reminders: list[Item] = []

            if list_type == "task":
                # Create task items with task-specific fields
                for item_data in items_to_add:
                    # Parse due_date from ISO string if provided
                    due_date = None
                    if item_data.get("due_date"):
                        due_date_str = item_data["due_date"]
                        if isinstance(due_date_str, str):
                            try:
                                due_date = datetime.fromisoformat(
                                    due_date_str.replace("Z", "+00:00")
                                )
                            except ValueError:
                                logger.warning(f"Invalid due_date format: {due_date_str}")
                        else:
                            due_date = due_date_str

                    # Calculate reminder_at from due_date and offset
                    reminder_offset = item_data.get("reminder_offset")
                    reminder_at = _calculate_reminder_at(due_date, reminder_offset)

                    item = Item(
                        list_id=list_id,
                        name=item_data["name"],
                        checked=False,
                        due_date=due_date,
                        reminder_at=reminder_at,
                        reminder_offset=reminder_offset,
                        recurrence_pattern=item_data.get("recurrence_pattern"),
                    )
                    db.add(item)

                    # Track items that need reminders scheduled
                    if reminder_at:
                        items_needing_reminders.append(item)
            else:
                # Create grocery items with categorization
                categorization_service = CategorizationService(db)

                for item_data in items_to_add:
                    # Create the item
                    item = Item(
                        list_id=list_id,
                        category_id=item_data.get("category_id"),
                        name=item_data["name"],
                        checked=False,
                    )
                    db.add(item)

                    # Record categorization to history if category was assigned
                    if item_data.get("category_id"):
                        categorization_service.record_categorization(
                            item_name=item_data["name"],
                            category_id=item_data["category_id"],
                            list_id=list_id,
                            user_id=current_user.id,
                        )

        confirmation.status = "confirmed"
        confirmation.confirmed_at = datetime.now(UTC)
        db.commit()
        db.refresh(confirmation)

        # Schedule reminders AFTER commit so items exist in DB
        for item in items_needing_reminders:
            schedule_reminder.delay(item.id)

        logger.info(f"Confirmed pending confirmation {confirmation_id}")

    elif action_data.action == "reject":
        confirmation.status = "rejected"
        confirmation.confirmed_at = datetime.now(UTC)
        db.commit()
        db.refresh(confirmation)

        logger.info(f"Rejected pending confirmation {confirmation_id}")

    else:
        raise HTTPException(status_code=400, detail="Invalid action")

    # Fetch raw_text from VoiceInput for response
    voice_input = db.query(VoiceInput).filter(VoiceInput.id == confirmation.voice_input_id).first()
    raw_text = voice_input.raw_text if voice_input else ""

    return PendingConfirmationResponse(
        id=confirmation.id,
        user_id=confirmation.user_id,
        voice_input_id=confirmation.voice_input_id,
        raw_text=raw_text,
        proposed_changes=confirmation.proposed_changes,
        status=confirmation.status,
        created_at=confirmation.created_at,
    )


@router.delete("/{voice_input_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voice_input(
    voice_input_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Delete a voice input (used to dismiss failed jobs)."""
    voice_input = db.query(VoiceInput).filter(VoiceInput.id == voice_input_id).first()
    if not voice_input:
        raise HTTPException(status_code=404, detail="Voice input not found")

    if voice_input.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    db.delete(voice_input)
    db.commit()

    logger.info(f"Deleted voice input {voice_input_id} for user {current_user.id}")


@router.post("/{voice_input_id}/retry", response_model=VoiceInputResponse)
def retry_voice_input(
    voice_input_id: int,
    retry_data: VoiceInputRetry,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Retry a failed voice input with optionally edited text."""
    voice_input = db.query(VoiceInput).filter(VoiceInput.id == voice_input_id).first()
    if not voice_input:
        raise HTTPException(status_code=404, detail="Voice input not found")

    if voice_input.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if voice_input.status not in ["failed", "pending", "processing"]:
        raise HTTPException(status_code=400, detail="Voice input cannot be retried")

    # Update the voice input with new text and reset status
    voice_input.raw_text = retry_data.raw_text
    voice_input.status = "pending"
    voice_input.error_message = None
    voice_input.result_json = None
    voice_input.processed_at = None
    db.commit()
    db.refresh(voice_input)

    # Trigger async processing
    process_voice_input.delay(voice_input.id)

    logger.info(f"Retrying voice input {voice_input_id} for user {current_user.id}")

    return voice_input
