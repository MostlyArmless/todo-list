#!/bin/bash
# Agent-aware pytest runner for pre-commit hook
# Detects if running in an agent worktree and uses the appropriate Docker stack

set -e

# Check for agent override file in current directory
AGENT_OVERRIDE=$(ls docker-compose.override.agent-*.yml 2>/dev/null | head -1)

if [ -n "$AGENT_OVERRIDE" ]; then
    # Extract agent ID from filename (e.g., docker-compose.override.agent-c.yml -> c)
    AGENT_ID=$(echo "$AGENT_OVERRIDE" | sed 's/docker-compose.override.agent-\(.\)\.yml/\1/')
    echo "Running pytest in agent-${AGENT_ID} stack..."
    ./scripts/agent-compose.sh "$AGENT_ID" exec -T api pytest --cov=src --cov-fail-under=60 --tb=short -q
else
    # Standard docker compose for main repo
    docker compose exec -T api pytest --cov=src --cov-fail-under=60 --tb=short -q
fi
