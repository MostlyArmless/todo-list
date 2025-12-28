"""Celery tasks for recipe import processing."""

import asyncio
import logging
from datetime import UTC, datetime

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.recipe_import import RecipeImport
from src.services.llm import LLMService
from src.services.llm_prompts import RECIPE_PARSING_SYSTEM_PROMPT, get_recipe_parsing_prompt

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def process_recipe_import(self, import_id: int) -> dict:
    """Parse free-text recipe with LLM.

    Args:
        import_id: ID of the RecipeImport record to process

    Returns:
        dict with processing result
    """
    db = SessionLocal()
    try:
        recipe_import = db.query(RecipeImport).filter(RecipeImport.id == import_id).first()
        if not recipe_import:
            return {"error": "Import not found"}

        recipe_import.status = "processing"
        db.commit()

        logger.info(f"Processing recipe import {import_id}")

        llm_service = LLMService()
        parsed = asyncio.run(
            llm_service.generate_json(
                prompt=get_recipe_parsing_prompt(recipe_import.raw_text),
                system_prompt=RECIPE_PARSING_SYSTEM_PROMPT,
                temperature=0.1,
            )
        )

        # Validate required fields
        if not parsed.get("name") or not isinstance(parsed.get("ingredients"), list):
            recipe_import.status = "failed"
            recipe_import.error_message = "Failed to parse recipe structure"
            db.commit()
            return {"error": "Invalid structure"}

        recipe_import.parsed_recipe = parsed
        recipe_import.status = "completed"
        recipe_import.processed_at = datetime.now(UTC)
        db.commit()

        logger.info(f"Recipe import {import_id} processed successfully")

        return {"success": True}

    except Exception as e:
        logger.error(f"Error processing recipe import {import_id}: {e}", exc_info=True)
        db.rollback()
        recipe_import = db.query(RecipeImport).filter(RecipeImport.id == import_id).first()
        if recipe_import:
            recipe_import.status = "failed"
            recipe_import.error_message = str(e)
            db.commit()

        # Retry if not exhausted
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60) from e

        return {"error": str(e)}
    finally:
        db.close()
