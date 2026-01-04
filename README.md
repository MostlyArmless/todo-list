# Todo List App

Self-hosted grocery and task management app with voice input, recipe management, pantry tracking, and LLM-powered auto-categorization. Built for my household's daily use.

**Technical highlights**: Local LLM parsing via Ollama, SSE-based real-time sync, escalating reminder system (push → SMS → voice call), Celery task queue with beat scheduler.

## Screenshots

<table>
  <tr>
    <td align="center"><strong>Lists</strong></td>
    <td align="center"><strong>Grocery List</strong></td>
    <td align="center"><strong>Task List</strong></td>
  </tr>
  <tr>
    <td><img src="docs/images/lists-mobile.jpg" width="250"></td>
    <td><img src="docs/images/grocery-list-mobile.gif" width="250"></td>
    <td><img src="docs/images/task-list-mobile.gif" width="250"></td>
  </tr>
  <tr>
    <td align="center"><strong>Recipes</strong></td>
    <td align="center"><strong>Recipe Detail</strong></td>
    <td align="center"><strong>Pantry</strong></td>
  </tr>
  <tr>
    <td><img src="docs/images/recipes-mobile.gif" width="250"></td>
    <td><img src="docs/images/recipe-detail-mobile.gif" width="250"></td>
    <td><img src="docs/images/pantry-mobile.gif" width="250"></td>
  </tr>
</table>

## Features

### Shopping Lists
- Multiple lists with category grouping and drag-and-drop reordering
- Smart duplicate merging with quantity tracking
- Real-time multi-device sync via Server-Sent Events
- Household sharing with permission levels

### Task Lists
- Due dates with escalating reminders: push → SMS (5min) → voice call (15min)
- Recurrence patterns and quiet hours

### Voice Input
- Browser-native speech recognition (Web Speech API)
- Natural language parsing: "milk, eggs, and bread" → 3 items
- Confirmation flow before adding

### Recipes & Pantry
- Recipe library with ingredients, instructions, and image upload
- One-click "add to list" with pantry deduction
- Track inventory, see which recipes use each item
- Sort recipes by "ready to cook" based on pantry coverage

### AI Features
- Auto-categorization from purchase history, LLM fallback
- Voice input parsing via local Ollama
- Smart ingredient-to-pantry matching

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI, SQLAlchemy, PostgreSQL, Celery, Redis |
| Frontend | Next.js (App Router), React, PWA |
| LLM | Ollama (qwen2.5:7b) |
| Notifications | Twilio (SMS/voice), Web Push |
| Infrastructure | Docker Compose, Cloudflare Tunnel |

## Quick Start

**Prerequisites**: Docker, Docker Compose, Ollama with `qwen2.5:7b`

```bash
# Pull the model
ollama pull qwen2.5:7b

# Start services
docker compose up -d

# Run migrations
docker compose exec api alembic upgrade head
```

**Access**: App at http://localhost:3002, API docs at http://localhost:8000/docs

**Optional integrations**: Copy `.env.example` to `.env` and configure Twilio (SMS/voice reminders), VAPID keys (push notifications), or USDA API (nutrition data).

## Development

See `CLAUDE.md` for dev commands, architecture, and conventions.

## License

MIT
