'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type List } from '@/lib/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';

export default function ListsPage() {
  const router = useRouter();
  const { confirm, alert } = useConfirmDialog();
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState('');

  useEffect(() => {
    const currentUser = api.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    loadLists();
  }, [router]);

  const loadLists = async () => {
    try {
      const data = await api.getLists();
      setLists(data);
    } catch (error) {
      console.error('Failed to load lists:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;

    try {
      await api.createList({ name: newListName });
      setNewListName('');
      setShowNewList(false);
      loadLists();
    } catch (error) {
      console.error('Failed to create list:', error);
    }
  };

  const handleDeleteList = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: 'Delete List',
      message: `Delete "${name}"? This will permanently delete the list and all its items.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.deleteList(id);
      loadLists();
    } catch (error) {
      console.error('Failed to delete list:', error);
      await alert({ message: 'Failed to delete list. Please try again.' });
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '1rem', paddingBottom: '5rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>My Lists</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {lists.map((list) => (
          <div
            key={list.id}
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s',
              cursor: 'pointer',
              border: '1px solid var(--border)',
            }}
            onClick={() => router.push(`/list/${list.id}`)}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.transform = 'translateX(4px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>
                  {list.icon && <span style={{ marginRight: '0.5rem' }}>{list.icon}</span>}
                  {list.name}
                </h2>
                {(list as List & { unchecked_count?: number }).unchecked_count != null &&
                  (list as List & { unchecked_count?: number }).unchecked_count! > 0 && (
                    <span
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: 'white',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '9999px',
                        minWidth: '1.5rem',
                        textAlign: 'center',
                      }}
                    >
                      {(list as List & { unchecked_count?: number }).unchecked_count}
                    </span>
                  )}
              </div>
              {list.description && (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {list.description}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteList(list.id, list.name);
                }}
                style={{
                  color: 'var(--text-secondary)',
                  padding: '0.5rem',
                  flexShrink: 0,
                }}
                title="Delete list"
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
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </div>
        ))}

        {showNewList ? (
          <form onSubmit={handleCreateList} className="card">
            <input
              type="text"
              placeholder="List name"
              className="input"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              autoFocus
              style={{ marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewList(false);
                  setNewListName('');
                }}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowNewList(true)}
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              color: 'var(--accent)',
              cursor: 'pointer',
              border: '2px dashed var(--border)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>New List</span>
          </button>
        )}
      </div>
    </div>
  );
}
