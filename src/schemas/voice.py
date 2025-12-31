"""Voice input schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VoiceInputCreate(BaseModel):
    """Request to create a voice input."""

    raw_text: str = Field(..., max_length=50000)


class VoiceInputResponse(BaseModel):
    """Voice input response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    raw_text: str
    status: str
    result_json: dict | None
    error_message: str | None
    processed_at: datetime | None
    created_at: datetime


class PendingConfirmationResponse(BaseModel):
    """Pending confirmation response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    voice_input_id: int
    proposed_changes: dict
    status: str
    created_at: datetime


class ItemEdit(BaseModel):
    """Edited item data."""

    name: str = Field(..., max_length=500)
    category_id: int | None = None


class ConfirmationEdits(BaseModel):
    """Optional edits to apply when confirming."""

    list_id: int | None = None
    items: list[ItemEdit] | None = None


class ConfirmationAction(BaseModel):
    """Action to take on a pending confirmation."""

    action: str = Field(..., max_length=50)  # "confirm" or "reject"
    edits: ConfirmationEdits | None = None


class InProgressVoiceJob(BaseModel):
    """In-progress or failed voice processing job."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    raw_text: str
    status: str  # 'pending', 'processing', or 'failed'
    error_message: str | None
    created_at: datetime


class VoiceQueueResponse(BaseModel):
    """Combined response for confirm page with in-progress jobs and pending confirmations."""

    in_progress: list[InProgressVoiceJob]
    pending_confirmations: list[PendingConfirmationResponse]


class VoiceInputRetry(BaseModel):
    """Request to retry a voice input with updated text."""

    raw_text: str = Field(..., max_length=50000)
