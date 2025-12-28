'use client';

import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function ConfirmPage() {
  const router = useRouter();

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

      <h1 className={styles.title}>Pending Confirmations</h1>

      <div className={`card ${styles.emptyCard}`}>
        <p className={styles.emptyText}>
          No pending confirmations.
        </p>
        <p className={styles.emptySubtext}>
          Voice input confirmations will appear here once LLM integration is added in Phase 2.
        </p>
      </div>
    </div>
  );
}
