'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetListsApiV1ListsGet,
  useCreateListApiV1ListsPost,
  useDeleteListApiV1ListsListIdDelete,
  getGetListsApiV1ListsGetQueryKey,
  type ListResponse,
  ListCreateListType,
} from '@/generated/api';
import { getCurrentUser } from '@/lib/auth';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import styles from './page.module.css';

export default function ListsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, alert } = useConfirmDialog();
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListType, setNewListType] = useState<'grocery' | 'task'>('grocery');

  // Check auth on mount
  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      router.push('/login');
    }
  }, [router]);

  // Fetch lists using React Query
  const { data: lists = [], isLoading } = useGetListsApiV1ListsGet({
    query: {
      select: (data) => [...data].sort((a, b) => a.name.localeCompare(b.name)),
    },
  });

  // Create list mutation
  const createListMutation = useCreateListApiV1ListsPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetListsApiV1ListsGetQueryKey() });
        setNewListName('');
        setNewListType('grocery');
        setShowNewList(false);
      },
    },
  });

  // Delete list mutation
  const deleteListMutation = useDeleteListApiV1ListsListIdDelete({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetListsApiV1ListsGetQueryKey() });
      },
      onError: async () => {
        await alert({ message: 'Failed to delete list. Please try again.' });
      },
    },
  });

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;

    createListMutation.mutate({
      data: {
        name: newListName,
        list_type: newListType === 'task' ? ListCreateListType.task : ListCreateListType.grocery,
      },
    });
  };

  const handleDeleteList = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: 'Delete List',
      message: `Delete "${name}"? This will permanently delete the list and all its items.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    deleteListMutation.mutate({ listId: id });
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <p className={styles.loading}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>My Lists</h1>

      <div className={styles.listContainer}>
        {lists.map((list: ListResponse & { unchecked_count?: number }) => (
          <div
            key={list.id}
            className={styles.listCard}
            onClick={() => router.push(`/list/${list.id}`)}
          >
            <div className={styles.listInfo}>
              <h2>
                {list.icon && <span className={styles.listIcon}>{list.icon}</span>}
                {list.name}
                {list.unchecked_count != null && list.unchecked_count > 0 && (
                  <span className={styles.countBadge}>{list.unchecked_count}</span>
                )}
              </h2>
              <div className={styles.listMeta}>
                <span className={`${styles.listTypeBadge} ${list.list_type === 'task' ? styles.taskType : styles.groceryType}`}>
                  {list.list_type === 'task' ? '✓ Task' : '🛒 Grocery'}
                </span>
                {list.description && (
                  <span className={styles.listDescription}>{list.description}</span>
                )}
              </div>
            </div>
            <div className={styles.listActions}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteList(list.id, list.name);
                }}
                className={styles.deleteBtn}
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
          <form onSubmit={handleCreateList} className={styles.newListCard}>
            <input
              type="text"
              placeholder="List name"
              className={styles.input}
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              autoFocus
            />
            <div className={styles.typeSelector}>
              <button
                type="button"
                className={`${styles.typeBtn} ${newListType === 'grocery' ? styles.typeBtnActive : ''}`}
                onClick={() => setNewListType('grocery')}
              >
                <span className={styles.typeIcon}>🛒</span>
                Grocery
              </button>
              <button
                type="button"
                className={`${styles.typeBtn} ${newListType === 'task' ? styles.typeBtnActive : ''}`}
                onClick={() => setNewListType('task')}
              >
                <span className={styles.typeIcon}>✓</span>
                Task
              </button>
            </div>
            <div className={styles.formButtons}>
              <button
                type="submit"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={createListMutation.isPending}
              >
                {createListMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewList(false);
                  setNewListName('');
                  setNewListType('grocery');
                }}
                className={`${styles.btn} ${styles.btnSecondary}`}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowNewList(true)} className={styles.addListCard}>
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
