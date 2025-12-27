"""Pantry service for ingredient matching."""

import logging
from typing import Any

from sqlalchemy.orm import Session

from src.models.pantry import PantryItem
from src.models.recipe import Recipe
from src.services.llm import LLMService
from src.services.llm_prompts import (
    PANTRY_MATCHING_SYSTEM_PROMPT,
    get_pantry_matching_prompt,
)

logger = logging.getLogger(__name__)


class PantryService:
    """Service for pantry-related operations."""

    def __init__(self, db: Session, llm_service: LLMService | None = None):
        self.db = db
        self.llm_service = llm_service or LLMService()

    async def check_recipe_against_pantry(
        self,
        recipe_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """Check recipe ingredients against user's pantry.

        Returns:
            {
                "recipe_id": int,
                "recipe_name": str,
                "ingredients": [
                    {
                        "name": str,
                        "quantity": str | None,
                        "pantry_match": {
                            "id": int,
                            "name": str,
                            "status": str
                        } | None,
                        "confidence": float,
                        "add_to_list": bool  # suggested default
                    }
                ]
            }
        """
        # Get recipe
        recipe = (
            self.db.query(Recipe)
            .filter(
                Recipe.id == recipe_id,
                Recipe.user_id == user_id,
                Recipe.deleted_at.is_(None),
            )
            .first()
        )

        if not recipe:
            return {"error": "Recipe not found"}

        # Get user's pantry items
        pantry_items = (
            self.db.query(PantryItem).filter(PantryItem.user_id == user_id).all()
        )

        # Build pantry lookup by normalized name
        pantry_by_name = {item.normalized_name: item for item in pantry_items}
        pantry_names = [item.name for item in pantry_items]

        # Extract ingredient names
        ingredient_names = [ing.name for ing in recipe.ingredients]

        if not ingredient_names:
            return {
                "recipe_id": recipe.id,
                "recipe_name": recipe.name,
                "ingredients": [],
            }

        # First, try exact/substring matching
        results = []
        unmatched_ingredients = []

        for ingredient in recipe.ingredients:
            normalized = ingredient.name.lower().strip()

            # Try exact match
            if normalized in pantry_by_name:
                pantry_item = pantry_by_name[normalized]
                results.append(
                    self._build_ingredient_result(
                        ingredient,
                        pantry_item,
                        confidence=1.0,
                    )
                )
                continue

            # Try substring match (e.g., "garlic" matches "garlic cloves")
            matched = False
            for pantry_name, pantry_item in pantry_by_name.items():
                if normalized in pantry_name or pantry_name in normalized:
                    results.append(
                        self._build_ingredient_result(
                            ingredient,
                            pantry_item,
                            confidence=0.8,
                        )
                    )
                    matched = True
                    break

            if not matched:
                unmatched_ingredients.append(ingredient)

        # Use LLM for remaining unmatched ingredients if we have pantry items
        if unmatched_ingredients and pantry_names:
            try:
                llm_matches = await self._llm_match_ingredients(
                    [ing.name for ing in unmatched_ingredients],
                    pantry_names,
                )

                for ingredient in unmatched_ingredients:
                    llm_result = llm_matches.get(ingredient.name.lower())
                    if llm_result and llm_result["pantry_match"]:
                        # Find the pantry item by name
                        pantry_item = next(
                            (
                                item
                                for item in pantry_items
                                if item.name.lower() == llm_result["pantry_match"].lower()
                            ),
                            None,
                        )
                        results.append(
                            self._build_ingredient_result(
                                ingredient,
                                pantry_item,
                                confidence=llm_result["confidence"],
                            )
                        )
                    else:
                        results.append(
                            self._build_ingredient_result(ingredient, None, confidence=0.0)
                        )
            except Exception as e:
                logger.error(f"LLM matching failed: {e}")
                # Fall back to no matches for remaining
                for ingredient in unmatched_ingredients:
                    results.append(
                        self._build_ingredient_result(ingredient, None, confidence=0.0)
                    )
        else:
            # No pantry items or no unmatched ingredients
            for ingredient in unmatched_ingredients:
                results.append(
                    self._build_ingredient_result(ingredient, None, confidence=0.0)
                )

        return {
            "recipe_id": recipe.id,
            "recipe_name": recipe.name,
            "ingredients": results,
        }

    def _build_ingredient_result(
        self,
        ingredient,
        pantry_item: PantryItem | None,
        confidence: float,
    ) -> dict[str, Any]:
        """Build the result dict for a single ingredient."""
        if pantry_item:
            pantry_match = {
                "id": pantry_item.id,
                "name": pantry_item.name,
                "status": pantry_item.status,
            }
            # Suggest adding to list based on pantry status
            # "have" = don't add, "low" = add with note, "out" = add
            add_to_list = pantry_item.status != "have"
        else:
            pantry_match = None
            add_to_list = True  # Not in pantry, should add

        return {
            "name": ingredient.name,
            "quantity": ingredient.quantity,
            "pantry_match": pantry_match,
            "confidence": confidence,
            "add_to_list": add_to_list,
        }

    async def _llm_match_ingredients(
        self,
        ingredients: list[str],
        pantry_names: list[str],
    ) -> dict[str, dict]:
        """Use LLM to match ingredients to pantry items.

        Returns:
            Dict mapping lowercase ingredient name to match result
        """
        prompt = get_pantry_matching_prompt(ingredients, pantry_names)
        result = await self.llm_service.generate_json(
            prompt=prompt,
            system_prompt=PANTRY_MATCHING_SYSTEM_PROMPT,
            temperature=0.1,
        )

        logger.info(f"LLM pantry matching result: {result}")

        # Build lookup dict
        matches = {}
        if isinstance(result, list):
            for item in result:
                if isinstance(item, dict) and "ingredient" in item:
                    matches[item["ingredient"].lower()] = {
                        "pantry_match": item.get("pantry_match"),
                        "confidence": item.get("confidence", 0.0),
                    }

        return matches
