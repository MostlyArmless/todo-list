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

## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
- Completed tasks are removed during commits to prevent unbounded file growth
