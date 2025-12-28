"""Category schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CategoryCreate(BaseModel):
    """Create a new category."""

    name: str = Field(..., max_length=255)
    color: str | None = Field(None, max_length=50)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    """Update a category."""

    name: str | None = Field(None, max_length=255)
    color: str | None = Field(None, max_length=50)
    sort_order: int | None = None


class CategoryResponse(BaseModel):
    """Category response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    name: str
    color: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime
