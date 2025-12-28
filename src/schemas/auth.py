"""Authentication schemas."""

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserRegister(BaseModel):
    """User registration request."""

    email: EmailStr = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    name: str | None = Field(None, max_length=255)


class UserLogin(BaseModel):
    """User login request."""

    email: EmailStr = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class Token(BaseModel):
    """JWT token response."""

    access_token: str
    token_type: str = "bearer"  # noqa: S105


class AuthResponse(BaseModel):
    """Authentication response with token and user info."""

    access_token: str
    token_type: str = "bearer"  # noqa: S105
    user: "UserResponse"


class UserResponse(BaseModel):
    """User information response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str | None
