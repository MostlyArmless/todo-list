"""Reminder state model for tracking escalation."""

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.enums import ReminderStatus
from src.models.mixins import TimestampMixin


class ReminderState(Base, TimestampMixin):
    """Tracks the escalation state of a reminder for a task item."""

    __tablename__ = "reminder_states"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    current_escalation_level = Column(Integer, default=0)  # 0=push, 1=sms, 2=call
    last_escalation_at = Column(DateTime(timezone=True), nullable=True)
    next_escalation_at = Column(DateTime(timezone=True), nullable=True, index=True)
    status = Column(
        Enum(
            ReminderStatus,
            name="reminderstatus",
            values_callable=lambda x: [e.value for e in x],
        ),
        default=ReminderStatus.PENDING,
        nullable=False,
    )

    # Relationships
    item = relationship("Item", backref="reminder_states")
