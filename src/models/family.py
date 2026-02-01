"""Family models for list sharing."""

from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from src.database import Base
from src.models.mixins import TimestampMixin


class Family(Base, TimestampMixin):
    """Family entity for group list sharing."""

    __tablename__ = "families"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    members = relationship("FamilyMember", back_populates="family", cascade="all, delete-orphan")
    list_shares = relationship(
        "ListFamilyShare", back_populates="family", cascade="all, delete-orphan"
    )


class FamilyMember(Base, TimestampMixin):
    """Family membership with role (admin/member)."""

    __tablename__ = "family_members"

    id = Column(Integer, primary_key=True, index=True)
    family_id = Column(Integer, ForeignKey("families.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    role = Column(String(20), nullable=False, default="member")  # 'admin' | 'member'

    # Relationships
    family = relationship("Family", back_populates="members")
    user = relationship("User", backref="family_membership")

    def is_admin(self) -> bool:
        """Check if this member is an admin."""
        return self.role == "admin"


class ListFamilyShare(Base, TimestampMixin):
    """Share a list with an entire family."""

    __tablename__ = "list_family_shares"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False, index=True)
    family_id = Column(Integer, ForeignKey("families.id"), nullable=False, index=True)
    permission = Column(String(20), nullable=False, default="edit")  # 'view' | 'edit' | 'admin'

    # Unique constraint: a list can only be shared with a family once
    __table_args__ = (UniqueConstraint("list_id", "family_id", name="uq_list_family_share"),)

    # Relationships
    list = relationship("List", backref="family_shares")
    family = relationship("Family", back_populates="list_shares")
