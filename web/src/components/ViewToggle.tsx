'use client';

import styles from './ViewToggle.module.css';

export type ViewMode = 'list' | 'gallery';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}

export default function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div className={`${styles.toggle} ${className || ''}`} role="radiogroup" aria-label="View mode">
      <button
        type="button"
        className={`${styles.option} ${value === 'list' ? styles.active : ''}`}
        onClick={() => onChange('list')}
        role="radio"
        aria-checked={value === 'list'}
        title="List view"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.option} ${value === 'gallery' ? styles.active : ''}`}
        onClick={() => onChange('gallery')}
        role="radio"
        aria-checked={value === 'gallery'}
        title="Gallery view"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      </button>
    </div>
  );
}
