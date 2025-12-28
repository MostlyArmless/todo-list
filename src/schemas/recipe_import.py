"""Recipe import schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.schemas.recipe import RecipeIngredientCreate


class RecipeImportCreate(BaseModel):
    """Request to create a recipe import."""

    raw_text: str = Field(..., max_length=50000)


class ParsedIngredient(BaseModel):
    """Parsed ingredient from LLM."""

    name: str = Field(..., max_length=255)
    quantity: str | None = Field(None, max_length=50)
    description: str | None = Field(None, max_length=2000)


class ParsedRecipe(BaseModel):
    """Parsed recipe structure from LLM."""

    name: str = Field(..., max_length=255)
    servings: int | None = None
    ingredients: list[ParsedIngredient]
    instructions: str = Field(..., max_length=50000)


class RecipeImportResponse(BaseModel):
    """Response for recipe import status."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    status: str  # pending, processing, completed, failed
    parsed_recipe: ParsedRecipe | None = None
    error_message: str | None = None
    processed_at: datetime | None = None
    created_at: datetime


class RecipeImportConfirm(BaseModel):
    """Request to confirm and save a parsed recipe."""

    # Optional edits before saving
    name: str | None = Field(None, max_length=255)
    servings: int | None = None
    ingredients: list[RecipeIngredientCreate] | None = None
    instructions: str | None = Field(None, max_length=50000)


class StepCompletionsResponse(BaseModel):
    """Response with list of completed step indices."""

    completed_steps: list[int]


class StepToggleResponse(BaseModel):
    """Response from toggling a step."""

    completed: bool
