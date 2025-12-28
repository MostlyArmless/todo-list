"""Nutrition data service using Edamam API."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from src.config import get_settings
from src.models.recipe import Recipe, RecipeIngredient

logger = logging.getLogger(__name__)


@dataclass
class NutritionData:
    """Nutrition data for a recipe."""

    calories: int
    protein_grams: float
    carbs_grams: float
    fat_grams: float


class NutritionService:
    """Service for fetching nutrition data from Edamam API."""

    EDAMAM_API_URL = "https://api.edamam.com/api/nutrition-details"

    def __init__(self) -> None:
        """Initialize the nutrition service."""
        settings = get_settings()
        self.app_id = settings.edamam_app_id
        self.app_key = settings.edamam_app_key
        self._configured = bool(self.app_id and self.app_key)

    @property
    def is_configured(self) -> bool:
        """Check if the Edamam API is configured."""
        return self._configured

    async def compute_recipe_nutrition(
        self, ingredients: list[RecipeIngredient], servings: int | None = None
    ) -> NutritionData | None:
        """
        Compute nutrition data for a recipe's ingredients.

        Args:
            ingredients: List of recipe ingredients
            servings: Number of servings (defaults to 1 if not provided)

        Returns:
            NutritionData if successful, None if API not configured or failed
        """
        if not self.is_configured:
            logger.warning("Edamam API not configured - skipping nutrition computation")
            return None

        if not ingredients:
            return None

        servings = servings or 1

        # Build ingredient lines for Edamam API
        # Format: "quantity name" e.g. "2 cups chicken breast"
        ingredient_lines = []
        for ing in ingredients:
            if ing.quantity:
                ingredient_lines.append(f"{ing.quantity} {ing.name}")
            else:
                ingredient_lines.append(ing.name)

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.EDAMAM_API_URL,
                    params={
                        "app_id": self.app_id,
                        "app_key": self.app_key,
                    },
                    json={
                        "ingr": ingredient_lines,
                    },
                )

                if response.status_code == 422:
                    # Edamam returns 422 if it can't parse ingredients
                    logger.warning(f"Edamam could not parse ingredients: {response.text}")
                    return None

                response.raise_for_status()
                data = response.json()

            # Extract totals from response
            total_nutrients = data.get("totalNutrients", {})

            calories = total_nutrients.get("ENERC_KCAL", {}).get("quantity", 0)
            protein = total_nutrients.get("PROCNT", {}).get("quantity", 0)
            carbs = total_nutrients.get("CHOCDF", {}).get("quantity", 0)
            fat = total_nutrients.get("FAT", {}).get("quantity", 0)

            # Divide by servings to get per-serving values
            return NutritionData(
                calories=int(calories / servings),
                protein_grams=round(protein / servings, 1),
                carbs_grams=round(carbs / servings, 1),
                fat_grams=round(fat / servings, 1),
            )

        except httpx.HTTPStatusError as e:
            logger.error(f"Edamam API error: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"Error computing nutrition: {e}")
            return None

    def update_recipe_nutrition(self, recipe: Recipe, nutrition: NutritionData) -> None:
        """
        Update a recipe with computed nutrition data.

        Args:
            recipe: Recipe to update
            nutrition: Computed nutrition data
        """
        recipe.calories_per_serving = nutrition.calories
        recipe.protein_grams = nutrition.protein_grams
        recipe.carbs_grams = nutrition.carbs_grams
        recipe.fat_grams = nutrition.fat_grams
        recipe.nutrition_computed_at = datetime.now(UTC)
