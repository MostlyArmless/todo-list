"""Categorization service using history-first approach with LLM fallback."""

import logging
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from src.models.category import Category
from src.models.item_history import ItemHistory
from src.services.llm import LLMService
from src.services.llm_prompts import (
    CATEGORIZATION_SYSTEM_PROMPT,
    get_categorization_prompt,
)

logger = logging.getLogger(__name__)


class CategorizationService:
    """Service for categorizing items using history and LLM."""

    def __init__(self, db: Session, llm_service: LLMService | None = None):
        self.db = db
        self.llm_service = llm_service or LLMService()

    def categorize_item(
        self,
        item_name: str,
        list_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """Categorize an item using history-first approach.

        Returns:
            {
                "category_id": int | None,
                "confidence": float,
                "source": "history" | "llm" | "none",
                "reasoning": str
            }
        """
        # Step 1: Check item history for exact match
        history_match = self._check_history_exact(item_name, list_id, user_id)
        if history_match:
            return history_match

        # Step 2: Check item history for fuzzy match (case-insensitive, partial)
        fuzzy_match = self._check_history_fuzzy(item_name, list_id, user_id)
        if fuzzy_match:
            return fuzzy_match

        # Step 3: Use LLM with historical context
        llm_result = self._categorize_with_llm(item_name, list_id, user_id)
        return llm_result

    def _check_history_exact(
        self, item_name: str, list_id: int, user_id: int
    ) -> dict[str, Any] | None:
        """Check for exact match in item history."""
        normalized = item_name.lower().strip()
        history = (
            self.db.query(ItemHistory)
            .filter(
                ItemHistory.list_id == list_id,
                ItemHistory.normalized_name == normalized,
            )
            .order_by(ItemHistory.occurrence_count.desc())
            .first()
        )

        if history:
            logger.info(
                f"Found exact history match for '{item_name}' -> category {history.category_id}"
            )
            return {
                "category_id": history.category_id,
                "confidence": 1.0,
                "source": "history",
                "reasoning": f"Previously categorized {history.occurrence_count} times",
            }
        return None

    def _check_history_fuzzy(
        self, item_name: str, list_id: int, user_id: int
    ) -> dict[str, Any] | None:
        """Check for fuzzy match in item history."""
        item_lower = item_name.lower().strip()

        # Get all history for this list
        all_history = self.db.query(ItemHistory).filter(ItemHistory.list_id == list_id).all()

        # Count category matches for similar items (weighted by occurrence_count)
        category_scores = defaultdict(int)
        for hist in all_history:
            hist_lower = hist.normalized_name
            # Check for substring match in either direction
            if item_lower in hist_lower or hist_lower in item_lower:
                category_scores[hist.category_id] += hist.occurrence_count

        if category_scores:
            # Get category with highest score
            best_category = max(category_scores.items(), key=lambda x: x[1])
            category_id, score = best_category
            total_matches = sum(category_scores.values())
            confidence = score / total_matches if total_matches > 0 else 0.0

            # Only use fuzzy match if reasonably confident
            if confidence >= 0.5:
                logger.info(
                    f"Found fuzzy history match for '{item_name}' -> category {category_id} (confidence: {confidence:.2f})"
                )
                return {
                    "category_id": category_id,
                    "confidence": confidence,
                    "source": "history",
                    "reasoning": f"Similar items previously categorized here (score: {score}/{total_matches})",
                }

        return None

    def _categorize_with_llm(self, item_name: str, list_id: int, user_id: int) -> dict[str, Any]:
        """Use LLM to categorize item with historical context."""
        # Get all categories for this list
        categories = (
            self.db.query(Category)
            .filter(Category.list_id == list_id)
            .order_by(Category.sort_order)
            .all()
        )

        if not categories:
            logger.warning(f"No categories found for list {list_id}")
            return {
                "category_id": None,
                "confidence": 0.0,
                "source": "none",
                "reasoning": "No categories available",
            }

        # Build item history context for each category
        item_history = defaultdict(list)
        all_history = self.db.query(ItemHistory).filter(ItemHistory.list_id == list_id).all()

        for hist in all_history:
            item_history[hist.category_id].append(hist.normalized_name)

        # Prepare categories data for LLM
        categories_data = [{"id": cat.id, "name": cat.name} for cat in categories]

        try:
            prompt = get_categorization_prompt(item_name, categories_data, dict(item_history))
            result = self.llm_service.generate_json(
                prompt=prompt,
                system_prompt=CATEGORIZATION_SYSTEM_PROMPT,
                temperature=0.1,
            )

            logger.info(f"LLM categorization for '{item_name}': {result}")

            return {
                "category_id": result.get("category_id"),
                "confidence": result.get("confidence", 0.0),
                "source": "llm",
                "reasoning": result.get("reasoning", "LLM suggestion"),
            }
        except Exception as e:
            logger.error(f"LLM categorization failed: {e}")
            return {
                "category_id": None,
                "confidence": 0.0,
                "source": "none",
                "reasoning": f"LLM error: {str(e)}",
            }

    def record_categorization(
        self,
        item_name: str,
        category_id: int,
        list_id: int,
        user_id: int,
    ) -> None:
        """Record an item→category mapping to history for learning."""
        normalized = item_name.lower().strip()

        # Check if this exact combination exists
        existing = (
            self.db.query(ItemHistory)
            .filter(
                ItemHistory.list_id == list_id,
                ItemHistory.normalized_name == normalized,
                ItemHistory.category_id == category_id,
            )
            .first()
        )

        if existing:
            # Increment occurrence count
            existing.occurrence_count += 1
            existing.last_used_at = datetime.now(UTC)
        else:
            # Create new history record
            history = ItemHistory(
                list_id=list_id,
                category_id=category_id,
                normalized_name=normalized,
                occurrence_count=1,
            )
            self.db.add(history)

        self.db.commit()
        logger.info(f"Recorded history: '{item_name}' -> category {category_id}")
