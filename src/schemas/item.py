"""Item schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ItemCreate(BaseModel):
    """Create a new item."""

    name: str
    description: str | None = None
    quantity: str | None = None
    category_id: int | None = None
    sort_order: int = 0


class ItemUpdate(BaseModel):
    """Update an item."""

    name: str | None = None
    description: str | None = None
    quantity: str | None = None
    category_id: int | None = None
    sort_order: int | None = None


class ItemResponse(BaseModel):
    """Item response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    category_id: int | None
    name: str
    description: str | None
    quantity: str | None
    checked: bool
    checked_at: datetime | None
    sort_order: int
    created_at: datetime
    updated_at: datetime
