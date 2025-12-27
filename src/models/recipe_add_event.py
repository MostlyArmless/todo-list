"""RecipeAddEvent models for tracking add-to-list operations."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import TimestampMixin


class RecipeAddEvent(Base, TimestampMixin):
    """Tracks each 'add recipes to list' operation for undo capability."""

    __tablename__ = "recipe_add_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    undone_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    items = relationship("RecipeAddEventItem", back_populates="event", cascade="all, delete-orphan")


class RecipeAddEventItem(Base):
    """Tracks individual items affected by an add-to-list event."""

    __tablename__ = "recipe_add_event_items"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("recipe_add_events.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False)
    action = Column(String(20), nullable=False)  # "created" or "merged"

    # For merged items: store original state to restore on undo
    original_quantity = Column(String(100), nullable=True)
    original_recipe_sources = Column(JSON, nullable=True)

    # What was added by this event
    added_quantity = Column(String(100), nullable=True)
    added_recipe_sources = Column(JSON, nullable=True)

    # Relationships
    event = relationship("RecipeAddEvent", back_populates="items")
