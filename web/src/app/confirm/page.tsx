'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPendingConfirmationsApiV1VoicePendingListGet,
  useGetListsApiV1ListsGet,
  useActionPendingConfirmationApiV1VoicePendingConfirmationIdActionPost,
  useRetryVoiceInputApiV1VoiceVoiceInputIdRetryPost,
  useDeleteVoiceInputApiV1VoiceVoiceInputIdDelete,
  getListPendingConfirmationsApiV1VoicePendingListGetQueryKey,
  type PendingConfirmationResponse,
} from '@/generated/api';
import styles from './page.module.css';

interface EditableItem {
  name: string;
  category_id: number | null;
  // Task-specific fields
  due_date?: string | null;
  reminder_offset?: string | null;
  recurrence_pattern?: string | null;
}

interface EditState {
  listId: number;
  items: EditableItem[];
  rawText: string;
}

export default function ConfirmPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [editStates, setEditStates] = useState<Record<number, EditState>>({});
  const [failedJobEdits, setFailedJobEdits] = useState<Record<number, string>>({});
  const [now, setNow] = useState(Date.now());

  // Queries with polling
  const { data: queueData, isLoading: loadingQueue } = useListPendingConfirmationsApiV1VoicePendingListGet({
    query: { refetchInterval: 1000 },
  });
  const { data: lists = [], isLoading: loadingLists } = useGetListsApiV1ListsGet();

  const inProgressJobs = queueData?.in_progress ?? [];
  const confirmations = queueData?.pending_confirmations ?? [];
  const loading = loadingQueue || loadingLists;

  // Mutations
  const actionMutation = useActionPendingConfirmationApiV1VoicePendingConfirmationIdActionPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingConfirmationsApiV1VoicePendingListGetQueryKey() });
      },
    },
  });

  const retryMutation = useRetryVoiceInputApiV1VoiceVoiceInputIdRetryPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingConfirmationsApiV1VoicePendingListGetQueryKey() });
      },
    },
  });

  const deleteMutation = useDeleteVoiceInputApiV1VoiceVoiceInputIdDelete({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingConfirmationsApiV1VoicePendingListGetQueryKey() });
      },
    },
  });

  // Initialize edit states when confirmations load
  useEffect(() => {
    if (!queueData) return;

    // Initialize edit states for new confirmations
    setEditStates(prev => {
      const newStates = { ...prev };
      for (const conf of queueData.pending_confirmations) {
        if (!(conf.id in newStates)) {
          const changes = conf.proposed_changes as { list_id: number; items: EditableItem[] };
          newStates[conf.id] = {
            listId: changes.list_id,
            items: changes.items.map(item => ({
              name: item.name,
              category_id: item.category_id,
              due_date: item.due_date,
              reminder_offset: item.reminder_offset,
              recurrence_pattern: item.recurrence_pattern,
            })),
            rawText: conf.raw_text,
          };
        }
      }
      // Clean up states for confirmations that no longer exist
      const existingIds = new Set(queueData.pending_confirmations.map(c => c.id));
      for (const id of Object.keys(newStates)) {
        if (!existingIds.has(Number(id))) {
          delete newStates[Number(id)];
        }
      }
      return newStates;
    });

    // Initialize edit text for failed jobs
    setFailedJobEdits(prev => {
      const updated = { ...prev };
      for (const job of queueData.in_progress.filter(j => j.status === 'failed')) {
        if (!(job.id in updated)) {
          updated[job.id] = job.raw_text;
        }
      }
      // Clean up states for jobs that no longer exist
      const existingIds = new Set(queueData.in_progress.map(j => j.id));
      for (const id of Object.keys(updated)) {
        if (!existingIds.has(Number(id))) {
          delete updated[Number(id)];
        }
      }
      return updated;
    });
  }, [queueData]);

  // Update "now" every second for elapsed time display
  useEffect(() => {
    const nowInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(nowInterval);
  }, []);

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

  function updateRawText(confirmationId: number, newText: string) {
    setEditStates(prev => ({
      ...prev,
      [confirmationId]: {
        ...prev[confirmationId],
        rawText: newText,
      },
    }));
  }

  async function handleRetryConfirmation(confirmation: PendingConfirmationResponse) {
    const editState = editStates[confirmation.id];
    const textToRetry = editState?.rawText?.trim();
    if (!textToRetry) {
      setError('Please enter text to process');
      return;
    }

    try {
      setProcessing(confirmation.id);
      // Reject current confirmation and retry the voice input
      await actionMutation.mutateAsync({
        confirmationId: confirmation.id,
        data: { action: 'reject' },
      });
      await retryMutation.mutateAsync({
        voiceInputId: confirmation.voice_input_id,
        data: { raw_text: textToRetry },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    } finally {
      setProcessing(null);
    }
  }

  async function handleConfirm(confirmation: PendingConfirmationResponse) {
    const editState = editStates[confirmation.id];
    if (!editState || editState.items.length === 0) {
      setError('No items to add');
      return;
    }

    try {
      setProcessing(confirmation.id);
      const changes = confirmation.proposed_changes as { list_id: number; items: EditableItem[] };
      const hasEdits =
        editState.listId !== changes.list_id ||
        JSON.stringify(editState.items) !== JSON.stringify(
          changes.items.map(i => ({ name: i.name, category_id: i.category_id }))
        );

      await actionMutation.mutateAsync({
        confirmationId: confirmation.id,
        data: {
          action: 'confirm',
          edits: hasEdits ? { list_id: editState.listId, items: editState.items } : undefined,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setProcessing(null);
    }
  }

  async function handleReject(id: number) {
    try {
      setProcessing(id);
      await actionMutation.mutateAsync({
        confirmationId: id,
        data: { action: 'reject' },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setProcessing(null);
    }
  }

  async function handleDismissJob(id: number) {
    try {
      setProcessing(id);
      await deleteMutation.mutateAsync({ voiceInputId: id });
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
      await retryMutation.mutateAsync({
        voiceInputId: id,
        data: { raw_text: editedText },
      });
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

  function formatDueDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();

      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      if (isToday) {
        return `Today at ${timeStr}`;
      } else if (isTomorrow) {
        return `Tomorrow at ${timeStr}`;
      } else {
        const dateStrFormatted = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `${dateStrFormatted} at ${timeStr}`;
      }
    } catch {
      return dateStr;
    }
  }

  function formatReminderOffset(offset: string | null | undefined): string {
    if (!offset) return '';
    const unit = offset.slice(-1).toLowerCase();
    const value = offset.slice(0, -1);
    switch (unit) {
      case 'm': return `${value} min before`;
      case 'h': return `${value} hour${value !== '1' ? 's' : ''} before`;
      case 'd': return `${value} day${value !== '1' ? 's' : ''} before`;
      default: return offset;
    }
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

              <div className={styles.rawTextSection}>
                <div className={styles.rawTextHeader}>
                  <label className={styles.fieldLabel}>Transcribed text:</label>
                  <button
                    className={styles.reprocessBtn}
                    onClick={() => handleRetryConfirmation(confirmation)}
                    disabled={processing === confirmation.id}
                    title="Re-process with LLM"
                  >
                    {processing === confirmation.id ? 'Processing...' : 'Re-process'}
                  </button>
                </div>
                <textarea
                  className={styles.rawTextInput}
                  value={editState.rawText}
                  onChange={(e) => updateRawText(confirmation.id, e.target.value)}
                  disabled={processing === confirmation.id}
                  rows={2}
                />
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
                    <div key={idx} className={styles.editableItemWrapper}>
                      <div className={styles.editableItem}>
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
                      {(item.due_date || item.reminder_offset || item.recurrence_pattern) && (
                        <div className={styles.taskMeta}>
                          {item.due_date && (
                            <span className={styles.taskMetaItem}>
                              <span className={styles.taskMetaIcon}>📅</span>
                              {formatDueDate(item.due_date)}
                            </span>
                          )}
                          {item.reminder_offset && (
                            <span className={styles.taskMetaItem}>
                              <span className={styles.taskMetaIcon}>🔔</span>
                              {formatReminderOffset(item.reminder_offset)}
                            </span>
                          )}
                          {!item.reminder_offset && item.due_date && (
                            <span className={styles.taskMetaItem}>
                              <span className={styles.taskMetaIcon}>🔔</span>
                              at due time
                            </span>
                          )}
                          {item.recurrence_pattern && (
                            <span className={styles.taskMetaItem}>
                              <span className={styles.taskMetaIcon}>🔁</span>
                              {item.recurrence_pattern}
                            </span>
                          )}
                        </div>
                      )}
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
