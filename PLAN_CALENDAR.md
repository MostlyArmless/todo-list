# Meal Planning Calendar with Freezer Support

## Feature Overview

A weekly calendar view where users can:
1. Drag recipes onto specific days to plan meals
2. See visual bars showing how long cooked food lasts (freshness duration)
3. Optionally freeze portions, which go to a "Freezer" panel
4. Drag frozen items from the freezer back onto future calendar dates

## Data Model

### New Models

**MealPlanEntry** (`src/models/meal_plan.py`)
```python
class MealPlanEntry(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "meal_plan_entries"

    id: int (PK)
    user_id: int (FK -> users, indexed)
    recipe_id: int (FK -> recipes)
    cook_date: date  # The day this meal is cooked/thawed
    servings: int  # How many servings for this cook
    freshness_days: int  # How long it lasts (default from recipe or user override)
    source_frozen_item_id: int | None (FK -> freezer_items)  # If thawed from freezer
    notes: str | None
```

**FreezerItem** (`src/models/meal_plan.py`)
```python
class FreezerItem(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "freezer_items"

    id: int (PK)
    user_id: int (FK -> users, indexed)
    recipe_id: int (FK -> recipes)
    servings: int  # Portions frozen
    frozen_date: date  # When it was frozen
    source_meal_plan_entry_id: int | None (FK -> meal_plan_entries)  # Original cook event
    label: str | None  # Optional custom label ("Mike's birthday leftovers")
    notes: str | None
```

**Recipe Model Updates**
Add to existing Recipe model:
```python
default_freshness_days: int = 3  # How long this dish typically lasts in fridge
freezer_friendly: bool = True  # Whether this recipe freezes well
```

### Relationships
- MealPlanEntry -> Recipe (many-to-one)
- MealPlanEntry -> FreezerItem (optional, for thawed meals)
- FreezerItem -> Recipe (many-to-one)
- FreezerItem -> MealPlanEntry (optional, tracks origin)
- Both use household sharing via `get_household_user_ids()`

## API Endpoints

### Meal Plan Entries (`src/api/meal_plan.py`)

```
GET  /api/v1/meal-plan?start_date=2024-01-15&end_date=2024-01-21
     Returns entries for date range with recipe details
     Response includes computed "end_date" (cook_date + freshness_days)

POST /api/v1/meal-plan
     Create entry: { recipe_id, cook_date, servings, freshness_days?, freeze_servings? }
     If freeze_servings > 0, also creates FreezerItem

PUT  /api/v1/meal-plan/{entry_id}
     Update entry (move to different day, change servings, etc.)

DELETE /api/v1/meal-plan/{entry_id}
     Soft delete entry

POST /api/v1/meal-plan/{entry_id}/freeze
     Freeze remaining portions: { servings, label? }
     Creates FreezerItem linked to this entry
```

### Freezer (`src/api/meal_plan.py`)

```
GET  /api/v1/freezer
     List all frozen items with recipe details
     Sorted by frozen_date (oldest first, to encourage FIFO)

POST /api/v1/freezer
     Manually add frozen item (not from a meal plan entry)
     { recipe_id, servings, frozen_date?, label? }

PUT  /api/v1/freezer/{item_id}
     Update frozen item (change servings, label)

DELETE /api/v1/freezer/{item_id}
     Remove from freezer (eaten without planning, or discarded)

POST /api/v1/freezer/{item_id}/thaw
     Schedule thawed meal: { cook_date, servings? }
     Creates MealPlanEntry linked to this FreezerItem
     Decrements or deletes FreezerItem based on servings used
```

### Generate Shopping List

```
POST /api/v1/meal-plan/shopping-list
     { start_date, end_date, list_id }
     Aggregates ingredients from all planned meals in range
     Checks pantry, skips items already in stock
     Adds to specified shopping list (uses existing add-to-list logic)
```

## Frontend Implementation

### New Route: `/calendar`

**File Structure:**
```
web/src/app/calendar/
├── page.tsx           # Main calendar view
├── page.module.css    # Calendar styles
├── FreezerPanel.tsx   # Collapsible freezer sidebar
├── MealBar.tsx        # Visual bar for a planned meal
├── DayColumn.tsx      # Single day in the calendar
└── CookModal.tsx      # Modal when dropping recipe onto calendar
```

### Calendar View (`page.tsx`)

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  < Prev Week    Jan 15 - Jan 21, 2024    Next Week >        │
├─────────────────────────────────────────────────────────────┤
│  Mon 15 │ Tue 16 │ Wed 17 │ Thu 18 │ Fri 19 │ Sat 20 │ Sun │
│─────────┼────────┼────────┼────────┼────────┼────────┼─────│
│ [Lasagna═══════════════]  │        │        │        │     │
│         │ [Stir Fry══════]│        │        │        │     │
│         │        │        │ [Tacos═══════]  │        │     │
├─────────────────────────────────────────────────────────────┤
│  🧊 Freezer (3 items)                              [expand] │
│  ┌─────────────────┐ ┌─────────────────┐                    │
│  │ Lasagna (4 srv) │ │ Chili (6 srv)   │                    │
│  │ frozen Jan 10   │ │ frozen Jan 3    │                    │
│  └─────────────────┘ └─────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

**Mobile Layout:**
- Days stack vertically (scrollable)
- Freezer panel becomes a bottom sheet
- Tap to expand/collapse days

### Drag-and-Drop Interactions

**Sources (draggable):**
1. Recipe cards from a recipe picker dropdown/modal
2. Freezer items from the freezer panel
3. Existing meal bars (to reschedule)

**Targets (droppable):**
1. Day columns in the calendar
2. Freezer panel (to freeze a planned meal)

**Drop on Calendar Day:**
1. Opens CookModal with:
   - Recipe name (read-only)
   - Servings (editable, defaults to recipe.servings)
   - Freshness days (editable, defaults to recipe.default_freshness_days)
   - "Freeze some?" toggle -> servings to freeze input
2. On confirm: POST to /api/v1/meal-plan
3. Bar appears spanning cook_date to cook_date + freshness_days

**Drop Freezer Item on Calendar:**
1. Opens CookModal with "Thawing [Recipe Name]"
2. Shows available servings from freezer
3. On confirm: POST to /api/v1/freezer/{id}/thaw
4. Updates freezer count, creates meal bar

### Visual Design

**Meal Bars:**
- Use recipe's `label_color` for the bar background
- Show recipe name + servings count
- Span from cook_date through freshness end date
- Slightly transparent for days after cook date (eating leftovers)
- Click to edit/delete

**Freezer Items:**
- Card-style display with recipe thumbnail
- Shows: recipe name, servings, "frozen X days ago"
- Visual warning if frozen > 90 days (food safety)
- Draggable to calendar

**Color Scheme:**
- Fresh cooking day: solid color bar
- Leftover days: 60% opacity of same color
- Frozen items: blue-tinted cards with snowflake icon

### State Management

```typescript
// Queries
const { data: entries } = useGetMealPlanApiV1MealPlanGet({
  start_date: weekStart,
  end_date: weekEnd
});
const { data: freezerItems } = useGetFreezerApiV1FreezerGet();
const { data: recipes } = useListRecipesApiV1RecipesGet();

// Mutations
const createEntry = useCreateMealPlanEntryApiV1MealPlanPost();
const updateEntry = useUpdateMealPlanEntryApiV1MealPlanEntryIdPut();
const deleteEntry = useDeleteMealPlanEntryApiV1MealPlanEntryIdDelete();
const thawItem = useThawFreezerItemApiV1FreezerItemIdThawPost();
```

## Database Migration

```bash
docker compose exec api alembic revision --autogenerate -m "add meal planning tables"
docker compose exec api alembic upgrade head
```

**Migration adds:**
1. `meal_plan_entries` table
2. `freezer_items` table
3. `recipes.default_freshness_days` column (default 3)
4. `recipes.freezer_friendly` column (default true)

## Implementation Order

### Phase 1: Core Backend
1. Create `src/models/meal_plan.py` with MealPlanEntry and FreezerItem
2. Add Recipe model fields (default_freshness_days, freezer_friendly)
3. Run migration
4. Create `src/api/meal_plan.py` with CRUD endpoints
5. Add router to main.py
6. Write tests in `tests/test_meal_plan.py`

### Phase 2: Basic Calendar UI
1. Create `/calendar` page with week navigation
2. Implement day columns with drop zones
3. Fetch and display meal bars (no drag yet)
4. Add recipe picker modal

### Phase 3: Drag-and-Drop
1. Integrate dnd-kit for dragging recipes to calendar
2. Implement CookModal for configuring new entries
3. Add drag to reschedule existing meals
4. Optimistic updates for smooth UX

### Phase 4: Freezer Panel
1. Build FreezerPanel component
2. Implement drag from calendar to freezer (freeze portions)
3. Implement drag from freezer to calendar (thaw)
4. Add freezer item management (edit, delete)

### Phase 5: Shopping List Generation
1. Add POST /api/v1/meal-plan/shopping-list endpoint
2. Add "Generate Shopping List" button to calendar
3. Date range picker for list generation
4. Integration with existing list/pantry logic

### Phase 6: Polish
1. Mobile-responsive layout
2. Keyboard navigation
3. Visual indicators for food safety (old frozen items)
4. Recipe quick-add from calendar

## Files to Create/Modify

**New Files:**
- `src/models/meal_plan.py`
- `src/api/meal_plan.py`
- `src/schemas/meal_plan.py`
- `tests/test_meal_plan.py`
- `web/src/app/calendar/page.tsx`
- `web/src/app/calendar/page.module.css`
- `web/src/app/calendar/FreezerPanel.tsx`
- `web/src/app/calendar/MealBar.tsx`
- `web/src/app/calendar/DayColumn.tsx`
- `web/src/app/calendar/CookModal.tsx`

**Modified Files:**
- `src/models/__init__.py` - export new models
- `src/models/recipe.py` - add freshness_days, freezer_friendly
- `src/main.py` - register meal_plan router
- `web/src/components/Navbar/Navbar.tsx` - add Calendar link
- `web/orval.config.ts` - will auto-include new endpoints

## Open Questions

1. **Meal types (breakfast/lunch/dinner)?** - Could add later, start simple with just date-based planning
2. **Recurring meals?** - Could leverage existing recurrence_pattern from Item model
3. **Household calendar sharing?** - Yes, use existing household pattern from recipes
