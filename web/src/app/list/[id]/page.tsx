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
import { useListSync } from '@/hooks/useListSync';
import IconButton from '@/components/IconButton';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
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

// Field length limits (must match backend schemas)
const NAME_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 2000;

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
  // Track active drag item for DragOverlay
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  // Track if component is mounted (for hydration safety)
  const [mounted, setMounted] = useState(false);

  // Auth check and hydration safety
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional for hydration safety */
    setMounted(true);
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
      // Poll every 2s when items are being refined by AI
      refetchInterval: (query) => {
        const data = query.state.data;
        const hasPending = data?.some(item => item.refinement_status === 'pending');
        return hasPending ? 2000 : false;
      },
    },
  });

  const { data: pantryItems = [] } = useListPantryItemsApiV1PantryGet({
    query: {
      enabled: !!getCurrentUser(),
    },
  });

  // Real-time sync via WebSocket
  useListSync({
    listId,
    includeChecked: showChecked,
    enabled: !!listId && !!getCurrentUser(),
  });

  // Sync server categories to local state for optimistic updates
  const categories = localCategories ?? [...categoriesData].sort((a, b) => a.sort_order - b.sort_order);
  /* eslint-disable react-hooks/set-state-in-effect -- Resetting optimistic state when server data changes */
  useEffect(() => {
    setLocalCategories(null);
  }, [categoriesData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loading = !mounted || listLoading;

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
    description?: string | null;
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

  const handleUpdateItem = async (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null; sort_order?: number }) => {
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

  // dnd-kit sensors for pointer, touch, and keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // Delay for touch to distinguish from scroll
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Helper functions to parse drag IDs
  const parseId = (id: UniqueIdentifier): { type: 'category' | 'item' | 'drop-zone'; numId: number | null } => {
    const strId = String(id);
    if (strId.startsWith('cat-')) {
      return { type: 'category', numId: parseInt(strId.replace('cat-', ''), 10) };
    }
    if (strId.startsWith('item-')) {
      return { type: 'item', numId: parseInt(strId.replace('item-', ''), 10) };
    }
    if (strId.startsWith('drop-')) {
      // drop-null for uncategorized, drop-{id} for categories
      const rest = strId.replace('drop-', '');
      return { type: 'drop-zone', numId: rest === 'null' ? null : parseInt(rest, 10) };
    }
    // Legacy: try as raw number (for categories)
    return { type: 'category', numId: parseInt(strId, 10) };
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const activeInfo = parseId(active.id);
    const overInfo = parseId(over.id);

    // Handle category reordering (legacy: categories still use raw numeric IDs)
    if (activeInfo.type === 'category' && overInfo.type === 'category') {
      const oldIndex = categories.findIndex((cat) => cat.id === activeInfo.numId);
      const newIndex = categories.findIndex((cat) => cat.id === overInfo.numId);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(categories, oldIndex, newIndex);
      const updates = reordered.map((cat, idx) => ({
        ...cat,
        sort_order: idx,
      }));

      setLocalCategories(updates);

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
        invalidateListData();
      }
      return;
    }

    // Handle item drag
    if (activeInfo.type === 'item' && activeInfo.numId !== null) {
      const draggedItemId = activeInfo.numId;
      const draggedItem = items.find((i) => i.id === draggedItemId);
      if (!draggedItem) return;

      let targetCategoryId: number | null = draggedItem.category_id ?? null;

      // Determine target category first
      if (overInfo.type === 'item' && overInfo.numId !== null) {
        const overItem = items.find((i) => i.id === overInfo.numId);
        if (!overItem) return;
        targetCategoryId = overItem.category_id ?? null;
      } else if (overInfo.type === 'drop-zone') {
        targetCategoryId = overInfo.numId;
      }

      // Get all items in the target category, EXCLUDING the dragged item, sorted by sort_order
      const categoryItems = items
        .filter((i) => (i.category_id ?? null) === targetCategoryId && i.id !== draggedItemId)
        .sort((a, b) => a.sort_order - b.sort_order);

      // Now find the target index in the filtered/sorted list
      let targetIndex: number | null = null;
      if (overInfo.type === 'item' && overInfo.numId !== null) {
        targetIndex = categoryItems.findIndex((i) => i.id === overInfo.numId);
        if (targetIndex === -1) targetIndex = null; // Item not found (shouldn't happen)
      }

      // Calculate new sort_order
      let newSortOrder: number;
      if (targetIndex === null || categoryItems.length === 0) {
        // Place at end (or empty category)
        newSortOrder = categoryItems.length > 0
          ? categoryItems[categoryItems.length - 1].sort_order + 1000
          : 0;
      } else if (targetIndex === 0) {
        // Place at beginning (before the first item)
        newSortOrder = categoryItems[0].sort_order - 1000;
      } else {
        // Place between items - insert BEFORE the target item
        const prevItem = categoryItems[targetIndex - 1];
        const nextItem = categoryItems[targetIndex];
        newSortOrder = Math.floor((prevItem.sort_order + nextItem.sort_order) / 2);
        // If there's no room between sort_orders, shift to make room
        if (newSortOrder <= prevItem.sort_order || newSortOrder >= nextItem.sort_order) {
          newSortOrder = prevItem.sort_order + 1;
        }
      }

      // Only update if something changed
      const categoryChanged = (draggedItem.category_id ?? null) !== targetCategoryId;
      if (!categoryChanged && draggedItem.sort_order === newSortOrder) {
        return;
      }

      // Update the item
      try {
        await handleUpdateItem(draggedItemId, {
          category_id: targetCategoryId,
          sort_order: newSortOrder,
        });
      } catch {
        invalidateListData();
      }
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
            maxLength={NAME_MAX_LENGTH}
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

      {/* Grocery List: Items and Categories with dnd-kit */}
      {list.list_type === 'grocery' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Uncategorized Items */}
          {getItemsByCategory(null).length > 0 && (
            <DroppableZone id="drop-null" className={styles.categorySection}>
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
                <SortableContext
                  items={getItemsByCategory(null).map((item) => `item-${item.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {getItemsByCategory(null).map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      onToggle={handleToggleCheck}
                      onDelete={handleDeleteItem}
                      onUpdate={handleUpdateItem}
                      categories={categories}
                    />
                  ))}
                </SortableContext>
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
                      maxLength={NAME_MAX_LENGTH}
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
            </DroppableZone>
          )}

          {/* Categorized Items */}
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

          {/* Drag Overlay for visual feedback */}
          <DragOverlay>
            {activeId && String(activeId).startsWith('item-') ? (
              <div className={styles.itemCard} style={{ opacity: 0.8, boxShadow: 'var(--shadow-lg)' }}>
                <div className={styles.itemDragHandle} style={{ cursor: 'grabbing' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                </div>
                <div className={styles.itemContent}>
                  <div className={styles.itemName}>
                    <span>
                      {items.find((i) => `item-${i.id}` === activeId)?.name || 'Item'}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
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

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: `drop-${category.id}` });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDroppableRef(node);
      }}
      className={`${styles.sortableCategory} ${styles.categoryDropZone} ${isOver ? styles.categoryDropZoneActive : ''}`}
      style={dragStyle}
    >
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
        <SortableContext
          items={items.map((item) => `item-${item.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onToggle={onToggleItemCheck}
              onDelete={onDeleteItem}
              onUpdate={onUpdateItem}
              categories={allCategories}
            />
          ))}
        </SortableContext>
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
              maxLength={NAME_MAX_LENGTH}
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
  const cardRef = useRef<HTMLDivElement>(null);

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
    // Auto-scroll to item on mobile when editing starts
    if (window.innerWidth <= 640) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
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
      <div ref={cardRef} className={styles.itemEditCard}>
        <div className={styles.inputWithCounter}>
          <input
            type="text"
            className={styles.itemEditInput}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Item name"
            autoFocus
            maxLength={NAME_MAX_LENGTH}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
          <span className={`${styles.charCounter} ${editName.length >= NAME_MAX_LENGTH - 50 ? styles.charCounterWarning : ''} ${editName.length >= NAME_MAX_LENGTH ? styles.charCounterLimit : ''}`}>
            {editName.length}/{NAME_MAX_LENGTH}
          </span>
        </div>
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
          <div className={styles.inputWithCounter}>
            <textarea
              className={`${styles.itemEditInput} ${styles.itemEditDesc}`}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (notes, details...)"
              maxLength={DESCRIPTION_MAX_LENGTH}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCancelEdit();
              }}
            />
            <span className={`${styles.charCounter} ${editDescription.length >= DESCRIPTION_MAX_LENGTH - 100 ? styles.charCounterWarning : ''} ${editDescription.length >= DESCRIPTION_MAX_LENGTH ? styles.charCounterLimit : ''}`}>
              {editDescription.length}/{DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
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
      {/* AI refinement spinner */}
      {item.refinement_status === 'pending' && (
        <div className={styles.refinementSpinner} title="Refining with AI...">
          <div className={styles.refinementSpinnerIcon} />
        </div>
      )}

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

function SortableItem({
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `item-${item.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? styles.itemDragging : undefined}
    >
      <ItemRowWithDragHandle
        item={item}
        onToggle={onToggle}
        onDelete={onDelete}
        onUpdate={onUpdate}
        categories={categories}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

function ItemRowWithDragHandle({
  item,
  onToggle,
  onDelete,
  onUpdate,
  categories,
  dragHandleProps,
  isDragging,
}: {
  item: ItemResponse;
  onToggle: (item: ItemResponse) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => Promise<void>;
  categories: CategoryResponse[];
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const [editQuantity, setEditQuantity] = useState(item.quantity || '');
  const [editDescription, setEditDescription] = useState(item.description || '');
  const [editCategoryId, setEditCategoryId] = useState<number | null>(item.category_id ?? null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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
    // Auto-scroll to item on mobile when editing starts
    if (window.innerWidth <= 640) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
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
      <div ref={cardRef} className={styles.itemEditCard}>
        <div className={styles.inputWithCounter}>
          <input
            type="text"
            className={styles.itemEditInput}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Item name"
            autoFocus
            maxLength={NAME_MAX_LENGTH}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
          <span className={`${styles.charCounter} ${editName.length >= NAME_MAX_LENGTH - 50 ? styles.charCounterWarning : ''} ${editName.length >= NAME_MAX_LENGTH ? styles.charCounterLimit : ''}`}>
            {editName.length}/{NAME_MAX_LENGTH}
          </span>
        </div>
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
          <div className={styles.inputWithCounter}>
            <textarea
              className={`${styles.itemEditInput} ${styles.itemEditDesc}`}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (notes, details...)"
              maxLength={DESCRIPTION_MAX_LENGTH}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCancelEdit();
              }}
            />
            <span className={`${styles.charCounter} ${editDescription.length >= DESCRIPTION_MAX_LENGTH - 100 ? styles.charCounterWarning : ''} ${editDescription.length >= DESCRIPTION_MAX_LENGTH ? styles.charCounterLimit : ''}`}>
              {editDescription.length}/{DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
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
      {/* Drag handle */}
      {dragHandleProps && (
        <div
          {...dragHandleProps}
          className={styles.itemDragHandle}
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
      )}

      {/* AI refinement spinner */}
      {item.refinement_status === 'pending' && (
        <div className={styles.refinementSpinner} title="Refining with AI...">
          <div className={styles.refinementSpinnerIcon} />
        </div>
      )}

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

function DroppableZone({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} ${styles.categoryDropZone} ${isOver ? styles.categoryDropZoneActive : ''}`}
    >
      {children}
    </div>
  );
}
