"""Celery application configuration."""

from celery import Celery

from src.config import get_settings

settings = get_settings()

app = Celery(
    "todo_list",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["src.tasks.voice_processing", "src.tasks.categorization"],
)

# Celery configuration
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,  # 5 minutes max per task
    task_soft_time_limit=240,  # 4 minutes soft limit
)
