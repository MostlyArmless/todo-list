# Project Roadmap

This file tracks pending work items for coordination across agents and sessions.

## Status Legend
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Completed
- `[?]` - Blocked / Needs clarification

---

## Active Tasks

### [ ] Recipe Pantry Integration Improvements
**Files:** `web/src/app/recipes/page.tsx`, `web/src/app/recipes/[id]/page.tsx`

1. **Pantry progress indicator on /recipes page**: Show a small progress bar on each recipe card indicating how many ingredients the user already owns (based on Pantry data)

2. **Pantry quantity column on /recipes/{id}**: Add a new column to the right of Quantity that displays how many of each ingredient we currently have in the Pantry. Should be editable to update Pantry data directly from this page. Auto-ignore/disable for ingredients like "water" that we never shop for.

3. **Single-click to edit ingredient**: Currently requires two clicks (one to select row, second to focus field). Make it single-click to edit.

4. **Click-away to deselect**: Currently requires Esc to defocus editing a selected row. Should also deselect when clicking any non-interactive part of the page.

---

## Completed Tasks

### [x] Centralize CSS Theme (2025-12-27)
**Files:** `web/src/app/globals.css`

Added CSS custom properties for theming:
- Background colors (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, etc.)
- Text colors (`--text-primary`, `--text-secondary`, `--text-muted`)
- Status colors (`--success`, `--warning`, `--danger` with muted variants)
- Design tokens (`--radius-*`, `--shadow-*`, `--transition-*`)
- Utility classes (`.btn-danger`, `.badge`, `.card-interactive`, `.modal-overlay`)

Components updated to use CSS variables throughout.

---

### [x] Add Edit Button for List Items (2025-12-27)
**Files:** `web/src/app/list/[id]/page.tsx`

- Added inline edit mode with pencil icon button on each item
- Edit form includes: name, quantity, description, category dropdown
- Keyboard shortcuts: Enter to save, Escape to cancel

---

### [x] Fix Quantity Display Totals (2025-12-27)
**Files:** `web/src/app/list/[id]/page.tsx`

- Integrated `formatQuantityTotal()` function for display
- Sums integers: "2 + 3" -> "5"
- Handles units: "2 lbs + 3 lbs" -> "5 lbs"
- Falls back to "+" format if parsing fails

---

### [x] Fix Manual Categorization & History Lookup (2025-12-27)
**Files:** `src/api/items.py`, `web/src/app/list/[id]/page.tsx`

Backend:
- Added `lookup_category_from_history()` function
- Item creation now checks history before defaulting to Uncategorized
- 3 new tests added to verify behavior

Frontend:
- Category dropdown in Add Item form

---

### [x] Show Unchecked Item Count on Lists Page (2025-12-27)
**Files:** `src/api/lists.py`, `src/schemas/list.py`, `web/src/app/lists/page.tsx`

Backend:
- Added `unchecked_count: int` to `ListResponse` schema
- Efficient grouped query to get counts for all lists
- 1 new test added

Frontend:
- Accent-colored badge shows count when > 0

---

### [x] Add Code Coverage Requirements to Pre-commit Hook (2025-12-27)
**Files:** `.git/hooks/pre-commit`, `pyproject.toml`, `web/jest.config.js`, `web/src/lib/__tests__/api.test.ts`

Added minimum code coverage requirements:
- Backend (Python): 60% minimum (currently at 79%)
- Frontend (TypeScript/lib): 40% minimum (currently at 97%)

Pre-commit hook now enforces coverage thresholds. Frontend coverage focused on `src/lib/` to target testable utility code.

---

### [x] Recipe Management System (2025-12-27)
**Files:** `src/api/recipes.py`, `src/models/recipe.py`, `src/services/recipe_service.py`, `web/src/app/recipes/`

Full recipe management implementation:
- Recipe CRUD with ingredients
- Add recipe ingredients to shopping lists with one click
- Store preference per ingredient (remembers which store to buy from)
- Recipe labels with color-coded tags on shopping list items
- Undo support for recipe additions
- Recipe sources stored as JSONB for flexibility

---

### [x] Pantry Tracking Feature (2025-12-27)
**Files:** `src/api/pantry.py`, `src/models/pantry.py`, `src/services/pantry_service.py`, `web/src/app/pantry/`

Pantry inventory management:
- Track items on hand with optional categories
- LLM-powered ingredient matching (pantry items to recipe ingredients)
- Match caching for performance (`pantry_match_history` table)
- "Add missing to list" button for quick shopping list population
- Pantry check integration when adding recipes to lists

---

### [x] Smart Merge on Add (2025-12-27)
**Files:** `src/api/items.py`

When adding items that already exist in a list:
- Automatically merge with existing item
- Combine quantities intelligently
- Prevents duplicates

---

### [x] Recipe Label Colors (2025-12-27)
**Files:** `src/api/recipes.py`, `web/src/app/list/[id]/page.tsx`

- 10 maximally distinguishable colors for recipe labels
- Color changes propagate to existing list items
- Visual indication of which recipe each item came from

---

### [x] Delete Lists with Confirmation (2025-12-27)
**Files:** `web/src/app/lists/page.tsx`

- Delete button on lists page
- Confirmation dialog before deletion

---

### [x] Voice Input System (2025-12-07)
**Files:** `src/api/voice.py`, `src/tasks/voice.py`, `web/public/voice/`, `web/src/app/confirm/`

- Standalone voice page with Web Speech API
- LLM-powered parsing of natural language input
- Confirmation flow for reviewing parsed items
- Post-commit hook syncs voice page to nginx

---

### [x] LLM Auto-Categorization (2025-12-07)
**Files:** `src/services/categorization.py`, `src/services/llm.py`

- History-first lookup (exact match, then fuzzy)
- LLM fallback for unknown items
- Learning system improves over time

---

## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
