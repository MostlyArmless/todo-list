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

### [ ] Auto-Generated Frontend API Client
**Context:** Investigate whether to introduce a system for type-safe API clients auto-generated from FastAPI/Pydantic schemas.

**Potential approach:**
- Ensure all FastAPI endpoints have full Pydantic request/response models
- Generate OpenAPI spec from FastAPI
- Use a code generator (e.g., [orval](https://orval.dev/), openapi-typescript-codegen) to create TypeScript client with React Query hooks
- Benefits: FE/BE types stay in sync, less manual type duplication, deterministic client generation

**Considerations:**
- Evaluate tooling options (orval, openapi-generator, etc.)
- Consider impact on current manual api.ts approach
- May reduce token usage for AI agents working on frontend

---

### [ ] Recipe Macro and Calorie Estimation
**Context:** Display estimated macros (protein, carbs, fat) and calories for each recipe on the recipes page, derived automatically from the ingredients list and quantities.

**Requirements:**
- Show at-a-glance nutrition info on recipe cards (protein, carbs, fat, calories)
- Estimates based on ingredient names and quantities
- No manual entry required - fully automatic

**Implementation options to evaluate:**
1. **USDA FoodData Central API** - Free public API with comprehensive food nutrition data. Would need to map ingredient names to USDA food items.
2. **Nutritionix API** - Commercial API with natural language parsing ("1 cup chicken breast"). Has a free tier with rate limits.
3. **Edamam Nutrition Analysis API** - Parse full ingredient lines, returns nutrition data. Free tier available.
4. **Open Food Facts API** - Open source database of food products with nutrition info.

**Considerations:**
- Accuracy depends on ingredient name matching quality
- Quantities need to be parsed and normalized (e.g., "2 cups" vs "500g")
- May want to cache results to reduce API calls
- Could use LLM to help normalize ingredient names before API lookup
- Consider fallback strategies when ingredients don't match

**Decision:** Research APIs during implementation to determine best fit for accuracy and cost.

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
