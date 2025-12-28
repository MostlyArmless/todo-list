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

**After adding new Celery tasks**, restart the worker to register them:
```bash
docker compose restart celery-worker
```

### Frontend (Next.js PWA)

Located in `/web/` with App Router (`/web/src/app/`):
- `/lists` - List management
- `/list/[id]` - List detail with items and categories
- `/recipes` - Recipe management
- `/recipes/[id]` - Recipe detail with "Add to Shopping List" button
- `/voice` - Standalone voice input page (also at `/web/public/voice/index.html`)
- `/confirm` - Pending confirmation review

API client in `/web/src/lib/api.ts` handles auth token management.

### Local Network Deployment

The app is served at `https://todolist.lan` via nginx on the Ubuntu desktop (192.168.0.150).

**Traffic flow:**
```
Browser → nginx (443) → Docker PWA container (3002) → Next.js
                     → Docker API container (8000) → FastAPI (for /api/ routes)
```

**nginx config** (`/etc/nginx/sites-available/todolist.lan`):
- HTTPS with self-signed cert
- `/` → proxies to `http://192.168.0.150:3002` (Next.js)
- `/api/` → proxies to `http://192.168.0.150:8000` (FastAPI)
- `/voice` → serves static file from `/var/www/todolist/voice.html`

**Development mode (default):**
- The `pwa` container runs `npm run dev` with hot reloading
- File changes in `./web/` are reflected immediately on browser refresh
- `WATCHPACK_POLLING=true` enables file watching inside Docker

**Production build (manual):**
```bash
# Edit docker-compose.yml to change pwa command:
# command: sh -c "npm install && npm run build && npm run start"
# Then recreate the container:
docker compose up -d pwa
```

**Troubleshooting:**
- If changes aren't appearing, check `docker compose logs pwa` for compilation errors
- The pwa container uses an anonymous volume for `node_modules` (isolated from host)
- Hard refresh (Ctrl+Shift+R) to bypass browser cache

### Test Infrastructure

Tests use a separate PostgreSQL database (`todo_list_test`) in Docker. Each test gets a clean session with automatic cleanup via `conftest.py`. **Always use the `db` fixture from conftest.py—never import `SessionLocal` directly in tests.**

The `AuthHeaders` fixture provides headers dict plus `.user_id` and `.email`:
```python
def test_example(client, auth_headers):
    user_id = auth_headers.user_id
    email = auth_headers.email  # unique per test
    response = client.get("/api/v1/lists", headers=auth_headers)
```

## Git Hooks

Uses [pre-commit](https://pre-commit.com/) framework. Config in `.pre-commit-config.yaml`. Install with `uv run pre-commit install`.

Post-commit hook syncs voice page to `/var/www/todolist/voice.html` (nginx can't access files in user home directories).

## Commit Hygiene

**Before each commit**, read `ROADMAP.md` and remove any completed tasks (`[x]`) from the file. This prevents unbounded context window growth for future agents. Include the ROADMAP cleanup in the same commit as the feature work.
