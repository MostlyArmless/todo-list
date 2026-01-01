"""Notification API endpoints for push subscriptions and settings."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.config import get_settings
from src.database import get_db
from src.models import PushSubscription, ReminderState, UserNotificationSettings
from src.models.enums import ReminderStatus
from src.models.user import User
from src.schemas.notification import (
    NotificationSettingsResponse,
    NotificationSettingsUpdate,
    PushSubscriptionCreate,
    PushSubscriptionResponse,
    ReminderResponseCreate,
    ReminderResponseResult,
    VapidPublicKeyResponse,
)
from src.tasks.reminders import process_reminder_response

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key() -> VapidPublicKeyResponse:
    """Get the VAPID public key for push notification subscription."""
    settings = get_settings()
    return VapidPublicKeyResponse(public_key=settings.vapid_public_key)


@router.post("/subscribe", response_model=PushSubscriptionResponse)
async def subscribe_push(
    subscription: PushSubscriptionCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PushSubscription:
    """Subscribe to push notifications."""
    # Check if subscription already exists
    existing = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == current_user.id,
            PushSubscription.endpoint == subscription.endpoint,
        )
        .first()
    )

    if existing:
        # Update keys if changed
        existing.p256dh_key = subscription.p256dh_key
        existing.auth_key = subscription.auth_key
        db.commit()
        db.refresh(existing)
        return existing

    # Create new subscription
    push_sub = PushSubscription(
        user_id=current_user.id,
        endpoint=subscription.endpoint,
        p256dh_key=subscription.p256dh_key,
        auth_key=subscription.auth_key,
    )
    db.add(push_sub)
    db.commit()
    db.refresh(push_sub)
    return push_sub


@router.delete("/subscribe")
async def unsubscribe_push(
    endpoint: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Unsubscribe from push notifications."""
    subscription = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == current_user.id,
            PushSubscription.endpoint == endpoint,
        )
        .first()
    )

    if subscription:
        db.delete(subscription)
        db.commit()
        return {"message": "Unsubscribed successfully"}

    return {"message": "Subscription not found"}


@router.get("/settings", response_model=NotificationSettingsResponse)
async def get_notification_settings(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserNotificationSettings:
    """Get notification settings for the current user."""
    settings = (
        db.query(UserNotificationSettings)
        .filter(UserNotificationSettings.user_id == current_user.id)
        .first()
    )

    if not settings:
        # Create default settings
        settings = UserNotificationSettings(user_id=current_user.id)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return settings


@router.put("/settings", response_model=NotificationSettingsResponse)
async def update_notification_settings(
    settings_update: NotificationSettingsUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserNotificationSettings:
    """Update notification settings for the current user."""
    settings = (
        db.query(UserNotificationSettings)
        .filter(UserNotificationSettings.user_id == current_user.id)
        .first()
    )

    if not settings:
        settings = UserNotificationSettings(user_id=current_user.id)
        db.add(settings)

    # Update fields that are provided
    update_data = settings_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(settings, field, value)

    db.commit()
    db.refresh(settings)
    return settings


@router.post("/respond", response_model=ReminderResponseResult)
async def respond_to_reminder(
    response: ReminderResponseCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ReminderResponseResult:
    """Submit a response to a task reminder from the app."""
    from src.models import Item

    # Find the item and verify access
    item = db.query(Item).filter(Item.id == response.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Verify user owns the list
    if item.list.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Find active reminder for this item
    reminder = (
        db.query(ReminderState)
        .filter(
            ReminderState.item_id == response.item_id,
            ReminderState.status == ReminderStatus.PENDING,
        )
        .first()
    )

    if not reminder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active reminder found for this item",
        )

    # Process the response synchronously for immediate feedback
    result = process_reminder_response.apply(args=[reminder.id, "app", response.response]).get(
        timeout=30
    )

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result["error"],
        )

    return ReminderResponseResult(
        action=result.get("action", "unknown"),
        new_reminder_at=result.get("new_reminder_at"),
        pushback_message=result.get("pushback_message"),
    )
