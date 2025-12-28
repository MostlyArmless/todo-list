"""ReceiptScan model for tracking receipt upload and processing."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import TimestampMixin


class ReceiptScan(Base, TimestampMixin):
    """Model for tracking receipt scan uploads and their processing status."""

    __tablename__ = "receipt_scans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(
        String(20), nullable=False, default="pending"
    )  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)

    # Parsed items from the receipt (list of {name, quantity?, matched_pantry_id?})
    parsed_items = Column(JSONB, nullable=True)

    # Summary of what was done
    items_added = Column(Integer, nullable=True)
    items_updated = Column(Integer, nullable=True)

    # When processing completed
    processed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", backref="receipt_scans")
