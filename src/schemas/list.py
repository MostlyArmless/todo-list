"""List schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ListCreate(BaseModel):
    """Create a new list."""

    name: str
    description: str | None = None
    icon: str | None = None


class ListUpdate(BaseModel):
    """Update a list."""

    name: str | None = None
    description: str | None = None
    icon: str | None = None
    sort_order: int | None = None


class ListResponse(BaseModel):
    """List response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    icon: str | None
    sort_order: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    unchecked_count: int = 0


class ListShareCreate(BaseModel):
    """Share a list with another user."""

    user_email: str
    permission: str = "edit"  # 'view', 'edit', 'admin'
