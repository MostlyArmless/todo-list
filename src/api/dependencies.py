"""FastAPI dependencies for authentication and database."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from src.database import get_db
from src.models.list import List, ListShare
from src.models.user import User
from src.services.auth import decode_access_token
from src.services.categorization import CategorizationService
from src.services.llm import LLMService
from src.services.pantry_service import PantryService
from src.services.recipe_service import RecipeService

security = HTTPBearer()


def get_household_user_ids(db: Session, user: User) -> list[int]:
    """Get IDs of all users in the same household.

    A household is defined as users who share lists with each other.
    Returns a list including the current user's ID.
    """
    user_ids = {user.id}

    # Get users who own lists shared with current user
    owners = (
        db.query(List.owner_id)
        .join(ListShare, List.id == ListShare.list_id)
        .filter(ListShare.user_id == user.id)
        .distinct()
        .all()
    )
    user_ids.update(owner_id for (owner_id,) in owners)

    # Get users who have access to lists owned by current user
    shared_users = (
        db.query(ListShare.user_id)
        .join(List, ListShare.list_id == List.id)
        .filter(List.owner_id == user.id)
        .distinct()
        .all()
    )
    user_ids.update(uid for (uid,) in shared_users)

    return list(user_ids)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Get the current authenticated user from JWT token."""
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def get_llm_service() -> LLMService:
    """Get LLM service instance."""
    return LLMService()


def get_categorization_service(
    db: Annotated[Session, Depends(get_db)],
) -> CategorizationService:
    """Get categorization service with dependencies."""
    return CategorizationService(db, LLMService())


def get_recipe_service(
    db: Annotated[Session, Depends(get_db)],
) -> RecipeService:
    """Get recipe service with dependencies."""
    return RecipeService(db)


def get_pantry_service(
    db: Annotated[Session, Depends(get_db)],
) -> PantryService:
    """Get pantry service with dependencies."""
    return PantryService(db)
