"""LLM prompt templates for voice parsing and categorization."""

VOICE_PARSING_SYSTEM_PROMPT = """You are a shopping list assistant. Parse voice input into structured todo items.

Extract:
- list_name: which list (e.g., "costco", "walmart", "todo")
- items: array of item names
- action: "add" or "remove"

Common patterns:
- "add milk to costco list" → {"action": "add", "list_name": "costco", "items": ["milk"]}
- "add apples and bananas to walmart" → {"action": "add", "list_name": "walmart", "items": ["apples", "bananas"]}
- "remove eggs from todo list" → {"action": "remove", "list_name": "todo", "items": ["eggs"]}

Respond ONLY with valid JSON matching this schema:
{
  "action": "add" | "remove",
  "list_name": "string",
  "items": ["string", ...]
}"""


def get_voice_parsing_prompt(voice_text: str, available_lists: list[str]) -> str:
    """Generate prompt for parsing voice input."""
    lists_str = ", ".join(f'"{lst}"' for lst in available_lists)
    return f"""Parse this voice input: "{voice_text}"

Available lists: {lists_str}

If the list name doesn't match exactly, use fuzzy matching (e.g., "costco" matches "Costco").
If no list is mentioned, use "todo" as default.

Respond with JSON only."""


CATEGORIZATION_SYSTEM_PROMPT = """You are a shopping list categorization assistant.

Given an item name, list of categories with their historical items, suggest the best category.

Consider:
1. Historical patterns (items previously in each category)
2. Semantic similarity (e.g., "milk" goes with "dairy")
3. Store layout context (categories are often store sections)

Important distinctions:
- PANTRY: Dried spices, dried herbs, and seasonings (bay leaves, paprika, cumin, oregano, cinnamon, anise, peppercorns, chili flakes, etc.), canned goods, dry goods, oils, vinegars
- PRODUCE: Fresh fruits, fresh vegetables, fresh herbs only if specified as "fresh" (e.g., "fresh basil")
- When ambiguous (e.g., "coriander" without "fresh"), prefer Pantry for herbs/spices since dried is more common on shopping lists

Respond ONLY with valid JSON:
{
  "category_id": number | null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

If confidence < 0.5, set category_id to null for manual confirmation."""


def get_categorization_prompt(
    item_name: str,
    categories: list[dict],
    item_history: dict[int, list[str]],
) -> str:
    """Generate prompt for categorizing an item.

    Args:
        item_name: Name of the item to categorize
        categories: List of dicts with id, name
        item_history: Dict mapping category_id -> list of historical item names
    """
    categories_info = []
    for cat in categories:
        cat_id = cat["id"]
        cat_name = cat["name"]
        history = item_history.get(cat_id, [])
        history_str = ", ".join(history[:10]) if history else "no history"
        categories_info.append(f"- ID {cat_id}: {cat_name} (past items: {history_str})")

    categories_text = "\n".join(categories_info)

    return f"""Item to categorize: "{item_name}"

Available categories:
{categories_text}

Which category best fits this item? Respond with JSON only."""


# --- Pantry Matching Prompts ---

PANTRY_MATCHING_SYSTEM_PROMPT = """You are a kitchen pantry assistant. Match recipe ingredients to pantry items.

Consider:
1. Exact matches (e.g., "olive oil" → "olive oil")
2. Partial matches (e.g., "garlic cloves" → "garlic")
3. Ingredient forms (e.g., "fresh basil" → "basil")
4. Common substitutions shouldn't match (butter ≠ margarine)

Respond ONLY with valid JSON - an array with one object per ingredient:
[
  {"ingredient": "string", "pantry_match": "string" | null, "confidence": 0.0-1.0}
]

Rules:
- confidence >= 0.7: confident match
- confidence 0.4-0.7: possible match (suggest to user)
- confidence < 0.4 or no match: set pantry_match to null
- Only match if the pantry item would truly substitute for the ingredient"""


def get_pantry_matching_prompt(
    ingredients: list[str],
    pantry_items: list[str],
) -> str:
    """Generate prompt for matching ingredients to pantry.

    Args:
        ingredients: List of ingredient names from recipe
        pantry_items: List of item names from user's pantry
    """
    import json

    return f"""Match these recipe ingredients to pantry items.

Recipe ingredients: {json.dumps(ingredients)}
Pantry items: {json.dumps(pantry_items)}

For each ingredient, find the best matching pantry item (if any).
Respond with a JSON array only."""


# --- Recipe Parsing Prompts ---

RECIPE_PARSING_SYSTEM_PROMPT = """You are a recipe parsing assistant. Extract structured data from free-form recipe text.

Extract:
- name: The recipe title
- servings: Number of servings (integer or null if not specified)
- ingredients: Array of {name, quantity, description} objects
- instructions: The cooking steps as markdown

Format instructions as markdown:
- Use numbered list (1. 2. 3.) for steps
- Preserve section headers if present
- Keep formatting clean and readable

Ingredient field rules:
- name: The ingredient name only (e.g., "Cognac", "olive oil")
- quantity: Numeric amount + unit (e.g., "2 cups", "1 lb", "3 cloves"). Set to null if no specific amount.
- description: Preparation notes or usage hints (e.g., "for deglazing", "finely chopped", "room temperature"). Set to null if none.
- If text like "for deglazing" appears, it goes in description, NOT quantity
- Instructions should be complete, not truncated
- If recipe has no clear instructions, set instructions to empty string

Respond ONLY with valid JSON:
{
  "name": "string",
  "servings": number | null,
  "ingredients": [{"name": "string", "quantity": "string | null", "description": "string | null"}, ...],
  "instructions": "markdown string"
}"""


def get_recipe_parsing_prompt(raw_text: str) -> str:
    """Generate prompt for parsing recipe text."""
    return f"""Parse this recipe into structured data:

---
{raw_text}
---

Extract the recipe name, servings, ingredients (with quantities), and cooking instructions.
Format instructions as clean markdown with numbered steps.
Respond with JSON only."""
