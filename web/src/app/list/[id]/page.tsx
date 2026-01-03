'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from '@/lib/auth';
import {
  useGetListApiV1ListsListIdGet,
  useGetCategoriesApiV1ListsListIdCategoriesGet,
  useGetItemsApiV1ListsListIdItemsGet,
  useCreateItemApiV1ListsListIdItemsPost,
  useCheckItemApiV1ItemsItemIdCheckPost,
  useUncheckItemApiV1ItemsItemIdUncheckPost,
  useCompleteTaskItemApiV1ItemsItemIdCompletePost,
  useUpdateItemApiV1ItemsItemIdPut,
  useDeleteItemApiV1ItemsItemIdDelete,
  useCreateCategoryApiV1ListsListIdCategoriesPost,
  useUpdateCategoryApiV1CategoriesCategoryIdPut,
  useDeleteCategoryApiV1CategoriesCategoryIdDelete,
  useBulkDeleteItemsApiV1ListsListIdItemsBulkDeletePost,
  useAutoCategorizeItemsApiV1ListsListIdItemsAutoCategorizePost,
  useListPantryItemsApiV1PantryGet,
  useBulkAddPantryItemsApiV1PantryBulkPost,
  getGetListApiV1ListsListIdGetQueryKey,
  getGetCategoriesApiV1ListsListIdCategoriesGetQueryKey,
  getGetItemsApiV1ListsListIdItemsGetQueryKey,
  type CategoryResponse,
  type ItemResponse,
  type PantryItemResponse,
  type ItemCreateRecurrencePattern,
} from '@/generated/api';
import TaskItem from '@/components/TaskItem';
import { formatQuantityTotal } from '@/lib/formatQuantity';
import IconButton from '@/components/IconButton';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './page.module.css';

type RecurrencePattern = 'daily' | 'weekly' | 'monthly';

/**
 * Calculate whether text should be dark or light based on background color luminance.
 * Uses relative luminance formula from WCAG 2.0.
 */
function getContrastTextColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // Calculate relative luminance
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // Use dark text for light backgrounds (luminance > 0.5)
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
}

export default function ListDetailPage() {
  const router = useRouter();
  const params = useParams();
  const listId = parseInt(params.id as string);
  const { confirm, alert } = useConfirmDialog();
  const queryClient = useQueryClient();

  const [showChecked, setShowChecked] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<number | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [autoCategorizing, setAutoCategorizing] = useState(false);
  const [recentlyChecked, setRecentlyChecked] = useState<string[]>([]);
  const [showPantryPrompt, setShowPantryPrompt] = useState(false);
  const [addingToPantry, setAddingToPantry] = useState(false);
  const [addedItemMessage, setAddedItemMessage] = useState<string | null>(null);
  const [inlineAddCategory, setInlineAddCategory] = useState<number | null | 'uncategorized'>(null);
  const [inlineItemName, setInlineItemName] = useState('');
  // Task-specific form state
  const [newItemDueDate, setNewItemDueDate] = useState('');
  const [newItemReminderOffset, setNewItemReminderOffset] = useState('');
  const [newItemRecurrence, setNewItemRecurrence] = useState<RecurrencePattern | ''>('');
  // Optimistically reordered categories
  const [localCategories, setLocalCategories] = useState<CategoryResponse[] | null>(null);

  // Auth check
  useEffect(() => {
    if (!getCurrentUser()) {
      router.push('/login');
    }
  }, [router]);

  // Queries
  const { data: list, isLoading: listLoading } = useGetListApiV1ListsListIdGet(listId, {
    query: {
      enabled: !!listId && !!getCurrentUser(),
    },
  });

  const { data: categoriesData = [] } = useGetCategoriesApiV1ListsListIdCategoriesGet(listId, {
    query: {
      enabled: !!listId && !!getCurrentUser(),
    },
  });

  const { data: items = [] } = useGetItemsApiV1ListsListIdItemsGet(listId, { include_checked: showChecked }, {
    query: {
      enabled: !!listId && !!getCurrentUser(),
    },
  });

  const { data: pantryItems = [] } = useListPantryItemsApiV1PantryGet({
    query: {
      enabled: !!getCurrentUser(),
    },
  });

  // Sync server categories to local state for optimistic updates
  const categories = localCategories ?? [...categoriesData].sort((a, b) => a.sort_order - b.sort_order);
  /* eslint-disable react-hooks/set-state-in-effect -- Resetting optimistic state when server data changes */
  useEffect(() => {
    setLocalCategories(null);
  }, [categoriesData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loading = listLoading;

  // Invalidation helper
  const invalidateListData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetListApiV1ListsListIdGetQueryKey(listId) });
    queryClient.invalidateQueries({ queryKey: getGetCategoriesApiV1ListsListIdCategoriesGetQueryKey(listId) });
    queryClient.invalidateQueries({ queryKey: getGetItemsApiV1ListsListIdItemsGetQueryKey(listId, { include_checked: showChecked }) });
  }, [queryClient, listId, showChecked]);

  // Mutations
  const createItemMutation = useCreateItemApiV1ListsListIdItemsPost();
  const checkItemMutation = useCheckItemApiV1ItemsItemIdCheckPost();
  const uncheckItemMutation = useUncheckItemApiV1ItemsItemIdUncheckPost();
  const completeItemMutation = useCompleteTaskItemApiV1ItemsItemIdCompletePost();
  const updateItemMutation = useUpdateItemApiV1ItemsItemIdPut();
  const deleteItemMutation = useDeleteItemApiV1ItemsItemIdDelete();
  const createCategoryMutation = useCreateCategoryApiV1ListsListIdCategoriesPost();
  const updateCategoryMutation = useUpdateCategoryApiV1CategoriesCategoryIdPut();
  const deleteCategoryMutation = useDeleteCategoryApiV1CategoriesCategoryIdDelete();
  const bulkDeleteMutation = useBulkDeleteItemsApiV1ListsListIdItemsBulkDeletePost();
  const autoCategorizeItemsMutation = useAutoCategorizeItemsApiV1ListsListIdItemsAutoCategorizePost();
  const bulkAddPantryMutation = useBulkAddPantryItemsApiV1PantryBulkPost();

  // Handlers
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const isTaskList = list?.list_type === 'task';

    // Check if item with same name already exists (for merge detection) - grocery only
    const existingItem = !isTaskList ? items.find(
      i => i.name.toLowerCase().trim() === newItemName.toLowerCase().trim() && !i.checked
    ) : null;

    createItemMutation.mutate(
      {
        listId,
        data: {
          name: newItemName,
          // Grocery-specific fields
          category_id: !isTaskList ? (newItemCategory || undefined) : undefined,
          // Task-specific fields
          due_date: isTaskList && newItemDueDate ? new Date(newItemDueDate).toISOString() : undefined,
          reminder_offset: isTaskList && newItemReminderOffset ? newItemReminderOffset : undefined,
          recurrence_pattern: isTaskList && newItemRecurrence ? newItemRecurrence as ItemCreateRecurrencePattern : undefined,
        },
      },
      {
        onSuccess: (createdItem) => {
          // Reset form
          setNewItemName('');
          setNewItemCategory(null);
          setNewItemDueDate('');
          setNewItemReminderOffset('');
          setNewItemRecurrence('');

          // Show ghost message indicating what happened
          if (!isTaskList) {
            const wasMerged = existingItem && existingItem.id === createdItem.id;
            const categoryName = createdItem.category_id
              ? categories.find(c => c.id === createdItem.category_id)?.name || 'Unknown'
              : 'Uncategorized';

            if (wasMerged) {
              setAddedItemMessage(`Merged with existing in ${categoryName}`);
            } else {
              setAddedItemMessage(`Added to ${categoryName}`);
            }
            setTimeout(() => setAddedItemMessage(null), 3000);
          } else {
            setAddedItemMessage('Task added');
            setTimeout(() => setAddedItemMessage(null), 2000);
          }

          invalidateListData();
        },
      }
    );
  };

  const handleInlineAdd = (categoryId: number | null) => {
    if (!inlineItemName.trim()) return;

    createItemMutation.mutate(
      {
        listId,
        data: {
          name: inlineItemName,
          category_id: categoryId || undefined,
        },
      },
      {
        onSuccess: () => {
          setInlineItemName('');
          setInlineAddCategory(null);
          invalidateListData();
        },
      }
    );
  };

  const handleToggleCheck = (item: ItemResponse) => {
    if (item.checked) {
      uncheckItemMutation.mutate(
        { itemId: item.id },
        {
          onSuccess: () => {
            // Remove from recently checked if unchecking
            setRecentlyChecked((prev) => prev.filter((name) => name !== item.name));
            invalidateListData();
          },
        }
      );
    } else {
      checkItemMutation.mutate(
        { itemId: item.id },
        {
          onSuccess: () => {
            // Track the checked item name for pantry prompt
            setRecentlyChecked((prev) => {
              // Avoid duplicates
              if (prev.includes(item.name)) return prev;
              const updated = [...prev, item.name];
              // Show prompt after 2+ items checked
              if (updated.length >= 2 && !showPantryPrompt) {
                setShowPantryPrompt(true);
              }
              return updated;
            });
            invalidateListData();
          },
        }
      );
    }
  };

  // Task-specific handlers
  const handleCompleteTask = (item: ItemResponse) => {
    completeItemMutation.mutate(
      { itemId: item.id },
      { onSuccess: () => invalidateListData() }
    );
  };

  const handleUncheckTask = (item: ItemResponse) => {
    uncheckItemMutation.mutate(
      { itemId: item.id },
      { onSuccess: () => invalidateListData() }
    );
  };

  const handleUpdateTask = async (id: number, data: {
    name?: string;
    due_date?: string | null;
    reminder_offset?: string | null;
    recurrence_pattern?: RecurrencePattern | null;
  }) => {
    return new Promise<void>((resolve, reject) => {
      updateItemMutation.mutate(
        { itemId: id, data },
        {
          onSuccess: () => {
            invalidateListData();
            resolve();
          },
          onError: (error) => reject(error),
        }
      );
    });
  };

  const handleAddToPantry = () => {
    setAddingToPantry(true);
    // Filter out items that are already in pantry
    const existingNames = new Set(pantryItems.map((p) => p.normalized_name));
    const newItems = recentlyChecked.filter(
      (name) => !existingNames.has(name.toLowerCase().trim())
    );

    if (newItems.length > 0) {
      bulkAddPantryMutation.mutate(
        { data: { items: newItems.map((name) => ({ name, status: 'have' as const })) } },
        {
          onSuccess: () => {
            setRecentlyChecked([]);
            setShowPantryPrompt(false);
            setAddingToPantry(false);
          },
          onError: () => {
            setAddingToPantry(false);
          },
        }
      );
    } else {
      setRecentlyChecked([]);
      setShowPantryPrompt(false);
      setAddingToPantry(false);
    }
  };

  const dismissPantryPrompt = () => {
    setRecentlyChecked([]);
    setShowPantryPrompt(false);
  };

  const handleDeleteItem = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Item',
      message: 'Are you sure you want to delete this item?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    deleteItemMutation.mutate(
      { itemId: id },
      { onSuccess: () => invalidateListData() }
    );
  };

  const handleUpdateItem = async (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => {
    return new Promise<void>((resolve, reject) => {
      updateItemMutation.mutate(
        { itemId: id, data },
        {
          onSuccess: () => {
            invalidateListData();
            resolve();
          },
          onError: (error) => reject(error),
        }
      );
    });
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    createCategoryMutation.mutate(
      {
        listId,
        data: {
          name: newCategoryName,
          sort_order: categories.length,
        },
      },
      {
        onSuccess: () => {
          setNewCategoryName('');
          setShowNewCategory(false);
          invalidateListData();
        },
      }
    );
  };

  const handleDeleteCategory = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Category',
      message: 'Delete this category? Items in it will become uncategorized.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    deleteCategoryMutation.mutate(
      { categoryId: id },
      { onSuccess: () => invalidateListData() }
    );
  };

  const handleStartEditCategory = (category: CategoryResponse) => {
    setEditingCategoryId(category.id);
    setEditCategoryName(category.name);
  };

  const handleCancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryName('');
  };

  const handleSaveEditCategory = (id: number) => {
    if (!editCategoryName.trim()) return;
    updateCategoryMutation.mutate(
      { categoryId: id, data: { name: editCategoryName } },
      {
        onSuccess: () => {
          setEditingCategoryId(null);
          setEditCategoryName('');
          invalidateListData();
        },
      }
    );
  };

  // dnd-kit sensors for pointer and keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((cat) => cat.id === active.id);
    const newIndex = categories.findIndex((cat) => cat.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder with arrayMove
    const reordered = arrayMove(categories, oldIndex, newIndex);

    // Update sort_order for all categories
    const updates = reordered.map((cat, idx) => ({
      ...cat,
      sort_order: idx,
    }));

    // Optimistically update UI
    setLocalCategories(updates);

    // Save to backend
    try {
      await Promise.all(
        updates.map((cat) =>
          new Promise<void>((resolve, reject) => {
            updateCategoryMutation.mutate(
              { categoryId: cat.id, data: { sort_order: cat.sort_order } },
              { onSuccess: () => resolve(), onError: reject }
            );
          })
        )
      );
    } catch {
      invalidateListData(); // Reload on error
    }
  };

  const getItemsByCategory = (categoryId: number | null) => {
    return items.filter((item) => item.category_id === categoryId);
  };

  const toggleItemSelection = (itemId: number) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const toggleCategorySelection = (categoryId: number | null) => {
    const categoryItems = getItemsByCategory(categoryId);
    const categoryItemIds = categoryItems.map((item) => item.id);
    const allSelected = categoryItemIds.every((id) => selectedItems.has(id));

    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (allSelected) {
        categoryItemIds.forEach((id) => newSet.delete(id));
      } else {
        categoryItemIds.forEach((id) => newSet.add(id));
      }
      return newSet;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    const confirmed = await confirm({
      title: 'Delete Items',
      message: `Delete ${selectedItems.size} selected item${selectedItems.size > 1 ? 's' : ''}?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    bulkDeleteMutation.mutate(
      { listId, data: Array.from(selectedItems) },
      {
        onSuccess: () => {
          setSelectedItems(new Set());
          invalidateListData();
        },
      }
    );
  };

  const handleAutoCategorize = async () => {
    setAutoCategorizing(true);
    autoCategorizeItemsMutation.mutate(
      { listId },
      {
        onSuccess: async (data) => {
          const result = data as { categorized: number; failed: number };
          if (result.categorized > 0) {
            await alert({
              title: 'Auto-Categorize Complete',
              message: `Categorized ${result.categorized} item${result.categorized > 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} could not be categorized)` : ''}`,
            });
            invalidateListData();
          } else if (result.failed > 0) {
            await alert({
              title: 'Auto-Categorize',
              message: `Could not categorize any items. ${result.failed} item${result.failed > 1 ? 's' : ''} remain uncategorized.`,
            });
          }
          setAutoCategorizing(false);
        },
        onError: async () => {
          await alert({
            title: 'Error',
            message: 'Failed to auto-categorize items. Please try again.',
          });
          setAutoCategorizing(false);
        },
      }
    );
  };

  const isCategoryFullySelected = (categoryId: number | null) => {
    const categoryItems = getItemsByCategory(categoryId);
    return categoryItems.length > 0 && categoryItems.every((item) => selectedItems.has(item.id));
  };

  const isCategoryPartiallySelected = (categoryId: number | null) => {
    const categoryItems = getItemsByCategory(categoryId);
    const selectedCount = categoryItems.filter((item) => selectedItems.has(item.id)).length;
    return selectedCount > 0 && selectedCount < categoryItems.length;
  };

  if (loading) {
    return (
      <div className={`${styles.container} ${styles.loading}`}>
        <p className={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  if (!list) {
    return (
      <div className={`${styles.container} ${styles.loading}`}>
        <p className={styles.loadingText}>List not found</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <button
            onClick={() => router.push('/lists')}
            className={styles.backBtn}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Back
          </button>
          <label className={styles.showCheckedLabel}>
            <input
              type="checkbox"
              checked={showChecked}
              onChange={(e) => {
                setShowChecked(e.target.checked);
              }}
              className={styles.showCheckedCheckbox}
            />
            <span className={styles.showCheckedText}>
              Show checked
            </span>
          </label>
        </div>
        <h1 className={styles.title}>
          {list.icon && <span className={styles.titleIcon}>{list.icon}</span>}
          {list.name}
        </h1>
        {list.description && (
          <p className={styles.description}>
            {list.description}
          </p>
        )}
      </div>

      {/* Add Item Form */}
      <form onSubmit={handleAddItem} className={styles.addItemCard}>
        <div className={styles.addItemRow}>
          <input
            type="text"
            placeholder={list.list_type === 'task' ? 'Add task...' : 'Add item...'}
            className={styles.addItemInput}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
          />
          {list.list_type === 'grocery' && (
            <select
              className={styles.addItemSelect}
              value={newItemCategory || ''}
              onChange={(e) => setNewItemCategory(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className={styles.addItemBtn}>
            Add
          </button>
        </div>
        {/* Task-specific fields */}
        {list.list_type === 'task' && (
          <div className={styles.taskFormFields}>
            <label className={styles.taskFieldLabel}>
              Due
              <input
                type="datetime-local"
                className={styles.taskFieldInput}
                value={newItemDueDate}
                onChange={(e) => setNewItemDueDate(e.target.value)}
              />
            </label>
            <label className={styles.taskFieldLabel}>
              Reminder
              <select
                className={styles.taskFieldSelect}
                value={newItemReminderOffset}
                onChange={(e) => setNewItemReminderOffset(e.target.value)}
              >
                <option value="">No reminder</option>
                <option value="0m">At due time</option>
                <option value="1m">1 min before</option>
                <option value="15m">15 min before</option>
                <option value="30m">30 min before</option>
                <option value="1h">1 hour before</option>
                <option value="2h">2 hours before</option>
                <option value="1d">1 day before</option>
              </select>
            </label>
            <label className={styles.taskFieldLabel}>
              Repeat
              <select
                className={styles.taskFieldSelect}
                value={newItemRecurrence}
                onChange={(e) => setNewItemRecurrence(e.target.value as RecurrencePattern | '')}
              >
                <option value="">No repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
        )}
        {addedItemMessage && (
          <span className={styles.addedMessage}>
            {addedItemMessage}
          </span>
        )}
      </form>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className={styles.bulkActions}>
          <button
            onClick={handleBulkDelete}
            className={styles.bulkDeleteBtn}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete {selectedItems.size}
          </button>
        </div>
      )}

      {/* Task List Items */}
      {list.list_type === 'task' && (
        <div className={styles.taskListSection}>
          <div className={styles.itemList}>
            {items.map((item) => (
              <TaskItem
                key={item.id}
                item={item}
                onComplete={handleCompleteTask}
                onUncheck={handleUncheckTask}
                onDelete={handleDeleteItem}
                onUpdate={handleUpdateTask}
              />
            ))}
          </div>
        </div>
      )}

      {/* Grocery List: Uncategorized Items */}
      {list.list_type === 'grocery' && getItemsByCategory(null).length > 0 && (
        <div className={styles.categorySection}>
          <div className={styles.categoryHeader}>
            <input
              type="checkbox"
              checked={isCategoryFullySelected(null)}
              ref={(el) => {
                if (el) el.indeterminate = isCategoryPartiallySelected(null);
              }}
              onChange={() => toggleCategorySelection(null)}
              className={styles.categoryCheckbox}
              title="Select all uncategorized items"
            />
            <h2 className={styles.categoryTitle}>
              Uncategorized
            </h2>
            {categories.length > 0 && (
              <button
                onClick={handleAutoCategorize}
                disabled={autoCategorizing}
                className={styles.autoCategorizeBtn}
                title="Auto-categorize items using AI"
              >
                {autoCategorizing ? (
                  <>
                    <span className={styles.spinIcon}>⟳</span>
                    ...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                    </svg>
                    Auto
                  </>
                )}
              </button>
            )}
          </div>
          <div className={styles.itemList}>
            {getItemsByCategory(null).map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={handleToggleCheck}
                onDelete={handleDeleteItem}
                onUpdate={handleUpdateItem}
                categories={categories}
              />
            ))}
            {/* Inline add button/form */}
            {inlineAddCategory === 'uncategorized' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleInlineAdd(null);
                }}
                className={styles.inlineAddForm}
              >
                <input
                  type="text"
                  className={styles.inlineInput}
                  value={inlineItemName}
                  onChange={(e) => setInlineItemName(e.target.value)}
                  placeholder="Add item..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setInlineAddCategory(null);
                      setInlineItemName('');
                    }
                  }}
                  onBlur={() => {
                    if (!inlineItemName.trim()) {
                      setInlineAddCategory(null);
                    }
                  }}
                />
                <button type="submit" className={styles.btnPrimary}>
                  Add
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setInlineAddCategory('uncategorized');
                  setInlineItemName('');
                }}
                className={styles.inlineAddBtn}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add item
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grocery List: Categorized Items with dnd-kit */}
      {list.list_type === 'grocery' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={categories.map((cat) => cat.id)}
            strategy={verticalListSortingStrategy}
          >
            {categories.map((category) => (
              <SortableCategory
                key={category.id}
                category={category}
                items={getItemsByCategory(category.id)}
                isFullySelected={isCategoryFullySelected(category.id)}
                isPartiallySelected={isCategoryPartiallySelected(category.id)}
                onToggleCategorySelection={() => toggleCategorySelection(category.id)}
                isEditing={editingCategoryId === category.id}
                editName={editCategoryName}
                onEditNameChange={setEditCategoryName}
                onSaveEdit={() => handleSaveEditCategory(category.id)}
                onCancelEdit={handleCancelEditCategory}
                onStartEdit={() => handleStartEditCategory(category)}
                onDelete={() => handleDeleteCategory(category.id)}
                onToggleItemCheck={handleToggleCheck}
                onDeleteItem={handleDeleteItem}
                onUpdateItem={handleUpdateItem}
                allCategories={categories}
                isInlineAdding={inlineAddCategory === category.id}
                inlineItemName={inlineItemName}
                onInlineItemNameChange={setInlineItemName}
                onStartInlineAdd={() => {
                  setInlineAddCategory(category.id);
                  setInlineItemName('');
                }}
                onCancelInlineAdd={() => {
                  setInlineAddCategory(null);
                  setInlineItemName('');
                }}
                onSubmitInlineAdd={() => handleInlineAdd(category.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {/* Empty State */}
      {items.length === 0 && (
        <div className={styles.emptyState}>
          <p>
            {list.list_type === 'task'
              ? 'No tasks yet. Add your first task above!'
              : 'No items yet. Add your first item above!'}
          </p>
        </div>
      )}

      {/* Add Category - Grocery lists only */}
      {list.list_type === 'grocery' && (
        <div className={styles.addCategorySection}>
          {showNewCategory ? (
            <form onSubmit={handleAddCategory} className={styles.addCategoryForm}>
              <input
                type="text"
                placeholder="Category name"
                className={styles.addCategoryInput}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowNewCategory(false);
                    setNewCategoryName('');
                  }
                }}
              />
              <button type="submit" className={styles.btnPrimary}>
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewCategory(false);
                  setNewCategoryName('');
                }}
                className={styles.btnSecondary}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowNewCategory(true)}
              className={styles.addCategoryBtn}
            >
              <svg
                width="14"
                height="14"
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
              Add Category
            </button>
          )}
        </div>
      )}

      {/* Post-Shopping Pantry Prompt - Grocery lists only */}
      {list.list_type === 'grocery' && showPantryPrompt && recentlyChecked.length > 0 && (
        <div className={styles.pantryPrompt}>
          <div className={styles.pantryPromptHeader}>
            <div>
              <p className={styles.pantryPromptTitle}>Add to pantry?</p>
              <p className={styles.pantryPromptSubtitle}>
                Track these {recentlyChecked.length} item{recentlyChecked.length !== 1 ? 's' : ''} in your pantry
              </p>
            </div>
            <IconButton onClick={dismissPantryPrompt} title="Dismiss">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </IconButton>
          </div>
          <div className={styles.pantryPromptItems}>
            {recentlyChecked.slice(0, 5).join(', ')}
            {recentlyChecked.length > 5 && ` and ${recentlyChecked.length - 5} more`}
          </div>
          <div className={styles.pantryPromptActions}>
            <button
              onClick={dismissPantryPrompt}
              disabled={addingToPantry}
              className={styles.pantrySkipBtn}
            >
              Skip
            </button>
            <button
              onClick={handleAddToPantry}
              disabled={addingToPantry}
              className={styles.pantryAddBtn}
            >
              {addingToPantry ? 'Adding...' : 'Add to Pantry'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableCategory({
  category,
  items,
  isFullySelected,
  isPartiallySelected,
  onToggleCategorySelection,
  isEditing,
  editName,
  onEditNameChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDelete,
  onToggleItemCheck,
  onDeleteItem,
  onUpdateItem,
  allCategories,
  isInlineAdding,
  inlineItemName,
  onInlineItemNameChange,
  onStartInlineAdd,
  onCancelInlineAdd,
  onSubmitInlineAdd,
}: {
  category: CategoryResponse;
  items: ItemResponse[];
  isFullySelected: boolean;
  isPartiallySelected: boolean;
  onToggleCategorySelection: () => void;
  isEditing: boolean;
  editName: string;
  onEditNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onToggleItemCheck: (item: ItemResponse) => void;
  onDeleteItem: (id: number) => void;
  onUpdateItem: (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => Promise<void>;
  allCategories: CategoryResponse[];
  isInlineAdding: boolean;
  inlineItemName: string;
  onInlineItemNameChange: (name: string) => void;
  onStartInlineAdd: () => void;
  onCancelInlineAdd: () => void;
  onSubmitInlineAdd: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
  };

  return (
    <div ref={setNodeRef} className={styles.sortableCategory} style={dragStyle}>
      <div className={styles.categoryHeader}>
        {/* Category selection checkbox */}
        {items.length > 0 && (
          <input
            type="checkbox"
            checked={isFullySelected}
            ref={(el) => {
              if (el) el.indeterminate = isPartiallySelected;
            }}
            onChange={onToggleCategorySelection}
            className={styles.categoryCheckbox}
            title={`Select all items in ${category.name}`}
          />
        )}

        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className={styles.dragHandle}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          title="Drag to reorder"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </div>

        {/* Category name or edit input */}
        {isEditing ? (
          <>
            <input
              type="text"
              className={styles.inlineInput}
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
            />
            <button
              onClick={onSaveEdit}
              className={styles.btnPrimary}
            >
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className={styles.btnSecondary}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2
              className={styles.categoryTitle}
              style={{ color: category.color || 'var(--text-primary)' }}
            >
              {category.name}
            </h2>

            {/* Meatball menu */}
            <div className={styles.meatballMenu} ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={styles.meatballBtn}
                title="More options"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <circle cx="5" cy="12" r="2"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                  <circle cx="19" cy="12" r="2"></circle>
                </svg>
              </button>
              {menuOpen && (
                <div className={styles.meatballDropdown}>
                  <button
                    onClick={() => {
                      onStartEdit();
                      setMenuOpen(false);
                    }}
                    className={styles.meatballOption}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      onDelete();
                      setMenuOpen(false);
                    }}
                    className={`${styles.meatballOption} ${styles.meatballOptionDanger}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Delete
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className={styles.itemList}>
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            onToggle={onToggleItemCheck}
            onDelete={onDeleteItem}
            onUpdate={onUpdateItem}
            categories={allCategories}
          />
        ))}
        {/* Inline add button/form */}
        {isInlineAdding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitInlineAdd();
            }}
            className={styles.inlineAddForm}
          >
            <input
              type="text"
              className={styles.inlineInput}
              value={inlineItemName}
              onChange={(e) => onInlineItemNameChange(e.target.value)}
              placeholder="Add item..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onCancelInlineAdd();
                }
              }}
              onBlur={() => {
                if (!inlineItemName.trim()) {
                  onCancelInlineAdd();
                }
              }}
            />
            <button type="submit" className={styles.btnPrimary}>
              Add
            </button>
          </form>
        ) : (
          <button
            onClick={onStartInlineAdd}
            className={styles.inlineAddBtn}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add item
          </button>
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onDelete,
  onUpdate,
  categories,
}: {
  item: ItemResponse;
  onToggle: (item: ItemResponse) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => Promise<void>;
  categories: CategoryResponse[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const [editQuantity, setEditQuantity] = useState(item.quantity || '');
  const [editDescription, setEditDescription] = useState(item.description || '');
  const [editCategoryId, setEditCategoryId] = useState<number | null>(item.category_id ?? null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleStartEdit = () => {
    setEditName(item.name);
    setEditQuantity(item.quantity || '');
    setEditDescription(item.description || '');
    setEditCategoryId(item.category_id ?? null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await onUpdate(item.id, {
        name: editName.trim(),
        quantity: editQuantity.trim(),
        description: editDescription.trim(),
        category_id: editCategoryId,
      });
      setIsEditing(false);
    } catch {
      // Failed to update item
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className={styles.itemEditCard}>
        <input
          type="text"
          className={styles.itemEditInput}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Item name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveEdit();
            if (e.key === 'Escape') handleCancelEdit();
          }}
        />
        <div className={styles.itemEditRow}>
          <input
            type="text"
            className={`${styles.itemEditInput} ${styles.itemEditQty}`}
            value={editQuantity}
            onChange={(e) => setEditQuantity(e.target.value)}
            placeholder="Qty"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
          <input
            type="text"
            className={`${styles.itemEditInput} ${styles.itemEditDesc}`}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
          <select
            className={`${styles.itemEditInput} ${styles.itemEditCategory}`}
            value={editCategoryId || ''}
            onChange={(e) => setEditCategoryId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.itemEditActions}>
          <button
            onClick={handleSaveEdit}
            disabled={saving || !editName.trim()}
            className={`${styles.itemEditBtn} ${styles.itemEditBtnPrimary}`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={saving}
            className={`${styles.itemEditBtn} ${styles.itemEditBtnSecondary}`}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.itemCard} ${item.checked ? styles.itemCardChecked : ''}`}>
      {/* Check/uncheck circle button */}
      <button
        onClick={() => onToggle(item)}
        className={`${styles.checkCircle} ${item.checked ? styles.checkCircleChecked : ''}`}
      >
        {item.checked && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        )}
      </button>

      <div className={styles.itemContent}>
        <div className={`${styles.itemName} ${item.checked ? styles.itemNameChecked : ''}`}>
          <span>{item.name}</span>
          {(item.quantity || item.description) && (
            <span className={styles.itemMeta}>
              {item.quantity && formatQuantityTotal(item.quantity)}
              {item.quantity && item.description && ' · '}
              {item.description}
            </span>
          )}
          {/* Recipe source badges */}
          {item.recipe_sources && item.recipe_sources.length > 0 && (
            <span className={styles.recipeBadges}>
              {item.recipe_sources.map((source, idx) => {
                const sourceObj = source as { recipe_id?: number; recipe_name?: string; label_color?: string };
                const bgColor = sourceObj.label_color || (sourceObj.recipe_id ? '#e6194b' : '#666666');
                return (
                  <span
                    key={sourceObj.recipe_id ?? `adhoc-${idx}`}
                    className={styles.recipeBadge}
                    style={{
                      backgroundColor: bgColor,
                      color: getContrastTextColor(bgColor),
                    }}
                    title={sourceObj.recipe_id ? `From recipe: ${sourceObj.recipe_name}` : 'Manually added'}
                  >
                    {sourceObj.recipe_name}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </div>

      {/* Meatball menu */}
      <div className={styles.meatballMenu} ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className={styles.meatballBtn}
          title="More options"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <circle cx="5" cy="12" r="2"></circle>
            <circle cx="12" cy="12" r="2"></circle>
            <circle cx="19" cy="12" r="2"></circle>
          </svg>
        </button>
        {menuOpen && (
          <div className={styles.meatballDropdown}>
            <button
              onClick={() => {
                handleStartEdit();
                setMenuOpen(false);
              }}
              className={styles.meatballOption}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              Edit
            </button>
            <button
              onClick={() => {
                onDelete(item.id);
                setMenuOpen(false);
              }}
              className={`${styles.meatballOption} ${styles.meatballOptionDanger}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
