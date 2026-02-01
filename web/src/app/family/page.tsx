'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMyFamilyApiV1FamiliesMeGet,
  useCreateFamilyApiV1FamiliesPost,
  useUpdateFamilyApiV1FamiliesFamilyIdPut,
  useDeleteFamilyApiV1FamiliesFamilyIdDelete,
  useAddFamilyMemberApiV1FamiliesFamilyIdMembersPost,
  useRemoveFamilyMemberApiV1FamiliesFamilyIdMembersUserIdDelete,
  useUpdateMemberRoleApiV1FamiliesFamilyIdMembersUserIdPut,
  getGetMyFamilyApiV1FamiliesMeGetQueryKey,
  type FamilyMemberResponse,
} from '@/generated/api';
import { getCurrentUser } from '@/lib/auth';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import styles from './page.module.css';

// Hydration-safe mounted check
const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

function MemberCard({
  member,
  currentUserId,
  isAdmin,
  onRemove,
  onUpdateRole,
}: {
  member: FamilyMemberResponse;
  currentUserId: number;
  isAdmin: boolean;
  onRemove: () => void;
  onUpdateRole: (role: 'admin' | 'member') => void;
}) {
  const isCurrentUser = member.user_id === currentUserId;
  const initials = member.user_name
    ? member.user_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : member.user_email?.[0].toUpperCase() || '?';

  return (
    <div className={styles.memberCard}>
      <div className={styles.memberAvatar}>{initials}</div>
      <div className={styles.memberInfo}>
        <div className={styles.memberName}>
          {member.user_name || member.user_email}
          {isCurrentUser && <span className={styles.youBadge}>You</span>}
        </div>
        <div className={styles.memberEmail}>{member.user_email}</div>
      </div>
      <div className={styles.memberActions}>
        {member.role === 'admin' ? (
          <span className={styles.adminBadge}>Admin</span>
        ) : (
          <span className={styles.memberBadge}>Member</span>
        )}
        {isAdmin && !isCurrentUser && (
          <>
            <button
              onClick={() => onUpdateRole(member.role === 'admin' ? 'member' : 'admin')}
              className={styles.roleBtn}
              title={member.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
            >
              {member.role === 'admin' ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
            <button onClick={onRemove} className={styles.removeBtn} title="Remove from family">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
        {isCurrentUser && !isAdmin && (
          <button onClick={onRemove} className={styles.leaveBtn}>
            Leave
          </button>
        )}
      </div>
    </div>
  );
}

export default function FamilyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, alert } = useConfirmDialog();
  const mounted = useMounted();

  // Get user at render time - only meaningful when mounted (client-side)
  const user = mounted ? getCurrentUser() : null;
  const currentUserId = user?.id ?? null;

  // Create family state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');

  // Add member state
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [addMemberError, setAddMemberError] = useState('');

  // Edit family name state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  useEffect(() => {
    if (mounted && !user) {
      router.push('/login');
    }
  }, [mounted, user, router]);

  // Fetch family data
  const { data: family, isLoading } = useGetMyFamilyApiV1FamiliesMeGet();

  // Mutations
  const createFamilyMutation = useCreateFamilyApiV1FamiliesPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyFamilyApiV1FamiliesMeGetQueryKey() });
        setShowCreateForm(false);
        setNewFamilyName('');
      },
      onError: async () => {
        await alert({ message: 'Failed to create family' });
      },
    },
  });

  const updateFamilyMutation = useUpdateFamilyApiV1FamiliesFamilyIdPut({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyFamilyApiV1FamiliesMeGetQueryKey() });
        setIsEditingName(false);
      },
    },
  });

  const deleteFamilyMutation = useDeleteFamilyApiV1FamiliesFamilyIdDelete({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyFamilyApiV1FamiliesMeGetQueryKey() });
      },
    },
  });

  const addMemberMutation = useAddFamilyMemberApiV1FamiliesFamilyIdMembersPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyFamilyApiV1FamiliesMeGetQueryKey() });
        setShowAddMember(false);
        setNewMemberEmail('');
        setAddMemberError('');
      },
      onError: () => {
        setAddMemberError('Failed to add member. User may not exist or is already in a family.');
      },
    },
  });

  const removeMemberMutation = useRemoveFamilyMemberApiV1FamiliesFamilyIdMembersUserIdDelete({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyFamilyApiV1FamiliesMeGetQueryKey() });
      },
      onError: async () => {
        await alert({ message: 'Failed to remove member' });
      },
    },
  });

  const updateRoleMutation = useUpdateMemberRoleApiV1FamiliesFamilyIdMembersUserIdPut({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyFamilyApiV1FamiliesMeGetQueryKey() });
      },
      onError: async () => {
        await alert({ message: 'Failed to update role' });
      },
    },
  });

  const handleCreateFamily = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFamilyName.trim()) return;
    createFamilyMutation.mutate({ data: { name: newFamilyName } });
  };

  const handleDeleteFamily = async () => {
    if (!family) return;
    const confirmed = await confirm({
      title: 'Delete Family',
      message: `Delete "${family.name}"? All members will be removed and family-shared lists will be unshared.`,
      confirmText: 'Delete Family',
      variant: 'danger',
    });
    if (confirmed) {
      deleteFamilyMutation.mutate({ familyId: family.id });
    }
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!family || !newMemberEmail.trim()) return;
    setAddMemberError('');
    addMemberMutation.mutate({
      familyId: family.id,
      data: { email: newMemberEmail },
    });
  };

  const handleRemoveMember = async (member: FamilyMemberResponse) => {
    if (!family) return;
    const isCurrentUser = member.user_id === currentUserId;
    const message = isCurrentUser
      ? 'Leave this family? You will lose access to family-shared lists.'
      : `Remove ${member.user_name || member.user_email} from the family?`;

    const confirmed = await confirm({
      title: isCurrentUser ? 'Leave Family' : 'Remove Member',
      message,
      confirmText: isCurrentUser ? 'Leave' : 'Remove',
      variant: 'danger',
    });

    if (confirmed) {
      removeMemberMutation.mutate({
        familyId: family.id,
        userId: member.user_id,
      });
    }
  };

  const handleUpdateRole = async (member: FamilyMemberResponse, newRole: 'admin' | 'member') => {
    if (!family) return;
    updateRoleMutation.mutate({
      familyId: family.id,
      userId: member.user_id,
      data: { role: newRole },
    });
  };

  const handleSaveName = () => {
    if (!family || !editedName.trim()) return;
    updateFamilyMutation.mutate({
      familyId: family.id,
      data: { name: editedName },
    });
  };

  const currentMember = family?.members?.find((m) => m.user_id === currentUserId);
  const isAdmin = currentMember?.role === 'admin';

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Family</h1>
          <p className={styles.subtitle}>Loading...</p>
        </div>
      </div>
    );
  }

  // No family - show create form
  if (!family) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Family</h1>
          <p className={styles.subtitle}>Create or join a family to share lists easily</p>
        </div>

        {showCreateForm ? (
          <form onSubmit={handleCreateFamily} className={styles.section}>
            <h2 className={styles.sectionTitle}>Create a Family</h2>
            <div className={styles.field}>
              <label className={styles.label}>Family name</label>
              <input
                type="text"
                className={styles.input}
                placeholder="e.g., Smith Family"
                value={newFamilyName}
                onChange={(e) => setNewFamilyName(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.formButtons}>
              <button
                type="submit"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={createFamilyMutation.isPending}
              >
                {createFamilyMutation.isPending ? 'Creating...' : 'Create Family'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className={`${styles.btn} ${styles.btnSecondary}`}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h2 className={styles.emptyTitle}>No Family Yet</h2>
            <p className={styles.emptyText}>
              Create a family to easily share lists with your household members.
            </p>
            <button onClick={() => setShowCreateForm(true)} className={styles.createBtn}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Family
            </button>
          </div>
        )}
      </div>
    );
  }

  // Has family - show family details
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {isEditingName ? (
          <div className={styles.editNameRow}>
            <input
              type="text"
              className={styles.editNameInput}
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              autoFocus
            />
            <button onClick={handleSaveName} className={styles.saveNameBtn}>
              Save
            </button>
            <button onClick={() => setIsEditingName(false)} className={styles.cancelNameBtn}>
              Cancel
            </button>
          </div>
        ) : (
          <h1 className={styles.title}>
            {family.name}
            {isAdmin && (
              <button
                onClick={() => {
                  setEditedName(family.name);
                  setIsEditingName(true);
                }}
                className={styles.editNameBtn}
                title="Edit family name"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
          </h1>
        )}
        <p className={styles.subtitle}>
          {family.members?.length || 0} member{(family.members?.length || 0) !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Members Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Members
          </h2>
          {isAdmin && (
            <button onClick={() => setShowAddMember(true)} className={styles.addMemberBtn}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Member
            </button>
          )}
        </div>

        {showAddMember && (
          <form onSubmit={handleAddMember} className={styles.addMemberForm}>
            <div className={styles.addMemberInputRow}>
              <input
                type="email"
                className={styles.input}
                placeholder="Email address"
                value={newMemberEmail}
                onChange={(e) => {
                  setNewMemberEmail(e.target.value);
                  setAddMemberError('');
                }}
                autoFocus
              />
              <button
                type="submit"
                className={styles.addBtn}
                disabled={addMemberMutation.isPending}
              >
                {addMemberMutation.isPending ? 'Adding...' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddMember(false);
                  setNewMemberEmail('');
                  setAddMemberError('');
                }}
                className={styles.cancelBtn}
              >
                Cancel
              </button>
            </div>
            {addMemberError && <p className={styles.errorText}>{addMemberError}</p>}
          </form>
        )}

        <div className={styles.membersList}>
          {family.members?.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              currentUserId={currentUserId || 0}
              isAdmin={isAdmin}
              onRemove={() => handleRemoveMember(member)}
              onUpdateRole={(role) => handleUpdateRole(member, role)}
            />
          ))}
        </div>
      </div>

      {/* Admin Actions */}
      {isAdmin && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Admin Actions
          </h2>
          <button onClick={handleDeleteFamily} className={styles.dangerBtn}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete Family
          </button>
        </div>
      )}
    </div>
  );
}
