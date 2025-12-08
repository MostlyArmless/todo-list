"""Pending confirmation model for LLM-suggested changes."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin


class PendingConfirmation(Base, TimestampMixin):
    """LLM-generated changes pending user confirmation."""

    __tablename__ = "pending_confirmations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    voice_input_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    proposed_changes: Mapped[dict] = mapped_column(
        JSON, nullable=False
    )  # {action, list_id, items: [{name, category_id, confidence}]}
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        index=True,
    )  # pending, confirmed, rejected
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<PendingConfirmation(id={self.id}, user_id={self.user_id}, status={self.status})>"
