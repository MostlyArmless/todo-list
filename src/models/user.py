"""User model."""

from sqlalchemy import Column, Integer, String

from src.database import Base
from src.models.mixins import TimestampMixin


class User(Base, TimestampMixin):
    """User model for authentication and ownership."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
