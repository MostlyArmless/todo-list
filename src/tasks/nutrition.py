"""Celery tasks for nutrition computation."""

import asyncio
import logging

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.recipe import Recipe
from src.services.nutrition_service import NutritionService

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def compute_recipe_nutrition(self, recipe_id: int) -> dict:
    """Compute nutrition data for a recipe asynchronously.

    Args:
        recipe_id: ID of the Recipe to compute nutrition for

    Returns:
        dict with computation result
    """
    db = SessionLocal()
    try:
        recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
        if not recipe:
            return {"error": "Recipe not found"}

        nutrition_service = NutritionService()
        if not nutrition_service.is_configured:
            logger.info("Edamam API not configured - skipping nutrition computation")
            return {"skipped": True, "reason": "API not configured"}

        logger.info(f"Computing nutrition for recipe {recipe_id}: {recipe.name}")

        # Compute nutrition
        nutrition = asyncio.run(
            nutrition_service.compute_recipe_nutrition(
                ingredients=recipe.ingredients,
                servings=recipe.servings,
            )
        )

        if nutrition:
            nutrition_service.update_recipe_nutrition(recipe, nutrition)
            db.commit()
            logger.info(
                f"Updated nutrition for recipe {recipe_id}: "
                f"{nutrition.calories} cal, {nutrition.protein_grams}g protein"
            )
            return {
                "success": True,
                "calories": nutrition.calories,
                "protein": nutrition.protein_grams,
                "carbs": nutrition.carbs_grams,
                "fat": nutrition.fat_grams,
            }
        else:
            logger.warning(f"Could not compute nutrition for recipe {recipe_id}")
            return {"success": False, "reason": "Could not parse ingredients"}

    except Exception as e:
        logger.error(f"Error computing nutrition for recipe {recipe_id}: {e}", exc_info=True)
        db.rollback()

        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60) from e

        return {"error": str(e)}
    finally:
        db.close()
