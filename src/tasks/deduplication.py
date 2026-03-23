"""Celery tasks for deduplicating checked grocery list items."""

import logging
import re

from sqlalchemy.orm import Session

from src.celery_app import app as celery_app
from src.database import SessionLocal
from src.models.item import Item
from src.services.llm import LLMService

logger = logging.getLogger(__name__)

# Common English pluralization rules for de-pluralization
_PLURAL_RULES = [
    # Order matters: most specific first
    (re.compile(r"ies$"), "y"),  # berries -> berry
    (re.compile(r"ves$"), "f"),  # halves -> half
    (re.compile(r"oes$"), "o"),  # tomatoes -> tomato, potatoes -> potato
    (re.compile(r"ses$"), "s"),  # sauces -> sauce (but not "cheeses" -> "chees")
    (re.compile(r"ches$"), "ch"),  # peaches -> peach
    (re.compile(r"shes$"), "sh"),  # radishes -> radish
    (re.compile(r"xes$"), "x"),  # boxes -> box
    (re.compile(r"s$"), ""),  # generic plural
]

# Words that shouldn't be de-pluralized (already singular or mass nouns)
_IRREGULAR = {
    "hummus",
    "couscous",
    "asparagus",
    "citrus",
    "molasses",
    "lettuce",
    "rice",
    "quinoa",
    "tofu",
    "cheese",
}


def normalize_name(name: str) -> str:
    """Normalize an item name for comparison: lowercase, strip, collapse whitespace."""
    return re.sub(r"\s+", " ", name.lower().strip())


def singularize(word: str) -> str:
    """Best-effort English singularization of a single word."""
    if word in _IRREGULAR or len(word) <= 2:
        return word
    for pattern, replacement in _PLURAL_RULES:
        if pattern.search(word):
            return pattern.sub(replacement, word)
    return word


def canonical_name(name: str) -> str:
    """Return a canonical form for deduplication comparison.

    Normalizes whitespace/case and singularizes each word.
    """
    normalized = normalize_name(name)
    words = normalized.split()
    return " ".join(singularize(w) for w in words)


def find_basic_duplicate_groups(items: list[dict]) -> list[list[dict]]:
    """Group items by canonical name using basic string normalization.

    Returns groups of 2+ items that share the same canonical name.
    """
    buckets: dict[str, list[dict]] = {}
    for item in items:
        key = canonical_name(item["name"])
        buckets.setdefault(key, []).append(item)
    return [group for group in buckets.values() if len(group) >= 2]


def find_llm_duplicate_pairs(
    singletons: list[dict],
    existing_groups: list[list[dict]],
) -> list[tuple[int, int]]:
    """Use LLM to find additional duplicate pairs among items that weren't
    caught by basic normalization.

    Only compares items that are still ungrouped (singletons) against each
    other and against the canonical name of each existing group.

    Returns list of (item_id_a, item_id_b) pairs the LLM considers duplicates.
    """
    if len(singletons) < 2 and not existing_groups:
        return []

    # Build a list of candidate names for comparison
    # Include singletons + one representative from each existing group
    candidates = []
    for item in singletons:
        candidates.append({"id": item["id"], "name": item["name"], "is_singleton": True})
    for group in existing_groups:
        candidates.append({"id": group[0]["id"], "name": group[0]["name"], "is_singleton": False})

    if len(candidates) < 2:
        return []

    # Only compare singletons against everything (not group reps against each other)
    pairs_to_check = []
    for i, a in enumerate(candidates):
        if not a["is_singleton"]:
            continue
        for j, b in enumerate(candidates):
            if j <= i:
                continue
            pairs_to_check.append((a, b))

    if not pairs_to_check:
        return []

    # Batch pairs into a single LLM call for efficiency
    # Cap at 50 pairs to avoid overwhelming the model
    pairs_to_check = pairs_to_check[:50]

    pairs_text = "\n".join(
        f'{idx + 1}. "{a["name"]}" vs "{b["name"]}"' for idx, (a, b) in enumerate(pairs_to_check)
    )

    system_prompt = (
        "You are a grocery shopping assistant. Given pairs of ingredient/product names, "
        "determine which pairs refer to the same item for shopping list deduplication purposes.\n\n"
        "Consider items the same if a shopper would buy one product to satisfy both entries. "
        "For example: 'onion' and 'yellow onion' are the same (a shopper would just buy onions), "
        "but 'green onion' and 'yellow onion' are different.\n\n"
        "Respond with ONLY a JSON array of pair numbers that are duplicates. "
        "Example: [1, 3, 5] means pairs 1, 3, and 5 are duplicates. "
        "If none are duplicates, respond with []."
    )

    prompt = f"Which of these pairs are the same grocery item?\n\n{pairs_text}"

    try:
        llm = LLMService()
        result = llm.generate_json(prompt=prompt, system_prompt=system_prompt, temperature=0.1)

        if not isinstance(result, list):
            logger.warning(f"LLM returned non-list result: {result}")
            return []

        duplicate_pairs = []
        for pair_num in result:
            if isinstance(pair_num, int) and 1 <= pair_num <= len(pairs_to_check):
                a, b = pairs_to_check[pair_num - 1]
                duplicate_pairs.append((a["id"], b["id"]))

        return duplicate_pairs

    except Exception:
        logger.exception("LLM deduplication failed, skipping LLM matches")
        return []


def merge_llm_pairs_into_groups(
    groups: list[list[dict]],
    singletons: list[dict],
    llm_pairs: list[tuple[int, int]],
) -> list[list[dict]]:
    """Merge LLM-identified duplicate pairs into existing groups or create new ones."""
    # Build id -> item lookup
    all_items = {item["id"]: item for item in singletons}
    for group in groups:
        for item in group:
            all_items[item["id"]] = item

    # Build id -> group index lookup
    item_to_group: dict[int, int] = {}
    for gi, group in enumerate(groups):
        for item in group:
            item_to_group[item["id"]] = gi

    new_groups = [list(g) for g in groups]

    for id_a, id_b in llm_pairs:
        ga = item_to_group.get(id_a)
        gb = item_to_group.get(id_b)

        if ga is not None and gb is not None:
            if ga == gb:
                continue  # Already in same group
            # Merge groups: move all from gb into ga
            for item in new_groups[gb]:
                item_to_group[item["id"]] = ga
            new_groups[ga].extend(new_groups[gb])
            new_groups[gb] = []
        elif ga is not None:
            # Add b to a's group
            item_b = all_items.get(id_b)
            if item_b:
                new_groups[ga].append(item_b)
                item_to_group[id_b] = ga
        elif gb is not None:
            # Add a to b's group
            item_a = all_items.get(id_a)
            if item_a:
                new_groups[gb].append(item_a)
                item_to_group[id_a] = gb
        else:
            # Both are singletons, create new group
            item_a = all_items.get(id_a)
            item_b = all_items.get(id_b)
            if item_a and item_b:
                new_group = [item_a, item_b]
                new_groups.append(new_group)
                gi = len(new_groups) - 1
                item_to_group[id_a] = gi
                item_to_group[id_b] = gi

    # Filter out empty groups
    return [g for g in new_groups if len(g) >= 2]


@celery_app.task(bind=True, max_retries=2)
def find_duplicates(self, list_id: int, user_id: int) -> dict:
    """Find duplicate checked items in a grocery list.

    Phase 1: Basic normalization (case, whitespace, singularization)
    Phase 2: LLM-assisted fuzzy matching for remaining singletons

    Returns dict with duplicate groups for user review.
    """
    db: Session = SessionLocal()
    try:
        # Get all checked, non-deleted items for this list
        checked_items = (
            db.query(Item)
            .filter(
                Item.list_id == list_id,
                Item.checked.is_(True),
                Item.deleted_at.is_(None),
            )
            .all()
        )

        if not checked_items:
            return {"groups": [], "total_checked": 0}

        items_data = [{"id": item.id, "name": item.name} for item in checked_items]

        # Phase 1: Basic normalization grouping
        basic_groups = find_basic_duplicate_groups(items_data)

        # Determine singletons (items not in any basic group)
        grouped_ids = {item["id"] for group in basic_groups for item in group}
        singletons = [item for item in items_data if item["id"] not in grouped_ids]

        # Phase 2: LLM-assisted matching among singletons
        llm_pairs = find_llm_duplicate_pairs(singletons, basic_groups)

        # Merge LLM results into groups
        final_groups = merge_llm_pairs_into_groups(basic_groups, singletons, llm_pairs)

        # Format response: each group has a suggested canonical name and member items
        result_groups = []
        for group in final_groups:
            # Pick the shortest name as the canonical suggestion (often the most general)
            canonical = min(group, key=lambda item: len(item["name"]))["name"]
            result_groups.append(
                {
                    "canonical_name": canonical,
                    "items": [{"id": item["id"], "name": item["name"]} for item in group],
                }
            )

        return {
            "groups": result_groups,
            "total_checked": len(checked_items),
        }

    except Exception as e:
        db.rollback()
        logger.exception(f"Deduplication failed for list {list_id}")
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=10) from e
        return {"error": str(e), "groups": []}
    finally:
        db.close()
