"""List model."""

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import SoftDeleteMixin, TimestampMixin


class List(Base, TimestampMixin, SoftDeleteMixin):
    """List model for organizing items (shopping lists, todo lists, etc.)."""

    __tablename__ = "lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    description = Column(String, nullable=True)
    icon = Column(String(50), nullable=True)  # emoji or icon name
    sort_order = Column(Integer, default=0)

    # Relationships
    owner = relationship("User", backref="lists")
    categories = relationship("Category", back_populates="list", cascade="all, delete-orphan")
    items = relationship("Item", back_populates="list", cascade="all, delete-orphan")
    shares = relationship("ListShare", back_populates="list", cascade="all, delete-orphan")


class ListShare(Base, TimestampMixin):
    """List sharing model for multi-user access."""

    __tablename__ = "list_shares"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    permission = Column(String(20), default="edit")  # 'view', 'edit', 'admin'

    # Relationships
    list = relationship("List", back_populates="shares")
    user = relationship("User", backref="shared_lists")
