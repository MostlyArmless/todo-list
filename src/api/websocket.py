"""WebSocket endpoint for real-time list synchronization."""

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from src.api.lists import get_user_list
from src.database import SessionLocal
from src.models.user import User
from src.services.auth import decode_access_token
from src.services.realtime import RealtimeService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ws", tags=["websocket"])


@router.websocket("/lists/{list_id}")
async def websocket_list_sync(
    websocket: WebSocket,
    list_id: int,
    token: str = Query(...),
) -> None:
    """WebSocket endpoint for real-time list updates.

    Authentication via token query parameter (WebSocket doesn't support headers).
    Subscribes to Redis pub/sub channel for the list and broadcasts updates.
    """
    # Manual DB session for WebSocket (can't use Depends normally)
    db = SessionLocal()
    realtime_service = RealtimeService()
    user_id: int | None = None

    try:
        # Authenticate user
        payload = decode_access_token(token)
        if not payload:
            await websocket.close(code=4001, reason="Invalid token")
            return

        user_id_str = payload.get("sub")
        if not user_id_str:
            await websocket.close(code=4001, reason="Invalid token")
            return

        user_id = int(user_id_str)
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            await websocket.close(code=4001, reason="User not found")
            return

        # Verify user has access to the list
        try:
            get_user_list(db, list_id, user)
        except Exception:
            await websocket.close(code=4003, reason="Access denied")
            return

        await websocket.accept()
        logger.info(f"WebSocket connected: user={user_id}, list={list_id}")

        async def handle_messages() -> None:
            """Receive messages from Redis and forward to WebSocket."""
            async for message in realtime_service.subscribe(f"list:{list_id}"):
                try:
                    await websocket.send_json(message)
                except WebSocketDisconnect:
                    break
                except Exception as e:
                    logger.error(f"Error sending WebSocket message: {e}")
                    break

        async def handle_ping() -> None:
            """Send periodic pings to keep connection alive."""
            while True:
                try:
                    await asyncio.sleep(30)
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

        async def handle_client() -> None:
            """Handle incoming messages from client (pong responses)."""
            while True:
                try:
                    data = await websocket.receive_json()
                    if data.get("type") == "pong":
                        continue  # Keepalive acknowledgment
                except WebSocketDisconnect:
                    break
                except Exception:
                    break

        # Run all handlers concurrently
        await asyncio.gather(
            handle_messages(),
            handle_ping(),
            handle_client(),
            return_exceptions=True,
        )

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: user={user_id}, list={list_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        db.close()
        await realtime_service.cleanup()
