# Multi-Agent Development Isolation

This document describes how to run multiple isolated development environments (for parallel AI agents or developers) on the same machine using Docker Compose project isolation.

## The Problem

When multiple agents work on the same codebase simultaneously:
- Only one set of containers can run on the default ports
- Container names conflict (Docker container names are global)
- Agents can't run tests or curl the server without interfering

## Solution: Docker Compose Project Isolation

Each agent gets its own complete Docker stack with:
- Separate project name (namespaces networks and volumes)
- Different port mappings (no conflicts)
- Different container names (no conflicts)
- Isolated databases (separate postgres volumes)

## Audit Results

### Critical Issue: Hardcoded Container Names

The current `docker-compose.yml` uses explicit `container_name` for all services:
```yaml
container_name: todo-list-db
container_name: todo-list-redis
container_name: todo-list-api
# etc.
```

**Problem:** Container names are global in Docker, not namespaced by project. Two projects trying to create `todo-list-api` will conflict.

**Fix:** Override container names in agent-specific compose files.

### What Already Works Correctly

1. **Frontend API calls** - Uses `window.location.origin`, so it's relative to whatever port the browser is on
2. **WebSocket URL** - Also uses `window.location.host`, works with any port
3. **Named volumes** - `postgres_data` and `redis_data` are automatically namespaced by project name
4. **Bind mounts** - All use relative paths (`./src`, `./web`), work correctly when compose is run from the worktree directory
5. **Test database** - Derived from `DATABASE_URL`, isolated per project

### Ports That Need Remapping

Agent ports use high ranges to avoid conflicts with other projects:

| Service   | Default | Agent A | Agent B |
|-----------|---------|---------|---------|
| db        | 5433    | 15433   | 15434   |
| redis     | 6381    | 16380   | 16381   |
| api       | 8000    | 18001   | 18002   |
| pwa       | 3002    | 13002   | 13004   |

**Note**: Agent environments use `pwa-dev` (hot reload) instead of production PWA. The prod `pwa` container is disabled via profiles.

## Implementation

### Step 1: Override File Template

The `docker-compose.override.template.yml` file is already provided. It uses the `!override` directive (Docker Compose 2.24+) to replace port arrays rather than merge them.

```yaml
services:
  db:
    container_name: todo-AGENT-db
    ports: !override
      - "5434:5432"  # Change to unique port

  api:
    container_name: todo-AGENT-api
    ports: !override
      - "8001:8000"  # Change to unique port
  # ... etc
```

### Step 2: Autonomous Agent Environment Creation

Use `scripts/agent-env.sh` to automatically create isolated environments with unique ports:

```bash
# Create next available agent environment (auto-assigns ID and ports)
./scripts/agent-env.sh create
# Output: Created agent environment: a
#         API: http://localhost:8001, PWA: http://localhost:3004, ...
#         AGENT_ID=a

# Create with specific ID
./scripts/agent-env.sh create b

# List existing environments
./scripts/agent-env.sh list

# Destroy an environment (stops containers, removes config)
./scripts/agent-env.sh destroy a
```

The script uses file locking (`flock`) to ensure atomic creation when multiple agents spin up simultaneously.

**Port assignment formula:**
- Agent ID a=1, b=2, c=3, etc.
- API: 8000 + agent_num (a=8001, b=8002, ...)
- PWA: 3002 + agent_num*2 (a=3004, b=3006, ...)
- DB: 5433 + agent_num (a=5434, b=5435, ...)

### Step 3: Running the Agent Stack

After creating an environment, use `scripts/agent-compose.sh`:

```bash
# Start agent's stack
./scripts/agent-compose.sh a up -d

# Run tests
./scripts/agent-compose.sh a exec -T api pytest

# View logs
./scripts/agent-compose.sh a logs -f api

# Stop stack
./scripts/agent-compose.sh a down

# Stop and remove volumes (deletes data!)
./scripts/agent-compose.sh a down -v
```

## Resource Considerations

Each full stack uses approximately:
- PostgreSQL: 100-200 MB RAM
- Redis: 50 MB RAM
- FastAPI + Celery (3 containers): 300-500 MB RAM
- Next.js: 200-300 MB RAM
- **Total: ~1-1.5 GB RAM per stack**

With 3 parallel agents: ~4-5 GB RAM for Docker stacks alone.

## Caveats

### 1. Always Run Compose From Worktree Directory
The `.` in bind mounts is relative to where you run `docker compose`. If you're in worktree B but run compose from the main repo, containers will see the wrong code.

### 2. Shared Ollama
All stacks point to `host.docker.internal:11434` (the host's Ollama). This is fine - Ollama is stateless for inference. If running many parallel LLM requests, they'll queue.

### 3. Cloudflare Tunnel
The tunnel only points to the primary stack's ports. Agent stacks are only accessible via localhost.

### 4. Database Migrations
Each stack has isolated databases. If Agent A creates a migration and Agent B needs it, B must pull the code changes and run the migration on their stack.

### 5. .env File
All stacks read from the same `.env` file in each worktree. Copy it to each worktree if they need different secrets.

## Quick Reference

```bash
# List all running compose projects
docker compose ls

# Using the convenience script (recommended):
./scripts/agent-compose.sh b up -d        # Start
./scripts/agent-compose.sh b logs -f api  # Logs
./scripts/agent-compose.sh b down         # Stop
./scripts/agent-compose.sh b down -v      # Stop + delete data

# Manual approach (if needed):
COMPOSE_PROJECT_NAME=todo-b docker compose -f docker-compose.yml -f docker-compose.override.agent-b.yml up -d
```
