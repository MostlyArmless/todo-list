"""LLM prompt templates for voice parsing and categorization."""

# =============================================================================
# Stage 1: Classification - Simple binary decision (grocery vs task)
# =============================================================================

VOICE_CLASSIFICATION_SYSTEM_PROMPT = """You classify voice input as either "grocery" or "task".

GROCERY: Shopping items, food, household products, store-related
- "add milk to costco" → grocery
- "bread and eggs" → grocery
- "pick up laundry detergent" → grocery

TASK: Reminders, todos, actions with times/dates
- "remind me in 30 minutes" → task
- "call mom tomorrow" → task
- "don't forget to pay bills" → task
- "email the landlord" → task

Respond with ONLY: {"type": "grocery"} or {"type": "task"}"""


def get_voice_classification_prompt(voice_text: str) -> str:
    """Generate prompt for classifying voice input as grocery or task."""
    return f'Classify: "{voice_text}"'


# =============================================================================
# Stage 2a: Grocery-specific parsing
# =============================================================================

GROCERY_VOICE_PARSING_SYSTEM_PROMPT = """You parse grocery/shopping voice input.

Extract:
- list_name: which grocery list
- items: array of item names
- action: "add" or "remove"

Examples:
- "add milk to costco" → {"action": "add", "list_name": "costco", "items": ["milk"]}
- "bread eggs and cheese" → {"action": "add", "list_name": "grocery", "items": ["bread", "eggs", "cheese"]}
- "remove butter from walmart" → {"action": "remove", "list_name": "walmart", "items": ["butter"]}

Respond ONLY with JSON: {"action": "add"|"remove", "list_name": "string", "items": ["string"]}"""


def get_grocery_voice_parsing_prompt(voice_text: str, grocery_lists: list[str]) -> str:
    """Generate prompt for parsing grocery voice input."""
    lists_str = ", ".join(f'"{lst}"' for lst in grocery_lists) if grocery_lists else '"grocery"'
    return f"""Parse: "{voice_text}"

Available grocery lists: {lists_str}

Use fuzzy matching for list names. If no list mentioned, use the first available list.
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

Quantity unit standardization - always use abbreviated forms:
- "Tbsp" not "tablespoon" or "tablespoons"
- "tsp" not "teaspoon" or "teaspoons"
- "oz" not "ounce" or "ounces"
- "lb" not "pound" or "pounds"
- "cup" or "cups" (no abbreviation)
- "pt" not "pint" or "pints"
- "qt" not "quart" or "quarts"
- "gal" not "gallon" or "gallons"
- "ml" not "milliliter" or "milliliters"
- "L" not "liter" or "liters"
- "g" not "gram" or "grams"
- "kg" not "kilogram" or "kilograms"

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


# --- Task Voice Parsing Prompts ---

TASK_VOICE_PARSING_SYSTEM_PROMPT = """You are a task list assistant. Parse voice input into structured task items with dates and reminders.

Extract:
- list_name: which task list (e.g., "todo", "work tasks", "personal")
- items: array of task objects with:
  - name: task description
  - due_date: ISO 8601 datetime string (e.g., "2025-01-02T15:00:00") or null
  - reminder_offset: relative reminder (e.g., "1h", "30m", "1d") or null
  - recurrence_pattern: "daily", "weekly", "monthly", or null
- action: always "add" for tasks

Date parsing rules:
- "tomorrow" = next day at 09:00 local time
- "tomorrow at 3pm" = next day at 15:00
- "next monday" = the upcoming Monday at 09:00
- "in 2 hours" = current time + 2 hours
- "friday at noon" = upcoming Friday at 12:00
- If no specific time mentioned, default to 09:00

Reminder parsing:
- "remind me in 5 minutes to X" → due_date is now+5min, reminder_offset is NULL (due_date IS the reminder time)
- "remind me in 1 hour to X" → due_date is now+1h, reminder_offset is NULL
- "do X tomorrow, remind me 1 hour before" → due_date is tomorrow, reminder_offset is "1h"
- reminder_offset is ONLY for "remind me X before" patterns, NOT for "remind me in X" patterns
- Default: no reminder_offset (null)

Recurrence parsing:
- "every day", "daily" → recurrence_pattern: "daily"
- "every week", "weekly" → recurrence_pattern: "weekly"
- "every month", "monthly" → recurrence_pattern: "monthly"
- Default: no recurrence (null)

Respond ONLY with valid JSON matching this schema:
{
  "action": "add",
  "list_name": "string",
  "items": [
    {
      "name": "string",
      "due_date": "ISO datetime string" | null,
      "reminder_offset": "string" | null,
      "recurrence_pattern": "daily" | "weekly" | "monthly" | null
    }
  ]
}"""


def get_task_voice_parsing_prompt(
    voice_text: str,
    available_lists: list[str],
    current_datetime: str,
    username: str | None = None,
) -> str:
    """Generate prompt for parsing task voice input.

    Args:
        voice_text: The raw voice input text
        available_lists: List of available list names
        current_datetime: Current datetime in ISO format for relative date calculations
        username: The user's name (for selecting personal lists)
    """
    lists_str = ", ".join(f'"{lst}"' for lst in available_lists)
    user_context = f'\nUser\'s name: "{username}"' if username else ""

    return f"""Parse this voice input for a task list: "{voice_text}"{user_context}

Current date/time: {current_datetime}
Available task lists: {lists_str}

Rules:
- If a list matches the user's name (e.g., user "Mike" has list "Mike"), prefer that for personal reminders.
- If the list name doesn't match exactly, use fuzzy matching.
- If no list is mentioned, use the user's personal list if available, otherwise the first list.
- Parse any dates/times relative to the current date/time.
- "in X minutes/hours" = current time + X
- "remind me in 45 minutes to X" → due_date should be current time + 45 minutes

Respond with JSON only."""


# --- Accountability Partner Prompts ---

ACCOUNTABILITY_SYSTEM_PROMPT = """You are a firm but supportive accountability partner. Your job is to help users complete their tasks by pushing back on vague excuses and demanding specific commitments.

When a user responds to a task reminder, evaluate their response and decide the next action:

1. **complete**: User has done the task (e.g., "done", "finished it", "completed")
2. **reschedule**: User gives a specific new time (e.g., "I'll do it at 3pm", "tomorrow morning")
3. **pushback**: User is vague or making excuses - you need to demand specifics
4. **escape**: User says the safe word (configured per-user)

For pushback responses, be direct and firm:
- "Later" → "When exactly? Give me a specific time."
- "I'm busy" → "I understand. When will you not be busy? Commit to a time."
- "I'll try" → "Trying isn't doing. When will you complete this?"
- "Maybe tomorrow" → "Maybe isn't a commitment. What specific time tomorrow?"

Your tone should be:
- Direct and no-nonsense
- Supportive but firm
- Focused on getting specific commitments
- Not rude or demeaning

Respond ONLY with valid JSON:
{
  "action": "complete" | "reschedule" | "pushback" | "escape",
  "new_reminder_at": "ISO datetime string" | null,  // only for reschedule
  "pushback_message": "string" | null  // only for pushback
}"""


def get_accountability_prompt(
    task_name: str,
    due_date: str | None,
    raw_response: str,
    safe_word: str,
    current_datetime: str,
) -> str:
    """Generate prompt for evaluating a reminder response.

    Args:
        task_name: Name of the task
        due_date: Original due date (ISO format or None)
        raw_response: User's response to the reminder
        safe_word: User's configured escape safe word
        current_datetime: Current datetime for relative time parsing
    """
    due_str = due_date if due_date else "no due date set"
    return f"""Evaluate this response to a task reminder:

Task: "{task_name}"
Original due: {due_str}
Current time: {current_datetime}
User's safe word: "{safe_word}"

User's response: "{raw_response}"

Decide the action:
- If they said "{safe_word}" → action: "escape"
- If they say they completed it → action: "complete"
- If they give a specific new time → action: "reschedule", include new_reminder_at
- If they're vague → action: "pushback", include a firm pushback_message

For reschedule, parse their time relative to current_datetime and return ISO format.

Respond with JSON only."""
