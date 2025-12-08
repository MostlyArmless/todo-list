'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const user = api.getCurrentUser();
    if (user) {
      router.push('/lists');
    } else {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
      <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
    </div>
  );
}
