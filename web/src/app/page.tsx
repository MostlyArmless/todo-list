'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      router.push('/lists');
    } else {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className={`container ${styles.loading}`}>
      <p className={styles.loadingText}>Loading...</p>
    </div>
  );
}
