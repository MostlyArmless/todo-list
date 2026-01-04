# Real-Time List Syncing via WebSocket + Redis Pub/Sub

## Goal
Enable near-instant (~1 second) updates across all devices viewing the same list when any user makes changes.

## Architecture

```
Frontend (Next.js)                Backend (FastAPI)
┌─────────────────┐              ┌─────────────────────────────┐
│ useListSync()   │◄─WebSocket──►│ /api/v1/ws/lists/{id}       │
│       │         │              │         │                   │
│       ▼         │              │         ▼                   │
│ React Query     │              │ Redis Pub/Sub list:{id}     │
│ invalidate()    │              │         ▲                   │
└─────────────────┘              │         │ publish           │
                                 │ items.py, categories.py     │
                                 └─────────────────────────────┘
```

## Implementation Steps

### 1. Backend: Create Redis Pub/Sub Service
**New file: `/src/services/realtime.py`**
- `publish_list_event(list_id, event_type, data)` - sync Redis publish for API endpoints
- `RealtimeService` class - async subscribe/cleanup for WebSocket connections
- Use existing `redis_url` from settings

### 2. Backend: Create WebSocket Endpoint
**New file: `/src/api/websocket.py`**
- `@router.websocket("/lists/{list_id}")` endpoint
- Auth via `token` query param (WebSocket doesn't support headers)
- Verify list access using existing `get_user_list()`
- Subscribe to `list:{list_id}` Redis channel
- Forward messages to WebSocket
- 30-second ping/pong keepalive

**Modify: `/src/main.py`**
- Register WebSocket router

### 3. Backend: Add Event Publishing to Mutations
**Modify: `/src/api/items.py`**
Add `publish_list_event()` after db.commit() for:
- `create_item` → `item_created`
- `update_item` → `item_updated`
- `delete_item` → `item_deleted`
- `check_item` → `item_checked`
- `uncheck_item` → `item_unchecked`
- `bulk_delete_items` → `items_bulk_deleted`

**Modify: `/src/api/categories.py`**
Add `publish_list_event()` after db.commit() for:
- `create_category` → `category_created`
- `update_category` → `category_updated`
- `delete_category` → `category_deleted`

### 4. Frontend: Create WebSocket Hook
**New file: `/web/src/hooks/useListSync.ts`**
- Connect to WebSocket with auth token
- Exponential backoff reconnection (1s, 2s, 5s, 10s, 30s)
- On message received: invalidate React Query cache
- Handle ping/pong for keepalive
- Return `{ isConnected, connectionError }`

### 5. Frontend: Integrate Hook into List Page
**Modify: `/web/src/app/list/[id]/page.tsx`**
- Add `useListSync({ listId, includeChecked: showChecked, enabled: !!listId && !!getCurrentUser() })`
- Existing `invalidateListData()` helper remains for local mutations

## Event Types
```
item_created, item_updated, item_deleted, item_checked, item_unchecked, items_bulk_deleted
category_created, category_updated, category_deleted
```

## File Summary

| Action | Path |
|--------|------|
| Create | `/src/services/realtime.py` |
| Create | `/src/api/websocket.py` |
| Create | `/web/src/hooks/useListSync.ts` |
| Modify | `/src/main.py` |
| Modify | `/src/api/items.py` |
| Modify | `/src/api/categories.py` |
| Modify | `/web/src/app/list/[id]/page.tsx` |

## Key Considerations
- Redis pub/sub handles multiple uvicorn workers
- Cloudflare tunnel supports WebSocket by default
- uvicorn[standard] already includes websockets library
- Token expiry: connection continues until next reconnect
- Mobile sleep: reconnection logic handles disconnects
- Race conditions: React Query dedupes fetches automatically
