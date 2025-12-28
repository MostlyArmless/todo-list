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

### [ ] Pantry Page UX Improvements
**Context:** The current pantry page has several usability issues that make it harder to use effectively.

**Required changes:**
1. **List layout instead of grid** - Switch to an alphabetically sorted list for easier scanning and finding items
2. **Search/filter** - Add a search input to quickly find whether items exist in the pantry
3. **Stable icon positioning** - Reserve fixed space for the shopping cart icon so that clicking the status tag to cycle through statuses doesn't cause layout shift that places the cart icon under the cursor (leading to accidental "add to list" clicks)

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

## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
- Completed tasks are removed during commits to prevent unbounded file growth
