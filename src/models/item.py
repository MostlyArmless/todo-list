"""Item model."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import relationship

from src.database import Base
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
    recipe_sources = Column(JSON, nullable=True)

    # Relationships
    list = relationship("List", back_populates="items")
    category = relationship("Category", back_populates="items")
    checked_by_user = relationship("User", foreign_keys=[checked_by])
    created_by_user = relationship("User", foreign_keys=[created_by])
