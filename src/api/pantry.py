"""Pantry API endpoints."""

import base64
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.database import get_db
from src.models.pantry import PantryItem
from src.models.receipt_scan import ReceiptScan
from src.models.user import User
from src.schemas.pantry import (
    PantryBulkAddRequest,
    PantryBulkAddResponse,
    PantryItemCreate,
    PantryItemResponse,
    PantryItemUpdate,
)
from src.schemas.receipt_scan import ReceiptScanCreateResponse, ReceiptScanResponse

router = APIRouter(prefix="/api/v1/pantry", tags=["pantry"])


def get_user_pantry_item(db: Session, item_id: int, user: User) -> PantryItem:
    """Get a pantry item that belongs to the user."""
    item = (
        db.query(PantryItem)
        .filter(
            PantryItem.id == item_id,
            PantryItem.user_id == user.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pantry item not found")
    return item


@router.get("", response_model=list[PantryItemResponse])
async def list_pantry_items(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """List all pantry items for the current user."""
    items = (
        db.query(PantryItem)
        .filter(PantryItem.user_id == current_user.id)
        .order_by(PantryItem.category.nullslast(), PantryItem.name)
        .all()
    )
    return items


@router.post("", response_model=PantryItemResponse, status_code=status.HTTP_201_CREATED)
async def create_pantry_item(
    item_data: PantryItemCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Add an item to the pantry."""
    normalized = item_data.name.lower().strip()

    # Check for duplicate
    existing = (
        db.query(PantryItem)
        .filter(
            PantryItem.user_id == current_user.id,
            PantryItem.normalized_name == normalized,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Item '{existing.name}' already exists in pantry",
        )

    item = PantryItem(
        user_id=current_user.id,
        name=item_data.name,
        normalized_name=normalized,
        status=item_data.status,
        category=item_data.category,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{item_id}", response_model=PantryItemResponse)
async def get_pantry_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get a specific pantry item."""
    return get_user_pantry_item(db, item_id, current_user)


@router.put("/{item_id}", response_model=PantryItemResponse)
async def update_pantry_item(
    item_id: int,
    item_data: PantryItemUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update a pantry item."""
    item = get_user_pantry_item(db, item_id, current_user)

    if item_data.name is not None:
        item.name = item_data.name
        item.normalized_name = item_data.name.lower().strip()
    if item_data.status is not None:
        item.status = item_data.status
    if item_data.category is not None:
        item.category = item_data.category if item_data.category else None

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pantry_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Remove an item from the pantry."""
    item = get_user_pantry_item(db, item_id, current_user)
    db.delete(item)
    db.commit()


@router.post("/bulk", response_model=PantryBulkAddResponse)
async def bulk_add_pantry_items(
    request: PantryBulkAddRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Bulk add items to pantry (for post-shopping flow)."""
    added = 0
    updated = 0
    result_items = []

    for item_data in request.items:
        normalized = item_data.name.lower().strip()

        # Check for existing
        existing = (
            db.query(PantryItem)
            .filter(
                PantryItem.user_id == current_user.id,
                PantryItem.normalized_name == normalized,
            )
            .first()
        )

        if existing:
            # Update existing item's status to "have"
            existing.status = "have"
            db.flush()
            result_items.append(existing)
            updated += 1
        else:
            # Create new item
            item = PantryItem(
                user_id=current_user.id,
                name=item_data.name,
                normalized_name=normalized,
                status=item_data.status,
                category=item_data.category,
            )
            db.add(item)
            db.flush()
            result_items.append(item)
            added += 1

    db.commit()
    for item in result_items:
        db.refresh(item)

    return PantryBulkAddResponse(added=added, updated=updated, items=result_items)


# --- Receipt Scanning ---


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@router.post("/scan-receipt", response_model=ReceiptScanCreateResponse)
async def scan_receipt(
    file: Annotated[UploadFile, File(description="Receipt image (JPEG, PNG, GIF, or WebP)")],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Upload a receipt image for scanning.

    The receipt will be processed asynchronously using Claude Vision.
    Poll the status endpoint to check when processing is complete.
    """
    from src.tasks.receipt_scan import process_receipt_scan

    # Validate file type
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed types: {', '.join(ALLOWED_IMAGE_TYPES)}",
        )

    # Read file content
    image_data = await file.read()

    # Limit file size (10MB)
    if len(image_data) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 10MB.",
        )

    # Create scan record
    scan = ReceiptScan(
        user_id=current_user.id,
        status="pending",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Queue async processing
    image_data_b64 = base64.b64encode(image_data).decode("utf-8")
    process_receipt_scan.delay(scan.id, image_data_b64, file.content_type)

    return ReceiptScanCreateResponse(
        id=scan.id,
        status="pending",
        message="Receipt uploaded successfully. Processing in background.",
    )


@router.get("/scan-receipt/{scan_id}", response_model=ReceiptScanResponse)
async def get_receipt_scan(
    scan_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get the status and results of a receipt scan."""
    scan = (
        db.query(ReceiptScan)
        .filter(
            ReceiptScan.id == scan_id,
            ReceiptScan.user_id == current_user.id,
        )
        .first()
    )

    if not scan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt scan not found",
        )

    return scan


@router.get("/scan-receipts", response_model=list[ReceiptScanResponse])
async def list_receipt_scans(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 10,
):
    """List recent receipt scans for the user."""
    scans = (
        db.query(ReceiptScan)
        .filter(ReceiptScan.user_id == current_user.id)
        .order_by(ReceiptScan.created_at.desc())
        .limit(limit)
        .all()
    )
    return scans
