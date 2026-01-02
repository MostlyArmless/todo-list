"""Item API endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.api.lists import get_user_list
from src.database import get_db
from src.models.enums import ListType
from src.models.item import Item
from src.models.item_history import ItemHistory
from src.models.list import List
from src.models.user import User
from src.schemas.item import ItemCreate, ItemResponse, ItemUpdate
from src.tasks.reminders import schedule_reminder

router = APIRouter(prefix="/api/v1", tags=["items"])


def _calculate_reminder_at(due_date: datetime | None, offset: str | None) -> datetime | None:
    """Calculate reminder_at from due_date and optional offset.

    Args:
        due_date: The due datetime
        offset: Offset string like "1h", "30m", "1d", "0m" or None

    Returns:
        Reminder datetime: due_date - offset if offset provided, else None
    """
    if not due_date or not offset:
        return None

    # Parse offset string
    unit = offset[-1].lower()
    try:
        value = int(offset[:-1])
    except ValueError:
        return due_date

    if unit == "m":
        delta = timedelta(minutes=value)
    elif unit == "h":
        delta = timedelta(hours=value)
    elif unit == "d":
        delta = timedelta(days=value)
    else:
        return due_date

    return due_date - delta


def validate_item_fields_for_list_type(item_data: ItemCreate | ItemUpdate, list_obj: List) -> None:
    """Validate that item fields are appropriate for the list type.

    Raises HTTPException if invalid fields are provided.
    """
    is_task_list = list_obj.list_type == ListType.TASK

    if is_task_list:
        # Task lists don't support grocery-specific fields
        if hasattr(item_data, "quantity") and item_data.quantity is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task lists do not support quantity field",
            )
        if hasattr(item_data, "category_id") and item_data.category_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task lists do not support categories",
            )
    else:
        # Grocery lists don't support task-specific fields
        task_fields = ["due_date", "reminder_at", "reminder_offset", "recurrence_pattern"]
        for field in task_fields:
            if hasattr(item_data, field) and getattr(item_data, field) is not None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Grocery lists do not support {field} field",
                )


def validate_category_id(db: Session, category_id: int | None, list_id: int) -> int | None:
    """Validate that a category_id is valid for the given list.

    Returns the category_id if valid, None if category_id was None or invalid.
    Silently returns None for deleted/invalid categories rather than raising an error,
    allowing items to be created as uncategorized.
    """
    if category_id is None:
        return None

    from src.models.category import Category

    category = (
        db.query(Category)
        .filter(
            Category.id == category_id,
            Category.list_id == list_id,
            Category.deleted_at.is_(None),
        )
        .first()
    )
    return category_id if category else None


def lookup_category_from_history(db: Session, item_name: str, list_id: int) -> int | None:
    """Look up category_id from item history for exact match.

    Returns category_id if found in history and category is not deleted, None otherwise.
    """
    from src.models.category import Category

    normalized = item_name.lower().strip()
    history = (
        db.query(ItemHistory)
        .filter(
            ItemHistory.list_id == list_id,
            ItemHistory.normalized_name == normalized,
        )
        .order_by(ItemHistory.occurrence_count.desc())
        .first()
    )
    if history and history.category_id:
        # Verify the category still exists and is not deleted
        category = (
            db.query(Category)
            .filter(
                Category.id == history.category_id,
                Category.deleted_at.is_(None),
            )
            .first()
        )
        if category:
            return history.category_id
    return None


def get_item(db: Session, item_id: int, user: User) -> Item:
    """Get an item that belongs to a list the user has access to."""
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    # Verify user has access to the list
    get_user_list(db, item.list_id, user)

    return item


@router.get("/lists/{list_id}/items", response_model=list[ItemResponse])
def get_items(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    include_checked: bool = Query(default=False, description="Include checked items"),
):
    """Get all items for a list."""
    # Verify user has access to the list
    get_user_list(db, list_id, current_user)

    query = db.query(Item).filter(Item.list_id == list_id, Item.deleted_at.is_(None))

    if not include_checked:
        query = query.filter(Item.checked.is_(False))

    items = query.order_by(Item.sort_order).all()
    return items


@router.post(
    "/lists/{list_id}/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED
)
def create_item(
    list_id: int,
    item_data: ItemCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new item in a list, merging with existing if same name exists."""
    # Verify user has access to the list
    list_obj = get_user_list(db, list_id, current_user)

    # Validate item fields match list type
    validate_item_fields_for_list_type(item_data, list_obj)

    is_task_list = list_obj.list_type == ListType.TASK
    normalized_name = item_data.name.lower().strip()

    # Check for existing unchecked item with same name (for merging)
    existing_item = (
        db.query(Item)
        .filter(
            Item.list_id == list_id,
            Item.deleted_at.is_(None),
            Item.checked.is_(False),
        )
        .all()
    )
    matching_item = None
    for item in existing_item:
        if item.name.lower().strip() == normalized_name:
            matching_item = item
            break

    if matching_item and not is_task_list:
        # Merge with existing item (only for grocery lists)
        # Ad-hoc source marker
        adhoc_source = {"recipe_id": None, "recipe_name": "Ad-hoc"}

        if item_data.quantity:
            if matching_item.quantity:
                matching_item.quantity = f"{matching_item.quantity} + {item_data.quantity}"
            else:
                matching_item.quantity = item_data.quantity

        # Add ad-hoc to recipe_sources
        existing_sources = matching_item.recipe_sources or []
        # Check if ad-hoc already exists, if not add it
        if not any(s.get("recipe_id") is None for s in existing_sources):
            existing_sources.append(adhoc_source)
        matching_item.recipe_sources = existing_sources

        db.commit()
        db.refresh(matching_item)
        return matching_item
    else:
        # Create new item
        if is_task_list:
            # Calculate reminder_at from due_date and offset if not explicitly provided
            reminder_at = item_data.reminder_at
            if reminder_at is None and item_data.due_date and item_data.reminder_offset:
                reminder_at = _calculate_reminder_at(item_data.due_date, item_data.reminder_offset)

            # Task list item - no category, no quantity
            item = Item(
                list_id=list_id,
                name=item_data.name,
                description=item_data.description,
                sort_order=item_data.sort_order,
                created_by=current_user.id,
                due_date=item_data.due_date,
                reminder_at=reminder_at,
                reminder_offset=item_data.reminder_offset,
                recurrence_pattern=item_data.recurrence_pattern,
            )
        else:
            # Grocery list item - determine category_id
            category_id = item_data.category_id
            if category_id is not None:
                # Validate the provided category_id
                category_id = validate_category_id(db, category_id, list_id)
            if category_id is None:
                # Check item history for an exact match (no LLM call needed)
                category_id = lookup_category_from_history(db, item_data.name, list_id)

            item = Item(
                list_id=list_id,
                name=item_data.name,
                description=item_data.description,
                quantity=item_data.quantity,
                category_id=category_id,
                sort_order=item_data.sort_order,
                created_by=current_user.id,
            )
        db.add(item)
        db.commit()
        db.refresh(item)

        # Schedule reminder for task items with due date or reminder
        if is_task_list and (item.due_date or item.reminder_at):
            schedule_reminder.delay(item.id)

        return item


@router.put("/items/{item_id}", response_model=ItemResponse)
def update_item(
    item_id: int,
    item_data: ItemUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update an item."""
    item = get_item(db, item_id, current_user)

    # Get the list to validate fields
    list_obj = db.query(List).filter(List.id == item.list_id).first()
    validate_item_fields_for_list_type(item_data, list_obj)

    is_task_list = list_obj.list_type == ListType.TASK

    # Common fields
    if item_data.name is not None:
        item.name = item_data.name
    if item_data.description is not None:
        # Empty string clears the field
        item.description = item_data.description or None
    if item_data.sort_order is not None:
        item.sort_order = item_data.sort_order

    if is_task_list:
        # Task-specific fields
        if item_data.due_date is not None:
            item.due_date = item_data.due_date
        if item_data.reminder_at is not None:
            item.reminder_at = item_data.reminder_at
        if item_data.reminder_offset is not None:
            item.reminder_offset = item_data.reminder_offset or None
        if item_data.recurrence_pattern is not None:
            item.recurrence_pattern = item_data.recurrence_pattern

        # Recalculate reminder_at if due_date or reminder_offset changed
        if item_data.due_date is not None or item_data.reminder_offset is not None:
            effective_offset = (
                item_data.reminder_offset
                if item_data.reminder_offset is not None
                else item.reminder_offset
            )
            effective_due = item_data.due_date if item_data.due_date is not None else item.due_date
            if effective_offset and effective_due:
                item.reminder_at = _calculate_reminder_at(effective_due, effective_offset)
            elif effective_offset == "" and effective_due:
                # Empty string means "no reminder" - clear reminder_at
                item.reminder_at = None
    else:
        # Grocery-specific fields
        if item_data.quantity is not None:
            # Empty string clears the field
            item.quantity = item_data.quantity or None
        if item_data.category_id is not None:
            # Validate category_id before setting (silently ignores invalid/deleted categories)
            item.category_id = validate_category_id(db, item_data.category_id, item.list_id)

    db.commit()
    db.refresh(item)

    # Reschedule reminder if task reminder fields changed
    if (
        is_task_list
        and (
            item_data.due_date is not None
            or item_data.reminder_at is not None
            or item_data.reminder_offset is not None
        )
        and (item.due_date or item.reminder_at)
    ):
        schedule_reminder.delay(item.id)

    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Soft delete an item."""
    from src.models import ReminderState
    from src.models.enums import ReminderStatus

    item = get_item(db, item_id, current_user)

    # Cancel any pending reminders for this item
    db.query(ReminderState).filter(
        ReminderState.item_id == item_id,
        ReminderState.status == ReminderStatus.PENDING,
    ).update({"status": ReminderStatus.COMPLETED})

    item.soft_delete()
    db.commit()


@router.post("/items/{item_id}/check", response_model=ItemResponse)
def check_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Check off an item."""
    item = get_item(db, item_id, current_user)

    item.checked = True
    item.checked_at = datetime.now(UTC)
    item.checked_by = current_user.id

    db.commit()
    db.refresh(item)
    return item


@router.post("/items/{item_id}/uncheck", response_model=ItemResponse)
def uncheck_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Uncheck an item."""
    item = get_item(db, item_id, current_user)

    item.checked = False
    item.checked_at = None
    item.checked_by = None

    db.commit()
    db.refresh(item)
    return item


@router.post("/items/{item_id}/complete", response_model=ItemResponse)
def complete_task_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Complete a task item (for task lists only).

    Marks the item as checked and sets completed_at.
    If the item has a recurrence pattern, creates the next occurrence.
    """
    from dateutil.relativedelta import relativedelta

    item = get_item(db, item_id, current_user)

    # Verify this is a task list item
    list_obj = db.query(List).filter(List.id == item.list_id).first()
    if list_obj.list_type != ListType.TASK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete endpoint is only for task list items",
        )

    # Mark as completed
    now = datetime.now(UTC)
    item.checked = True
    item.checked_at = now
    item.checked_by = current_user.id
    item.completed_at = now

    # Handle recurrence - create next occurrence
    if item.recurrence_pattern and item.due_date:
        # Calculate next due date based on pattern
        if item.recurrence_pattern == "daily":
            next_due = item.due_date + relativedelta(days=1)
        elif item.recurrence_pattern == "weekly":
            next_due = item.due_date + relativedelta(weeks=1)
        elif item.recurrence_pattern == "monthly":
            next_due = item.due_date + relativedelta(months=1)
        else:
            next_due = None

        if next_due:
            # Calculate next reminder based on offset or original reminder
            next_reminder = None
            if item.reminder_offset and item.due_date:
                # Parse offset and apply to new due date
                # Format: "1h", "30m", "1d"
                offset_str = item.reminder_offset.lower()
                if offset_str.endswith("h"):
                    hours = int(offset_str[:-1])
                    next_reminder = next_due - relativedelta(hours=hours)
                elif offset_str.endswith("m"):
                    minutes = int(offset_str[:-1])
                    next_reminder = next_due - relativedelta(minutes=minutes)
                elif offset_str.endswith("d"):
                    days = int(offset_str[:-1])
                    next_reminder = next_due - relativedelta(days=days)
            elif item.reminder_at and item.due_date:
                # Calculate the offset from the original due_date to reminder_at
                # and apply it to the new due date
                offset = item.due_date - item.reminder_at
                next_reminder = next_due - offset

            # Create next occurrence
            next_item = Item(
                list_id=item.list_id,
                name=item.name,
                description=item.description,
                sort_order=item.sort_order,
                created_by=current_user.id,
                due_date=next_due,
                reminder_at=next_reminder,
                reminder_offset=item.reminder_offset,
                recurrence_pattern=item.recurrence_pattern,
                recurrence_parent_id=item.recurrence_parent_id or item.id,
            )
            db.add(next_item)

    db.commit()
    db.refresh(item)
    return item


@router.post("/lists/{list_id}/items/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def bulk_delete_items(
    list_id: int,
    item_ids: list[int],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Bulk soft delete items."""
    # Verify user has access to the list
    get_user_list(db, list_id, current_user)

    items = (
        db.query(Item)
        .filter(Item.id.in_(item_ids), Item.list_id == list_id, Item.deleted_at.is_(None))
        .all()
    )

    for item in items:
        item.soft_delete()

    db.commit()


@router.post("/lists/{list_id}/items/auto-categorize")
def auto_categorize_items(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Auto-categorize uncategorized items using history and LLM."""
    from src.services.categorization import CategorizationService

    # Verify user has access to the list
    list_obj = get_user_list(db, list_id, current_user)

    # Task lists don't support categories
    if list_obj.list_type == ListType.TASK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task lists do not support categories",
        )

    # Get uncategorized items
    uncategorized = (
        db.query(Item)
        .filter(
            Item.list_id == list_id,
            Item.category_id.is_(None),
            Item.deleted_at.is_(None),
            Item.checked.is_(False),
        )
        .all()
    )

    if not uncategorized:
        return {"categorized": 0, "failed": 0, "results": []}

    categorization_service = CategorizationService(db)
    results = []

    for item in uncategorized:
        result = categorization_service.categorize_item(item.name, list_id, current_user.id)
        if result["category_id"]:
            item.category_id = result["category_id"]
            # Record to history for learning
            categorization_service.record_categorization(
                item.name, result["category_id"], list_id, current_user.id
            )
        results.append(
            {
                "item_id": item.id,
                "item_name": item.name,
                "category_id": result["category_id"],
                "confidence": result["confidence"],
                "source": result["source"],
                "reasoning": result["reasoning"],
            }
        )

    db.commit()

    categorized = sum(1 for r in results if r["category_id"])
    return {"categorized": categorized, "failed": len(results) - categorized, "results": results}
