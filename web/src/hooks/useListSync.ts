/**
 * WebSocket hook for real-time list synchronization.
 * Connects to the backend WebSocket and invalidates React Query cache on updates.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken } from '@/lib/auth';
import {
  getGetListApiV1ListsListIdGetQueryKey,
  getGetCategoriesApiV1ListsListIdCategoriesGetQueryKey,
  getGetItemsApiV1ListsListIdItemsGetQueryKey,
} from '@/generated/api';

interface ListSyncEvent {
  type: string;
  list_id: number;
  timestamp: string;
  data: Record<string, unknown>;
}

interface UseListSyncOptions {
  listId: number;
  includeChecked: boolean;
  enabled?: boolean;
}

interface UseListSyncReturn {
  isConnected: boolean;
  connectionError: string | null;
}

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // Exponential backoff

export function useListSync({
  listId,
  includeChecked,
  enabled = true,
}: UseListSyncOptions): UseListSyncReturn {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listIdRef = useRef(listId);
  const enabledRef = useRef(enabled);
  // Store connect function in ref to allow self-reference in onclose
  const connectRef = useRef<() => void>(() => {});

  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Keep refs updated
  useEffect(() => {
    listIdRef.current = listId;
  }, [listId]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const invalidateListData = useCallback(() => {
    const currentListId = listIdRef.current;
    queryClient.invalidateQueries({
      queryKey: getGetListApiV1ListsListIdGetQueryKey(currentListId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetCategoriesApiV1ListsListIdCategoriesGetQueryKey(currentListId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetItemsApiV1ListsListIdItemsGetQueryKey(currentListId, {
        include_checked: includeChecked,
      }),
    });
  }, [queryClient, includeChecked]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data: ListSyncEvent = JSON.parse(event.data);

        // Handle ping messages
        if (data.type === 'ping') {
          wsRef.current?.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Invalidate queries to trigger refetch
        // React Query will dedupe and only fetch once
        invalidateListData();
      } catch {
        // Silently ignore parse errors
      }
    },
    [invalidateListData]
  );

  // Define connect function and store in ref
  const connect = useCallback(() => {
    if (!enabledRef.current || typeof window === 'undefined') return;

    const token = getToken();
    if (!token) {
      setConnectionError('Not authenticated');
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    // Build WebSocket URL
    const currentListId = listIdRef.current;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/lists/${currentListId}?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = handleMessage;

    ws.onerror = () => {
      setConnectionError('Connection error');
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      wsRef.current = null;

      // Don't reconnect if disabled or closed normally
      if (!enabledRef.current || event.code === 1000) return;

      // Handle auth errors - don't reconnect
      if (event.code === 4001 || event.code === 4003) {
        setConnectionError(event.reason || 'Authentication failed');
        return;
      }

      // Schedule reconnection with exponential backoff
      const delay =
        RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, delay);
    };
  }, [handleMessage]);

  // Keep connectRef updated
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Connect on mount and when dependencies change
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: setState in async WebSocket callbacks */
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
      }
    };
  }, [connect]);

  return { isConnected, connectionError };
}
