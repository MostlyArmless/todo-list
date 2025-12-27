"""Pantry schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PantryItemCreate(BaseModel):
    """Create a pantry item."""

    name: str = Field(..., min_length=1, max_length=255)
    status: Literal["have", "low", "out"] = "have"
    category: str | None = Field(None, max_length=100)


class PantryItemUpdate(BaseModel):
    """Update a pantry item."""

    name: str | None = Field(None, min_length=1, max_length=255)
    status: Literal["have", "low", "out"] | None = None
    category: str | None = None


class PantryItemResponse(BaseModel):
    """Pantry item response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    normalized_name: str
    status: str
    category: str | None
    created_at: datetime
    updated_at: datetime


class PantryBulkAddRequest(BaseModel):
    """Bulk add items to pantry."""

    items: list[PantryItemCreate]


class PantryBulkAddResponse(BaseModel):
    """Result of bulk adding to pantry."""

    added: int
    updated: int
    items: list[PantryItemResponse]
