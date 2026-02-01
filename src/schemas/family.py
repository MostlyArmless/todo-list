"""Family schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FamilyCreate(BaseModel):
    """Create a new family."""

    name: str = Field(..., max_length=255)


class FamilyUpdate(BaseModel):
    """Update a family."""

    name: str | None = Field(None, max_length=255)


class FamilyMemberResponse(BaseModel):
    """Family member response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role: str
    created_at: datetime
    # User info
    user_name: str | None = None
    user_email: str | None = None


class FamilyResponse(BaseModel):
    """Family response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_by: int
    created_at: datetime
    updated_at: datetime
    member_count: int = 0


class FamilyDetailResponse(BaseModel):
    """Family response with members."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_by: int
    created_at: datetime
    updated_at: datetime
    members: list[FamilyMemberResponse] = []


class AddFamilyMember(BaseModel):
    """Add a member to a family by email."""

    email: str = Field(..., max_length=255)


class UpdateFamilyMemberRole(BaseModel):
    """Update a family member's role."""

    role: Literal["admin", "member"]


class ListFamilyShareCreate(BaseModel):
    """Share a list with a family."""

    permission: Literal["view", "edit", "admin"] = "edit"


class ListFamilyShareResponse(BaseModel):
    """List family share response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    family_id: int
    family_name: str | None = None
    permission: str
    created_at: datetime
