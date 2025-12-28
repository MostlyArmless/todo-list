'use client';

import { useSyncExternalStore } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import styles from './Navbar.module.css';

// Hydration-safe mounted check
const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useMounted();

  // Get user at render time - only meaningful when mounted (client-side)
  const user = mounted ? api.getCurrentUser() : null;

  const handleLogout = () => {
    api.logout();
    router.push('/login');
  };

  if (!mounted || !user || pathname === '/login' || pathname === '/register') {
    return null;
  }

  const navItems = [
    { href: '/lists', label: 'My Lists' },
    { href: '/recipes', label: 'Recipes' },
    { href: '/pantry', label: 'Pantry' },
    { href: '/voice', label: 'Voice' },
  ];

  return (
    <nav className={styles.navbar}>
      <div className={styles.container}>
        <div className={styles.navLinks}>
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className={styles.userSection}>
          <span className={styles.userName}>{user.name || user.email}</span>
          <button onClick={handleLogout} className={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
