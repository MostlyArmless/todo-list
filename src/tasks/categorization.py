"""Celery tasks for item categorization."""

import asyncio
import logging

from sqlalchemy.orm import Session

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.item import Item
from src.services.categorization import CategorizationService

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=2)
def categorize_list_items(self, list_id: int, user_id: int, item_ids: list[int]) -> dict:
    """Categorize items in the background.

    Args:
        list_id: ID of the list containing the items
        user_id: ID of the user who owns the items
        item_ids: List of item IDs to categorize

    Returns:
        dict with categorization results
    """
    db: Session = SessionLocal()
    try:
        categorization_service = CategorizationService(db)

        categorized = 0
        failed = 0

        for item_id in item_ids:
            item = db.query(Item).filter(Item.id == item_id).first()
            if not item:
                logger.warning(f"Item {item_id} not found, skipping")
                continue

            # Skip if already categorized
            if item.category_id is not None:
                continue

            try:
                result = asyncio.run(
                    categorization_service.categorize_item(
                        item_name=item.name,
                        list_id=list_id,
                        user_id=user_id,
                    )
                )

                if result["category_id"]:
                    item.category_id = result["category_id"]
                    # Record to history for learning
                    categorization_service.record_categorization(
                        item.name, result["category_id"], list_id, user_id
                    )
                    categorized += 1
                    logger.info(
                        f"Categorized item '{item.name}' -> category {result['category_id']}"
                    )
                else:
                    failed += 1
                    logger.info(f"Could not categorize item '{item.name}'")

            except Exception as e:
                logger.error(f"Error categorizing item {item_id}: {e}")
                failed += 1

        db.commit()

        logger.info(f"Categorization complete: {categorized} categorized, {failed} failed")
        return {
            "success": True,
            "list_id": list_id,
            "categorized": categorized,
            "failed": failed,
        }

    except Exception as e:
        logger.error(f"Error in categorize_list_items: {e}", exc_info=True)
        db.rollback()

        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=30)

        return {"error": str(e)}

    finally:
        db.close()
