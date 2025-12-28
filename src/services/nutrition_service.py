"""Nutrition data service using USDA FoodData Central API."""

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
    """Service for fetching nutrition data from USDA FoodData Central API."""

    USDA_API_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"

    def __init__(self) -> None:
        """Initialize the nutrition service."""
        settings = get_settings()
        self.api_key = settings.usda_api_key
        self._configured = bool(self.api_key)

    @property
    def is_configured(self) -> bool:
        """Check if the USDA API is configured."""
        return self._configured

    async def _search_food(self, query: str) -> dict | None:
        """Search for a food item in USDA database.

        Args:
            query: Food name to search for

        Returns:
            First matching food item with nutrients, or None if not found
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                self.USDA_API_URL,
                params={
                    "api_key": self.api_key,
                    "query": query,
                    "pageSize": 1,
                    "dataType": ["Survey (FNDDS)", "SR Legacy", "Foundation"],
                },
            )
            response.raise_for_status()
            data = response.json()

            foods = data.get("foods", [])
            if not foods:
                return None

            return foods[0]

    def _extract_nutrients(self, food: dict) -> dict[str, float]:
        """Extract key nutrients from a USDA food item.

        Args:
            food: USDA food item with foodNutrients array

        Returns:
            Dict with calories, protein, carbs, fat per 100g
        """
        nutrients = {}
        for nutrient in food.get("foodNutrients", []):
            nutrient_id = nutrient.get("nutrientId")
            value = nutrient.get("value", 0)

            # USDA nutrient IDs:
            # 1008 = Energy (kcal)
            # 1003 = Protein (g)
            # 1005 = Carbohydrate (g)
            # 1004 = Total lipid/fat (g)
            if nutrient_id == 1008:
                nutrients["calories"] = value
            elif nutrient_id == 1003:
                nutrients["protein"] = value
            elif nutrient_id == 1005:
                nutrients["carbs"] = value
            elif nutrient_id == 1004:
                nutrients["fat"] = value

        return nutrients

    def _parse_quantity(self, quantity_str: str | None) -> float:
        """Parse a quantity string to estimate grams.

        This is a rough estimation - converts common units to approximate grams.
        For more accurate results, would need a more sophisticated parser.

        Args:
            quantity_str: Quantity string like "2 cups", "1 lb", "500g"

        Returns:
            Estimated weight in grams (defaults to 100g if can't parse)
        """
        if not quantity_str:
            return 100.0  # Default to 100g serving

        quantity_str = quantity_str.lower().strip()

        # Try to extract numeric value
        import re

        match = re.match(r"([\d./]+)\s*(.*)$", quantity_str)
        if not match:
            return 100.0

        try:
            # Handle fractions like "1/2"
            num_str = match.group(1)
            if "/" in num_str:
                parts = num_str.split("/")
                amount = float(parts[0]) / float(parts[1])
            else:
                amount = float(num_str)
        except (ValueError, ZeroDivisionError):
            return 100.0

        unit = match.group(2).strip()

        # Rough conversions to grams
        unit_to_grams = {
            "g": 1,
            "gram": 1,
            "grams": 1,
            "kg": 1000,
            "oz": 28.35,
            "ounce": 28.35,
            "ounces": 28.35,
            "lb": 453.6,
            "lbs": 453.6,
            "pound": 453.6,
            "pounds": 453.6,
            "cup": 240,
            "cups": 240,
            "tbsp": 15,
            "tablespoon": 15,
            "tablespoons": 15,
            "tsp": 5,
            "teaspoon": 5,
            "teaspoons": 5,
            "ml": 1,
            "l": 1000,
            "liter": 1000,
            "liters": 1000,
            "": 100,  # No unit = assume 100g
        }

        # Check for unit match
        for unit_key, grams_per_unit in unit_to_grams.items():
            if unit.startswith(unit_key):
                return amount * grams_per_unit

        # Default: treat as count of ~100g items
        return amount * 100

    async def compute_recipe_nutrition(
        self, ingredients: list[RecipeIngredient], servings: int | None = None
    ) -> NutritionData | None:
        """Compute nutrition data for a recipe's ingredients.

        Args:
            ingredients: List of recipe ingredients
            servings: Number of servings (defaults to 1 if not provided)

        Returns:
            NutritionData if successful, None if API not configured or failed
        """
        if not self.is_configured:
            logger.warning("USDA API not configured - skipping nutrition computation")
            return None

        if not ingredients:
            return None

        servings = servings or 1

        total_calories = 0.0
        total_protein = 0.0
        total_carbs = 0.0
        total_fat = 0.0

        for ingredient in ingredients:
            try:
                food = await self._search_food(ingredient.name)
                if not food:
                    logger.debug(f"No USDA match found for: {ingredient.name}")
                    continue

                nutrients = self._extract_nutrients(food)
                if not nutrients:
                    continue

                # Estimate grams from quantity
                grams = self._parse_quantity(ingredient.quantity)

                # USDA nutrients are per 100g, so scale by actual amount
                scale = grams / 100.0

                total_calories += nutrients.get("calories", 0) * scale
                total_protein += nutrients.get("protein", 0) * scale
                total_carbs += nutrients.get("carbs", 0) * scale
                total_fat += nutrients.get("fat", 0) * scale

            except httpx.HTTPStatusError as e:
                logger.warning(f"USDA API error for '{ingredient.name}': {e}")
                continue
            except Exception as e:
                logger.warning(f"Error processing '{ingredient.name}': {e}")
                continue

        # Divide by servings to get per-serving values
        return NutritionData(
            calories=int(total_calories / servings),
            protein_grams=round(total_protein / servings, 1),
            carbs_grams=round(total_carbs / servings, 1),
            fat_grams=round(total_fat / servings, 1),
        )

    def update_recipe_nutrition(self, recipe: Recipe, nutrition: NutritionData) -> None:
        """Update a recipe with computed nutrition data.

        Args:
            recipe: Recipe to update
            nutrition: Computed nutrition data
        """
        recipe.calories_per_serving = nutrition.calories
        recipe.protein_grams = nutrition.protein_grams
        recipe.carbs_grams = nutrition.carbs_grams
        recipe.fat_grams = nutrition.fat_grams
        recipe.nutrition_computed_at = datetime.now(UTC)
