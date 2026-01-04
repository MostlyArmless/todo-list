"""Real-time synchronization service using Redis pub/sub."""

import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING

import redis
import redis.asyncio as aioredis

from src.config import get_settings

if TYPE_CHECKING:
    from redis.asyncio.client import PubSub

logger = logging.getLogger(__name__)
settings = get_settings()


class ListEventType(StrEnum):
    """Event types for list updates."""

    # Item events
    ITEM_CREATED = "item_created"
    ITEM_UPDATED = "item_updated"
    ITEM_DELETED = "item_deleted"
    ITEM_CHECKED = "item_checked"
    ITEM_UNCHECKED = "item_unchecked"
    ITEMS_BULK_DELETED = "items_bulk_deleted"

    # Category events
    CATEGORY_CREATED = "category_created"
    CATEGORY_UPDATED = "category_updated"
    CATEGORY_DELETED = "category_deleted"


# Synchronous Redis client for use in API endpoints
_sync_redis: redis.Redis | None = None


def get_sync_redis() -> redis.Redis:
    """Get synchronous Redis client for publishing from API endpoints."""
    global _sync_redis
    if _sync_redis is None:
        _sync_redis = redis.from_url(settings.redis_url)
    return _sync_redis


def publish_list_event(list_id: int, event_type: ListEventType, data: dict | None = None) -> None:
    """Publish an event to a list's Redis channel.

    Called from API endpoints after mutations.

    Args:
        list_id: The list ID to publish to
        event_type: Type of event (item_created, item_updated, etc.)
        data: Optional event payload
    """
    try:
        redis_client = get_sync_redis()
        channel = f"list:{list_id}"
        message = {
            "type": event_type,
            "list_id": list_id,
            "timestamp": datetime.now(UTC).isoformat(),
            "data": data or {},
        }
        redis_client.publish(channel, json.dumps(message))
        logger.debug(f"Published {event_type} to {channel}")
    except Exception as e:
        # Don't fail the request if pub/sub fails
        logger.error(f"Failed to publish list event: {e}")


class RealtimeService:
    """Async Redis pub/sub service for WebSocket connections."""

    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None
        self._pubsub: PubSub | None = None

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url)
        return self._redis

    async def subscribe(self, channel: str) -> AsyncIterator[dict]:
        """Subscribe to a Redis channel and yield messages."""
        redis_conn = await self._get_redis()
        self._pubsub = redis_conn.pubsub()
        await self._pubsub.subscribe(channel)

        try:
            async for message in self._pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        yield data
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON in pub/sub message: {message['data']}")
        finally:
            if self._pubsub:
                await self._pubsub.unsubscribe(channel)

    async def cleanup(self) -> None:
        """Clean up Redis connections."""
        if self._pubsub:
            await self._pubsub.close()
        if self._redis:
            await self._redis.close()
