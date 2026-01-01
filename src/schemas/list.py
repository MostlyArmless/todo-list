"""List schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ListCreate(BaseModel):
    """Create a new list."""

    name: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    icon: str | None = Field(None, max_length=50)
    list_type: Literal["grocery", "task"] = "grocery"


class ListUpdate(BaseModel):
    """Update a list."""

    name: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)
    icon: str | None = Field(None, max_length=50)
    sort_order: int | None = None
    # Note: list_type is intentionally not included - it's immutable after creation


class ListResponse(BaseModel):
    """List response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    icon: str | None
    sort_order: int
    owner_id: int
    list_type: str
    created_at: datetime
    updated_at: datetime
    unchecked_count: int = 0


class ListShareCreate(BaseModel):
    """Share a list with another user."""

    user_email: str = Field(..., max_length=255)
    permission: str = Field("edit", max_length=50)  # 'view', 'edit', 'admin'
