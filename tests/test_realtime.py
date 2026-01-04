"""Tests for real-time synchronization service."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.realtime import (
    ListEventType,
    RealtimeService,
    get_sync_redis,
    publish_list_event,
)


class TestListEventType:
    """Tests for ListEventType enum."""

    def test_item_events_exist(self):
        """Verify all item event types are defined."""
        assert ListEventType.ITEM_CREATED == "item_created"
        assert ListEventType.ITEM_UPDATED == "item_updated"
        assert ListEventType.ITEM_DELETED == "item_deleted"
        assert ListEventType.ITEM_CHECKED == "item_checked"
        assert ListEventType.ITEM_UNCHECKED == "item_unchecked"
        assert ListEventType.ITEMS_BULK_DELETED == "items_bulk_deleted"

    def test_category_events_exist(self):
        """Verify all category event types are defined."""
        assert ListEventType.CATEGORY_CREATED == "category_created"
        assert ListEventType.CATEGORY_UPDATED == "category_updated"
        assert ListEventType.CATEGORY_DELETED == "category_deleted"


class TestGetSyncRedis:
    """Tests for get_sync_redis function."""

    def test_creates_redis_client(self):
        """Test that get_sync_redis creates a Redis client."""
        # Reset the global client
        import src.services.realtime as realtime_module

        realtime_module._sync_redis = None

        with patch("src.services.realtime.redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_from_url.return_value = mock_client

            result = get_sync_redis()

            assert result == mock_client
            mock_from_url.assert_called_once()

    def test_reuses_existing_client(self):
        """Test that get_sync_redis reuses existing client."""
        import src.services.realtime as realtime_module

        mock_client = MagicMock()
        realtime_module._sync_redis = mock_client

        with patch("src.services.realtime.redis.from_url") as mock_from_url:
            result = get_sync_redis()

            assert result == mock_client
            mock_from_url.assert_not_called()

        # Clean up
        realtime_module._sync_redis = None


class TestPublishListEvent:
    """Tests for publish_list_event function."""

    def test_publishes_event_to_correct_channel(self):
        """Test that events are published to the correct Redis channel."""
        import src.services.realtime as realtime_module

        mock_redis = MagicMock()
        realtime_module._sync_redis = mock_redis

        publish_list_event(123, ListEventType.ITEM_CREATED, {"item_id": 456})

        mock_redis.publish.assert_called_once()
        call_args = mock_redis.publish.call_args
        assert call_args[0][0] == "list:123"

        # Verify message structure
        message = json.loads(call_args[0][1])
        assert message["type"] == "item_created"
        assert message["list_id"] == 123
        assert message["data"] == {"item_id": 456}
        assert "timestamp" in message

        # Clean up
        realtime_module._sync_redis = None

    def test_publishes_event_without_data(self):
        """Test publishing event with no additional data."""
        import src.services.realtime as realtime_module

        mock_redis = MagicMock()
        realtime_module._sync_redis = mock_redis

        publish_list_event(123, ListEventType.ITEM_DELETED)

        call_args = mock_redis.publish.call_args
        message = json.loads(call_args[0][1])
        assert message["data"] == {}

        # Clean up
        realtime_module._sync_redis = None

    def test_handles_redis_error_gracefully(self):
        """Test that Redis errors don't crash the publish function."""
        import src.services.realtime as realtime_module

        mock_redis = MagicMock()
        mock_redis.publish.side_effect = Exception("Redis connection failed")
        realtime_module._sync_redis = mock_redis

        # Should not raise exception
        publish_list_event(123, ListEventType.ITEM_CREATED, {"item_id": 456})

        # Clean up
        realtime_module._sync_redis = None


class TestRealtimeService:
    """Tests for RealtimeService class."""

    def test_init(self):
        """Test RealtimeService initialization."""
        service = RealtimeService()
        assert service._redis is None
        assert service._pubsub is None

    @pytest.mark.asyncio
    async def test_get_redis_creates_connection(self):
        """Test that _get_redis creates a Redis connection."""
        service = RealtimeService()

        with patch("src.services.realtime.aioredis.from_url") as mock_from_url:
            mock_redis = AsyncMock()
            mock_from_url.return_value = mock_redis

            result = await service._get_redis()

            assert result == mock_redis
            mock_from_url.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_redis_reuses_connection(self):
        """Test that _get_redis reuses existing connection."""
        service = RealtimeService()
        mock_redis = AsyncMock()
        service._redis = mock_redis

        with patch("src.services.realtime.aioredis.from_url") as mock_from_url:
            result = await service._get_redis()

            assert result == mock_redis
            mock_from_url.assert_not_called()

    @pytest.mark.asyncio
    async def test_cleanup_closes_connections(self):
        """Test that cleanup closes Redis connections."""
        service = RealtimeService()
        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        service._redis = mock_redis
        service._pubsub = mock_pubsub

        await service.cleanup()

        mock_pubsub.close.assert_called_once()
        mock_redis.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_handles_no_connections(self):
        """Test that cleanup works when no connections exist."""
        service = RealtimeService()

        # Should not raise
        await service.cleanup()

    @pytest.mark.asyncio
    async def test_subscribe_yields_messages(self):
        """Test that subscribe yields parsed messages from Redis."""
        service = RealtimeService()

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()

        # Simulate message stream
        test_message = {"type": "item_created", "list_id": 123}

        async def mock_listen():
            yield {"type": "message", "data": json.dumps(test_message)}

        mock_pubsub.listen = mock_listen
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub

        # Directly set the redis connection to bypass _get_redis
        service._redis = mock_redis

        messages = []
        async for msg in service.subscribe("list:123"):
            messages.append(msg)
            break  # Just get the first message

        assert len(messages) == 1
        assert messages[0] == test_message

    @pytest.mark.asyncio
    async def test_subscribe_skips_non_message_types(self):
        """Test that subscribe skips non-message types (like subscribe confirmations)."""
        service = RealtimeService()

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()

        test_message = {"type": "item_created", "list_id": 123}

        async def mock_listen():
            yield {"type": "subscribe", "data": 1}  # Subscribe confirmation
            yield {"type": "message", "data": json.dumps(test_message)}

        mock_pubsub.listen = mock_listen
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub

        # Directly set the redis connection to bypass _get_redis
        service._redis = mock_redis

        messages = []
        async for msg in service.subscribe("list:123"):
            messages.append(msg)
            break

        assert len(messages) == 1
        assert messages[0] == test_message

    @pytest.mark.asyncio
    async def test_subscribe_handles_invalid_json(self):
        """Test that subscribe handles invalid JSON gracefully."""
        service = RealtimeService()

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()

        valid_message = {"type": "item_created", "list_id": 123}

        async def mock_listen():
            yield {"type": "message", "data": "not valid json"}
            yield {"type": "message", "data": json.dumps(valid_message)}

        mock_pubsub.listen = mock_listen
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub

        # Directly set the redis connection to bypass _get_redis
        service._redis = mock_redis

        messages = []
        async for msg in service.subscribe("list:123"):
            messages.append(msg)
            break

        # Should only get the valid message, invalid JSON is skipped
        assert len(messages) == 1
        assert messages[0] == valid_message


class TestWebSocketEndpoint:
    """Tests for WebSocket endpoint."""

    def test_websocket_requires_token(self, client):
        """Test that WebSocket connection requires token parameter."""
        from starlette.websockets import WebSocketDisconnect

        # WebSocket without token should fail - FastAPI raises WebSocketDisconnect
        with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/v1/ws/lists/1"):
            pass

    def test_websocket_rejects_invalid_token(self, client):
        """Test that WebSocket rejects invalid token."""
        from starlette.websockets import WebSocketDisconnect

        with (
            pytest.raises(WebSocketDisconnect),
            client.websocket_connect("/api/v1/ws/lists/1?token=invalid_token"),
        ):
            pass

    def test_websocket_rejects_nonexistent_user(self, client, auth_headers):
        """Test that WebSocket rejects token for non-existent user."""
        from starlette.websockets import WebSocketDisconnect

        from src.services.auth import create_access_token

        # Create a token for a user ID that doesn't exist
        fake_token = create_access_token(user_id=99999, email="fake@example.com")
        with (
            pytest.raises(WebSocketDisconnect),
            client.websocket_connect(f"/api/v1/ws/lists/1?token={fake_token}"),
        ):
            pass

    def test_websocket_rejects_unauthorized_list_access(self, client, auth_headers, db):
        """Test that WebSocket rejects access to lists user doesn't own."""
        from starlette.websockets import WebSocketDisconnect

        from src.models.list import List
        from src.models.user import User

        # Create another user with a list
        other_user = User(email="other@example.com", password_hash="hash")
        db.add(other_user)
        db.commit()

        other_list = List(name="Other's List", owner_id=other_user.id)
        db.add(other_list)
        db.commit()

        # Try to connect to other user's list
        token = auth_headers["Authorization"].replace("Bearer ", "")
        with (
            pytest.raises(WebSocketDisconnect),
            client.websocket_connect(f"/api/v1/ws/lists/{other_list.id}?token={token}"),
        ):
            pass
