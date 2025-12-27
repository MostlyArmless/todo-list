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
    ingredients: list[RecipeIngredientCreate] = []


class RecipeUpdate(BaseModel):
    """Update a recipe."""

    name: str | None = None
    description: str | None = None
    servings: int | None = None


class RecipeResponse(BaseModel):
    """Recipe response with ingredients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    description: str | None
    servings: int | None
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
    ingredient_count: int
    created_at: datetime


# --- Add to List ---


class AddToListRequest(BaseModel):
    """Request to add recipe ingredients to shopping lists."""

    recipe_ids: list[int]


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
