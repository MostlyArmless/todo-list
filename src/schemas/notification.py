"""Notification-related Pydantic schemas."""

from datetime import datetime, time

from pydantic import BaseModel


class PushSubscriptionCreate(BaseModel):
    """Schema for creating a push subscription."""

    endpoint: str
    p256dh_key: str
    auth_key: str


class PushSubscriptionResponse(BaseModel):
    """Schema for push subscription response."""

    id: int
    endpoint: str
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationSettingsUpdate(BaseModel):
    """Schema for updating notification settings."""

    phone_number: str | None = None
    accountability_partner_phone: str | None = None
    escape_safe_word: str | None = None
    escalation_timing: dict | None = None
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    quiet_hours_timezone: str | None = None


class NotificationSettingsResponse(BaseModel):
    """Schema for notification settings response."""

    id: int
    phone_number: str | None
    accountability_partner_phone: str | None
    escape_safe_word: str
    escalation_timing: dict
    quiet_hours_start: time | None
    quiet_hours_end: time | None
    quiet_hours_timezone: str

    model_config = {"from_attributes": True}


class VapidPublicKeyResponse(BaseModel):
    """Schema for VAPID public key response."""

    public_key: str | None


class ReminderResponseCreate(BaseModel):
    """Schema for submitting a response to a reminder."""

    item_id: int
    response: str


class ReminderResponseResult(BaseModel):
    """Schema for reminder response processing result."""

    action: str
    new_reminder_at: str | None = None
    pushback_message: str | None = None
