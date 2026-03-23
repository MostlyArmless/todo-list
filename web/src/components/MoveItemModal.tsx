'use client';

import { useState } from 'react';
import {
  type CategoryResponse,
  type ListResponse,
  getCategoriesApiV1ListsListIdCategoriesGet,
} from '@/generated/api';
import styles from './MoveItemModal.module.css';

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={styles.closeBtn} title="Close">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={styles.backBtn} title="Back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
  );
}

function SectionList({
  categories,
  currentCategoryId,
  onSelect,
}: {
  categories: CategoryResponse[];
  currentCategoryId: number | null;
  onSelect: (categoryId: number | null) => void;
}) {
  return (
    <div className={styles.sectionList}>
      <button
        className={`${styles.sectionItem} ${currentCategoryId === null ? styles.sectionItemCurrent : ''}`}
        onClick={() => { if (currentCategoryId !== null) onSelect(null); }}
      >
        Uncategorized
        {currentCategoryId === null && <span className={styles.currentBadge}>Current</span>}
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          className={`${styles.sectionItem} ${currentCategoryId === cat.id ? styles.sectionItemCurrent : ''}`}
          onClick={() => { if (currentCategoryId !== cat.id) onSelect(cat.id); }}
        >
          <span style={{ color: cat.color || undefined }}>{cat.name}</span>
          {currentCategoryId === cat.id && <span className={styles.currentBadge}>Current</span>}
        </button>
      ))}
    </div>
  );
}

/** Modal for moving an item to a different section within the same list. */
export function MoveSectionModal({
  categories,
  currentCategoryId,
  onSelect,
  onClose,
}: {
  categories: CategoryResponse[];
  currentCategoryId: number | null;
  onSelect: (categoryId: number | null) => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>Move to section</h3>
          <CloseButton onClick={onClose} />
        </div>
        <SectionList
          categories={categories}
          currentCategoryId={currentCategoryId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/** Modal for moving an item to a different list (and optionally a section within it). */
export function MoveToListModal({
  lists,
  currentListId,
  onSelect,
  onClose,
}: {
  lists: ListResponse[];
  currentListId: number;
  onSelect: (listId: number, categoryId: number | null) => void;
  onClose: () => void;
}) {
  const [selectedList, setSelectedList] = useState<ListResponse | null>(null);
  const [targetCategories, setTargetCategories] = useState<CategoryResponse[] | null>(null);
  const [loading, setLoading] = useState(false);

  const otherLists = lists.filter((l) => l.id !== currentListId && !l.archived_at);

  const handleSelectList = async (list: ListResponse) => {
    setSelectedList(list);
    setLoading(true);
    try {
      const cats = await getCategoriesApiV1ListsListIdCategoriesGet(list.id);
      setTargetCategories(cats);
    } catch {
      setTargetCategories([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedList(null);
    setTargetCategories(null);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {selectedList === null ? (
          <>
            <div className={styles.header}>
              <h3 className={styles.title}>Move to list</h3>
              <CloseButton onClick={onClose} />
            </div>
            <div className={styles.sectionList}>
              {otherLists.length === 0 && (
                <div className={styles.emptyState}>No other lists available</div>
              )}
              {otherLists.map((list) => (
                <button
                  key={list.id}
                  className={styles.sectionItem}
                  onClick={() => handleSelectList(list)}
                >
                  <span>
                    {list.icon && <span className={styles.listIcon}>{list.icon}</span>}
                    {list.name}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className={styles.header}>
              <BackButton onClick={handleBack} />
              <h3 className={styles.title}>
                {selectedList.icon && <span className={styles.listIcon}>{selectedList.icon}</span>}
                {selectedList.name}
              </h3>
              <CloseButton onClick={onClose} />
            </div>
            {loading ? (
              <div className={styles.loadingState}>Loading sections...</div>
            ) : (
              <SectionList
                categories={targetCategories || []}
                currentCategoryId={null}
                onSelect={(categoryId) => onSelect(selectedList.id, categoryId)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
