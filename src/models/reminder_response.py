"""Reminder response model for logging user responses."""

from sqlalchemy import Column, Enum, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.enums import NotificationChannel
from src.models.mixins import TimestampMixin


class ReminderResponse(Base, TimestampMixin):
    """Logs user responses to reminder notifications."""

    __tablename__ = "reminder_responses"

    id = Column(Integer, primary_key=True, index=True)
    reminder_state_id = Column(
        Integer, ForeignKey("reminder_states.id"), nullable=False, index=True
    )
    channel = Column(
        Enum(
            NotificationChannel,
            name="notificationchannel",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    raw_response = Column(Text, nullable=False)
    llm_interpretation = Column(JSONB, nullable=True)
    # {action: "reschedule", new_time: "...", pushback_message: "..."}

    # Relationships
    reminder_state = relationship("ReminderState", backref="responses")
