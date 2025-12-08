"""Category model."""

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import SoftDeleteMixin, TimestampMixin


class Category(Base, TimestampMixin, SoftDeleteMixin):
    """Category model for organizing items within lists."""

    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    sort_order = Column(Integer, default=0)
    color = Column(String(20), nullable=True)

    # Relationships
    list = relationship("List", back_populates="categories")
    items = relationship("Item", back_populates="category")
