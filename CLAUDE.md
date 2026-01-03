# CLAUDE.md

## Build and Development Commands

```bash
# Docker Services
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose logs -f api        # Follow API logs
docker compose logs -f celery-worker  # Follow Celery logs

# Testing (in Docker)
docker compose exec -T api pytest --tb=short -q
docker compose exec -T api pytest tests/test_api.py::test_create_list -v

# Database
docker compose exec api alembic revision --autogenerate -m "description"
docker compose exec api alembic upgrade head
docker compose exec api alembic downgrade -1
docker compose exec -T db psql -U todo_user -d todo_list

# Linting (requires `uv sync --extra dev`)
uv run ruff format .
uv run ruff check . --fix
```

## Architecture

### Backend (FastAPI + Celery)

**API Structure** (`/src/api/`): `auth.py` (JWT), `lists.py`, `categories.py`, `items.py`, `voice.py`

**Voice Processing Flow**:
1. `POST /api/v1/voice` → Celery task `process_voice_input` → Ollama LLM parsing
2. Auto-categorization via `CategorizationService` (history-first, LLM fallback)
3. Creates `PendingConfirmation` → user confirms via `/api/v1/voice/pending/{id}/action`

**Categorization** (`src/services/categorization.py`): Exact match (confidence 1.0) → fuzzy substring (≥0.5) → LLM fallback

**After adding Celery tasks**: `docker compose restart celery-worker`

**Household Sharing** (`src/api/dependencies.py`): Users sharing lists form a "household" and auto-share recipes/pantry. Use `get_household_user_ids(db, user)` then `.filter(Model.user_id.in_(household_ids))`. Lists use explicit `ListShare` table with permission levels.

**List Types**: `grocery` (default) or `task`. Task lists support `due_date`, `reminder_offset`, `reminder_at`, `recurrence_pattern`.

**Task Reminders** (`src/tasks/reminders.py`): `celery-beat` runs `process_escalations` every minute. Escalation: push → SMS (5min) → voice call (15min). Settings in `UserNotificationSettings`. Twilio webhooks at `/api/v1/webhooks/twilio/{sms,voice/*}`.

**Recipe Images**: Upload via `POST /api/v1/recipes/{id}/image`. Stored in `/app/uploads/recipes/` as JPEG (800px main, 200px thumb). Served at `/api/v1/uploads/recipes/{id}.jpg`.

### Frontend (Next.js PWA)

Located in `/web/` with App Router. Routes: `/lists`, `/list/[id]`, `/recipes`, `/recipes/[id]`, `/pantry`, `/voice`, `/confirm`

**Production Build**: The PWA runs in production mode. After making frontend changes, restart to rebuild:
```bash
docker compose up -d pwa --force-recreate  # Rebuilds Next.js (~15-20s)
```

**Development Mode** (hot reloading): For faster iteration during development:
```bash
docker compose --profile dev up pwa-dev    # Runs on port 3003 with hot reload
```
Dev hot-reloads on `todolist.lan`; prod on `thiemnet.ca` needs manual rebuild (`docker compose up -d pwa --force-recreate`) - do this before committing frontend changes.

**Voice Page**: Uses Web Speech API. Brave Desktop blocks Google's speech servers (privacy); code shows warning banner. Other browsers work fine.

**API Client Architecture** (IMPORTANT):
- **Generated client** (`/web/src/generated/api.ts`): Auto-generated from OpenAPI spec using orval. Provides React Query hooks for all API endpoints with type-safe request/response types.
- **Auth helpers** (`/web/src/lib/auth.ts`): Login/logout/getCurrentUser functions that handle localStorage token management.
- **Custom fetcher** (`/web/src/lib/api-fetcher.ts`): Base fetch wrapper used by generated client. Handles auth headers, base URL, error responses.

**NEVER write manual API client code.** All API calls must use:
1. Generated React Query hooks from `@/generated/api` for data fetching/mutations
2. Auth helpers from `@/lib/auth` for login/logout/user state
3. Types from `@/generated/api` for request/response types

**Regenerating the API client** (after backend API changes):
```bash
cd web && npm run generate-api
```

**Auto-regeneration watcher** (for development):
```bash
./scripts/watch-api.sh  # Watches backend files, auto-regenerates on change
```

The pre-commit hook will fail if it detects manual API client imports. Fix by migrating to the generated client.

### Deployment (Cloudflare Tunnel)

App accessible at `https://thiemnet.ca`. Config at `/etc/cloudflared/config.yml`. Restart: `sudo systemctl restart cloudflared`

Key routing:
- `/api/*` → FastAPI (port 8000)
- `/voice` → nginx (port 443) for static voice.html
- Everything else → Next.js (port 3002)

**Important**: The `/voice` navbar link uses `<a>` tag (not Next.js `<Link>`) since voice page is static HTML served by nginx.

**CORS**: `https://thiemnet.ca` allowed in `src/main.py`

### Test Infrastructure

Tests use `todo_list_test` database. **Use `db` fixture from conftest.py, never import `SessionLocal` directly.**

```python
def test_example(client, auth_headers):
    user_id = auth_headers.user_id
    email = auth_headers.email
    response = client.get("/api/v1/lists", headers=auth_headers)
```

### Playwright E2E Tests

Located in `/web/e2e/`. Run: `npm run e2e` or `npx playwright test <file>`

Screenshot utility: `npm run screenshot` (mobile) or `npm run screenshot:all` (all viewports)

**README Media**: Demo data persists in main DB (isolated by demo user). Regenerate with:
```bash
cd web && npm run readme-media
```

This script seeds demo data, captures viewport-sized screenshots, records scroll videos for tall pages, and converts to GIFs with ffmpeg. Device viewports configured for Pixel 6/6 Pro (the actual users' devices). See `web/playwright.config.ts`.

## Git Hooks

Uses pre-commit framework. Config in `.pre-commit-config.yaml`. Install: `uv run pre-commit install`

**Post-commit hook** - install with:
```bash
cp scripts/hooks/post-commit .git/hooks/post-commit
```

The post-commit hook syncs the voice page to `/var/www/todolist/voice.html`.

## Code Quality

**Testing**: New endpoints need tests. Bug fixes should include regression tests when practical.

**UI Changes**: Always validate UI changes with Playwright. Use `npm run screenshot` for visual verification of styling/layout changes, or write e2e tests for behavioral changes. Never commit UI changes without visual confirmation they work correctly on mobile viewports.

**Patterns**:
- Services in `src/services/`, CRUD in routers
- Frontend uses CSS Modules (`.module.css`)
- Use generated React Query hooks from `@/generated/api`, never manual fetch calls
- Use `@/lib/auth` for auth state, not direct localStorage access

**Avoid**:
- `print()`/`console.log()` (ruff T20 catches this)
- `# type: ignore`/`as any` without comment
- Adding dependencies without discussing tradeoffs
- Commenting out code (use git history)
- Abstractions for single-use cases

## Commit Hygiene

**Before each commit**:
- Read `ROADMAP.md` and remove completed tasks (`[x]`). Include cleanup in the same commit.
- If visual UI changed, regenerate README media: `cd web && npm run readme-media`
