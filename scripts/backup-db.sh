#!/bin/bash
# Daily PostgreSQL backup script for todo-list app
# Runs at 3am Pacific via cron

set -euo pipefail

BACKUP_DIR="$HOME/NAS_MJT/Backups/todo-list-db"
RETENTION_DAYS=30
NTFY_TOPIC="EC1C60CC-E8DA-46FF-AE69-3C696EDD3C96"
PROJECT_DIR="$HOME/dev/todo-list"

DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/todo_list_$DATE.sql.gz"

notify_failure() {
    local message="$1"
    curl -s -X POST "https://ntfy.sh/$NTFY_TOPIC" \
        -H "Title: Todo List DB Backup Failed" \
        -H "Priority: high" \
        -H "Tags: warning,database" \
        -d "$message" > /dev/null 2>&1 || true
}

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Run pg_dump inside the db container
cd "$PROJECT_DIR"
if ! docker compose exec -T db pg_dump -U todo_user todo_list 2>/dev/null | gzip > "$BACKUP_FILE"; then
    notify_failure "pg_dump failed at $(date). Check if Docker containers are running."
    rm -f "$BACKUP_FILE"  # Remove partial file
    exit 1
fi

# Verify backup is not empty
if [ ! -s "$BACKUP_FILE" ]; then
    notify_failure "Backup file is empty at $(date). Database may be inaccessible."
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Delete backups older than retention period
find "$BACKUP_DIR" -name "todo_list_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
