'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStartDeduplicationApiV1ListsListIdDeduplicatePost,
  useGetDeduplicationStatusApiV1ListsListIdDeduplicateTaskIdGet,
  useApplyDeduplicationApiV1ListsListIdDeduplicateApplyPost,
  getGetItemsApiV1ListsListIdItemsGetQueryKey,
  type DeduplicateApplyRequest,
} from '@/generated/api';
import styles from './DeduplicateModal.module.css';

interface DeduplicateGroup {
  canonical_name: string;
  items: { id: number; name: string }[];
}

interface DeduplicateResult {
  groups: DeduplicateGroup[];
  total_checked: number;
}

type Phase = 'scanning' | 'review' | 'applying' | 'done' | 'error';

export function DeduplicateModal({
  listId,
  onClose,
}: {
  listId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [groups, setGroups] = useState<DeduplicateGroup[]>([]);
  const [editedNames, setEditedNames] = useState<Record<number, string>>({});
  const [excludedGroups, setExcludedGroups] = useState<Set<number>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const startMutation = useStartDeduplicationApiV1ListsListIdDeduplicatePost();
  const applyMutation = useApplyDeduplicationApiV1ListsListIdDeduplicateApplyPost();

  // Poll for task status
  const { data: statusData } = useGetDeduplicationStatusApiV1ListsListIdDeduplicateTaskIdGet(
    listId,
    taskId || '',
    {
      query: {
        enabled: !!taskId && phase === 'scanning',
        refetchInterval: 1000,
      },
    }
  );

  // Start the dedup task on mount
  useEffect(() => {
    startMutation.mutate(
      { listId },
      {
        onSuccess: (data) => {
          setTaskId((data as { task_id: string }).task_id);
        },
        onError: (err) => {
          setPhase('error');
          setErrorMessage(err.detail?.[0]?.msg || 'Failed to start deduplication');
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  // React to poll results
  useEffect(() => {
    if (!statusData) return;
    const status = statusData as { status: string; result?: DeduplicateResult; error?: string };

    if (status.status === 'complete' && status.result) {
      if (status.result.groups.length === 0) {
        setPhase('done');
        setResultMessage('No duplicates found among checked items.');
      } else {
        setGroups(status.result.groups);
        setPhase('review');
      }
    } else if (status.status === 'failed') {
      setPhase('error');
      setErrorMessage(status.error || 'Deduplication task failed');
    }
  }, [statusData]);

  const handleApply = useCallback(() => {
    const activeGroups = groups
      .map((group, idx) => ({ group, idx }))
      .filter(({ idx }) => !excludedGroups.has(idx));

    if (activeGroups.length === 0) {
      onClose();
      return;
    }

    const applyRequest: DeduplicateApplyRequest = {
      groups: activeGroups.map(({ group, idx }) => {
        const canonicalName = editedNames[idx] ?? group.canonical_name;
        // Keep the first item, delete the rest
        const keepId = group.items[0].id;
        const deleteIds = group.items.slice(1).map((item) => item.id);
        return {
          keep_id: keepId,
          delete_ids: deleteIds,
          canonical_name: canonicalName,
        };
      }),
    };

    setPhase('applying');
    applyMutation.mutate(
      { listId, data: applyRequest },
      {
        onSuccess: (data) => {
          const result = data as { deleted: number; updated: number; labels_stripped: number };
          setPhase('done');
          setResultMessage(
            `Merged ${result.deleted + result.updated} items into ${result.updated}. ` +
            `Labels stripped from ${result.labels_stripped} checked items.`
          );
          queryClient.invalidateQueries({
            queryKey: getGetItemsApiV1ListsListIdItemsGetQueryKey(listId, { include_checked: true }),
          });
        },
        onError: (err) => {
          setPhase('error');
          setErrorMessage(err.detail?.[0]?.msg || 'Failed to apply changes');
        },
      }
    );
  }, [groups, excludedGroups, editedNames, listId, applyMutation, queryClient, onClose]);

  const toggleGroup = (idx: number) => {
    setExcludedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const activeCount = groups.length - excludedGroups.size;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            {phase === 'scanning' && 'Scanning for duplicates...'}
            {phase === 'review' && 'Review Duplicates'}
            {phase === 'applying' && 'Applying...'}
            {phase === 'done' && 'Done'}
            {phase === 'error' && 'Error'}
          </h3>
          <button onClick={onClose} className={styles.closeBtn} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {/* Scanning phase */}
          {(phase === 'scanning' || phase === 'applying') && (
            <div className={styles.spinnerContainer}>
              <span className={styles.spinner}>&#x27F3;</span>
              <p className={styles.spinnerText}>
                {phase === 'scanning'
                  ? 'Analyzing checked items for duplicates...'
                  : 'Applying changes...'}
              </p>
            </div>
          )}

          {/* Review phase */}
          {phase === 'review' && (
            <>
              <p className={styles.reviewSummary}>
                Found {groups.length} duplicate group{groups.length !== 1 ? 's' : ''}.
                Select which to merge:
              </p>
              <div className={styles.groupList}>
                {groups.map((group, idx) => {
                  const excluded = excludedGroups.has(idx);
                  return (
                    <div
                      key={idx}
                      className={`${styles.groupCard} ${excluded ? styles.groupExcluded : ''}`}
                    >
                      <div className={styles.groupHeader}>
                        <label className={styles.groupCheckLabel}>
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={() => toggleGroup(idx)}
                            className={styles.groupCheck}
                          />
                          <span className={styles.groupArrow}>&#x2192;</span>
                          <input
                            type="text"
                            className={styles.canonicalInput}
                            value={editedNames[idx] ?? group.canonical_name}
                            onChange={(e) =>
                              setEditedNames((prev) => ({ ...prev, [idx]: e.target.value }))
                            }
                            disabled={excluded}
                          />
                        </label>
                      </div>
                      <ul className={styles.itemList}>
                        {group.items.map((item) => (
                          <li key={item.id} className={styles.itemEntry}>
                            {item.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Done phase */}
          {phase === 'done' && (
            <p className={styles.doneMessage}>{resultMessage}</p>
          )}

          {/* Error phase */}
          {phase === 'error' && (
            <p className={styles.errorMessage}>{errorMessage}</p>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {phase === 'review' && (
            <>
              <button onClick={onClose} className={styles.btnSecondary}>
                Cancel
              </button>
              <button
                onClick={handleApply}
                className={styles.btnPrimary}
                disabled={activeCount === 0}
              >
                Apply {activeCount} merge{activeCount !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {(phase === 'done' || phase === 'error') && (
            <button onClick={onClose} className={styles.btnPrimary}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
