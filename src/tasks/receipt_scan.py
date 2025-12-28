"""Celery task for receipt scanning."""

import asyncio
import logging
from datetime import UTC, datetime

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.pantry import PantryItem
from src.models.receipt_scan import ReceiptScan
from src.services.receipt_service import ReceiptService

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.process_receipt_scan")
def process_receipt_scan(scan_id: int, image_data_b64: str, media_type: str) -> dict:
    """Process a receipt scan using Claude Vision.

    Args:
        scan_id: ID of the ReceiptScan record
        image_data_b64: Base64-encoded image data
        media_type: MIME type of the image

    Returns:
        Dict with processing results
    """
    import base64

    db = SessionLocal()
    try:
        scan = db.query(ReceiptScan).filter(ReceiptScan.id == scan_id).first()
        if not scan:
            logger.error(f"ReceiptScan {scan_id} not found")
            return {"error": "Scan not found"}

        scan.status = "processing"
        db.commit()

        # Decode image data
        image_data = base64.b64decode(image_data_b64)

        # Parse the receipt
        service = ReceiptService()
        if not service.is_configured:
            scan.status = "failed"
            scan.error_message = "Anthropic API not configured"
            db.commit()
            return {"error": "Anthropic API not configured"}

        try:
            # Run async function in sync context
            parsed_items = asyncio.run(service.parse_receipt_image(image_data, media_type))
        except Exception as e:
            logger.error(f"Failed to parse receipt: {e}")
            scan.status = "failed"
            scan.error_message = str(e)
            db.commit()
            return {"error": str(e)}

        # Match items to pantry and update
        items_added = 0
        items_updated = 0
        parsed_items_data = []

        for item in parsed_items:
            normalized = item.name.lower().strip()

            # Check if item exists in pantry
            existing = (
                db.query(PantryItem)
                .filter(
                    PantryItem.user_id == scan.user_id,
                    PantryItem.normalized_name == normalized,
                )
                .first()
            )

            item_data = {
                "name": item.name,
                "quantity": item.quantity,
                "matched_pantry_id": None,
                "action": None,
            }

            if existing:
                # Update existing item to "have" status
                existing.status = "have"
                item_data["matched_pantry_id"] = existing.id
                item_data["action"] = "updated"
                items_updated += 1
            else:
                # Create new pantry item
                new_item = PantryItem(
                    user_id=scan.user_id,
                    name=item.name,
                    normalized_name=normalized,
                    status="have",
                    category=None,  # User can categorize later
                )
                db.add(new_item)
                db.flush()
                item_data["matched_pantry_id"] = new_item.id
                item_data["action"] = "added"
                items_added += 1

            parsed_items_data.append(item_data)

        # Update scan record
        scan.status = "completed"
        scan.parsed_items = parsed_items_data
        scan.items_added = items_added
        scan.items_updated = items_updated
        scan.processed_at = datetime.now(UTC)
        db.commit()

        return {
            "status": "completed",
            "items_added": items_added,
            "items_updated": items_updated,
            "parsed_items": parsed_items_data,
        }

    except Exception as e:
        logger.exception(f"Error processing receipt scan {scan_id}")
        try:
            scan = db.query(ReceiptScan).filter(ReceiptScan.id == scan_id).first()
            if scan:
                scan.status = "failed"
                scan.error_message = str(e)
                db.commit()
        except Exception as db_error:
            logger.error(f"Failed to update scan status: {db_error}")
        return {"error": str(e)}
    finally:
        db.close()
