"""Pantry item model for tracking staples/spices at home."""

from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import TimestampMixin


class PantryItem(Base, TimestampMixin):
    """Pantry item for tracking what the user has at home."""

    __tablename__ = "pantry_items"
    __table_args__ = (
        UniqueConstraint("user_id", "normalized_name", name="uq_pantry_user_normalized_name"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)  # Display name
    normalized_name = Column(String(255), nullable=False)  # Lowercase, trimmed for matching
    status = Column(String(20), nullable=False, default="have")  # "have" | "low" | "out"
    category = Column(String(100), nullable=True)  # Optional: "spices", "baking", "canned", etc.
    preferred_store = Column(String(50), nullable=True)  # "Grocery" | "Costco" | null

    # Relationships
    user = relationship("User", backref="pantry_items")
