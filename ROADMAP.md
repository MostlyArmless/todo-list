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

## Notes

- Agents should not mark tasks as complete - human review required
- Update this file when starting/finishing work to avoid conflicts
- Completed tasks are removed during commits to prevent unbounded file growth
