"""Item schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ItemCreate(BaseModel):
    """Create a new item (works for both grocery and task lists).

    For grocery lists: use quantity, category_id
    For task lists: use due_date, reminder_at, reminder_offset, recurrence_pattern
    """

    name: str = Field(..., max_length=500)
    description: str | None = Field(None, max_length=2000)
    sort_order: int = 0
    # Grocery-specific fields
    quantity: str | None = Field(None, max_length=50)
    category_id: int | None = None
    # Task-specific fields
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    reminder_offset: str | None = Field(None, max_length=20)  # "1h", "1d", "30m"
    recurrence_pattern: Literal["daily", "weekly", "monthly"] | None = None

    @field_validator("recurrence_pattern", mode="before")
    @classmethod
    def empty_string_to_none(cls, v: str | None) -> str | None:
        """Convert empty string to None for recurrence_pattern."""
        if v == "":
            return None
        return v


class TaskItemCreate(BaseModel):
    """Create a new task item (for task lists). Deprecated - use ItemCreate instead."""

    name: str = Field(..., max_length=500)
    description: str | None = Field(None, max_length=2000)
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    reminder_offset: str | None = Field(None, max_length=20)  # "1h", "1d", "30m"
    recurrence_pattern: Literal["daily", "weekly", "monthly"] | None = None
    sort_order: int = 0


class ItemUpdate(BaseModel):
    """Update an item (works for both grocery and task lists).

    For grocery lists: use quantity, category_id
    For task lists: use due_date, reminder_at, reminder_offset, recurrence_pattern
    """

    name: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=2000)
    sort_order: int | None = None
    # Grocery-specific fields
    quantity: str | None = Field(None, max_length=50)
    category_id: int | None = None
    # Task-specific fields
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    reminder_offset: str | None = Field(None, max_length=20)
    recurrence_pattern: Literal["daily", "weekly", "monthly"] | None = None

    @field_validator("recurrence_pattern", mode="before")
    @classmethod
    def empty_string_to_none(cls, v: str | None) -> str | None:
        """Convert empty string to None for recurrence_pattern."""
        if v == "":
            return None
        return v


class TaskItemUpdate(BaseModel):
    """Update a task item. Deprecated - use ItemUpdate instead."""

    name: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=2000)
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    reminder_offset: str | None = Field(None, max_length=20)
    recurrence_pattern: Literal["daily", "weekly", "monthly"] | None = None
    sort_order: int | None = None


class ItemResponse(BaseModel):
    """Item response (includes all fields, task fields will be null for grocery items)."""

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
    recipe_sources: list[dict] | None = None
    # Task-specific fields (null for grocery items)
    due_date: datetime | None = None
    reminder_at: datetime | None = None
    reminder_offset: str | None = None
    recurrence_pattern: str | None = None
    recurrence_parent_id: int | None = None
    completed_at: datetime | None = None
    # Voice processing fields
    refinement_status: str | None = None
    raw_voice_text: str | None = None


class TaskItemResponse(ItemResponse):
    """Task item response with computed fields."""

    @property
    def is_overdue(self) -> bool:
        """Check if task is overdue."""
        if self.due_date and not self.checked:
            return datetime.now(self.due_date.tzinfo) > self.due_date
        return False
