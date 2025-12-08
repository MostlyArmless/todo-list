"""Item history model for categorization learning."""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from src.database import Base


class ItemHistory(Base):
    """Item history model to track categorization patterns."""

    __tablename__ = "item_history"

    id = Column(Integer, primary_key=True, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    occurrence_count = Column(Integer, default=1)
    last_used_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
