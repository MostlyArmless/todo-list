# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

### Docker Services
```bash
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose logs -f api        # Follow API logs
docker compose logs -f celery-worker  # Follow Celery logs
```

### Testing
```bash
# Run all tests (in Docker)
docker compose exec -T api pytest --tb=short -q

# Run specific test file
docker compose exec -T api pytest tests/test_api.py -v

# Run specific test
docker compose exec -T api pytest tests/test_api.py::test_create_list -v
```

### Database Migrations
```bash
docker compose exec api alembic revision --autogenerate -m "description"
docker compose exec api alembic upgrade head
docker compose exec api alembic downgrade -1
```

### Linting and Formatting (requires `uv sync --extra dev`)
```bash
uv run ruff format .              # Format code
uv run ruff check . --fix         # Lint and auto-fix
```

### Direct Database Access
```bash
docker compose exec -T db psql -U todo_user -d todo_list
```

## Architecture

### Backend (FastAPI + Celery)

**API Structure**: `/src/api/` contains routers following REST conventions:
- `auth.py`: JWT-based authentication (register, login)
- `lists.py`, `categories.py`, `items.py`: Standard CRUD
- `voice.py`: Voice input processing with async Celery tasks

**Voice Processing Flow**:
1. User submits voice text via `POST /api/v1/voice`
2. Celery task `process_voice_input` parses with Ollama LLM
3. Items auto-categorized using `CategorizationService` (history-first, LLM fallback)
4. Creates `PendingConfirmation` for user review
5. User confirms/rejects via `/api/v1/voice/pending/{id}/action`

**Categorization Strategy** (`src/services/categorization.py`):
1. Exact match on `ItemHistory.normalized_name` → confidence 1.0
2. Fuzzy substring match weighted by `occurrence_count` → confidence ≥0.5
3. LLM fallback with category context

### Frontend (Next.js PWA)

Located in `/web/` with App Router (`/web/src/app/`):
- `/lists` - List management
- `/list/[id]` - List detail with items and categories
- `/voice` - Standalone voice input page (also at `/web/public/voice/index.html`)
- `/confirm` - Pending confirmation review

API client in `/web/src/lib/api.ts` handles auth token management.

### Test Infrastructure

Tests use a separate PostgreSQL database (`todo_list_test`) in Docker. Each test gets a clean session with automatic cleanup via `conftest.py`. **Always use the `db` fixture from conftest.py—never import `SessionLocal` directly in tests.**

The `AuthHeaders` fixture provides headers dict plus `.user_id` and `.email`:
```python
def test_example(client, auth_headers):
    user_id = auth_headers.user_id
    email = auth_headers.email  # unique per test
    response = client.get("/api/v1/lists", headers=auth_headers)
```

## Pre-commit Hook

The pre-commit hook (`.git/hooks/pre-commit`) runs:
1. `ruff format` with `--quiet`
2. `ruff check --fix` with `--quiet`
3. `pytest --tb=short -q` in Docker

All checks must pass before commits are allowed.
