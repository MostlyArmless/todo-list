"""User notification settings model."""

from sqlalchemy import Column, ForeignKey, Integer, String, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import TimestampMixin


class UserNotificationSettings(Base, TimestampMixin):
    """User-specific notification preferences and accountability settings."""

    __tablename__ = "user_notification_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    phone_number = Column(String(20), nullable=True)  # For SMS/call
    accountability_partner_phone = Column(String(20), nullable=True)  # Partner's phone
    escape_safe_word = Column(String(50), default="abort")
    # {"push_to_sms": 5, "sms_to_call": 15, "call_repeat": 30} (minutes)
    escalation_timing = Column(
        JSONB, default={"push_to_sms": 5, "sms_to_call": 15, "call_repeat": 30}
    )
    quiet_hours_start = Column(Time, nullable=True)  # e.g., 23:00
    quiet_hours_end = Column(Time, nullable=True)  # e.g., 07:00
    quiet_hours_timezone = Column(String(50), default="America/Toronto")

    # Relationships
    user = relationship("User", backref="notification_settings")
