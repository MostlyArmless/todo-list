#!/bin/bash
# Usage: ./scripts/agent-compose.sh <agent-name> <compose-args...>
# Example: ./scripts/agent-compose.sh b up -d
# Example: ./scripts/agent-compose.sh b exec -T api pytest
# Example: ./scripts/agent-compose.sh b down
#
# This script can be run from anywhere - it will find the correct worktree/repo.

AGENT_NAME=$1
shift

if [ -z "$AGENT_NAME" ]; then
    echo "Usage: $0 <agent-name> <compose-args...>"
    echo ""
    echo "Examples:"
    echo "  $0 b up -d                    # Start agent B's stack"
    echo "  $0 b exec -T api pytest       # Run tests in agent B's stack"
    echo "  $0 b logs -f api              # Follow API logs"
    echo "  $0 b down                     # Stop agent B's stack"
    echo "  $0 b down -v                  # Stop and remove volumes (deletes data!)"
    exit 1
fi

# Find the main repo (works from worktree or main repo)
MAIN_REPO=$(git rev-parse --show-toplevel 2>/dev/null)
if git rev-parse --git-common-dir &>/dev/null; then
    GIT_COMMON=$(git rev-parse --git-common-dir)
    if [[ "$GIT_COMMON" != ".git" && "$GIT_COMMON" != *"/.git" ]]; then
        MAIN_REPO=$(dirname "$GIT_COMMON")
    fi
fi

OVERRIDE_FILE="docker-compose.override.agent-${AGENT_NAME}.yml"

# Find the working directory containing the override file
# Priority: 1) worktree, 2) current dir, 3) main repo
WORKING_DIR=""

# Check for dedicated worktree
WORKTREE_PATH="${MAIN_REPO}-agent-${AGENT_NAME}"
if [ -d "$WORKTREE_PATH" ] && [ -f "${WORKTREE_PATH}/${OVERRIDE_FILE}" ]; then
    WORKING_DIR="$WORKTREE_PATH"
# Check current directory
elif [ -f "$OVERRIDE_FILE" ]; then
    WORKING_DIR="$PWD"
# Check main repo
elif [ -f "${MAIN_REPO}/${OVERRIDE_FILE}" ]; then
    WORKING_DIR="$MAIN_REPO"
fi

if [ -z "$WORKING_DIR" ]; then
    echo "Error: Cannot find $OVERRIDE_FILE"
    echo ""
    echo "Searched in:"
    echo "  - Worktree: $WORKTREE_PATH"
    echo "  - Current dir: $PWD"
    echo "  - Main repo: $MAIN_REPO"
    echo ""
    echo "To create agent '$AGENT_NAME' environment:"
    echo "  ./scripts/agent-env.sh create --worktree $AGENT_NAME"
    exit 1
fi

# Run docker compose from the working directory (important for bind mounts)
cd "$WORKING_DIR" || exit 1

# Check if this is an "up" command - we'll need to run migrations after
IS_UP_COMMAND=0
for arg in "$@"; do
    if [[ "$arg" == "up" ]]; then
        IS_UP_COMMAND=1
        break
    fi
done

COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
    -f docker-compose.yml \
    -f "$OVERRIDE_FILE" \
    "$@"

COMPOSE_EXIT_CODE=$?

# After 'up', wait for db, verify network, and run migrations
if [ $IS_UP_COMMAND -eq 1 ] && [ $COMPOSE_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "Waiting for database to be ready..."

    # Wait for db healthcheck (max 30 seconds)
    DB_READY=0
    for i in {1..30}; do
        if COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
            -f docker-compose.yml -f "$OVERRIDE_FILE" \
            exec -T db pg_isready -U todo_user -d todo_list &>/dev/null; then
            DB_READY=1
            break
        fi
        sleep 1
    done

    if [ $DB_READY -eq 0 ]; then
        echo "Warning: Database not ready after 30s"
        echo ""
        echo "If you see network errors, try:"
        echo "  ./scripts/agent-compose.sh ${AGENT_NAME} down"
        echo "  ./scripts/agent-compose.sh ${AGENT_NAME} up -d"
        exit 1
    fi

    # Verify API can reach db (catches network issues)
    echo "Verifying network connectivity..."
    if ! COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
        -f docker-compose.yml -f "$OVERRIDE_FILE" \
        exec -T api python -c "from src.database import engine; engine.connect()" &>/dev/null; then
        echo ""
        echo "Error: API cannot connect to database (network issue)"
        echo ""
        echo "Fix by restarting the stack:"
        echo "  ./scripts/agent-compose.sh ${AGENT_NAME} down"
        echo "  ./scripts/agent-compose.sh ${AGENT_NAME} up -d"
        exit 1
    fi

    # Check if this is a fresh DB with tables created by SQLAlchemy (not alembic)
    # This happens because the API runs create_all() on startup
    echo "Checking database migration state..."

    ALEMBIC_VERSION=$(COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
        -f docker-compose.yml -f "$OVERRIDE_FILE" \
        exec -T db psql -U todo_user -d todo_list -tAc \
        "SELECT version_num FROM alembic_version LIMIT 1" 2>/dev/null || echo "")

    TABLES_EXIST=$(COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
        -f docker-compose.yml -f "$OVERRIDE_FILE" \
        exec -T db psql -U todo_user -d todo_list -tAc \
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')" 2>/dev/null || echo "f")

    if [ -z "$ALEMBIC_VERSION" ] && [ "$TABLES_EXIST" = "t" ]; then
        # Tables exist but alembic hasn't run - stamp to current head
        echo "Fresh DB with existing tables detected, stamping alembic to head..."
        COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
            -f docker-compose.yml \
            -f "$OVERRIDE_FILE" \
            exec -T api alembic stamp head 2>&1
    else
        # Normal migration
        echo "Running database migrations..."
        COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
            -f docker-compose.yml \
            -f "$OVERRIDE_FILE" \
            exec -T api alembic upgrade head 2>&1 || {
                echo ""
                echo "Note: If migrations failed, you may need to manually resolve the state:"
                echo "  ./scripts/agent-compose.sh ${AGENT_NAME} exec api alembic stamp head"
            }
    fi
    echo ""
    echo "Agent ${AGENT_NAME} stack is ready!"
fi

exit $COMPOSE_EXIT_CODE
