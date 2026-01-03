#!/bin/bash
# Watch backend API files and auto-regenerate frontend client
#
# Usage: ./scripts/watch-api.sh
#
# This script watches for changes in backend API/schema files and automatically
# regenerates the frontend API client. It requires:
# - inotifywait (from inotify-tools package)
# - The API server to be running (for OpenAPI spec)
#
# Install inotify-tools: sudo apt install inotify-tools

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_DIR/web"

# Files/directories to watch for changes
WATCH_PATHS=(
    "$PROJECT_DIR/src/api"
    "$PROJECT_DIR/src/schemas"
    "$PROJECT_DIR/src/models"
)

# Check for inotifywait
if ! command -v inotifywait &> /dev/null; then
    echo "Error: inotifywait not found. Install with: sudo apt install inotify-tools"
    exit 1
fi

# Check that API server is running
if ! curl -s http://localhost:8000/openapi.json > /dev/null 2>&1; then
    echo "Warning: API server not responding at http://localhost:8000"
    echo "Make sure to run: docker compose up -d api"
fi

echo "Watching for API changes in:"
for path in "${WATCH_PATHS[@]}"; do
    echo "  - $path"
done
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Function to regenerate API client
regenerate() {
    echo "[$(date +%H:%M:%S)] Change detected, regenerating API client..."

    cd "$WEB_DIR"

    # Wait a moment for the API server to reload
    sleep 2

    if npm run generate-api 2>&1; then
        echo "[$(date +%H:%M:%S)] API client regenerated successfully"

        # Check for TypeScript errors
        if npx tsc --noEmit 2>&1 | head -5; then
            echo "[$(date +%H:%M:%S)] TypeScript check passed"
        else
            echo "[$(date +%H:%M:%S)] WARNING: TypeScript errors detected - frontend may need updates"
        fi
    else
        echo "[$(date +%H:%M:%S)] ERROR: Failed to regenerate API client"
    fi

    echo ""
}

# Watch for changes and regenerate
while true; do
    inotifywait -q -r -e modify,create,delete "${WATCH_PATHS[@]}" --include '\.py$'
    regenerate
done
