'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { type Item, type RecurrencePattern } from '@/lib/api';
import styles from './TaskItem.module.css';

// URL regex that matches http(s) URLs
const URL_REGEX = /(https?:\/\/[^\s<>"\])}]+)/g;

/**
 * Parse text and convert URLs to clickable links.
 * Returns an array of ReactNodes (strings and <a> elements).
 */
function renderTextWithLinks(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0; // Reset regex state
  while ((match = URL_REGEX.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the URL as a link
    const url = match[1];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  // Add remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

interface TaskItemProps {
  item: Item;
  onComplete: (item: Item) => void;
  onUncheck: (item: Item) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, data: {
    name?: string;
    due_date?: string | null;
    reminder_offset?: string | null;
    recurrence_pattern?: RecurrencePattern | null;
  }) => Promise<void>;
}

const REMINDER_OFFSET_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '1m', label: '1 minute before' },
  { value: '15m', label: '15 minutes before' },
  { value: '30m', label: '30 minutes before' },
  { value: '1h', label: '1 hour before' },
  { value: '2h', label: '2 hours before' },
  { value: '1d', label: '1 day before' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: 'No repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

function formatAbsoluteDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (taskDate.getTime() === today.getTime()) {
    return `Today at ${timeStr}`;
  } else if (taskDate.getTime() === tomorrow.getTime()) {
    return `Tomorrow at ${timeStr}`;
  } else {
    const dateFormatted = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateFormatted} at ${timeStr}`;
  }
}

/**
 * Format relative time as "Xd Xh Xm" with fixed-width padding.
 * Shows days only if > 0, hours only if > 0 or days > 0, always shows minutes.
 * Negative values show as past time with "-" prefix.
 */
function formatRelativeCountdown(targetDate: Date, now: Date): string {
  const diffMs = targetDate.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);

  const totalMinutes = Math.floor(absDiffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  // Build the string with fixed-width components
  let result = '';
  if (days > 0) {
    result += `${days}d`;
  }
  if (days > 0 || hours > 0) {
    result += `${hours}h`;
  }
  result += `${minutes}m`;

  return isPast ? `-${result}` : result;
}

function formatCompletedAt(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate) < new Date();
}

function getRecurrenceIcon(pattern: RecurrencePattern): string {
  switch (pattern) {
    case 'daily': return '↻ Daily';
    case 'weekly': return '↻ Weekly';
    case 'monthly': return '↻ Monthly';
  }
}

function parseOffsetMs(offset: string): number {
  const match = offset.match(/^(\d+)([mhd])$/);
  if (!match) return 0;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  switch (unit) {
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

function getReminderTime(dueDate: string, offset: string): Date | null {
  if (!dueDate || !offset) return null;
  const due = new Date(dueDate);
  const offsetMs = parseOffsetMs(offset);
  return new Date(due.getTime() - offsetMs);
}

export default function TaskItem({
  item,
  onComplete,
  onUncheck,
  onDelete,
  onUpdate,
}: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const [editDueDate, setEditDueDate] = useState(item.due_date ? item.due_date.slice(0, 16) : '');
  const [editReminderOffset, setEditReminderOffset] = useState(item.reminder_offset || '');
  const [editRecurrence, setEditRecurrence] = useState(item.recurrence_pattern || '');
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Real-time countdown update
  useEffect(() => {
    if (item.checked || !item.due_date) return;

    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [item.checked, item.due_date]);

  const handleStartEdit = () => {
    setEditName(item.name);
    setEditDueDate(item.due_date ? item.due_date.slice(0, 16) : '');
    setEditReminderOffset(item.reminder_offset || '');
    setEditRecurrence(item.recurrence_pattern || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await onUpdate(item.id, {
        name: editName.trim(),
        due_date: editDueDate ? new Date(editDueDate).toISOString() : null,
        reminder_offset: editReminderOffset || null,
        recurrence_pattern: (editRecurrence as RecurrencePattern) || null,
      });
      setIsEditing(false);
    } catch {
      // Failed to update
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = () => {
    onComplete(item);
  };

  const handleUncheck = () => {
    onUncheck(item);
  };

  if (isEditing) {
    return (
      <div className={styles.editCard}>
        <input
          type="text"
          className={styles.editInput}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Task name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveEdit();
            if (e.key === 'Escape') handleCancelEdit();
          }}
        />
        <div className={styles.editRow}>
          <label className={styles.fieldLabel}>
            Due
            <input
              type="datetime-local"
              className={styles.editInput}
              value={editDueDate}
              onChange={(e) => setEditDueDate(e.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            Reminder
            <select
              className={styles.editSelect}
              value={editReminderOffset}
              onChange={(e) => setEditReminderOffset(e.target.value)}
            >
              {REMINDER_OFFSET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            Repeat
            <select
              className={styles.editSelect}
              value={editRecurrence}
              onChange={(e) => setEditRecurrence(e.target.value)}
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.editActions}>
          <button
            onClick={handleSaveEdit}
            disabled={saving || !editName.trim()}
            className={styles.btnPrimary}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={saving}
            className={styles.btnSecondary}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const overdue = item.due_date && !item.checked && isOverdue(item.due_date);

  return (
    <div className={`${styles.taskCard} ${item.checked ? styles.taskCardCompleted : ''} ${overdue ? styles.taskCardOverdue : ''}`}>
      {/* Complete/Uncomplete circle button */}
      <button
        onClick={item.checked ? handleUncheck : handleComplete}
        className={`${styles.completeCircle} ${item.checked ? styles.completeCircleChecked : ''}`}
        title={item.checked ? 'Mark as incomplete' : 'Complete task'}
      >
        {item.checked && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        )}
      </button>

      <div className={styles.taskContent}>
        <div className={`${styles.taskName} ${item.checked ? styles.taskNameCompleted : ''}`}>
          {renderTextWithLinks(item.name)}
        </div>

        <div className={styles.taskMeta}>
          {/* Due date */}
          {item.due_date && !item.checked && (
            <span className={`${styles.dueDate} ${overdue ? styles.dueDateOverdue : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              {formatAbsoluteDateTime(item.due_date)}
              <span className={styles.countdown}>
                ({formatRelativeCountdown(new Date(item.due_date), now)})
              </span>
            </span>
          )}

          {/* Completed at */}
          {item.checked && item.completed_at && (
            <span className={styles.completedAt}>
              Completed {formatCompletedAt(item.completed_at)}
            </span>
          )}

          {/* Recurrence badge */}
          {item.recurrence_pattern && (
            <span className={styles.recurrenceBadge}>
              {getRecurrenceIcon(item.recurrence_pattern)}
            </span>
          )}

          {/* Reminder indicator */}
          {item.reminder_offset && item.due_date && !item.checked && (() => {
            const reminderTime = getReminderTime(item.due_date, item.reminder_offset);
            if (!reminderTime) return null;
            return (
              <span className={styles.reminderBadge} title={`Reminder: ${REMINDER_OFFSET_OPTIONS.find(o => o.value === item.reminder_offset)?.label || item.reminder_offset}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
                {formatAbsoluteDateTime(reminderTime.toISOString())}
                <span className={styles.countdown}>
                  ({formatRelativeCountdown(reminderTime, now)})
                </span>
              </span>
            );
          })()}
        </div>
      </div>

      {/* Edit button */}
      <button
        onClick={handleStartEdit}
        className={styles.actionBtn}
        title="Edit task"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>

      {/* Delete button */}
      <button
        onClick={() => onDelete(item.id)}
        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
        title="Delete task"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  );
}
