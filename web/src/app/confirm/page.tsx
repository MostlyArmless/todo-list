'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, PendingConfirmation, List } from '@/lib/api';
import styles from './page.module.css';

interface EditableItem {
  name: string;
  category_id: number | null;
}

interface EditState {
  listId: number;
  items: EditableItem[];
}

export default function ConfirmPage() {
  const router = useRouter();
  const [confirmations, setConfirmations] = useState<PendingConfirmation[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [editStates, setEditStates] = useState<Record<number, EditState>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [confirmationsData, listsData] = await Promise.all([
        api.getPendingConfirmations(),
        api.getLists(),
      ]);
      setConfirmations(confirmationsData);
      setLists(listsData);

      // Initialize edit states
      const initialEditStates: Record<number, EditState> = {};
      for (const conf of confirmationsData) {
        initialEditStates[conf.id] = {
          listId: conf.proposed_changes.list_id,
          items: conf.proposed_changes.items.map(item => ({
            name: item.name,
            category_id: item.category_id,
          })),
        };
      }
      setEditStates(initialEditStates);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  function updateItemName(confirmationId: number, itemIndex: number, newName: string) {
    setEditStates(prev => ({
      ...prev,
      [confirmationId]: {
        ...prev[confirmationId],
        items: prev[confirmationId].items.map((item, idx) =>
          idx === itemIndex ? { ...item, name: newName } : item
        ),
      },
    }));
  }

  function updateListId(confirmationId: number, newListId: number) {
    setEditStates(prev => ({
      ...prev,
      [confirmationId]: {
        ...prev[confirmationId],
        listId: newListId,
      },
    }));
  }

  function removeItem(confirmationId: number, itemIndex: number) {
    setEditStates(prev => ({
      ...prev,
      [confirmationId]: {
        ...prev[confirmationId],
        items: prev[confirmationId].items.filter((_, idx) => idx !== itemIndex),
      },
    }));
  }

  async function handleConfirm(confirmation: PendingConfirmation) {
    const editState = editStates[confirmation.id];
    if (!editState || editState.items.length === 0) {
      setError('No items to add');
      return;
    }

    try {
      setProcessing(confirmation.id);
      const hasEdits =
        editState.listId !== confirmation.proposed_changes.list_id ||
        JSON.stringify(editState.items) !== JSON.stringify(
          confirmation.proposed_changes.items.map(i => ({ name: i.name, category_id: i.category_id }))
        );

      await api.confirmPendingConfirmation(
        confirmation.id,
        hasEdits ? { list_id: editState.listId, items: editState.items } : undefined
      );
      setConfirmations(prev => prev.filter(c => c.id !== confirmation.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setProcessing(null);
    }
  }

  async function handleReject(id: number) {
    try {
      setProcessing(id);
      await api.rejectPendingConfirmation(id);
      setConfirmations(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setProcessing(null);
    }
  }

  function formatTimestamp(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) {
      return `${diffSecs}s ago`;
    }

    const diffMins = Math.floor(diffSecs / 60);
    const remainingSecs = diffSecs % 60;

    if (diffMins < 60) {
      return `${diffMins}m${remainingSecs}s ago`;
    }

    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;

    if (diffHours < 24) {
      return `${diffHours}h${remainingMins}m${remainingSecs}s ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return `${diffDays}d${remainingHours}h${remainingMins}m ago`;
  }

  return (
    <div className={`container ${styles.pageContainer}`}>
      <button
        onClick={() => router.push('/lists')}
        className={styles.backButton}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        Back to Lists
      </button>

      <h1 className={styles.title}>Voice Input Review</h1>

      <div className={styles.pageDescription}>
        <p>
          Review items captured from your voice input. You can edit item names,
          change the target list, or remove items before adding them.
        </p>
      </div>

      {error && (
        <div className={styles.errorCard}>
          {error}
          <button onClick={() => setError(null)} className={styles.dismissError}>×</button>
        </div>
      )}

      {loading ? (
        <div className={`card ${styles.emptyCard}`}>
          <p className={styles.emptyText}>Loading...</p>
        </div>
      ) : confirmations.length === 0 ? (
        <div className={`card ${styles.emptyCard}`}>
          <div className={styles.emptyIcon}>🎤</div>
          <p className={styles.emptyText}>No pending voice inputs</p>
          <p className={styles.emptySubtext}>
            Use the Voice feature to add items by speaking. Your voice inputs
            will appear here for review before being added to your lists.
          </p>
        </div>
      ) : (
        confirmations.map(confirmation => {
          const editState = editStates[confirmation.id];
          if (!editState) return null;

          return (
            <div key={confirmation.id} className={styles.confirmCard}>
              <div className={styles.confirmHeader}>
                <div className={styles.confirmMeta}>
                  <span className={styles.confirmBadge}>Voice Input</span>
                  <div className={styles.confirmTime}>
                    <span className={styles.timestamp}>{formatTimestamp(confirmation.created_at)}</span>
                    <span className={styles.relativeTime}>{formatRelativeTime(confirmation.created_at)}</span>
                  </div>
                </div>
              </div>

              <div className={styles.targetListSection}>
                <label className={styles.fieldLabel}>Add to list:</label>
                <select
                  className={styles.listSelect}
                  value={editState.listId}
                  onChange={(e) => updateListId(confirmation.id, Number(e.target.value))}
                  disabled={processing === confirmation.id}
                >
                  {lists.map(list => (
                    <option key={list.id} value={list.id}>
                      {list.icon && `${list.icon} `}{list.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.itemsSection}>
                <label className={styles.fieldLabel}>Items to add:</label>
                <div className={styles.itemsList}>
                  {editState.items.map((item, idx) => (
                    <div key={idx} className={styles.editableItem}>
                      <input
                        type="text"
                        className={styles.itemInput}
                        value={item.name}
                        onChange={(e) => updateItemName(confirmation.id, idx, e.target.value)}
                        disabled={processing === confirmation.id}
                        placeholder="Item name"
                      />
                      <button
                        className={styles.removeItemBtn}
                        onClick={() => removeItem(confirmation.id, idx)}
                        disabled={processing === confirmation.id}
                        title="Remove item"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {editState.items.length === 0 && (
                  <p className={styles.noItemsWarning}>All items removed. Reject to dismiss.</p>
                )}
              </div>

              <div className={styles.confirmActions}>
                <button
                  className={styles.rejectBtn}
                  onClick={() => handleReject(confirmation.id)}
                  disabled={processing === confirmation.id}
                >
                  {processing === confirmation.id ? 'Processing...' : 'Reject'}
                </button>
                <button
                  className={styles.approveBtn}
                  onClick={() => handleConfirm(confirmation)}
                  disabled={processing === confirmation.id || editState.items.length === 0}
                >
                  {processing === confirmation.id ? 'Processing...' : `Add ${editState.items.length} item${editState.items.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
