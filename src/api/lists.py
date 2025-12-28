"""List API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.database import get_db
from src.models.item import Item
from src.models.list import List, ListShare
from src.models.user import User
from src.schemas.list import ListCreate, ListResponse, ListShareCreate, ListUpdate
from src.services.auth import get_user_by_email

router = APIRouter(prefix="/api/v1/lists", tags=["lists"])


def get_user_list(db: Session, list_id: int, user: User) -> List:
    """Get a list that the user owns or has access to."""
    # Check if user owns the list
    list_obj = db.query(List).filter(List.id == list_id, List.owner_id == user.id).first()
    if list_obj:
        return list_obj

    # Check if list is shared with user
    share = (
        db.query(ListShare)
        .join(List)
        .filter(ListShare.list_id == list_id, ListShare.user_id == user.id)
        .first()
    )
    if share:
        return share.list

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found")


@router.get("", response_model=list[ListResponse])
async def get_lists(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get all lists owned by or shared with the current user."""
    # Get owned lists
    owned_lists = (
        db.query(List).filter(List.owner_id == current_user.id, List.deleted_at.is_(None)).all()
    )

    # Get shared lists
    shared_lists = (
        db.query(List)
        .join(ListShare)
        .filter(ListShare.user_id == current_user.id, List.deleted_at.is_(None))
        .all()
    )

    all_lists = list(set(owned_lists + shared_lists))  # Remove duplicates

    # Get unchecked item counts for all lists in one query
    list_ids = [lst.id for lst in all_lists]
    unchecked_counts = {}
    if list_ids:
        counts = (
            db.query(Item.list_id, func.count(Item.id))
            .filter(
                Item.list_id.in_(list_ids),
                Item.checked == False,  # noqa: E712
                Item.deleted_at.is_(None),
            )
            .group_by(Item.list_id)
            .all()
        )
        unchecked_counts = dict(counts)

    # Build response with unchecked counts
    result = []
    for lst in sorted(all_lists, key=lambda x: x.sort_order):
        list_response = ListResponse.model_validate(lst)
        list_response.unchecked_count = unchecked_counts.get(lst.id, 0)
        result.append(list_response)

    return result


@router.post("", response_model=ListResponse, status_code=status.HTTP_201_CREATED)
async def create_list(
    list_data: ListCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new list."""
    new_list = List(
        name=list_data.name,
        description=list_data.description,
        icon=list_data.icon,
        owner_id=current_user.id,
    )
    db.add(new_list)
    db.commit()
    db.refresh(new_list)

    list_response = ListResponse.model_validate(new_list)
    list_response.unchecked_count = 0  # New list has no items
    return list_response


@router.get("/{list_id}", response_model=ListResponse)
async def get_list(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get a specific list."""
    lst = get_user_list(db, list_id, current_user)

    # Count unchecked items
    unchecked_count = (
        db.query(func.count(Item.id))
        .filter(
            Item.list_id == list_id,
            Item.checked == False,  # noqa: E712
            Item.deleted_at.is_(None),
        )
        .scalar()
    )

    list_response = ListResponse.model_validate(lst)
    list_response.unchecked_count = unchecked_count or 0
    return list_response


@router.put("/{list_id}", response_model=ListResponse)
async def update_list(
    list_id: int,
    list_data: ListUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update a list."""
    list_obj = get_user_list(db, list_id, current_user)

    # Check if user has edit permission
    if list_obj.owner_id != current_user.id:
        share = (
            db.query(ListShare)
            .filter(ListShare.list_id == list_id, ListShare.user_id == current_user.id)
            .first()
        )
        if not share or share.permission == "view":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to edit this list",
            )

    # Update fields
    if list_data.name is not None:
        list_obj.name = list_data.name
    if list_data.description is not None:
        list_obj.description = list_data.description
    if list_data.icon is not None:
        list_obj.icon = list_data.icon
    if list_data.sort_order is not None:
        list_obj.sort_order = list_data.sort_order

    db.commit()
    db.refresh(list_obj)

    # Count unchecked items
    unchecked_count = (
        db.query(func.count(Item.id))
        .filter(
            Item.list_id == list_id,
            Item.checked == False,  # noqa: E712
            Item.deleted_at.is_(None),
        )
        .scalar()
    )

    list_response = ListResponse.model_validate(list_obj)
    list_response.unchecked_count = unchecked_count or 0
    return list_response


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Soft delete a list (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can delete this list",
        )

    list_obj.soft_delete()
    db.commit()


@router.post("/{list_id}/share", status_code=status.HTTP_201_CREATED)
async def share_list(
    list_id: int,
    share_data: ListShareCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Share a list with another user (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can share this list",
        )

    # Find the user to share with
    share_user = get_user_by_email(db, share_data.user_email)
    if not share_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Check if already shared
    existing_share = (
        db.query(ListShare)
        .filter(ListShare.list_id == list_id, ListShare.user_id == share_user.id)
        .first()
    )
    if existing_share:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="List already shared with this user",
        )

    # Create share
    share = ListShare(list_id=list_id, user_id=share_user.id, permission=share_data.permission)
    db.add(share)
    db.commit()

    return {"message": f"List shared with {share_data.user_email}"}


@router.delete("/{list_id}/share/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unshare_list(
    list_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Remove a user's access to a list (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can manage sharing",
        )

    share = (
        db.query(ListShare)
        .filter(ListShare.list_id == list_id, ListShare.user_id == user_id)
        .first()
    )
    if not share:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Share not found",
        )

    db.delete(share)
    db.commit()
