# Project Roadmap

This file tracks pending work items for coordination across agents and sessions.

## Status Legend
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Completed
- `[?]` - Blocked / Needs clarification

---

## Active Tasks

### [ ] Receipt Scanning for Pantry Updates
**Context:** After shopping, take a photo of the receipt and automatically update pantry items based on what was purchased.

**Implementation options to evaluate:**
1. **Claude Opus 4.5 Vision** - Send receipt image directly to Claude for parsing. Simpler integration, leverages existing LLM infrastructure.
2. **Dedicated OCR Service** - Use a specialized OCR service (e.g., Google Cloud Vision, AWS Textract, Tesseract) for potentially better accuracy on receipt text extraction, then parse the extracted text.

**Considerations:**
- Receipt formats vary widely by store
- Need to map receipt item names to pantry items (fuzzy matching)
- Should handle quantities when present
- May want to auto-create new pantry items for unrecognized products
- Cost/latency tradeoffs between approaches

**Decision:** Evaluate both approaches during implementation to determine best fit.

---

### [ ] Recipe Sorting Options
**Context:** Allow users to sort the /recipes page by different criteria for easier meal planning and decision-making.

**Sort criteria to implement:**
1. **Alphabetical** - Sort by recipe name (A-Z, Z-A)
2. **Number of ingredients** - Fewest first for quick meals, most first for complex dishes
3. **Date last cooked** - Most recent first, or oldest first to find neglected recipes
4. **Cost** - Cheapest first (requires ingredient cost data)
5. **Macros per serving** - Sort by protein, carbs, fat, or calories (depends on "Recipe Macro and Calorie Estimation" feature)

**Prerequisites:**
- "Date last cooked" requires tracking when recipes are completed (infer from step checkmark usage in instructions section - when all steps are checked, record as "cooked")
- "Cost" requires ingredient cost tracking (could be manual or integrated with store APIs)
- "Macros" sorting depends on implementing "Recipe Macro and Calorie Estimation" first

**Implementation notes:**
- Add sort dropdown/selector to recipes page header
- Persist user's sort preference (localStorage or user settings)
- Consider secondary sort (e.g., alphabetical as tiebreaker)
- Default to most recently added or alphabetical

---

## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
- Completed tasks are removed during commits to prevent unbounded file growth
