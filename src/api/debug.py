"""Debug API endpoints for development and troubleshooting."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user, get_db
from src.models.category import Category
from src.models.item import Item
from src.models.list import List
from src.models.user import User

router = APIRouter(prefix="/debug", tags=["debug"])


class VoiceDebugItem(BaseModel):
    """Debug info for a voice-added item."""

    id: int
    name: str
    list_id: int
    list_name: str
    category_id: int | None
    category_name: str | None
    raw_voice_text: str | None
    refinement_status: str | None
    voice_debug_info: dict | None
    created_at: str
    updated_at: str


class VoiceHistoryResponse(BaseModel):
    """Response for voice history debug endpoint."""

    items: list[VoiceDebugItem]
    total: int


@router.get("/voice-history", response_model=VoiceHistoryResponse)
def get_voice_history(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Get recent voice-added items with debug info.

    Returns items that have raw_voice_text set (i.e., were created via voice input),
    ordered by creation time descending (newest first).
    """
    # Get items with voice text, ordered by newest first
    query = (
        db.query(Item)
        .filter(
            Item.created_by == current_user.id,
            Item.raw_voice_text.isnot(None),
            Item.deleted_at.is_(None),
        )
        .order_by(desc(Item.created_at))
    )

    total = query.count()
    items = query.offset(offset).limit(limit).all()

    # Build response with list and category names
    result_items = []
    for item in items:
        # Get list name
        list_obj = db.query(List).filter(List.id == item.list_id).first()
        list_name = list_obj.name if list_obj else "Unknown"

        # Get category name
        category_name = None
        if item.category_id:
            category = db.query(Category).filter(Category.id == item.category_id).first()
            category_name = category.name if category else None

        result_items.append(
            VoiceDebugItem(
                id=item.id,
                name=item.name,
                list_id=item.list_id,
                list_name=list_name,
                category_id=item.category_id,
                category_name=category_name,
                raw_voice_text=item.raw_voice_text,
                refinement_status=item.refinement_status,
                voice_debug_info=item.voice_debug_info,
                created_at=item.created_at.isoformat() if item.created_at else "",
                updated_at=item.updated_at.isoformat() if item.updated_at else "",
            )
        )

    return VoiceHistoryResponse(items=result_items, total=total)
