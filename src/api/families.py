"""Family API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.database import get_db
from src.models.family import Family, FamilyMember
from src.models.user import User
from src.schemas.family import (
    AddFamilyMember,
    FamilyCreate,
    FamilyDetailResponse,
    FamilyMemberResponse,
    FamilyResponse,
    FamilyUpdate,
    UpdateFamilyMemberRole,
)
from src.services.auth import get_user_by_email

router = APIRouter(prefix="/api/v1/families", tags=["families"])


def get_user_family(db: Session, user: User) -> FamilyMember | None:
    """Get the user's family membership, if any."""
    return db.query(FamilyMember).filter(FamilyMember.user_id == user.id).first()


def get_family_by_id(db: Session, family_id: int) -> Family | None:
    """Get a family by ID."""
    return db.query(Family).filter(Family.id == family_id).first()


def require_family_admin(db: Session, family_id: int, user: User) -> Family:
    """Require that the user is an admin of the specified family."""
    family = get_family_by_id(db, family_id)
    if not family:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Family not found")

    membership = (
        db.query(FamilyMember)
        .filter(FamilyMember.family_id == family_id, FamilyMember.user_id == user.id)
        .first()
    )
    if not membership or not membership.is_admin():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only family admins can perform this action",
        )

    return family


@router.post("", response_model=FamilyResponse, status_code=status.HTTP_201_CREATED)
def create_family(
    family_data: FamilyCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new family. The creator becomes an admin member."""
    # Check if user is already in a family
    existing_membership = get_user_family(db, current_user)
    if existing_membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already in a family. Leave your current family first.",
        )

    # Create the family
    family = Family(name=family_data.name, created_by=current_user.id)
    db.add(family)
    db.flush()  # Get the family ID

    # Add creator as admin member
    member = FamilyMember(family_id=family.id, user_id=current_user.id, role="admin")
    db.add(member)
    db.commit()
    db.refresh(family)

    return FamilyResponse(
        id=family.id,
        name=family.name,
        created_by=family.created_by,
        created_at=family.created_at,
        updated_at=family.updated_at,
        member_count=1,
    )


@router.get("/me", response_model=FamilyDetailResponse | None)
def get_my_family(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get the current user's family, or null if not in a family."""
    membership = get_user_family(db, current_user)
    if not membership:
        return None

    family = membership.family
    members = []
    for m in family.members:
        members.append(
            FamilyMemberResponse(
                id=m.id,
                user_id=m.user_id,
                role=m.role,
                created_at=m.created_at,
                user_name=m.user.name,
                user_email=m.user.email,
            )
        )

    return FamilyDetailResponse(
        id=family.id,
        name=family.name,
        created_by=family.created_by,
        created_at=family.created_at,
        updated_at=family.updated_at,
        members=members,
    )


@router.put("/{family_id}", response_model=FamilyResponse)
def update_family(
    family_id: int,
    family_data: FamilyUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update a family's name. Admin only."""
    family = require_family_admin(db, family_id, current_user)

    if family_data.name is not None:
        family.name = family_data.name

    db.commit()
    db.refresh(family)

    return FamilyResponse(
        id=family.id,
        name=family.name,
        created_by=family.created_by,
        created_at=family.created_at,
        updated_at=family.updated_at,
        member_count=len(family.members),
    )


@router.delete("/{family_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_family(
    family_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Delete a family. Admin only."""
    family = require_family_admin(db, family_id, current_user)
    db.delete(family)
    db.commit()


@router.get("/{family_id}/members", response_model=list[FamilyMemberResponse])
def get_family_members(
    family_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get all members of a family. Must be a member to view."""
    family = get_family_by_id(db, family_id)
    if not family:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Family not found")

    # Check if user is a member
    membership = (
        db.query(FamilyMember)
        .filter(FamilyMember.family_id == family_id, FamilyMember.user_id == current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this family",
        )

    members = []
    for m in family.members:
        members.append(
            FamilyMemberResponse(
                id=m.id,
                user_id=m.user_id,
                role=m.role,
                created_at=m.created_at,
                user_name=m.user.name,
                user_email=m.user.email,
            )
        )

    return members


@router.post(
    "/{family_id}/members", response_model=FamilyMemberResponse, status_code=status.HTTP_201_CREATED
)
def add_family_member(
    family_id: int,
    member_data: AddFamilyMember,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Add a member to the family by email. Admin only."""
    require_family_admin(db, family_id, current_user)

    # Find the user to add
    user_to_add = get_user_by_email(db, member_data.email)
    if not user_to_add:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check if user is already in a family
    existing_membership = get_user_family(db, user_to_add)
    if existing_membership:
        if existing_membership.family_id == family_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is already in this family",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already in another family",
        )

    # Add the member
    member = FamilyMember(family_id=family_id, user_id=user_to_add.id, role="member")
    db.add(member)
    db.commit()
    db.refresh(member)

    return FamilyMemberResponse(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        created_at=member.created_at,
        user_name=user_to_add.name,
        user_email=user_to_add.email,
    )


@router.delete("/{family_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_family_member(
    family_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Remove a member from the family. Admins can remove anyone, members can only remove themselves."""
    family = get_family_by_id(db, family_id)
    if not family:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Family not found")

    # Get current user's membership
    current_membership = (
        db.query(FamilyMember)
        .filter(FamilyMember.family_id == family_id, FamilyMember.user_id == current_user.id)
        .first()
    )
    if not current_membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this family",
        )

    # Check permissions: admins can remove anyone, members can only remove themselves
    if user_id != current_user.id and not current_membership.is_admin():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can remove other members",
        )

    # Find the member to remove
    member_to_remove = (
        db.query(FamilyMember)
        .filter(FamilyMember.family_id == family_id, FamilyMember.user_id == user_id)
        .first()
    )
    if not member_to_remove:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    # Prevent removing the last admin
    if member_to_remove.is_admin():
        admin_count = (
            db.query(FamilyMember)
            .filter(FamilyMember.family_id == family_id, FamilyMember.role == "admin")
            .count()
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the last admin. Promote another member first or delete the family.",
            )

    db.delete(member_to_remove)
    db.commit()


@router.put("/{family_id}/members/{user_id}", response_model=FamilyMemberResponse)
def update_member_role(
    family_id: int,
    user_id: int,
    role_data: UpdateFamilyMemberRole,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update a member's role. Admin only."""
    require_family_admin(db, family_id, current_user)

    # Find the member
    member = (
        db.query(FamilyMember)
        .filter(FamilyMember.family_id == family_id, FamilyMember.user_id == user_id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    # Prevent demoting the last admin
    if member.is_admin() and role_data.role == "member":
        admin_count = (
            db.query(FamilyMember)
            .filter(FamilyMember.family_id == family_id, FamilyMember.role == "admin")
            .count()
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the last admin. Promote another member first.",
            )

    member.role = role_data.role
    db.commit()
    db.refresh(member)

    return FamilyMemberResponse(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        created_at=member.created_at,
        user_name=member.user.name,
        user_email=member.user.email,
    )
