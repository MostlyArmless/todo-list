'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import { api, PendingConfirmation, InProgressVoiceJob, List } from '@/lib/api';
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
  const [inProgressJobs, setInProgressJobs] = useState<InProgressVoiceJob[]>([]);
  const [confirmations, setConfirmations] = useState<PendingConfirmation[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [editStates, setEditStates] = useState<Record<number, EditState>>({});
  const [failedJobEdits, setFailedJobEdits] = useState<Record<number, string>>({});
  const [now, setNow] = useState(Date.now());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for new confirmations without disrupting existing edit states
  const pollForUpdates = useCallback(async () => {
    try {
      const data = await api.getPendingConfirmations();

      // Update in-progress jobs (includes pending, processing, and failed)
      setInProgressJobs(data.in_progress);

      // Initialize edit text for failed jobs we haven't seen before
      setFailedJobEdits(prev => {
        const updated = { ...prev };
        for (const job of data.in_progress.filter(j => j.status === 'failed')) {
          if (!(job.id in updated)) {
            updated[job.id] = job.raw_text;
          }
        }
        return updated;
      });

      // Update confirmations
      setConfirmations(prev => {
        // Find truly new confirmations (IDs not in current list)
        const existingIds = new Set(prev.map(c => c.id));
        const newItems = data.pending_confirmations.filter(c => !existingIds.has(c.id));

        if (newItems.length > 0) {
          // Add edit states for new items
          setEditStates(prevStates => {
            const newStates = { ...prevStates };
            for (const conf of newItems) {
              newStates[conf.id] = {
                listId: conf.proposed_changes.list_id,
                items: conf.proposed_changes.items.map(item => ({
                  name: item.name,
                  category_id: item.category_id,
                })),
              };
            }
            return newStates;
          });
          return [...prev, ...newItems];
        }
        return prev;
      });
    } catch {
      // Silently ignore polling errors to avoid spamming the user
    }
  }, []);

  useEffect(() => {
    loadData();

    // Start polling every 1 second
    pollIntervalRef.current = setInterval(pollForUpdates, 1000);

    // Update "now" every second for elapsed time display
    const nowInterval = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      clearInterval(nowInterval);
    };
  }, [pollForUpdates]);

  async function loadData() {
    try {
      setLoading(true);
      const [queueData, listsData] = await Promise.all([
        api.getPendingConfirmations(),
        api.getLists(),
      ]);
      setInProgressJobs(queueData.in_progress);
      setConfirmations(queueData.pending_confirmations);
      setLists(listsData);

      // Initialize edit states for confirmations
      const initialEditStates: Record<number, EditState> = {};
      for (const conf of queueData.pending_confirmations) {
        initialEditStates[conf.id] = {
          listId: conf.proposed_changes.list_id,
          items: conf.proposed_changes.items.map(item => ({
            name: item.name,
            category_id: item.category_id,
          })),
        };
      }
      setEditStates(initialEditStates);

      // Initialize edit text for failed jobs
      const initialFailedEdits: Record<number, string> = {};
      for (const job of queueData.in_progress.filter(j => j.status === 'failed')) {
        initialFailedEdits[job.id] = job.raw_text;
      }
      setFailedJobEdits(initialFailedEdits);

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

  async function handleDismissJob(id: number) {
    try {
      setProcessing(id);
      await api.deleteVoiceInput(id);
      setInProgressJobs(prev => prev.filter(j => j.id !== id));
      setFailedJobEdits(prev => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss');
    } finally {
      setProcessing(null);
    }
  }

  async function handleRetryJob(id: number) {
    const editedText = failedJobEdits[id];
    if (!editedText?.trim()) {
      setError('Please enter text to process');
      return;
    }

    try {
      setProcessing(id);
      await api.retryVoiceInput(id, editedText);
      // The job will now appear as 'pending' in the next poll
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    } finally {
      setProcessing(null);
    }
  }

  function formatElapsedTime(dateStr: string): string {
    const date = new Date(dateStr);
    const diffMs = now - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) {
      return `${diffSecs}s`;
    }

    const diffMins = Math.floor(diffSecs / 60);
    const remainingSecs = diffSecs % 60;
    return `${diffMins}m ${remainingSecs}s`;
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
      ) : inProgressJobs.length === 0 && confirmations.length === 0 ? (
        <div className={`card ${styles.emptyCard}`}>
          <div className={styles.emptyIcon}>🎤</div>
          <p className={styles.emptyText}>No pending voice inputs</p>
          <p className={styles.emptySubtext}>
            Use the Voice feature to add items by speaking. Your voice inputs
            will appear here for review before being added to your lists.
          </p>
        </div>
      ) : (
        <>
          {/* In-progress jobs (pending/processing) */}
          {inProgressJobs.filter(j => j.status !== 'failed').map(job => (
            <div key={`job-${job.id}`} className={styles.inProgressCard}>
              <div className={styles.inProgressHeader}>
                <div className={styles.spinner} />
                <span className={styles.statusBadge}>
                  {job.status === 'pending' ? 'Queued' : 'Processing'}
                </span>
                <span className={styles.elapsedTime}>{formatElapsedTime(job.created_at)}</span>
              </div>
              <div className={styles.rawText}>&ldquo;{job.raw_text}&rdquo;</div>
            </div>
          ))}

          {/* Failed jobs */}
          {inProgressJobs.filter(j => j.status === 'failed').map(job => (
            <div key={`failed-${job.id}`} className={styles.failedCard}>
              <div className={styles.failedHeader}>
                <span className={styles.failedBadge}>Failed</span>
                <span className={styles.elapsedTime}>{formatElapsedTime(job.created_at)}</span>
              </div>
              {job.error_message && (
                <div className={styles.errorMessage}>{job.error_message}</div>
              )}
              <div className={styles.failedEditSection}>
                <label className={styles.fieldLabel}>Edit text and retry:</label>
                <textarea
                  className={styles.failedTextarea}
                  value={failedJobEdits[job.id] || ''}
                  onChange={(e) => setFailedJobEdits(prev => ({ ...prev, [job.id]: e.target.value }))}
                  disabled={processing === job.id}
                  rows={3}
                />
              </div>
              <div className={styles.failedActions}>
                <button
                  className={styles.dismissBtn}
                  onClick={() => handleDismissJob(job.id)}
                  disabled={processing === job.id}
                >
                  {processing === job.id ? 'Processing...' : 'Dismiss'}
                </button>
                <button
                  className={styles.retryBtn}
                  onClick={() => handleRetryJob(job.id)}
                  disabled={processing === job.id}
                >
                  {processing === job.id ? 'Processing...' : 'Retry'}
                </button>
              </div>
            </div>
          ))}

          {/* Pending confirmations */}
          {confirmations.map(confirmation => {
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
        })}
        </>
      )}
    </div>
  );
}
