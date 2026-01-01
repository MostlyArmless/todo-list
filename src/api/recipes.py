"""Recipe API endpoints."""

import os
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image
from sqlalchemy import func, text
from sqlalchemy.orm import Session, selectinload

from src.api.dependencies import get_current_user, get_household_user_ids
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
    BulkPantryCheckResponse,
    CheckPantryResponse,
    IngredientStoreDefaultCreate,
    IngredientStoreDefaultResponse,
    RecipeAddEventResponse,
    RecipeCreate,
    RecipeIngredientCreate,
    RecipeIngredientResponse,
    RecipeIngredientUpdate,
    RecipeListResponse,
    RecipePantryStatus,
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
from src.services.recipe_service import SKIP_INGREDIENTS

# Upload configuration
UPLOAD_DIR = Path("/app/uploads/recipes")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_IMAGE_SIZE = 800  # Max dimension for main image
THUMBNAIL_SIZE = 200  # Max dimension for thumbnail
JPEG_QUALITY = 85
THUMBNAIL_QUALITY = 80

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


def get_image_urls(image_path: str | None) -> tuple[str | None, str | None]:
    """Convert image_path to image_url and thumbnail_url."""
    if not image_path:
        return None, None
    # image_path is like "recipes/123.jpg"
    # URLs under /api/v1/uploads/ so Cloudflare tunnel routes them to FastAPI
    base_url = f"/api/v1/uploads/{image_path}"
    # Derive thumbnail path from main image path
    path = Path(image_path)
    thumb_path = path.parent / f"{path.stem}_thumb{path.suffix}"
    thumb_url = f"/api/v1/uploads/{thumb_path}"
    return base_url, thumb_url


def process_and_save_image(file: UploadFile, recipe_id: int) -> str:
    """Process uploaded image: resize and save main + thumbnail.

    Returns the relative image_path to store in the database.
    """
    # Ensure upload directory exists
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Open and process image
    img = Image.open(file.file)

    # Convert to RGB if necessary (handles RGBA, P mode, etc.)
    if img.mode in ("RGBA", "P", "LA"):
        # Create white background for transparency
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize main image (maintain aspect ratio)
    img.thumbnail((MAX_IMAGE_SIZE, MAX_IMAGE_SIZE), Image.Resampling.LANCZOS)

    # Save main image
    main_path = UPLOAD_DIR / f"{recipe_id}.jpg"
    img.save(main_path, "JPEG", quality=JPEG_QUALITY, optimize=True)

    # Create and save thumbnail
    thumb = img.copy()
    thumb.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
    thumb_path = UPLOAD_DIR / f"{recipe_id}_thumb.jpg"
    thumb.save(thumb_path, "JPEG", quality=THUMBNAIL_QUALITY, optimize=True)

    return f"recipes/{recipe_id}.jpg"


def delete_recipe_images(image_path: str | None) -> None:
    """Delete main and thumbnail images for a recipe."""
    if not image_path:
        return

    # Delete main image
    main_file = Path("/app/uploads") / image_path
    if main_file.exists():
        main_file.unlink()

    # Delete thumbnail
    path = Path(image_path)
    thumb_path = Path("/app/uploads") / path.parent / f"{path.stem}_thumb{path.suffix}"
    if thumb_path.exists():
        thumb_path.unlink()


def get_user_recipe(db: Session, recipe_id: int, user: User) -> Recipe:
    """Get a recipe that belongs to the user or their household."""
    household_ids = get_household_user_ids(db, user)
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == recipe_id,
            Recipe.user_id.in_(household_ids),
            Recipe.deleted_at.is_(None),
        )
        .first()
    )
    if not recipe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")
    return recipe


def get_user_ingredient(db: Session, ingredient_id: int, user: User) -> RecipeIngredient:
    """Get an ingredient that belongs to a recipe in the user's household."""
    household_ids = get_household_user_ids(db, user)
    ingredient = (
        db.query(RecipeIngredient)
        .join(Recipe)
        .filter(
            RecipeIngredient.id == ingredient_id,
            Recipe.user_id.in_(household_ids),
            Recipe.deleted_at.is_(None),
        )
        .first()
    )
    if not ingredient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    return ingredient


# --- Static routes first (before /{recipe_id}) ---


@router.get("/colors")
def get_label_colors():
    """Get available label colors for recipes."""
    return {"colors": RECIPE_LABEL_COLORS}


# --- Image upload/delete endpoints ---


@router.post("/{recipe_id}/image", response_model=RecipeResponse)
def upload_recipe_image(
    recipe_id: int,
    file: Annotated[UploadFile, File()],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Upload an image for a recipe.

    Accepts JPEG, PNG, WebP, or GIF. Images are resized to max 800px
    and a 200px thumbnail is created. Both are stored as JPEG.
    """
    recipe = get_user_recipe(db, recipe_id, current_user)

    # Validate file extension
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Delete existing images if any
    delete_recipe_images(recipe.image_path)

    # Process and save new image
    try:
        image_path = process_and_save_image(file, recipe_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process image: {e}") from None

    # Update recipe with new image path
    recipe.image_path = image_path
    db.commit()
    db.refresh(recipe)

    # Build response with image URLs
    image_url, thumbnail_url = get_image_urls(recipe.image_path)
    return RecipeResponse(
        id=recipe.id,
        user_id=recipe.user_id,
        name=recipe.name,
        description=recipe.description,
        servings=recipe.servings,
        label_color=recipe.label_color,
        instructions=recipe.instructions,
        ingredients=[RecipeIngredientResponse.model_validate(ing) for ing in recipe.ingredients],
        calories_per_serving=recipe.calories_per_serving,
        protein_grams=recipe.protein_grams,
        carbs_grams=recipe.carbs_grams,
        fat_grams=recipe.fat_grams,
        nutrition_computed_at=recipe.nutrition_computed_at,
        last_cooked_at=recipe.last_cooked_at,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        created_at=recipe.created_at,
        updated_at=recipe.updated_at,
    )


@router.delete("/{recipe_id}/image", status_code=status.HTTP_204_NO_CONTENT)
def delete_image(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Delete the image for a recipe."""
    recipe = get_user_recipe(db, recipe_id, current_user)

    if not recipe.image_path:
        raise HTTPException(status_code=404, detail="Recipe has no image")

    # Delete image files
    delete_recipe_images(recipe.image_path)

    # Clear image_path in database
    recipe.image_path = None
    db.commit()


@router.post("/{recipe_id}/compute-nutrition")
def compute_nutrition(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Trigger nutrition computation for a recipe.

    This queues an async task to compute nutrition data using the Edamam API.
    The nutrition data will be available on subsequent GET requests once computed.
    """
    from src.tasks.nutrition import compute_recipe_nutrition

    recipe = get_user_recipe(db, recipe_id, current_user)

    # Queue the task
    compute_recipe_nutrition.delay(recipe.id)

    return {
        "message": "Nutrition computation queued",
        "recipe_id": recipe.id,
    }


class RecipeSortBy(str, Enum):
    """Sort options for recipe list."""

    name_asc = "name_asc"
    name_desc = "name_desc"
    ingredients_asc = "ingredients_asc"
    ingredients_desc = "ingredients_desc"
    last_cooked_asc = "last_cooked_asc"
    last_cooked_desc = "last_cooked_desc"
    calories_asc = "calories_asc"
    calories_desc = "calories_desc"
    protein_asc = "protein_asc"
    protein_desc = "protein_desc"
    created_at_desc = "created_at_desc"
    updated_at_desc = "updated_at_desc"


@router.get("", response_model=list[RecipeListResponse])
def list_recipes(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    sort_by: RecipeSortBy = RecipeSortBy.name_asc,
):
    """List all recipes for the current user's household."""
    household_ids = get_household_user_ids(db, current_user)
    query = (
        db.query(Recipe)
        .options(selectinload(Recipe.ingredients))
        .filter(Recipe.user_id.in_(household_ids), Recipe.deleted_at.is_(None))
    )

    # Apply sorting
    if sort_by == RecipeSortBy.name_asc:
        query = query.order_by(func.lower(Recipe.name))
    elif sort_by == RecipeSortBy.name_desc:
        query = query.order_by(func.lower(Recipe.name).desc())
    elif sort_by == RecipeSortBy.last_cooked_asc:
        # Never cooked recipes last
        query = query.order_by(Recipe.last_cooked_at.asc().nullslast())
    elif sort_by == RecipeSortBy.last_cooked_desc:
        # Most recently cooked first, never cooked last
        query = query.order_by(Recipe.last_cooked_at.desc().nullslast())
    elif sort_by == RecipeSortBy.calories_asc:
        query = query.order_by(Recipe.calories_per_serving.asc().nullslast())
    elif sort_by == RecipeSortBy.calories_desc:
        query = query.order_by(Recipe.calories_per_serving.desc().nullslast())
    elif sort_by == RecipeSortBy.protein_asc:
        query = query.order_by(Recipe.protein_grams.asc().nullslast())
    elif sort_by == RecipeSortBy.protein_desc:
        query = query.order_by(Recipe.protein_grams.desc().nullslast())
    elif sort_by == RecipeSortBy.created_at_desc:
        query = query.order_by(Recipe.created_at.desc())
    elif sort_by == RecipeSortBy.updated_at_desc:
        query = query.order_by(Recipe.updated_at.desc())
    # For ingredient sorting, we need to count in Python after fetching

    recipes = query.all()

    # Handle ingredient sorting
    if sort_by == RecipeSortBy.ingredients_asc:
        recipes = sorted(recipes, key=lambda r: len(r.ingredients))
    elif sort_by == RecipeSortBy.ingredients_desc:
        recipes = sorted(recipes, key=lambda r: len(r.ingredients), reverse=True)

    result = []
    for recipe in recipes:
        _, thumbnail_url = get_image_urls(recipe.image_path)
        result.append(
            RecipeListResponse(
                id=recipe.id,
                name=recipe.name,
                description=recipe.description,
                servings=recipe.servings,
                label_color=recipe.label_color,
                instructions=recipe.instructions,
                ingredient_count=len(recipe.ingredients),
                calories_per_serving=recipe.calories_per_serving,
                protein_grams=recipe.protein_grams,
                carbs_grams=recipe.carbs_grams,
                fat_grams=recipe.fat_grams,
                last_cooked_at=recipe.last_cooked_at,
                thumbnail_url=thumbnail_url,
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
def create_recipe(
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
    return build_recipe_response(recipe)


# --- Add to Shopping List (static route) ---


@router.post("/add-to-list", response_model=AddToListResult)
def add_recipes_to_list(
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
def list_add_events(
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
def undo_add_event(
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
def list_store_defaults(
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
def set_store_default(
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


# --- Bulk Pantry Check ---


@router.get("/pantry-status", response_model=BulkPantryCheckResponse)
def bulk_check_pantry(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Check all recipes against pantry to get ingredient counts.

    Returns a lightweight summary of how many ingredients from each recipe
    the user has in their pantry, broken down by status (have/low/out).
    Uses simple matching only (no LLM) for speed.
    """
    from src.models.pantry import PantryItem

    # Get all household's recipes with ingredients
    household_ids = get_household_user_ids(db, current_user)
    recipes = (
        db.query(Recipe)
        .filter(Recipe.user_id.in_(household_ids), Recipe.deleted_at.is_(None))
        .order_by(Recipe.name)
        .all()
    )

    # Get all household's pantry items (all statuses)
    pantry_items = db.query(PantryItem).filter(PantryItem.user_id.in_(household_ids)).all()

    # Build pantry lookup by normalized name -> status
    pantry_by_name: dict[str, str] = {item.normalized_name: item.status for item in pantry_items}

    def match_ingredient(normalized: str) -> str | None:
        """Match ingredient to pantry and return status, or None if no match.

        Uses EXACT matching only. This ensures users have fine-grained control:
        if they want "garlic powder" tracked separately from "garlic", they can
        set different statuses for each. Fuzzy matching was too aggressive and
        would override user intent.
        """
        return pantry_by_name.get(normalized)

    results = []
    for recipe in recipes:
        total = len(recipe.ingredients)
        have_count = 0
        low_count = 0
        out_count = 0
        unmatched_count = 0

        for ingredient in recipe.ingredients:
            normalized = ingredient.name.lower().strip()

            # Skip ingredients (like water) count as "have" - they're always available
            if normalized in SKIP_INGREDIENTS:
                have_count += 1
                continue

            status = match_ingredient(normalized)

            if status == "have":
                have_count += 1
            elif status == "low":
                low_count += 1
            elif status == "out":
                out_count += 1
            else:
                unmatched_count += 1

        results.append(
            RecipePantryStatus(
                recipe_id=recipe.id,
                total_ingredients=total,
                ingredients_in_pantry=have_count,  # backwards compat
                have_count=have_count,
                low_count=low_count,
                out_count=out_count,
                unmatched_count=unmatched_count,
            )
        )

    return BulkPantryCheckResponse(recipes=results)


# --- Recipe Import endpoints ---


@router.post("/import", response_model=RecipeImportResponse)
def create_recipe_import(
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
def get_recipe_import(
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
def confirm_recipe_import(
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

    return build_recipe_response(recipe)


@router.delete("/import/{import_id}", status_code=204)
def delete_recipe_import(
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
def update_ingredient(
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
def delete_ingredient(
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
def check_recipe_pantry(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Check recipe ingredients against user's pantry."""
    from src.services.pantry_service import PantryService

    service = PantryService(db)
    result = service.check_recipe_against_pantry(recipe_id, current_user.id)

    if "error" in result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=result["error"])

    return result


# --- Dynamic recipe routes (must be last) ---


def build_recipe_response(recipe: Recipe) -> RecipeResponse:
    """Build RecipeResponse with computed image URLs."""
    image_url, thumbnail_url = get_image_urls(recipe.image_path)
    return RecipeResponse(
        id=recipe.id,
        user_id=recipe.user_id,
        name=recipe.name,
        description=recipe.description,
        servings=recipe.servings,
        label_color=recipe.label_color,
        instructions=recipe.instructions,
        ingredients=[RecipeIngredientResponse.model_validate(ing) for ing in recipe.ingredients],
        calories_per_serving=recipe.calories_per_serving,
        protein_grams=recipe.protein_grams,
        carbs_grams=recipe.carbs_grams,
        fat_grams=recipe.fat_grams,
        nutrition_computed_at=recipe.nutrition_computed_at,
        last_cooked_at=recipe.last_cooked_at,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        created_at=recipe.created_at,
        updated_at=recipe.updated_at,
    )


@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(
    recipe_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Get a specific recipe with all ingredients."""
    recipe = get_user_recipe(db, recipe_id, current_user)
    return build_recipe_response(recipe)


@router.put("/{recipe_id}", response_model=RecipeResponse)
def update_recipe(
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
    # Allow setting last_cooked_at (including clearing it with null)
    if "last_cooked_at" in recipe_data.model_fields_set:
        recipe.last_cooked_at = recipe_data.last_cooked_at

    db.commit()
    db.refresh(recipe)
    return build_recipe_response(recipe)


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(
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
def add_ingredient(
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
def get_step_completions(
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


def count_recipe_steps(instructions: str | None) -> int:
    """Count the number of steps in recipe instructions.

    Steps are identified by numbered lines (e.g., "1.", "2.") or bullet points.
    """
    if not instructions:
        return 0
    import re

    # Match lines starting with numbers followed by . or )
    # e.g., "1.", "2)", "10."
    lines = instructions.strip().split("\n")
    step_count = 0
    for line in lines:
        line = line.strip()
        if re.match(r"^\d+[.)]\s*", line):
            step_count += 1
    return step_count


@router.post("/{recipe_id}/steps/{step_index}/toggle", response_model=StepToggleResponse)
def toggle_step_completion(
    recipe_id: int,
    step_index: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Toggle a step's completion state."""
    # Verify recipe exists and user has household access
    household_ids = get_household_user_ids(db, current_user)
    recipe = (
        db.query(Recipe)
        .filter(
            Recipe.id == recipe_id,
            Recipe.user_id.in_(household_ids),
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
        db.flush()

        # Check if all steps are now complete
        total_steps = count_recipe_steps(recipe.instructions)
        if total_steps > 0:
            completed_count = (
                db.query(func.count(RecipeStepCompletion.id))
                .filter(
                    RecipeStepCompletion.recipe_id == recipe_id,
                    RecipeStepCompletion.user_id == current_user.id,
                )
                .scalar()
            )
            if completed_count >= total_steps:
                recipe.last_cooked_at = datetime.now(UTC)

        db.commit()
        return {"completed": True}


@router.delete("/{recipe_id}/step-completions", status_code=204)
def reset_step_completions(
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
