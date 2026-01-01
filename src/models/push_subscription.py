"""Push subscription model for web push notifications."""

from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import TimestampMixin


class PushSubscription(Base, TimestampMixin):
    """Stores web push notification subscriptions."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("user_id", "endpoint", name="uq_user_endpoint"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    endpoint = Column(String(500), nullable=False)
    p256dh_key = Column(String(200), nullable=False)
    auth_key = Column(String(100), nullable=False)

    # Relationships
    user = relationship("User", backref="push_subscriptions")
