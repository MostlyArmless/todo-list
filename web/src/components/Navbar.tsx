'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api, type User } from '@/lib/api';

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUser(api.getCurrentUser());
  }, []);

  const handleLogout = () => {
    api.logout();
    router.push('/login');
  };

  // Don't show navbar on login/register pages or when not logged in
  if (!user || pathname === '/login' || pathname === '/register') {
    return null;
  }

  const navItems = [
    { href: '/lists', label: 'My Lists' },
    { href: '/recipes', label: 'Recipes' },
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
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
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
