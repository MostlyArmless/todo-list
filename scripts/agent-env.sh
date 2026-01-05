#!/bin/bash
# Autonomous agent environment management
# Usage:
#   ./scripts/agent-env.sh create          # Create env in current directory
#   ./scripts/agent-env.sh create --hierarchical  # Create worktree + env (full isolation)
#   ./scripts/agent-env.sh list            # List existing agent envs
#   ./scripts/agent-env.sh destroy <id>    # Remove agent env, stop containers, optionally remove worktree

set -e

# Always use absolute path to lock file (works across worktrees)
LOCK_FILE="/tmp/todo-agent-env.lock"

# Find the main repo (git worktree root or current repo)
MAIN_REPO=$(git rev-parse --show-toplevel 2>/dev/null)
if git rev-parse --git-common-dir &>/dev/null; then
    GIT_COMMON=$(git rev-parse --git-common-dir)
    if [[ "$GIT_COMMON" != ".git" && "$GIT_COMMON" != *"/.git" ]]; then
        # We're in a worktree, find main repo
        MAIN_REPO=$(dirname "$GIT_COMMON")
    fi
fi

TEMPLATE_FILE="docker-compose.override.template.yml"

# Port calculation: base + agent_num
# Agent a=1, b=2, c=3, etc.
# Using higher base ports to avoid conflicts with other projects (habit-bot uses 5434, 8001)
BASE_DB_PORT=15432      # Agent a=15433, b=15434, etc.
BASE_REDIS_PORT=16379   # Agent a=16380, b=16381, etc.
BASE_API_PORT=18000     # Agent a=18001, b=18002, etc.
BASE_PWA_PORT=13000     # Agent a=13002, b=13004, etc. (increments by 2)

get_agent_num() {
    local id=$1
    # Convert letter to number: a=1, b=2, ..., z=26
    printf '%d' "'$id" | awk '{print $1 - 96}'
}

get_ports_for_agent() {
    local id=$1
    local num=$(get_agent_num "$id")

    echo "DB_PORT=$((BASE_DB_PORT + num))"
    echo "REDIS_PORT=$((BASE_REDIS_PORT + num))"
    echo "API_PORT=$((BASE_API_PORT + num))"
    echo "PWA_PORT=$((BASE_PWA_PORT + num * 2))"  # Agents use pwa-dev on this port
}

check_port_available() {
    local port=$1
    # Check if port is in use using ss (socket statistics)
    if ss -tuln 2>/dev/null | grep -q ":${port} "; then
        return 1  # Port in use
    fi
    return 0
}

check_ports_for_agent() {
    local id=$1
    eval $(get_ports_for_agent "$id")

    local conflicts=""
    if ! check_port_available "$DB_PORT"; then
        conflicts="${conflicts}  - DB port $DB_PORT is in use\n"
    fi
    if ! check_port_available "$REDIS_PORT"; then
        conflicts="${conflicts}  - Redis port $REDIS_PORT is in use\n"
    fi
    if ! check_port_available "$API_PORT"; then
        conflicts="${conflicts}  - API port $API_PORT is in use\n"
    fi
    if ! check_port_available "$PWA_PORT"; then
        conflicts="${conflicts}  - PWA port $PWA_PORT is in use\n"
    fi

    if [ -n "$conflicts" ]; then
        echo -e "$conflicts"
        return 1
    fi
    return 0
}

list_agents() {
    echo "Existing agent environments:"
    echo ""

    local found=0
    shopt -s nullglob

    # Check for override files in main repo
    for f in "${MAIN_REPO}"/docker-compose.override.agent-*.yml; do
        local id=$(basename "$f" | sed 's/docker-compose.override.agent-\(.*\)\.yml/\1/')
        local running=""
        if docker compose ls --format json 2>/dev/null | grep -q "\"todo-${id}\""; then
            running=" (running)"
        fi
        echo "  $id: $f$running"
        found=1
    done

    # Check for worktrees
    for d in "${MAIN_REPO}-agent-"*; do
        if [ -d "$d" ]; then
            local id=$(basename "$d" | sed 's/.*-agent-//')
            local running=""
            if docker compose ls --format json 2>/dev/null | grep -q "\"todo-${id}\""; then
                running=" (running)"
            fi
            # Get branch name
            local branch=$(git -C "$d" branch --show-current 2>/dev/null || echo "unknown")
            echo "  $id: $d (worktree, branch: $branch)$running"
            found=1
        fi
    done

    shopt -u nullglob

    if [ $found -eq 0 ]; then
        echo "  (none)"
    fi

    echo ""
    echo "Running compose projects:"
    docker compose ls 2>/dev/null | grep -E "^todo-" || echo "  (none)"
}

find_next_available() {
    # Find next available agent ID (a-z)
    # Check main repo, all worktrees, running containers, AND port availability
    for letter in {a..z}; do
        local in_use=0

        # Check main repo
        if [ -f "${MAIN_REPO}/docker-compose.override.agent-${letter}.yml" ]; then
            in_use=1
        fi

        # Check for worktree
        if [ -d "${MAIN_REPO}-agent-${letter}" ]; then
            in_use=1
        fi

        # Check running containers
        if docker compose ls --format json 2>/dev/null | grep -q "\"todo-${letter}\""; then
            in_use=1
        fi

        # Check port availability
        if [ $in_use -eq 0 ]; then
            if ! check_ports_for_agent "$letter" >/dev/null 2>&1; then
                in_use=1
            fi
        fi

        if [ $in_use -eq 0 ]; then
            echo "$letter"
            return 0
        fi
    done
    echo "Error: No available agent IDs (a-z all in use)" >&2
    return 1
}

create_agent() {
    local use_worktree=0
    local id=""
    local branch_name=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --worktree)
                use_worktree=1
                shift
                ;;
            --branch)
                branch_name="$2"
                shift 2
                ;;
            *)
                if [ -z "$id" ]; then
                    id="$1"
                fi
                shift
                ;;
        esac
    done

    # Acquire lock for atomic creation
    exec 200>"$LOCK_FILE"
    flock -w 5 200 || { echo "Error: Could not acquire lock" >&2; exit 1; }

    # If no ID specified, find next available
    if [ -z "$id" ]; then
        id=$(find_next_available)
        if [ $? -ne 0 ]; then
            flock -u 200
            exit 1
        fi
    fi

    # Validate ID is a single lowercase letter
    if ! [[ "$id" =~ ^[a-z]$ ]]; then
        echo "Error: Agent ID must be a single lowercase letter (a-z)" >&2
        flock -u 200
        exit 1
    fi

    # Check port availability
    local port_conflicts=$(check_ports_for_agent "$id" 2>&1)
    if [ $? -ne 0 ]; then
        echo "Error: Port conflicts detected for agent $id:" >&2
        echo -e "$port_conflicts" >&2
        echo "" >&2
        echo "Try a different agent ID, or stop the conflicting services." >&2
        flock -u 200
        exit 1
    fi

    local worktree_path="${MAIN_REPO}-agent-${id}"
    local working_dir="$PWD"

    if [ $use_worktree -eq 1 ]; then
        # Check worktree doesn't exist
        if [ -d "$worktree_path" ]; then
            echo "Error: Worktree $worktree_path already exists" >&2
            flock -u 200
            exit 1
        fi

        # Determine branch name
        if [ -z "$branch_name" ]; then
            branch_name="agent-${id}-work"
        fi

        # Create worktree with new branch from current HEAD
        echo "Creating git worktree at $worktree_path..."
        git -C "$MAIN_REPO" worktree add -b "$branch_name" "$worktree_path" HEAD

        # Copy .env if it exists
        if [ -f "${MAIN_REPO}/.env" ]; then
            cp "${MAIN_REPO}/.env" "${worktree_path}/.env"
        fi

        # Copy template file if it's not in git (untracked)
        if [ -f "${MAIN_REPO}/${TEMPLATE_FILE}" ] && [ ! -f "${worktree_path}/${TEMPLATE_FILE}" ]; then
            cp "${MAIN_REPO}/${TEMPLATE_FILE}" "${worktree_path}/${TEMPLATE_FILE}"
        fi

        working_dir="$worktree_path"
    fi

    # Check template exists in working directory
    if [ ! -f "${working_dir}/${TEMPLATE_FILE}" ]; then
        echo "Error: ${working_dir}/${TEMPLATE_FILE} not found" >&2
        flock -u 200
        exit 1
    fi

    local override_file="${working_dir}/docker-compose.override.agent-${id}.yml"

    if [ -f "$override_file" ]; then
        echo "Error: $override_file already exists" >&2
        flock -u 200
        exit 1
    fi

    # Calculate ports
    eval $(get_ports_for_agent "$id")

    # Create override file from template
    # Template has agent-a ports (15433, 16380, 18001, 13002), replace with calculated ports
    sed -e "s/todo-AGENT/todo-${id}/g" \
        -e "s/\"15433:5432\"/\"${DB_PORT}:5432\"/g" \
        -e "s/\"16380:6379\"/\"${REDIS_PORT}:6379\"/g" \
        -e "s/\"18001:8000\"/\"${API_PORT}:8000\"/g" \
        -e "s/\"13002:3000\"/\"${PWA_PORT}:3000\"/g" \
        "${working_dir}/${TEMPLATE_FILE}" > "$override_file"

    # Release lock
    flock -u 200

    echo ""
    echo "===== Agent Environment Created ====="
    echo "AGENT_ID=${id}"
    if [ $use_worktree -eq 1 ]; then
        echo "WORKTREE=${worktree_path}"
        echo "BRANCH=${branch_name}"
    fi
    echo ""
    echo "Ports:"
    echo "  API:     http://localhost:${API_PORT}"
    echo "  PWA:     http://localhost:${PWA_PORT}  (dev mode with hot reload)"
    echo "  DB:      localhost:${DB_PORT}"
    echo "  Redis:   localhost:${REDIS_PORT}"
    echo ""
    if [ $use_worktree -eq 1 ]; then
        echo "Next steps:"
        echo "  cd ${worktree_path}"
        echo "  ./scripts/agent-compose.sh ${id} up -d"
        echo ""
        echo "When done:"
        echo "  git add -A && git commit -m 'your changes'"
        echo "  git checkout master && git merge ${branch_name}"
        echo "  ./scripts/agent-env.sh destroy ${id}"
    else
        echo "Commands:"
        echo "  ./scripts/agent-compose.sh ${id} up -d       # Start"
        echo "  ./scripts/agent-compose.sh ${id} exec -T api pytest  # Test"
        echo "  ./scripts/agent-compose.sh ${id} down        # Stop"
    fi
    echo ""
}

destroy_agent() {
    local id=$1

    if [ -z "$id" ]; then
        echo "Usage: $0 destroy <agent-id>" >&2
        exit 1
    fi

    local worktree_path="${MAIN_REPO}-agent-${id}"
    local branch_name="agent-${id}-work"

    # Determine where the override file might be
    local override_file=""
    local working_dir=""
    if [ -d "$worktree_path" ]; then
        working_dir="$worktree_path"
        override_file="${worktree_path}/docker-compose.override.agent-${id}.yml"
    else
        working_dir="$MAIN_REPO"
        override_file="${MAIN_REPO}/docker-compose.override.agent-${id}.yml"
    fi

    # Stop containers if running
    if docker compose ls --format json 2>/dev/null | grep -q "\"todo-${id}\""; then
        echo "Stopping containers for agent $id..."
        (cd "$working_dir" && ./scripts/agent-compose.sh "$id" down 2>/dev/null) || true
    fi

    # Remove override file
    if [ -f "$override_file" ]; then
        rm "$override_file"
        echo "Removed $override_file"
    else
        echo "Warning: $override_file not found"
    fi

    # Remove worktree if it exists
    if [ -d "$worktree_path" ]; then
        echo "Removing worktree $worktree_path..."
        git -C "$MAIN_REPO" worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"

        # Delete the branch if it exists and is not checked out elsewhere
        if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/${branch_name}" 2>/dev/null; then
            git -C "$MAIN_REPO" branch -D "$branch_name" 2>/dev/null || echo "Warning: Could not delete branch $branch_name"
        fi
    fi

    echo "Agent environment $id destroyed"
}

case "${1:-}" in
    create)
        shift
        create_agent "$@"
        ;;
    list)
        list_agents
        ;;
    destroy)
        destroy_agent "${2:-}"
        ;;
    *)
        echo "Usage: $0 {create|list|destroy} [options]"
        echo ""
        echo "Commands:"
        echo "  create [--worktree] [--branch <name>] [<id>]"
        echo "      Create agent environment with isolated Docker stack"
        echo "      --worktree    Also create a git worktree (full isolation)"
        echo "      --branch      Custom branch name (default: agent-<id>-work)"
        echo "      <id>          Specific agent ID a-z (default: next available)"
        echo ""
        echo "  list"
        echo "      List existing agent environments and running stacks"
        echo ""
        echo "  destroy <id>"
        echo "      Stop containers, remove override file, and remove worktree if exists"
        exit 1
        ;;
esac
