"""Recipe schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# --- Recipe Ingredient ---


class RecipeIngredientCreate(BaseModel):
    """Create a recipe ingredient."""

    name: str
    quantity: str | None = None
    description: str | None = Field(None, max_length=200)
    store_preference: str | None = None  # "Grocery", "Costco", or None


class RecipeIngredientUpdate(BaseModel):
    """Update a recipe ingredient."""

    name: str | None = None
    quantity: str | None = None
    description: str | None = Field(None, max_length=200)
    store_preference: str | None = None


class RecipeIngredientResponse(BaseModel):
    """Recipe ingredient response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    recipe_id: int
    name: str
    quantity: str | None
    description: str | None
    store_preference: str | None
    created_at: datetime
    updated_at: datetime


# --- Recipe ---


class RecipeCreate(BaseModel):
    """Create a new recipe."""

    name: str
    description: str | None = None
    servings: int | None = None
    label_color: str | None = None  # Hex color like "#e94560"
    instructions: str | None = None
    ingredients: list[RecipeIngredientCreate] = []


class RecipeUpdate(BaseModel):
    """Update a recipe."""

    name: str | None = None
    description: str | None = None
    servings: int | None = None
    label_color: str | None = None
    instructions: str | None = None


class RecipeResponse(BaseModel):
    """Recipe response with ingredients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    description: str | None
    servings: int | None
    label_color: str | None
    instructions: str | None
    ingredients: list[RecipeIngredientResponse]
    created_at: datetime
    updated_at: datetime


class RecipeListResponse(BaseModel):
    """Recipe list item (without full ingredients)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    servings: int | None
    label_color: str | None
    instructions: str | None
    ingredient_count: int
    created_at: datetime


# --- Check Pantry ---


class PantryMatchResponse(BaseModel):
    """Pantry item match info."""

    id: int
    name: str
    status: str  # "have" | "low" | "out"


class CheckPantryIngredient(BaseModel):
    """Ingredient with pantry match info."""

    name: str
    quantity: str | None
    pantry_match: PantryMatchResponse | None
    confidence: float
    add_to_list: bool  # Suggested default based on pantry status
    always_skip: bool = False  # True for items like "water" that are never added


class CheckPantryResponse(BaseModel):
    """Response from check-pantry endpoint."""

    recipe_id: int
    recipe_name: str
    ingredients: list[CheckPantryIngredient]


# --- Add to List ---


class IngredientOverride(BaseModel):
    """Override for an ingredient when adding to list."""

    name: str
    add_to_list: bool


class AddToListRequest(BaseModel):
    """Request to add recipe ingredients to shopping lists."""

    recipe_ids: list[int]
    ingredient_overrides: list[IngredientOverride] | None = None


class AddToListResult(BaseModel):
    """Result of adding to shopping lists."""

    event_id: int
    grocery_items_added: int
    costco_items_added: int
    items_merged: int
    items_skipped: int = 0


# --- Undo ---


class RecipeAddEventResponse(BaseModel):
    """Recipe add event for undo UI."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime
    undone_at: datetime | None


# --- Ingredient Store Defaults ---


class IngredientStoreDefaultCreate(BaseModel):
    """Set default store for an ingredient."""

    ingredient_name: str
    store_preference: str  # "Grocery" or "Costco"


class IngredientStoreDefaultResponse(BaseModel):
    """Ingredient store default response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    normalized_name: str
    store_preference: str


# --- Bulk Pantry Check ---


class RecipePantryStatus(BaseModel):
    """Pantry status for a single recipe."""

    recipe_id: int
    total_ingredients: int
    ingredients_in_pantry: int  # Count of ingredients with "have" status (for backwards compat)
    have_count: int = 0  # Ingredients matched to pantry items with "have" status
    low_count: int = 0  # Ingredients matched to pantry items with "low" status
    out_count: int = 0  # Ingredients matched to pantry items with "out" status
    unmatched_count: int = 0  # Ingredients not matched to any pantry item


class BulkPantryCheckResponse(BaseModel):
    """Response from bulk pantry check endpoint."""

    recipes: list[RecipePantryStatus]
