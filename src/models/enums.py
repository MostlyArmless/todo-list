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


class ListType(str, Enum):
    """Type of list - determines available features."""

    GROCERY = "grocery"
    TASK = "task"


class RecurrencePattern(str, Enum):
    """Recurrence pattern for task items."""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ReminderStatus(str, Enum):
    """Status of a reminder escalation."""

    PENDING = "pending"
    ACKNOWLEDGED = "acknowledged"
    COMPLETED = "completed"
    ESCAPED = "escaped"


class NotificationChannel(str, Enum):
    """Channel through which notification was sent/received."""

    PUSH = "push"
    SMS = "sms"
    CALL = "call"
    APP = "app"
