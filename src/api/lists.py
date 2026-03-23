"""List API endpoints."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.database import get_db
from src.models.enums import ListType, Permission
from src.models.family import FamilyMember, ListFamilyShare
from src.models.item import Item
from src.models.list import List, ListShare
from src.models.user import User
from src.schemas.family import ListFamilyShareCreate, ListFamilyShareResponse
from src.schemas.list import ListCreate, ListResponse, ListShareCreate, ListUpdate
from src.services.auth import get_user_by_email

router = APIRouter(prefix="/api/v1/lists", tags=["lists"])


def get_user_list(db: Session, list_id: int, user: User) -> List:
    """Get a list that the user owns or has access to."""
    # Check if user owns the list
    list_obj = db.query(List).filter(List.id == list_id, List.owner_id == user.id).first()
    if list_obj:
        return list_obj

    # Check if list is shared with user directly
    share = (
        db.query(ListShare)
        .join(List)
        .filter(ListShare.list_id == list_id, ListShare.user_id == user.id)
        .first()
    )
    if share:
        return share.list

    # Check if list is shared with user's family
    user_family = db.query(FamilyMember).filter(FamilyMember.user_id == user.id).first()
    if user_family:
        family_share = (
            db.query(ListFamilyShare)
            .join(List)
            .filter(
                ListFamilyShare.list_id == list_id,
                ListFamilyShare.family_id == user_family.family_id,
            )
            .first()
        )
        if family_share:
            return family_share.list

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found")


@router.get("", response_model=list[ListResponse])
def get_lists(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    include_archived: bool = Query(False, description="Include archived lists"),
):
    """Get all lists owned by or shared with the current user."""
    # Get owned lists
    owned_query = db.query(List).filter(List.owner_id == current_user.id, List.deleted_at.is_(None))
    if not include_archived:
        owned_query = owned_query.filter(List.archived_at.is_(None))
    owned_lists = owned_query.all()

    # Get directly shared lists
    shared_query = (
        db.query(List)
        .join(ListShare)
        .filter(ListShare.user_id == current_user.id, List.deleted_at.is_(None))
    )
    if not include_archived:
        shared_query = shared_query.filter(List.archived_at.is_(None))
    shared_lists = shared_query.all()

    # Get family-shared lists
    family_shared_lists = []
    user_family = db.query(FamilyMember).filter(FamilyMember.user_id == current_user.id).first()
    if user_family:
        family_query = (
            db.query(List)
            .join(ListFamilyShare)
            .filter(
                ListFamilyShare.family_id == user_family.family_id,
                List.deleted_at.is_(None),
            )
        )
        if not include_archived:
            family_query = family_query.filter(List.archived_at.is_(None))
        family_shared_lists = family_query.all()

    all_lists = list(set(owned_lists + shared_lists + family_shared_lists))  # Remove duplicates

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
def create_list(
    list_data: ListCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new list."""
    new_list = List(
        name=list_data.name,
        description=list_data.description,
        icon=list_data.icon,
        list_type=ListType(list_data.list_type),
        owner_id=current_user.id,
    )
    db.add(new_list)
    db.commit()
    db.refresh(new_list)

    list_response = ListResponse.model_validate(new_list)
    list_response.unchecked_count = 0  # New list has no items
    return list_response


@router.get("/{list_id}", response_model=ListResponse)
def get_list(
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
def update_list(
    list_id: int,
    list_data: ListUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update a list."""
    list_obj = get_user_list(db, list_id, current_user)

    # Check if user has edit permission
    if list_obj.owner_id != current_user.id:
        # Check direct share
        share = (
            db.query(ListShare)
            .filter(ListShare.list_id == list_id, ListShare.user_id == current_user.id)
            .first()
        )
        if share and Permission(share.permission).can_edit():
            pass  # Has edit permission via direct share
        else:
            # Check family share
            user_family = (
                db.query(FamilyMember).filter(FamilyMember.user_id == current_user.id).first()
            )
            family_share = None
            if user_family:
                family_share = (
                    db.query(ListFamilyShare)
                    .filter(
                        ListFamilyShare.list_id == list_id,
                        ListFamilyShare.family_id == user_family.family_id,
                    )
                    .first()
                )
            if not family_share or not Permission(family_share.permission).can_edit():
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
def delete_list(
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


@router.post("/{list_id}/archive", response_model=ListResponse)
def archive_list(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Archive a list (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can archive this list",
        )

    list_obj.archived_at = datetime.now(UTC)
    db.commit()
    db.refresh(list_obj)

    list_response = ListResponse.model_validate(list_obj)
    list_response.unchecked_count = 0
    return list_response


@router.post("/{list_id}/unarchive", response_model=ListResponse)
def unarchive_list(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Unarchive a list (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can unarchive this list",
        )

    list_obj.archived_at = None
    db.commit()
    db.refresh(list_obj)

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


@router.post("/{list_id}/share", status_code=status.HTTP_201_CREATED)
def share_list(
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
def unshare_list(
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


@router.post(
    "/{list_id}/share-family",
    response_model=ListFamilyShareResponse,
    status_code=status.HTTP_201_CREATED,
)
def share_list_with_family(
    list_id: int,
    share_data: ListFamilyShareCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Share a list with the current user's family (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can share this list",
        )

    # Get the user's family
    user_family = db.query(FamilyMember).filter(FamilyMember.user_id == current_user.id).first()
    if not user_family:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are not in a family. Create or join a family first.",
        )

    # Check if already shared with family
    existing_share = (
        db.query(ListFamilyShare)
        .filter(
            ListFamilyShare.list_id == list_id,
            ListFamilyShare.family_id == user_family.family_id,
        )
        .first()
    )
    if existing_share:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="List already shared with your family",
        )

    # Create family share
    family_share = ListFamilyShare(
        list_id=list_id,
        family_id=user_family.family_id,
        permission=share_data.permission,
    )
    db.add(family_share)
    db.commit()
    db.refresh(family_share)

    return ListFamilyShareResponse(
        id=family_share.id,
        list_id=family_share.list_id,
        family_id=family_share.family_id,
        family_name=user_family.family.name,
        permission=family_share.permission,
        created_at=family_share.created_at,
    )


@router.delete("/{list_id}/share-family", status_code=status.HTTP_204_NO_CONTENT)
def unshare_list_from_family(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Remove a list's family share (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can manage sharing",
        )

    # Get the user's family
    user_family = db.query(FamilyMember).filter(FamilyMember.user_id == current_user.id).first()
    if not user_family:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are not in a family",
        )

    # Find the share
    family_share = (
        db.query(ListFamilyShare)
        .filter(
            ListFamilyShare.list_id == list_id,
            ListFamilyShare.family_id == user_family.family_id,
        )
        .first()
    )
    if not family_share:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family share not found",
        )

    db.delete(family_share)
    db.commit()


@router.get("/{list_id}/shares")
def get_list_shares(
    list_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get all shares for a list (owner only)."""
    list_obj = get_user_list(db, list_id, current_user)

    if list_obj.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the owner can view sharing details",
        )

    # Get individual shares
    individual_shares = db.query(ListShare).filter(ListShare.list_id == list_id).all()

    # Get family shares
    family_shares = db.query(ListFamilyShare).filter(ListFamilyShare.list_id == list_id).all()

    return {
        "individual_shares": [
            {
                "id": s.id,
                "user_id": s.user_id,
                "user_email": s.user.email,
                "user_name": s.user.name,
                "permission": s.permission,
                "created_at": s.created_at,
            }
            for s in individual_shares
        ],
        "family_shares": [
            ListFamilyShareResponse(
                id=fs.id,
                list_id=fs.list_id,
                family_id=fs.family_id,
                family_name=fs.family.name,
                permission=fs.permission,
                created_at=fs.created_at,
            )
            for fs in family_shares
        ],
    }
