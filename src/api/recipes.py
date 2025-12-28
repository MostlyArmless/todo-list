"""Recipe API endpoints."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from src.api.dependencies import get_current_user
from src.database import get_db
from src.models.ingredient_store_default import IngredientStoreDefault
from src.models.recipe import Recipe, RecipeIngredient
from src.models.recipe_add_event import RecipeAddEvent
from src.models.recipe_import import RecipeImport
from src.models.recipe_step_completion import RecipeStepCompletion
from src.models.user import User
from src.schemas.recipe import (
    AddToListRequest,
    AddToListResult,
    CheckPantryResponse,
    IngredientStoreDefaultCreate,
    IngredientStoreDefaultResponse,
    RecipeAddEventResponse,
    RecipeCreate,
    RecipeIngredientCreate,
    RecipeIngredientResponse,
    RecipeIngredientUpdate,
    RecipeListResponse,
    RecipeResponse,
    RecipeUpdate,
)
from src.schemas.recipe_import import (
    RecipeImportConfirm,
    RecipeImportCreate,
    RecipeImportResponse,
    StepCompletionsResponse,
    StepToggleResponse,
)

# 10 maximally distinguishable colors for recipe labels
# Selected for maximum perceptual difference and good contrast on dark backgrounds
RECIPE_LABEL_COLORS = [
    "#e6194b",  # Red
    "#3cb44b",  # Green
    "#ffe119",  # Yellow
    "#4363d8",  # Blue
    "#f58231",  # Orange
    "#911eb4",  # Purple
    "#42d4f4",  # Cyan
    "#f032e6",  # Magenta
    "#fabed4",  # Pink
    "#469990",  # Teal
]

router = APIRouter(prefix="/api/v1/recipes", tags=["recipes"])


def get_user_recipe(db: Session, recipe_id: int, user: User) -> Recipe:
    """Get a recipe that belongs to the user."""
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == recipe_id,
            Recipe.user_id == user.id,
            Recipe.deleted_at.is_(None),
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")
    return recipe


def get_user_ingredient(db: Session, ingredient_id: int, user: User) -> RecipeIngredient:
    """Get an ingredient that belongs to one of the user's recipes."""
    ingredient = (
        db.query(RecipeIngredient)
        .join(Recipe)
        .filter(
            RecipeIngredient.id == ingredient_id,
            Recipe.user_id == user.id,
            Recipe.deleted_at.is_(None),
        )
        .first()
    )
    if not ingredient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    return ingredient


# --- Static routes first (before /{recipe_id}) ---


@router.get("/colors")
async def get_label_colors():
    """Get available label colors for recipes."""
    return {"colors": RECIPE_LABEL_COLORS}


@router.get("", response_model=list[RecipeListResponse])
async def list_recipes(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """List all recipes for the current user."""
    recipes = (
        db.query(Recipe)
        .filter(Recipe.user_id == current_user.id, Recipe.deleted_at.is_(None))
        .order_by(Recipe.name)
        .all()
    )

    result = []
    for recipe in recipes:
        result.append(
            RecipeListResponse(
                id=recipe.id,
                name=recipe.name,
                description=recipe.description,
                servings=recipe.servings,
                label_color=recipe.label_color,
                instructions=recipe.instructions,
                ingredient_count=len(recipe.ingredients),
                created_at=recipe.created_at,
            )
        )
    return result


def get_next_label_color(db: Session, user_id: int) -> str:
    """Get the next color in the cycle for a new recipe."""
    # Count existing recipes to determine which color to use next
    recipe_count = (
        db.query(func.count(Recipe.id))
        .filter(Recipe.user_id == user_id, Recipe.deleted_at.is_(None))
        .scalar()
    )
    return RECIPE_LABEL_COLORS[recipe_count % len(RECIPE_LABEL_COLORS)]


@router.post("", response_model=RecipeResponse, status_code=status.HTTP_201_CREATED)
async def create_recipe(
    recipe_data: RecipeCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new recipe with ingredients."""
    # Auto-assign color if not provided
    label_color = recipe_data.label_color
    if not label_color:
        label_color = get_next_label_color(db, current_user.id)

    recipe = Recipe(
        user_id=current_user.id,
        name=recipe_data.name,
        description=recipe_data.description,
        servings=recipe_data.servings,
        label_color=label_color,
        instructions=recipe_data.instructions,
    )

    # Add ingredients
    for ing_data in recipe_data.ingredients:
        ingredient = RecipeIngredient(
            name=ing_data.name,
            quantity=ing_data.quantity,
            description=ing_data.description,
            store_preference=ing_data.store_preference,
        )
        recipe.ingredients.append(ingredient)

    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe


# --- Add to Shopping List (static route) ---


@router.post("/add-to-list", response_model=AddToListResult)
async def add_recipes_to_list(
    request: AddToListRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Add ingredients from recipe(s) to appropriate shopping lists."""
    from src.services.recipe_service import RecipeService

    # Convert Pydantic models to dicts for the service
    overrides = None
    if request.ingredient_overrides:
        overrides = [o.model_dump() for o in request.ingredient_overrides]

    service = RecipeService(db)
    return service.add_recipes_to_shopping_lists(
        request.recipe_ids, current_user.id, ingredient_overrides=overrides
    )


# --- Undo (static routes) ---


@router.get("/add-events", response_model=list[RecipeAddEventResponse])
async def list_add_events(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """List recent add events (for undo UI)."""
    events = (
        db.query(RecipeAddEvent)
        .filter(
            RecipeAddEvent.user_id == current_user.id,
            RecipeAddEvent.undone_at.is_(None),
        )
        .order_by(RecipeAddEvent.created_at.desc())
        .limit(10)
        .all()
    )
    return events


@router.post("/add-events/{event_id}/undo", status_code=status.HTTP_200_OK)
async def undo_add_event(
    event_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Undo an add-to-list operation."""
    from src.services.recipe_service import RecipeService

    service = RecipeService(db)
    service.undo_add_event(event_id, current_user.id)
    return {"status": "undone"}


# --- Store Defaults (static routes) ---


@router.get("/store-defaults", response_model=list[IngredientStoreDefaultResponse])
async def list_store_defaults(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """List all ingredient store defaults for the user."""
    defaults = (
        db.query(IngredientStoreDefault)
        .filter(IngredientStoreDefault.user_id == current_user.id)
        .order_by(IngredientStoreDefault.normalized_name)
        .all()
    )
    return defaults


@router.post(
    "/store-defaults",
    response_model=IngredientStoreDefaultResponse,
    status_code=status.HTTP_201_CREATED,
)
async def set_store_default(
    data: IngredientStoreDefaultCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Set or update default store for an ingredient."""
    normalized = data.ingredient_name.lower().strip()

    # Check if already exists
    existing = (
        db.query(IngredientStoreDefault)
        .filter(
            IngredientStoreDefault.user_id == current_user.id,
            IngredientStoreDefault.normalized_name == normalized,
        )
        .first()
    )

    if existing:
        existing.store_preference = data.store_preference
        db.commit()
        db.refresh(existing)
        return existing

    default = IngredientStoreDefault(
        user_id=current_user.id,
        normalized_name=normalized,
        store_preference=data.store_preference,
    )
    db.add(default)
    db.commit()
    db.refresh(default)
    return default


# --- Recipe Import endpoints ---


@router.post("/import", response_model=RecipeImportResponse)
async def create_recipe_import(
    data: RecipeImportCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Submit recipe text for async LLM parsing."""
    recipe_import = RecipeImport(
        user_id=current_user.id,
        raw_text=data.raw_text,
        status="pending",
    )
    db.add(recipe_import)
    db.commit()
    db.refresh(recipe_import)

    # Trigger async processing
    from src.tasks.recipe_import import process_recipe_import

    process_recipe_import.delay(recipe_import.id)

    return recipe_import


@router.get("/import/{import_id}", response_model=RecipeImportResponse)
async def get_recipe_import(
    import_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get import status and parsed recipe."""
    recipe_import = (
        db.query(RecipeImport)
        .filter(
            RecipeImport.id == import_id,
            RecipeImport.user_id == current_user.id,
        )
        .first()
    )
    if not recipe_import:
        raise HTTPException(status_code=404, detail="Import not found")
    return recipe_import


@router.post("/import/{import_id}/confirm", response_model=RecipeResponse)
async def confirm_recipe_import(
    import_id: int,
    data: RecipeImportConfirm,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Create recipe from parsed import with optional edits."""
    recipe_import = (
        db.query(RecipeImport)
        .filter(
            RecipeImport.id == import_id,
            RecipeImport.user_id == current_user.id,
            RecipeImport.status == "completed",
        )
        .first()
    )
    if not recipe_import:
        raise HTTPException(status_code=404, detail="Completed import not found")

    parsed = recipe_import.parsed_recipe

    # Use edits if provided, otherwise use parsed values
    recipe = Recipe(
        user_id=current_user.id,
        name=data.name or parsed["name"],
        servings=data.servings if data.servings is not None else parsed.get("servings"),
        instructions=data.instructions
        if data.instructions is not None
        else parsed.get("instructions"),
        label_color=get_next_label_color(db, current_user.id),
    )
    db.add(recipe)
    db.flush()

    # Add ingredients
    if data.ingredients:
        ingredients_data = data.ingredients
    else:
        ingredients_data = [
            RecipeIngredientCreate(name=i["name"], quantity=i.get("quantity"))
            for i in parsed.get("ingredients", [])
        ]

    for ing_data in ingredients_data:
        ingredient = RecipeIngredient(
            recipe_id=recipe.id,
            name=ing_data.name,
            quantity=ing_data.quantity,
            description=ing_data.description,
            store_preference=ing_data.store_preference,
        )
        db.add(ingredient)

    # Link import to recipe
    recipe_import.recipe_id = recipe.id
    db.commit()
    db.refresh(recipe)

    return recipe


@router.delete("/import/{import_id}", status_code=204)
async def delete_recipe_import(
    import_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Discard an import."""
    recipe_import = (
        db.query(RecipeImport)
        .filter(
            RecipeImport.id == import_id,
            RecipeImport.user_id == current_user.id,
        )
        .first()
    )
    if recipe_import:
        db.delete(recipe_import)
        db.commit()


# --- Ingredient routes (before /{recipe_id}) ---


@router.put("/ingredients/{ingredient_id}", response_model=RecipeIngredientResponse)
async def update_ingredient(
    ingredient_id: int,
    ingredient_data: RecipeIngredientUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update an ingredient."""
    ingredient = get_user_ingredient(db, ingredient_id, current_user)

    if ingredient_data.name is not None:
        ingredient.name = ingredient_data.name
    if ingredient_data.quantity is not None:
        ingredient.quantity = ingredient_data.quantity
    if ingredient_data.description is not None:
        ingredient.description = ingredient_data.description
    if ingredient_data.store_preference is not None:
        ingredient.store_preference = ingredient_data.store_preference

    db.commit()
    db.refresh(ingredient)
    return ingredient


@router.delete("/ingredients/{ingredient_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ingredient(
    ingredient_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Delete an ingredient from a recipe."""
    ingredient = get_user_ingredient(db, ingredient_id, current_user)
    db.delete(ingredient)
    db.commit()


# --- Check Pantry (before dynamic routes) ---


@router.post("/{recipe_id}/check-pantry", response_model=CheckPantryResponse)
async def check_recipe_pantry(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Check recipe ingredients against user's pantry."""
    from src.services.pantry_service import PantryService

    service = PantryService(db)
    result = await service.check_recipe_against_pantry(recipe_id, current_user.id)

    if "error" in result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=result["error"])

    return result


# --- Dynamic recipe routes (must be last) ---


@router.get("/{recipe_id}", response_model=RecipeResponse)
async def get_recipe(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get a specific recipe with all ingredients."""
    recipe = get_user_recipe(db, recipe_id, current_user)
    return recipe


@router.put("/{recipe_id}", response_model=RecipeResponse)
async def update_recipe(
    recipe_id: int,
    recipe_data: RecipeUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Update recipe metadata (not ingredients)."""
    recipe = get_user_recipe(db, recipe_id, current_user)

    if recipe_data.name is not None:
        recipe.name = recipe_data.name
    if recipe_data.description is not None:
        recipe.description = recipe_data.description
    if recipe_data.servings is not None:
        recipe.servings = recipe_data.servings
    if recipe_data.instructions is not None:
        recipe.instructions = recipe_data.instructions
    if recipe_data.label_color is not None:
        recipe.label_color = recipe_data.label_color
        # Update label_color in all items that reference this recipe
        db.execute(
            text("""
                UPDATE items
                SET recipe_sources = (
                    SELECT jsonb_agg(
                        CASE WHEN (elem->>'recipe_id')::int = :recipe_id
                        THEN elem || jsonb_build_object('label_color', :color)
                        ELSE elem END
                    )
                    FROM jsonb_array_elements(recipe_sources) elem
                )
                WHERE recipe_sources @> cast(:match_pattern as jsonb)
                AND deleted_at IS NULL
            """),
            {
                "recipe_id": recipe_id,
                "color": recipe_data.label_color,
                "match_pattern": f'[{{"recipe_id": {recipe_id}}}]',
            },
        )

    db.commit()
    db.refresh(recipe)
    return recipe


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recipe(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Soft delete a recipe."""
    recipe = get_user_recipe(db, recipe_id, current_user)
    recipe.soft_delete()
    db.commit()


@router.post(
    "/{recipe_id}/ingredients",
    response_model=RecipeIngredientResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_ingredient(
    recipe_id: int,
    ingredient_data: RecipeIngredientCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Add an ingredient to a recipe."""
    recipe = get_user_recipe(db, recipe_id, current_user)

    ingredient = RecipeIngredient(
        recipe_id=recipe.id,
        name=ingredient_data.name,
        quantity=ingredient_data.quantity,
        description=ingredient_data.description,
        store_preference=ingredient_data.store_preference,
    )
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient)
    return ingredient


# --- Step Completion endpoints ---


@router.get("/{recipe_id}/step-completions", response_model=StepCompletionsResponse)
async def get_step_completions(
    recipe_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Get list of completed step indices."""
    completions = (
        db.query(RecipeStepCompletion)
        .filter(
            RecipeStepCompletion.recipe_id == recipe_id,
            RecipeStepCompletion.user_id == current_user.id,
        )
        .all()
    )
    return {"completed_steps": [c.step_index for c in completions]}


@router.post("/{recipe_id}/steps/{step_index}/toggle", response_model=StepToggleResponse)
async def toggle_step_completion(
    recipe_id: int,
    step_index: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Toggle a step's completion state."""
    # Verify recipe exists and user owns it
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == recipe_id,
            Recipe.user_id == current_user.id,
            Recipe.deleted_at.is_(None),
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    existing = (
        db.query(RecipeStepCompletion)
        .filter(
            RecipeStepCompletion.recipe_id == recipe_id,
            RecipeStepCompletion.user_id == current_user.id,
            RecipeStepCompletion.step_index == step_index,
        )
        .first()
    )

    if existing:
        db.delete(existing)
        db.commit()
        return {"completed": False}
    else:
        completion = RecipeStepCompletion(
            recipe_id=recipe_id,
            user_id=current_user.id,
            step_index=step_index,
            completed_at=datetime.now(UTC),
        )
        db.add(completion)
        db.commit()
        return {"completed": True}


@router.delete("/{recipe_id}/step-completions", status_code=204)
async def reset_step_completions(
    recipe_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Clear all step completions for a recipe."""
    db.query(RecipeStepCompletion).filter(
        RecipeStepCompletion.recipe_id == recipe_id,
        RecipeStepCompletion.user_id == current_user.id,
    ).delete()
    db.commit()
