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


class ConfirmationAction(BaseModel):
    """Action to take on a pending confirmation."""

    action: str = Field(..., max_length=50)  # "confirm" or "reject"
