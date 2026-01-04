'use client';

import {
  useGetVoiceHistoryDebugVoiceHistoryGet,
  VoiceDebugItem,
} from '@/generated/api';
import Link from 'next/link';
import styles from './page.module.css';

interface DebugInfo {
  heuristic?: {
    input_type?: string;
    list_id?: number;
    list_name?: string;
    name?: string;
    category_id?: number | null;
    due_date?: string | null;
    reminder_offset?: string | null;
    recurrence_pattern?: string | null;
    parsed_at?: string;
  };
  llm?: {
    name?: string;
    category_id?: number;
    due_date?: string;
    reminder_offset?: string;
    recurrence_pattern?: string;
    categorization?: {
      category_id?: number | null;
      confidence?: number;
      reasoning?: string;
    };
    raw_response?: unknown;
    refined_at?: string;
  };
}

export default function DebugPage() {
  const { data, isLoading, error } = useGetVoiceHistoryDebugVoiceHistoryGet({
    limit: 50,
    offset: 0,
  });

  if (isLoading) {
    return (
      <div className={styles.container}>
        <h1>Voice Debug</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h1>Voice Debug</h1>
        <p className={styles.error}>Error loading voice history</p>
      </div>
    );
  }

  const items = data?.items || [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Voice Debug</h1>
        <Link href="/lists" className={styles.backLink}>
          Back to Lists
        </Link>
      </header>

      <p className={styles.subtitle}>
        Recent voice-added items with heuristic and LLM processing details
      </p>

      {items.length === 0 ? (
        <p className={styles.empty}>No voice-added items found</p>
      ) : (
        <div className={styles.itemsList}>
          {items.map((item: VoiceDebugItem) => {
            const debugInfo = item.voice_debug_info as DebugInfo | null;
            const heuristic = debugInfo?.heuristic;
            const llm = debugInfo?.llm;

            return (
              <div key={item.id} className={styles.itemCard}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemName}>{item.name}</span>
                  <span
                    className={`${styles.status} ${
                      item.refinement_status === 'complete'
                        ? styles.statusComplete
                        : styles.statusPending
                    }`}
                  >
                    {item.refinement_status || 'unknown'}
                  </span>
                </div>

                <div className={styles.transcript}>
                  <strong>Transcript:</strong> &quot;{item.raw_voice_text}&quot;
                </div>

                <div className={styles.meta}>
                  <span>
                    List: <strong>{item.list_name}</strong>
                  </span>
                  {item.category_name && (
                    <span>
                      Category: <strong>{item.category_name}</strong>
                    </span>
                  )}
                  <span>Created: {new Date(item.created_at).toLocaleString()}</span>
                </div>

                <div className={styles.debugSections}>
                  {/* Heuristic Section */}
                  <div className={styles.debugSection}>
                    <h3>Heuristic Output</h3>
                    {heuristic ? (
                      <div className={styles.debugContent}>
                        <div className={styles.debugRow}>
                          <span className={styles.label}>Type:</span>
                          <span>{heuristic.input_type}</span>
                        </div>
                        <div className={styles.debugRow}>
                          <span className={styles.label}>Name:</span>
                          <span className={styles.code}>{heuristic.name}</span>
                        </div>
                        <div className={styles.debugRow}>
                          <span className={styles.label}>List:</span>
                          <span>{heuristic.list_name}</span>
                        </div>
                        {heuristic.category_id !== undefined && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Category ID:</span>
                            <span>{heuristic.category_id ?? 'none'}</span>
                          </div>
                        )}
                        {heuristic.due_date && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Due Date:</span>
                            <span>{heuristic.due_date}</span>
                          </div>
                        )}
                        {heuristic.reminder_offset && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Reminder:</span>
                            <span>{heuristic.reminder_offset}</span>
                          </div>
                        )}
                        {heuristic.recurrence_pattern && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Recurrence:</span>
                            <span>{heuristic.recurrence_pattern}</span>
                          </div>
                        )}
                        <div className={styles.debugRow}>
                          <span className={styles.label}>Parsed at:</span>
                          <span className={styles.timestamp}>
                            {heuristic.parsed_at
                              ? new Date(heuristic.parsed_at).toLocaleString()
                              : 'unknown'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className={styles.noData}>No heuristic data</p>
                    )}
                  </div>

                  {/* LLM Section */}
                  <div className={styles.debugSection}>
                    <h3>LLM Refinement</h3>
                    {llm ? (
                      <div className={styles.debugContent}>
                        {llm.name && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Name:</span>
                            <span className={styles.code}>{llm.name}</span>
                            {llm.name !== heuristic?.name && (
                              <span className={styles.changed}>(changed)</span>
                            )}
                          </div>
                        )}
                        {llm.category_id !== undefined && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Category ID:</span>
                            <span>{llm.category_id}</span>
                          </div>
                        )}
                        {llm.categorization && (
                          <>
                            <div className={styles.debugRow}>
                              <span className={styles.label}>Confidence:</span>
                              <span>
                                {llm.categorization.confidence !== undefined
                                  ? `${(llm.categorization.confidence * 100).toFixed(0)}%`
                                  : 'unknown'}
                              </span>
                            </div>
                            {llm.categorization.reasoning && (
                              <div className={styles.debugRow}>
                                <span className={styles.label}>Reasoning:</span>
                                <span className={styles.reasoning}>
                                  {llm.categorization.reasoning}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                        {llm.due_date && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Due Date:</span>
                            <span>{llm.due_date}</span>
                          </div>
                        )}
                        {llm.reminder_offset && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Reminder:</span>
                            <span>{llm.reminder_offset}</span>
                          </div>
                        )}
                        {llm.recurrence_pattern && (
                          <div className={styles.debugRow}>
                            <span className={styles.label}>Recurrence:</span>
                            <span>{llm.recurrence_pattern}</span>
                          </div>
                        )}
                        <div className={styles.debugRow}>
                          <span className={styles.label}>Refined at:</span>
                          <span className={styles.timestamp}>
                            {llm.refined_at
                              ? new Date(llm.refined_at).toLocaleString()
                              : 'unknown'}
                          </span>
                        </div>
                        {llm.raw_response !== undefined && llm.raw_response !== null && (
                          <details className={styles.rawResponse}>
                            <summary>Raw LLM Response</summary>
                            <pre>
                              {JSON.stringify(llm.raw_response, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ) : (
                      <p className={styles.noData}>
                        {item.refinement_status === 'pending'
                          ? 'Refinement in progress...'
                          : 'No LLM data'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className={styles.total}>Total: {data?.total || 0} items</p>
    </div>
  );
}
