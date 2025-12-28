"""Receipt scan schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ParsedReceiptItem(BaseModel):
    """An item parsed from a receipt."""

    name: str
    quantity: str | None = None
    matched_pantry_id: int | None = None
    action: str | None = None  # "added" or "updated"


class ReceiptScanResponse(BaseModel):
    """Response for a receipt scan."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    status: str
    error_message: str | None = None
    parsed_items: list[ParsedReceiptItem] | None = None
    items_added: int | None = None
    items_updated: int | None = None
    processed_at: datetime | None = None
    created_at: datetime


class ReceiptScanCreateResponse(BaseModel):
    """Response when creating a receipt scan."""

    id: int
    status: str
    message: str
