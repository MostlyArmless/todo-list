"""Enums for model fields."""

from enum import Enum


class Permission(str, Enum):
    """Permission levels for shared lists."""

    VIEW = "view"
    EDIT = "edit"
    ADMIN = "admin"

    def can_edit(self) -> bool:
        """Check if this permission allows editing."""
        return self in (Permission.EDIT, Permission.ADMIN)

    def can_admin(self) -> bool:
        """Check if this permission allows admin actions."""
        return self == Permission.ADMIN
