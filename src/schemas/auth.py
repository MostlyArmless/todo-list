"""Authentication schemas."""

from pydantic import BaseModel, ConfigDict, EmailStr


class UserRegister(BaseModel):
    """User registration request."""

    email: EmailStr
    password: str
    name: str | None = None


class UserLogin(BaseModel):
    """User login request."""

    email: EmailStr
    password: str


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
