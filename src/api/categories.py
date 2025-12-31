"""Category API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.api.lists import get_user_list
from src.database import get_db
from src.models.category import Category
from src.models.item import Item
from src.models.user import User
from src.schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate

router = APIRouter(prefix="/api/v1", tags=["categories"])


def get_category(db: Session, category_id: int, user: User) -> Category:
    """Get a category that belongs to a list the user has access to."""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    # Verify user has access to the list
    get_user_list(db, category.list_id, user)

    return category


@router.get("/lists/{list_id}/categories", response_model=list[CategoryResponse])
def get_categories(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get all categories for a list."""
    # Verify user has access to the list
    get_user_list(db, list_id, current_user)

    categories = (
        db.query(Category)
        .filter(Category.list_id == list_id, Category.deleted_at.is_(None))
        .order_by(Category.sort_order)
        .all()
    )

    return categories


@router.post(
    "/lists/{list_id}/categories",
    response_model=CategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    list_id: int,
    category_data: CategoryCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new category in a list."""
    # Verify user has access to the list
    get_user_list(db, list_id, current_user)

    category = Category(
        list_id=list_id,
        name=category_data.name,
        color=category_data.color,
        sort_order=category_data.sort_order,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.put("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    category_data: CategoryUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update a category."""
    category = get_category(db, category_id, current_user)

    if category_data.name is not None:
        category.name = category_data.name
    if category_data.color is not None:
        category.color = category_data.color
    if category_data.sort_order is not None:
        category.sort_order = category_data.sort_order

    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Soft delete a category. Items in the category become uncategorized."""
    from src.models.item_history import ItemHistory

    category = get_category(db, category_id, current_user)

    # Move items in this category to uncategorized
    db.query(Item).filter(
        Item.category_id == category_id,
        Item.deleted_at.is_(None),
    ).update({Item.category_id: None})

    # Clear category from item history to prevent auto-categorization to deleted category
    db.query(ItemHistory).filter(
        ItemHistory.category_id == category_id,
    ).update({ItemHistory.category_id: None})

    category.soft_delete()
    db.commit()
