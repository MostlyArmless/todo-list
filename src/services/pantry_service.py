"""Pantry service for ingredient matching."""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from src.models.pantry import PantryItem
from src.models.pantry_match_history import PantryMatchHistory
from src.models.recipe import Recipe
from src.services.llm import LLMService
from src.services.llm_prompts import (
    PANTRY_MATCHING_SYSTEM_PROMPT,
    get_pantry_matching_prompt,
)
from src.services.recipe_service import SKIP_INGREDIENTS

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
        pantry_items = self.db.query(PantryItem).filter(PantryItem.user_id == user_id).all()

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

        # First, try exact/substring/word matching
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

            if matched:
                continue

            # Try word-level match (e.g., "chicken breast" matches "chicken")
            ingredient_words = set(normalized.split())
            for pantry_name, pantry_item in pantry_by_name.items():
                pantry_words = set(pantry_name.split())
                # Check if any significant word overlaps (skip common words)
                common_words = ingredient_words & pantry_words
                # Filter out very short words that might be noise
                significant_common = {w for w in common_words if len(w) >= 3}
                if significant_common:
                    results.append(
                        self._build_ingredient_result(
                            ingredient,
                            pantry_item,
                            confidence=0.7,
                        )
                    )
                    matched = True
                    break

            if not matched:
                unmatched_ingredients.append(ingredient)

        # For remaining unmatched ingredients, check history first, then LLM
        if unmatched_ingredients and pantry_names:
            still_unmatched = []

            # Check history for cached matches
            for ingredient in unmatched_ingredients:
                normalized = ingredient.name.lower().strip()
                history_match = self._check_match_history(normalized, user_id, pantry_by_name)

                if history_match is not None:
                    pantry_item, confidence = history_match
                    results.append(
                        self._build_ingredient_result(
                            ingredient,
                            pantry_item,
                            confidence=confidence,
                        )
                    )
                    if pantry_item:
                        logger.info(f"History match: '{normalized}' -> '{pantry_item.name}'")
                    else:
                        logger.info(f"History cache: '{normalized}' -> no match (cached)")
                else:
                    still_unmatched.append(ingredient)

            # Only call LLM for ingredients not in history
            if still_unmatched:
                try:
                    llm_matches = await self._llm_match_ingredients(
                        [ing.name for ing in still_unmatched],
                        pantry_names,
                    )

                    for ingredient in still_unmatched:
                        normalized_ing = ingredient.name.lower().strip()
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
                            # Record this match to history for future use
                            if pantry_item and llm_result["confidence"] >= 0.7:
                                self._record_match_history(
                                    normalized_ing,
                                    pantry_item.normalized_name,
                                    llm_result["confidence"],
                                    user_id,
                                )
                        else:
                            results.append(
                                self._build_ingredient_result(ingredient, None, confidence=0.0)
                            )
                            # Record "no match" to history so we don't call LLM again
                            self._record_match_history(
                                normalized_ing,
                                "",  # Empty string means "no match"
                                0.0,
                                user_id,
                            )
                except Exception as e:
                    logger.error(f"LLM matching failed: {e}")
                    # Fall back to no matches for remaining
                    for ingredient in still_unmatched:
                        results.append(
                            self._build_ingredient_result(ingredient, None, confidence=0.0)
                        )
        else:
            # No pantry items or no unmatched ingredients
            for ingredient in unmatched_ingredients:
                results.append(self._build_ingredient_result(ingredient, None, confidence=0.0))

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
        normalized = ingredient.name.lower().strip()

        # Check if this ingredient should always be skipped (e.g., water)
        always_skip = normalized in SKIP_INGREDIENTS

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

        # Override add_to_list if always_skip
        if always_skip:
            add_to_list = False

        return {
            "name": ingredient.name,
            "quantity": ingredient.quantity,
            "pantry_match": pantry_match,
            "confidence": confidence,
            "add_to_list": add_to_list,
            "always_skip": always_skip,
        }

    def _check_match_history(
        self,
        normalized_ingredient: str,
        user_id: int,
        pantry_by_name: dict[str, PantryItem],
    ) -> tuple[PantryItem | None, float] | None:
        """Check if we have a cached match for this ingredient in history.

        Returns:
            - (PantryItem, confidence) if a match is cached
            - (None, 0.0) if "no match" is cached (skip LLM)
            - None if no history exists (need to call LLM)
        """
        history = (
            self.db.query(PantryMatchHistory)
            .filter(
                PantryMatchHistory.user_id == user_id,
                PantryMatchHistory.normalized_ingredient == normalized_ingredient,
            )
            .order_by(PantryMatchHistory.occurrence_count.desc())
            .first()
        )

        if history:
            # Update usage stats
            history.occurrence_count += 1
            history.last_used_at = datetime.now(UTC)
            self.db.commit()

            # Empty pantry name means "no match" was cached
            if not history.normalized_pantry_name:
                return (None, 0.0)

            # Check if the cached pantry item still exists
            if history.normalized_pantry_name in pantry_by_name:
                pantry_item = pantry_by_name[history.normalized_pantry_name]
                return (pantry_item, history.confidence)

        return None

    def _record_match_history(
        self,
        normalized_ingredient: str,
        normalized_pantry_name: str,
        confidence: float,
        user_id: int,
    ) -> None:
        """Record a successful LLM match to history for future use."""
        # Check if this exact match already exists
        existing = (
            self.db.query(PantryMatchHistory)
            .filter(
                PantryMatchHistory.user_id == user_id,
                PantryMatchHistory.normalized_ingredient == normalized_ingredient,
                PantryMatchHistory.normalized_pantry_name == normalized_pantry_name,
            )
            .first()
        )

        if existing:
            existing.occurrence_count += 1
            existing.last_used_at = datetime.now(UTC)
            existing.confidence = max(existing.confidence, confidence)
        else:
            history = PantryMatchHistory(
                user_id=user_id,
                normalized_ingredient=normalized_ingredient,
                normalized_pantry_name=normalized_pantry_name,
                confidence=confidence,
                occurrence_count=1,
            )
            self.db.add(history)

        self.db.commit()
        logger.info(
            f"Recorded pantry match history: '{normalized_ingredient}' -> '{normalized_pantry_name}'"
        )

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
