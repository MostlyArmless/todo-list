# Todo List App

Self-hosted todo list application with voice input, LLM-powered auto-categorization, and real-time sync.

## Features

- 🎤 **Voice Input**: Ultra-lightweight standalone voice page with Web Speech API
- 🤖 **LLM Auto-Categorization**: Ollama-powered item categorization with learning
- 🔄 **Real-Time Sync**: SSE-based multi-device synchronization
- 📱 **Progressive Web App**: Installable PWA with offline support
- 🔔 **Web Push Notifications**: Private, encrypted push notifications
- 🍳 **Recipe Management**: Smart recipe-to-list with natural language exclusions
- 🔒 **Secure External Access**: Cloudflare Tunnel for HTTPS without VPN

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Celery + Redis
- **Frontend**: Next.js 14+ with App Router
- **LLM**: Ollama (gemma3:12b)
- **Infrastructure**: Docker Compose
- **External Access**: Cloudflare Tunnel

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Ollama installed on host with gemma3:12b model
- Node.js 20+ (for PWA development)

### Setup

1. Clone and enter directory:
```bash
cd /home/mike/dev/todo-list
```

2. Copy environment file and configure:
```bash
cp .env.example .env
# Edit .env with your settings (JWT_SECRET, etc.)
```

3. Start services:
```bash
docker-compose up -d
```

4. Run database migrations:
```bash
docker-compose exec api alembic upgrade head
```

5. Access the application:
   - API: http://localhost:8000
   - PWA: http://localhost:3002
   - Voice: http://localhost:3002/voice
   - API Docs: http://localhost:8000/docs

## Development

### Database Migrations

Create a new migration:
```bash
docker-compose exec api alembic revision --autogenerate -m "description"
```

Apply migrations:
```bash
docker-compose exec api alembic upgrade head
```

Rollback:
```bash
docker-compose exec api alembic downgrade -1
```

### Testing Ollama Connection

```bash
curl http://localhost:11434/api/tags
```

Should show gemma3:12b in the list of models.

## Project Structure

```
todo-list/
├── src/                    # Python backend
│   ├── api/                # FastAPI endpoints
│   ├── models/             # SQLAlchemy models
│   ├── schemas/            # Pydantic schemas
│   ├── services/           # Business logic
│   └── tasks/              # Celery tasks
├── web/                    # Next.js PWA
├── voice/                  # Standalone voice page
├── alembic/                # Database migrations
└── docker-compose.yml      # Service orchestration
```

## Environment Variables

Key environment variables (see `.env.example` for full list):

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `OLLAMA_BASE_URL`: Ollama API URL (default: http://host.docker.internal:11434)
- `LLM_MODEL`: Ollama model to use (default: gemma3:12b)
- `JWT_SECRET`: Secret key for JWT tokens (generate with: `openssl rand -hex 32`)

## License

MIT
