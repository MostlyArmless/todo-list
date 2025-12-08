'use client';

import { useRouter } from 'next/navigation';

export default function ConfirmPage() {
  const router = useRouter();

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <button
        onClick={() => router.push('/lists')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: 'var(--text-secondary)',
          marginBottom: '1.5rem',
        }}
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

      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Pending Confirmations</h1>

      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          No pending confirmations.
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '1rem' }}>
          Voice input confirmations will appear here once LLM integration is added in Phase 2.
        </p>
      </div>
    </div>
  );
}
