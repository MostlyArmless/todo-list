'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api, type User } from '@/lib/api';

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  // Start with null to match server render, then hydrate on client
  const [user, setUser] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: set mounted to avoid hydration mismatch
    setMounted(true);
    setUser(api.getCurrentUser());
  }, []);

  const handleLogout = () => {
    api.logout();
    router.push('/login');
  };

  // Don't show navbar until mounted (avoids hydration mismatch)
  // or on login/register pages, or when not logged in
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
    <nav
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            overflowX: 'auto',
            flexShrink: 1,
            minWidth: 0,
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE/Edge
          }}
          className="navbar-links"
        >
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'color 0.2s',
                  padding: '0.25rem 0',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {user.name || user.email}
          </span>
          <button
            onClick={handleLogout}
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.875rem',
              padding: '0.25rem 0.5rem',
            }}
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
