'use client';

import { useSyncExternalStore } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import styles from './Navbar.module.css';

// Hydration-safe mounted check
const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

// Icon components
const ListIcon = () => (
  <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const RecipeIcon = () => (
  <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 11h.01" />
    <path d="M11 15h.01" />
    <path d="M16 16h.01" />
    <path d="m2 16 20 6-6-20A20 20 0 0 0 2 16" />
    <path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4" />
  </svg>
);

const PantryIcon = () => (
  <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 8h14M5 8a2 2 0 1 1 0-4h14a2 2 0 1 1 0 4M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M9 12h6" />
  </svg>
);

const VoiceIcon = () => (
  <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

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
    { href: '/lists', label: 'Lists', icon: ListIcon },
    { href: '/recipes', label: 'Recipes', icon: RecipeIcon },
    { href: '/pantry', label: 'Pantry', icon: PantryIcon },
    { href: '/voice', label: 'Voice', icon: VoiceIcon, isStatic: true },
  ];

  // Get user initials for avatar
  const initials = user.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <nav className={styles.navbar}>
      <div className={styles.container}>
        <div className={styles.navLinks}>
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            const className = `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`;

            // Use regular anchor for static pages (served by nginx, not Next.js)
            if ('isStatic' in item && item.isStatic) {
              return (
                <a key={item.href} href={item.href} className={className}>
                  <Icon />
                  <span className={styles.navLinkText}>{item.label}</span>
                </a>
              );
            }

            return (
              <Link key={item.href} href={item.href} className={className}>
                <Icon />
                <span className={styles.navLinkText}>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className={styles.userSection}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>{initials}</div>
            <span className={styles.userName}>{user.name || user.email}</span>
          </div>
          <button onClick={handleLogout} className={styles.logoutBtn} title="Sign out">
            <LogoutIcon />
          </button>
        </div>
      </div>
    </nav>
  );
}
