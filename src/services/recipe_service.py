"""Recipe service for add-to-list and undo operations."""

import logging
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from src.models.ingredient_store_default import IngredientStoreDefault
from src.models.item import Item
from src.models.list import List
from src.models.recipe import Recipe
from src.models.recipe_add_event import RecipeAddEvent, RecipeAddEventItem

logger = logging.getLogger(__name__)

GROCERY_LIST_NAME = "Grocery"
COSTCO_LIST_NAME = "Costco"

# Ingredients that are typically already available and shouldn't be added to shopping lists
SKIP_INGREDIENTS = {
    "water",
    "tap water",
    "cold water",
    "hot water",
    "warm water",
    "boiling water",
    "ice",
    "ice water",
    "ice cubes",
}


class RecipeService:
    """Service for recipe-related operations."""

    def __init__(self, db: Session):
        self.db = db

    def add_recipes_to_shopping_lists(
        self,
        recipe_ids: list[int],
        user_id: int,
        ingredient_overrides: list[dict] | None = None,
    ) -> dict:
        """
        Add ingredients from multiple recipes to shopping lists.

        Returns:
            {
                "event_id": int,
                "grocery_items_added": int,
                "costco_items_added": int,
                "items_merged": int,
            }
        """
        # Step 1: Create event record
        event = RecipeAddEvent(user_id=user_id)
        self.db.add(event)
        self.db.flush()  # Get event.id

        # Step 2: Ensure lists exist
        grocery_list = self._get_or_create_list(user_id, GROCERY_LIST_NAME, "🛒")
        costco_list = self._get_or_create_list(user_id, COSTCO_LIST_NAME, "🏪")

        # Step 3: Load recipes and ingredients
        recipes = (
            self.db.query(Recipe)
            .filter(
                Recipe.id.in_(recipe_ids),
                Recipe.user_id == user_id,
                Recipe.deleted_at.is_(None),
            )
            .all()
        )

        if not recipes:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No valid recipes found",
            )

        # Step 4: Collect and group ingredients by store
        # Key: (list_id, normalized_name) -> merged data
        ingredients_by_key: dict[tuple[int, str], dict] = {}
        skipped_count = 0

        # Build override lookup (by normalized name)
        skip_ingredients_override = set()
        if ingredient_overrides:
            for override in ingredient_overrides:
                if not override.get("add_to_list", True):
                    skip_ingredients_override.add(override["name"].lower().strip())

        for recipe in recipes:
            for ingredient in recipe.ingredients:
                normalized = ingredient.name.lower().strip()

                # Skip ingredients that don't need to be purchased
                if normalized in SKIP_INGREDIENTS:
                    skipped_count += 1
                    continue

                # Skip ingredients based on user overrides (e.g., from pantry check)
                if normalized in skip_ingredients_override:
                    skipped_count += 1
                    continue

                store = self._determine_store(ingredient, user_id)
                target_list = grocery_list if store == GROCERY_LIST_NAME else costco_list

                key = (target_list.id, normalized)

                recipe_source = {
                    "recipe_id": recipe.id,
                    "recipe_name": recipe.name,
                    "label_color": recipe.label_color,
                }

                if key in ingredients_by_key:
                    # Merge: append quantity, add recipe source
                    existing = ingredients_by_key[key]
                    if ingredient.quantity:
                        if existing["quantity"]:
                            existing["quantity"] = f"{existing['quantity']} + {ingredient.quantity}"
                        else:
                            existing["quantity"] = ingredient.quantity
                    existing["recipe_sources"].append(recipe_source)
                else:
                    ingredients_by_key[key] = {
                        "name": ingredient.name,
                        "quantity": ingredient.quantity,
                        "description": ingredient.description,
                        "recipe_sources": [recipe_source],
                        "list_id": target_list.id,
                    }

        # Step 5: Create/merge items on lists (without categorization for speed)
        result = {
            "event_id": event.id,
            "grocery_items_added": 0,
            "costco_items_added": 0,
            "items_merged": 0,
            "items_skipped": skipped_count,
        }

        # Track new items by list for background categorization
        new_items_by_list: dict[int, list[int]] = defaultdict(list)

        for (list_id, normalized), data in ingredients_by_key.items():
            added, merged, item_id = self._add_or_merge_item(
                event, list_id, normalized, data, user_id
            )
            if list_id == grocery_list.id:
                result["grocery_items_added"] += added
            else:
                result["costco_items_added"] += added
            result["items_merged"] += merged

            # Track new items for categorization
            if item_id is not None:
                new_items_by_list[list_id].append(item_id)

        self.db.commit()

        # Queue background categorization tasks for each list
        from src.tasks.categorization import categorize_list_items

        for list_id, item_ids in new_items_by_list.items():
            if item_ids:
                categorize_list_items.delay(list_id, user_id, item_ids)
                logger.info(f"Queued categorization for {len(item_ids)} items on list {list_id}")

        return result

    def undo_add_event(self, event_id: int, user_id: int) -> None:
        """Undo an add-to-list event."""
        event = (
            self.db.query(RecipeAddEvent)
            .filter(
                RecipeAddEvent.id == event_id,
                RecipeAddEvent.user_id == user_id,
            )
            .first()
        )

        if not event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Event not found",
            )

        if event.undone_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Event already undone",
            )

        # Process each event item
        for event_item in event.items:
            item = self.db.query(Item).filter(Item.id == event_item.item_id).first()
            if not item:
                continue

            if event_item.action == "created":
                # Soft delete the item
                item.soft_delete()
            elif event_item.action == "merged":
                # Restore original state
                item.quantity = event_item.original_quantity
                item.recipe_sources = event_item.original_recipe_sources

        # Mark event as undone
        event.undone_at = datetime.now(UTC)
        self.db.commit()

    def _get_or_create_list(self, user_id: int, name: str, icon: str) -> List:
        """Get or create a shopping list."""
        list_obj = (
            self.db.query(List)
            .filter(
                List.owner_id == user_id,
                List.name == name,
                List.deleted_at.is_(None),
            )
            .first()
        )

        if not list_obj:
            list_obj = List(name=name, owner_id=user_id, icon=icon)
            self.db.add(list_obj)
            self.db.flush()

        return list_obj

    def _determine_store(self, ingredient, user_id: int) -> str:
        """Determine which store for an ingredient."""
        # Priority 1: Recipe-level override
        if ingredient.store_preference:
            return ingredient.store_preference

        # Priority 2: Global user default
        normalized = ingredient.name.lower().strip()
        default = (
            self.db.query(IngredientStoreDefault)
            .filter(
                IngredientStoreDefault.user_id == user_id,
                IngredientStoreDefault.normalized_name == normalized,
            )
            .first()
        )
        if default:
            return default.store_preference

        # Priority 3: Default to Grocery
        return GROCERY_LIST_NAME

    def _add_or_merge_item(
        self,
        event: RecipeAddEvent,
        list_id: int,
        normalized: str,
        data: dict,
        user_id: int,
    ) -> tuple[int, int, int | None]:
        """
        Add or merge an item to a list.

        Returns: (items_added, items_merged, new_item_id or None)
        """
        # Check for existing unchecked item with same normalized name
        existing_items = (
            self.db.query(Item)
            .filter(
                Item.list_id == list_id,
                Item.deleted_at.is_(None),
                Item.checked.is_(False),
            )
            .all()
        )

        matching_item = None
        for item in existing_items:
            if item.name.lower().strip() == normalized:
                matching_item = item
                break

        if matching_item:
            # Merge into existing item
            event_item = RecipeAddEventItem(
                event_id=event.id,
                item_id=matching_item.id,
                list_id=list_id,
                action="merged",
                original_quantity=matching_item.quantity,
                original_recipe_sources=matching_item.recipe_sources,
                added_quantity=data["quantity"],
                added_recipe_sources=data["recipe_sources"],
            )
            self.db.add(event_item)

            # Update the item
            if data["quantity"]:
                if matching_item.quantity:
                    matching_item.quantity = f"{matching_item.quantity} + {data['quantity']}"
                else:
                    matching_item.quantity = data["quantity"]

            # Merge recipe sources
            existing_sources = matching_item.recipe_sources or []
            for source in data["recipe_sources"]:
                if not any(s["recipe_id"] == source["recipe_id"] for s in existing_sources):
                    existing_sources.append(source)
            matching_item.recipe_sources = existing_sources

            return (0, 1, None)  # Merged, no new item
        else:
            # Create new item WITHOUT categorization (will be done in background)
            item = Item(
                list_id=list_id,
                name=data["name"],
                quantity=data["quantity"],
                description=data["description"],
                category_id=None,  # Will be categorized in background
                recipe_sources=data["recipe_sources"],
                created_by=user_id,
            )
            self.db.add(item)
            self.db.flush()  # Get item.id

            # Record event item
            event_item = RecipeAddEventItem(
                event_id=event.id,
                item_id=item.id,
                list_id=list_id,
                action="created",
                added_quantity=data["quantity"],
                added_recipe_sources=data["recipe_sources"],
            )
            self.db.add(event_item)

            return (1, 0, item.id)  # Added, return new item ID for categorization
