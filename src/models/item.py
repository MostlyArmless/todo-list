"""Item model."""

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.enums import RecurrencePattern
from src.models.mixins import SoftDeleteMixin, TimestampMixin


class Item(Base, TimestampMixin, SoftDeleteMixin):
    """Item model for tasks/products in lists."""

    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True, index=True)
    name = Column(String(500), nullable=False)
    description = Column(String, nullable=True)
    quantity = Column(String(50), nullable=True)  # "2 lbs", "1 gallon", etc.
    checked = Column(Boolean, default=False, index=True)
    checked_at = Column(DateTime(timezone=True), nullable=True)
    checked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    sort_order = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Recipe sources: [{"recipe_id": 1, "recipe_name": "Pasta"}, ...]
    recipe_sources = Column(JSONB, nullable=True)

    # Task-specific fields (only used when parent list is task type)
    due_date = Column(DateTime(timezone=True), nullable=True, index=True)
    reminder_at = Column(DateTime(timezone=True), nullable=True, index=True)
    reminder_offset = Column(String(20), nullable=True)  # "1h", "1d", "30m" - relative to due_date
    recurrence_pattern = Column(
        Enum(
            RecurrencePattern,
            name="recurrencepattern",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
    recurrence_parent_id = Column(Integer, ForeignKey("items.id"), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)  # For task completion history

    # Relationships
    list = relationship("List", back_populates="items")
    category = relationship("Category", back_populates="items")
    checked_by_user = relationship("User", foreign_keys=[checked_by])
    created_by_user = relationship("User", foreign_keys=[created_by])
    recurrence_parent = relationship("Item", remote_side=[id], backref="recurrence_children")
