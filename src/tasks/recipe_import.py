"""Celery tasks for recipe import processing."""

import logging
from datetime import UTC, datetime

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.recipe_import import RecipeImport
from src.services.llm import LLMService
from src.services.llm_prompts import RECIPE_PARSING_SYSTEM_PROMPT, get_recipe_parsing_prompt

logger = logging.getLogger(__name__)


def validate_parsed_recipe(parsed: dict) -> tuple[bool, str | None]:
    """Validate LLM-parsed recipe structure.

    Returns (is_valid, error_message).
    """
    # Check name
    if not isinstance(parsed.get("name"), str) or not parsed["name"].strip():
        return False, "Recipe name is required and must be non-empty"
    if len(parsed["name"]) > 255:
        return False, "Recipe name too long (max 255 characters)"

    # Check ingredients
    ingredients = parsed.get("ingredients")
    if not isinstance(ingredients, list):
        return False, "Ingredients must be a list"
    if len(ingredients) == 0:
        return False, "Recipe must have at least one ingredient"

    for i, ing in enumerate(ingredients):
        if not isinstance(ing, dict):
            return False, f"Ingredient {i + 1} must be an object"
        if not isinstance(ing.get("name"), str) or not ing["name"].strip():
            return False, f"Ingredient {i + 1} must have a non-empty name"
        if (
            "quantity" in ing
            and ing["quantity"] is not None
            and not isinstance(ing["quantity"], str)
        ):
            return False, f"Ingredient {i + 1} quantity must be a string"

    # Check optional fields
    if (
        "servings" in parsed
        and parsed["servings"] is not None
        and not isinstance(parsed["servings"], int)
    ):
        return False, "Servings must be an integer"

    if (
        "instructions" in parsed
        and parsed["instructions"] is not None
        and not isinstance(parsed["instructions"], str)
    ):
        return False, "Instructions must be a string"

    return True, None


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
        parsed = llm_service.generate_json(
            prompt=get_recipe_parsing_prompt(recipe_import.raw_text),
            system_prompt=RECIPE_PARSING_SYSTEM_PROMPT,
            temperature=0.1,
        )

        # Validate parsed recipe structure
        is_valid, error = validate_parsed_recipe(parsed)
        if not is_valid:
            recipe_import.status = "failed"
            recipe_import.error_message = error
            db.commit()
            return {"success": False, "error": error}

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
