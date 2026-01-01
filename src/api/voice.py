"""Voice input API endpoints."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.database import get_db
from src.models.list import List
from src.models.pending_confirmation import PendingConfirmation
from src.models.user import User
from src.models.voice_input import VoiceInput
from src.schemas.voice import (
    ConfirmationAction,
    InProgressVoiceJob,
    PendingConfirmationResponse,
    VoiceInputCreate,
    VoiceInputResponse,
    VoiceInputRetry,
    VoiceQueueResponse,
)
from src.tasks.voice_processing import process_voice_input

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


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

    # Get pending confirmations
    confirmations = (
        db.query(PendingConfirmation)
        .filter(
            PendingConfirmation.user_id == current_user.id,
            PendingConfirmation.status == "pending",
        )
        .order_by(PendingConfirmation.created_at.desc())
        .all()
    )

    return VoiceQueueResponse(
        in_progress=[InProgressVoiceJob.model_validate(vi) for vi in in_progress],
        pending_confirmations=confirmations,
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

    return confirmation


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

                    item = Item(
                        list_id=list_id,
                        name=item_data["name"],
                        checked=False,
                        due_date=due_date,
                        reminder_offset=item_data.get("reminder_offset"),
                        recurrence_pattern=item_data.get("recurrence_pattern"),
                    )
                    db.add(item)
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

        logger.info(f"Confirmed pending confirmation {confirmation_id}")

    elif action_data.action == "reject":
        confirmation.status = "rejected"
        confirmation.confirmed_at = datetime.now(UTC)
        db.commit()
        db.refresh(confirmation)

        logger.info(f"Rejected pending confirmation {confirmation_id}")

    else:
        raise HTTPException(status_code=400, detail="Invalid action")

    return confirmation


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
