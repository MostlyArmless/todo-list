"""Item API endpoints."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.api.lists import get_user_list
from src.database import get_db
from src.models.item import Item
from src.models.item_history import ItemHistory
from src.models.user import User
from src.schemas.item import ItemCreate, ItemResponse, ItemUpdate

router = APIRouter(prefix="/api/v1", tags=["items"])


def lookup_category_from_history(db: Session, item_name: str, list_id: int) -> int | None:
    """Look up category_id from item history for exact match.

    Returns category_id if found in history, None otherwise.
    """
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
    if history:
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
    get_user_list(db, list_id, current_user)

    normalized_name = item_data.name.lower().strip()

    # Check for existing unchecked item with same name
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

    # Ad-hoc source marker
    adhoc_source = {"recipe_id": None, "recipe_name": "Ad-hoc"}

    if matching_item:
        # Merge with existing item
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
        # Determine category_id: use provided value, or look up from history
        category_id = item_data.category_id
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

    if item_data.name is not None:
        item.name = item_data.name
    if item_data.description is not None:
        item.description = item_data.description
    if item_data.quantity is not None:
        item.quantity = item_data.quantity
    if item_data.category_id is not None:
        item.category_id = item_data.category_id
    if item_data.sort_order is not None:
        item.sort_order = item_data.sort_order

    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Soft delete an item."""
    item = get_item(db, item_id, current_user)

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
    get_user_list(db, list_id, current_user)

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
