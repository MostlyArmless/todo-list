# Project Roadmap

This file tracks pending work items for coordination across agents and sessions.

## Status Legend
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Completed
- `[?]` - Blocked / Needs clarification

---

## Active Tasks

_(No active tasks - all items completed, pending human review)_

---

## Pending Review

The following tasks were completed by agents and need human review before being marked complete:

### 1. [~] Centralize CSS Theme
**Files modified:** `web/src/app/globals.css`

Added CSS custom properties for theming:
- Background colors (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, etc.)
- Text colors (`--text-primary`, `--text-secondary`, `--text-muted`)
- Status colors (`--success`, `--warning`, `--danger` with muted variants)
- Design tokens (`--radius-*`, `--shadow-*`, `--transition-*`)
- New utility classes (`.btn-danger`, `.badge`, `.card-interactive`, `.modal-overlay`)

Note: Component files not yet updated to use new variables.

---

### 2. [~] Add Edit Button for List Items
**Files modified:** `web/src/app/list/[id]/page.tsx`

- Added inline edit mode with pencil icon button on each item
- Edit form includes: name, quantity, description, category dropdown
- Keyboard shortcuts: Enter to save, Escape to cancel

---

### 3. [~] Fix Quantity Display Totals
**Files modified:** `web/src/app/list/[id]/page.tsx`

- Integrated `formatQuantityTotal()` function for display
- Sums integers: "2 + 3" → "5"
- Handles units: "2 lbs + 3 lbs" → "5 lbs"
- Falls back to "+" format if parsing fails

---

### 4. [~] Fix Manual Categorization & History Lookup
**Files modified:** `src/api/items.py`, `web/src/app/list/[id]/page.tsx`

Backend:
- Added `lookup_category_from_history()` function
- Item creation now checks history before defaulting to Uncategorized
- 3 new tests added to verify behavior

Frontend:
- Category dropdown in Add Item form already existed

---

### 5. [~] Show Unchecked Item Count on Lists Page
**Files modified:** `src/api/lists.py`, `src/schemas/list.py`, `web/src/app/lists/page.tsx`

Backend:
- Added `unchecked_count: int` to `ListResponse` schema
- Efficient grouped query to get counts for all lists
- 1 new test added

Frontend:
- Accent-colored badge shows count when > 0

---

## Completed Tasks

### [x] Add Code Coverage Requirements to Pre-commit Hook (2025-12-27)
**Files:** `.git/hooks/pre-commit`, `pyproject.toml`, `web/jest.config.js`, `web/src/lib/__tests__/api.test.ts`

Added minimum code coverage requirements:
- Backend (Python): 60% minimum (currently at 79%)
- Frontend (TypeScript/lib): 40% minimum (currently at 97%)

Pre-commit hook now enforces coverage thresholds. Frontend coverage focused on `src/lib/` to target testable utility code.

---

## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
