#!/bin/bash
# Usage: ./scripts/agent-compose.sh <agent-name> <compose-args...>
# Example: ./scripts/agent-compose.sh b up -d
# Example: ./scripts/agent-compose.sh b exec -T api pytest
# Example: ./scripts/agent-compose.sh b down

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
    echo ""
    echo "Setup:"
    echo "  1. Copy docker-compose.override.template.yml to docker-compose.override.agent-<name>.yml"
    echo "  2. Edit the ports to unique values (see docs/multi-agent-isolation.md)"
    echo "  3. Run this script with your agent name"
    exit 1
fi

OVERRIDE_FILE="docker-compose.override.agent-${AGENT_NAME}.yml"

if [ ! -f "$OVERRIDE_FILE" ]; then
    echo "Error: $OVERRIDE_FILE not found"
    echo ""
    echo "To set up agent '$AGENT_NAME':"
    echo "  1. cp docker-compose.override.template.yml $OVERRIDE_FILE"
    echo "  2. Edit $OVERRIDE_FILE and replace 'AGENT' with '$AGENT_NAME'"
    echo "  3. Update ports to avoid conflicts (see docs/multi-agent-isolation.md)"
    exit 1
fi

COMPOSE_PROJECT_NAME="todo-${AGENT_NAME}" docker compose \
    -f docker-compose.yml \
    -f "$OVERRIDE_FILE" \
    "$@"
