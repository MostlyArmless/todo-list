'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, type PantryItemWithRecipes, type List, type ReceiptScanResponse } from '@/lib/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import styles from './page.module.css';

const STATUS_ORDER = ['have', 'low', 'out'] as const;
type PantryStatus = (typeof STATUS_ORDER)[number];

const STATUS_LABELS: Record<string, string> = {
  have: 'Have',
  low: 'Low',
  out: 'Out',
};
const STATUS_COLORS: Record<string, string> = {
  have: '#22c55e', // green
  low: '#eab308', // yellow
  out: '#ef4444', // red
};

const SORT_OPTIONS = [
  { value: 'category', label: 'Category' },
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'status', label: 'Status' },
  { value: 'store', label: 'Store' },
  { value: 'recipes', label: 'Most Used in Recipes' },
  { value: 'created', label: 'Newest' },
  { value: 'updated', label: 'Recently Updated' },
] as const;
type SortOption = (typeof SORT_OPTIONS)[number]['value'];

export default function PantryPage() {
  const router = useRouter();
  const { confirm, alert } = useConfirmDialog();
  const [items, setItems] = useState<PantryItemWithRecipes[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemStore, setNewItemStore] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingScan, setPendingScan] = useState<ReceiptScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<SortOption>('category');
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState<PantryStatus>('have');
  const [editCategory, setEditCategory] = useState('');
  const [editStore, setEditStore] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const currentUser = api.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    loadData();
  }, [router]);

  const loadData = async () => {
    try {
      const [pantryData, listsData] = await Promise.all([
        api.getPantryItemsWithRecipes(),
        api.getLists(),
      ]);
      setItems(pantryData);
      setLists(listsData);
    } catch {
      // Failed to load data
    } finally {
      setLoading(false);
    }
  };

  const loadPantry = async () => {
    try {
      const data = await api.getPantryItemsWithRecipes();
      setItems(data);
    } catch {
      // Failed to load pantry
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (itemId: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    try {
      await api.createPantryItem({
        name: newItemName.trim(),
        status: 'have',
        category: newItemCategory.trim() || undefined,
        preferred_store: newItemStore || undefined,
      });
      setNewItemName('');
      setNewItemCategory('');
      setNewItemStore('');
      setShowAddForm(false);
      loadPantry();
    } catch {
      await alert({ message: 'Failed to add item. It may already exist in your pantry.' });
    }
  };

  const handleStatusChange = async (item: PantryItemWithRecipes) => {
    const currentIndex = STATUS_ORDER.indexOf(item.status);
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];

    try {
      await api.updatePantryItem(item.id, { status: nextStatus });
      loadPantry();
    } catch {
      // Failed to update status
    }
  };

  const handleDeleteItem = async (item: PantryItemWithRecipes) => {
    const confirmed = await confirm({
      title: 'Remove from Pantry',
      message: `Remove "${item.name}" from pantry?`,
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.deletePantryItem(item.id);
      loadPantry();
    } catch {
      // Failed to delete item
    }
  };

  const handleAddToShoppingList = async (item: PantryItemWithRecipes) => {
    // Find the Grocery list
    const groceryList = lists.find(l => l.name.toLowerCase() === 'grocery');
    if (!groceryList) {
      await alert({ message: 'No "Grocery" list found. Please create one first.' });
      return;
    }

    try {
      await api.createItem(groceryList.id, { name: item.name });
      await alert({
        title: 'Added to List',
        message: `Added "${item.name}" to shopping list`,
      });
    } catch {
      await alert({ message: 'Failed to add to shopping list' });
    }
  };

  const handleAddSelectedToShoppingList = async () => {
    if (selectedItems.size === 0) return;

    // Find the Grocery list
    const groceryList = lists.find(l => l.name.toLowerCase() === 'grocery');
    if (!groceryList) {
      await alert({ message: 'No "Grocery" list found. Please create one first.' });
      return;
    }

    // Get selected items data
    const itemsToAdd = items.filter(item => selectedItems.has(item.id));
    if (itemsToAdd.length === 0) return;

    try {
      // Get existing categories in the grocery list
      const existingCategories = await api.getCategories(groceryList.id);
      const categoryMap = new Map(existingCategories.map(c => [c.name.toLowerCase(), c.id]));

      // Add each item, creating categories as needed
      let addedCount = 0;
      for (const item of itemsToAdd) {
        let categoryId: number | undefined;

        // If item has a category, find or create it in the list
        if (item.category) {
          const existingCategoryId = categoryMap.get(item.category.toLowerCase());
          if (existingCategoryId) {
            categoryId = existingCategoryId;
          } else {
            // Create new category
            const newCategory = await api.createCategory(groceryList.id, { name: item.category });
            categoryMap.set(item.category.toLowerCase(), newCategory.id);
            categoryId = newCategory.id;
          }
        }

        await api.createItem(groceryList.id, {
          name: item.name,
          category_id: categoryId,
        });
        addedCount++;
      }

      // Clear selection after adding
      setSelectedItems(new Set());

      await alert({
        title: 'Added to List',
        message: `Added ${addedCount} item${addedCount !== 1 ? 's' : ''} to shopping list`,
      });
    } catch {
      await alert({ message: 'Failed to add items to shopping list' });
    }
  };

  const handleStartEdit = (item: PantryItemWithRecipes) => {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditStatus(item.status);
    setEditCategory(item.category || '');
    setEditStore(item.preferred_store || '');
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setEditName('');
    setEditStatus('have');
    setEditCategory('');
    setEditStore('');
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || editingItemId === null) return;

    setSaving(true);
    try {
      await api.updatePantryItem(editingItemId, {
        name: editName.trim(),
        status: editStatus,
        category: editCategory.trim() || undefined,
        preferred_store: editStore || undefined,
      });
      setEditingItemId(null);
      setEditName('');
      setEditStatus('have');
      setEditCategory('');
      setEditStore('');
      loadPantry();
    } catch {
      await alert({ message: 'Failed to update item. The name may already exist in your pantry.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setScanError(null);
    try {
      const result = await api.scanReceipt(file);
      // Start polling for result
      pollScanStatus(result.id);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to upload receipt');
    }
  };

  const pollScanStatus = async (scanId: number) => {
    try {
      const scan = await api.getReceiptScan(scanId);
      setPendingScan(scan);

      if (scan.status === 'pending' || scan.status === 'processing') {
        // Continue polling
        setTimeout(() => pollScanStatus(scanId), 2000);
      } else if (scan.status === 'completed') {
        // Reload pantry items
        loadPantry();
        await alert({
          title: 'Receipt Scanned',
          message: `Added ${scan.items_added || 0} new items, updated ${scan.items_updated || 0} existing items.`,
        });
        setPendingScan(null);
      } else if (scan.status === 'failed') {
        setScanError(scan.error_message || 'Failed to process receipt');
        setPendingScan(null);
      }
    } catch {
      setPendingScan(null);
    }
  };

  // Filter items by search term
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Selection handlers
  const toggleItemSelection = (itemId: number) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const selectAllItems = () => {
    setSelectedItems(new Set(filteredItems.map((item) => item.id)));
  };

  const deselectAllItems = () => {
    setSelectedItems(new Set());
  };

  const selectItemsByStatus = (status: 'low' | 'out') => {
    const itemsWithStatus = filteredItems.filter((item) => item.status === status);
    setSelectedItems(new Set(itemsWithStatus.map((item) => item.id)));
  };

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedItems.has(item.id));
  const someFilteredSelected = filteredItems.some((item) => selectedItems.has(item.id));

  // Sort items based on selected sort option
  const sortItems = (items: PantryItemWithRecipes[]): PantryItemWithRecipes[] => {
    const sorted = [...items];
    switch (sortBy) {
      case 'alphabetical':
        return sorted.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );
      case 'status':
        // Out first, then Low, then Have (urgency order)
        const statusPriority: Record<string, number> = { out: 0, low: 1, have: 2 };
        return sorted.sort((a, b) => {
          const statusDiff = statusPriority[a.status] - statusPriority[b.status];
          if (statusDiff !== 0) return statusDiff;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      case 'store':
        // Group by store alphabetically, items without a store at the end
        return sorted.sort((a, b) => {
          // Items with no store go last
          if (!a.preferred_store && b.preferred_store) return 1;
          if (a.preferred_store && !b.preferred_store) return -1;
          // Sort by store name, then by item name
          const storeCompare = (a.preferred_store || '').localeCompare(b.preferred_store || '', undefined, { sensitivity: 'base' });
          if (storeCompare !== 0) return storeCompare;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      case 'recipes':
        // Most used in recipes first (highest recipe_count first)
        return sorted.sort((a, b) => {
          const countDiff = b.recipe_count - a.recipe_count;
          if (countDiff !== 0) return countDiff;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      case 'created':
        return sorted.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      case 'updated':
        return sorted.sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      case 'category':
      default:
        // Keep original order for category grouping (sorted within groups below)
        return sorted;
    }
  };

  // For non-category sorts, use a flat list
  const useCategoryGrouping = sortBy === 'category';
  const sortedFilteredItems = sortItems(filteredItems);

  // Group items by category (only used when sortBy === 'category')
  const groupedItems = useCategoryGrouping
    ? filteredItems.reduce(
        (acc, item) => {
          const category = item.category || 'Uncategorized';
          if (!acc[category]) acc[category] = [];
          acc[category].push(item);
          return acc;
        },
        {} as Record<string, PantryItemWithRecipes[]>
      )
    : { 'All Items': sortedFilteredItems };

  // Sort categories (Uncategorized last, case-insensitive)
  const sortedCategories = useCategoryGrouping
    ? Object.keys(groupedItems).sort((a, b) => {
        if (a === 'Uncategorized') return 1;
        if (b === 'Uncategorized') return -1;
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
      })
    : ['All Items'];

  // Sort items within each category alphabetically (only for category grouping)
  if (useCategoryGrouping) {
    for (const category of sortedCategories) {
      groupedItems[category].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    }
  }

  // Get unique categories for autocomplete
  const existingCategories = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];

  if (loading) {
    return (
      <div className={`${styles.container} ${styles.loading}`}>
        <p className={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Pantry</h1>
      <p className={styles.subtitle}>
        Track what staples you have at home. Tap status to cycle: Have &rarr; Low &rarr; Out
      </p>

      {/* Search input */}
      <div className={styles.searchWrapper}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search pantry..."
          className={`${styles.searchInput} ${searchTerm ? styles.searchInputWithClear : ''}`}
        />
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          className={styles.searchIcon}
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className={styles.clearSearchBtn}
            title="Clear search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}
      </div>

      {/* Sort dropdown */}
      <div className={styles.sortRow}>
        <label htmlFor="sort-select" className={styles.sortLabel}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="4" y1="6" x2="20" y2="6"></line>
            <line x1="4" y1="12" x2="16" y2="12"></line>
            <line x1="4" y1="18" x2="12" y2="18"></line>
          </svg>
          Sort:
        </label>
        <select
          id="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className={styles.sortSelect}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Selection controls - pill buttons in a row */}
      {filteredItems.length > 0 && (() => {
        // Determine which button should show the count based on selection
        const selectedItemsList = filteredItems.filter(item => selectedItems.has(item.id));
        const selectionCount = selectedItemsList.length;
        const allSelectedAreLow = selectionCount > 0 && selectedItemsList.every(item => item.status === 'low');
        const allSelectedAreOut = selectionCount > 0 && selectedItemsList.every(item => item.status === 'out');

        return (
          <div className={styles.selectionControls}>
            <span className={styles.selectLabel}>Select:</span>
            <button
              onClick={() => {
                if (allFilteredSelected) {
                  deselectAllItems();
                } else {
                  selectAllItems();
                }
              }}
              className={`${styles.statusSelectBtn} ${styles.statusSelectBtnAll} ${selectionCount > 0 && !allSelectedAreLow && !allSelectedAreOut ? styles.statusSelectBtnActive : ''}`}
              title={allFilteredSelected ? 'Deselect all items' : 'Select all items'}
            >
              {selectionCount > 0 && !allSelectedAreLow && !allSelectedAreOut ? `All (${selectionCount})` : 'All'}
            </button>
            <button
              onClick={() => selectItemsByStatus('low')}
              className={`${styles.statusSelectBtn} ${styles.statusSelectBtnLow} ${allSelectedAreLow ? styles.statusSelectBtnActive : ''}`}
              title="Select all items with Low status"
            >
              {allSelectedAreLow ? `Low (${selectionCount})` : 'Low'}
            </button>
            <button
              onClick={() => selectItemsByStatus('out')}
              className={`${styles.statusSelectBtn} ${styles.statusSelectBtnOut} ${allSelectedAreOut ? styles.statusSelectBtnActive : ''}`}
              title="Select all items with Out status"
            >
              {allSelectedAreOut ? `Out (${selectionCount})` : 'Out'}
            </button>
            {/* Add to shopping list button - only shown when items are selected */}
            {selectionCount > 0 && (
              <button
                onClick={handleAddSelectedToShoppingList}
                className={styles.addSelectedBtn}
                title="Add selected items to shopping list"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <span>Add to List</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* Receipt Scan Section */}
      <div className={styles.receiptSection}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleReceiptUpload}
          className={styles.receiptInput}
          id="receipt-upload"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={pendingScan !== null}
          className={`${styles.receiptBtn} ${pendingScan ? styles.receiptBtnDisabled : ''}`}
        >
          {pendingScan ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.spinner}>
                <circle cx="12" cy="12" r="10" strokeDasharray="30 60" />
              </svg>
              <span>Scanning receipt...</span>
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
              <span>Scan Receipt</span>
            </>
          )}
        </button>
        {scanError && (
          <p className={styles.scanError}>{scanError}</p>
        )}
      </div>

      {/* Category sections */}
      {sortedCategories.map((category) => (
        <div key={category} className={styles.categorySection}>
          {useCategoryGrouping && category !== 'Uncategorized' && (
            <h2 className={styles.categoryTitle}>{category}</h2>
          )}
          <div className={styles.itemsList}>
            {groupedItems[category].map((item) => (
              editingItemId === item.id ? (
                /* Edit mode */
                <div key={item.id} className={styles.editCard}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Item name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className={styles.editInput}
                  />
                  <div className={styles.editRow}>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as PantryStatus)}
                      className={styles.editSelect}
                    >
                      {STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={editStore}
                      onChange={(e) => setEditStore(e.target.value)}
                      className={styles.editSelect}
                    >
                      <option value="">No Store</option>
                      {lists.map((list) => (
                        <option key={list.id} value={list.name}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      placeholder="Category (optional)"
                      list="edit-categories"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      className={styles.editCategoryInput}
                    />
                    <datalist id="edit-categories">
                      {existingCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>
                  <div className={styles.editBtns}>
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className={styles.cancelBtn}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving || !editName.trim()}
                      className={`${styles.saveBtn} ${(!editName.trim() || saving) ? styles.saveBtnDisabled : ''}`}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Display mode */
                <div key={item.id} className={styles.itemCardWrapper}>
                  <div className={styles.itemCard}>
                    <div className={styles.itemLeft}>
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.id)}
                        onChange={() => toggleItemSelection(item.id)}
                        className={styles.itemCheckbox}
                        title={selectedItems.has(item.id) ? 'Deselect item' : 'Select item'}
                      />
                      <span
                        onClick={() => handleStartEdit(item)}
                        className={styles.itemName}
                        title="Click to edit"
                      >
                        {item.name}
                      </span>
                      {/* Recipe count badge */}
                      {item.recipe_count > 0 && (
                        <button
                          onClick={() => toggleExpanded(item.id)}
                          className={`${styles.recipeCountBadge} ${expandedItems.has(item.id) ? styles.recipeCountBadgeActive : ''}`}
                          title={`Used in ${item.recipe_count} recipe${item.recipe_count !== 1 ? 's' : ''}. Click to ${expandedItems.has(item.id) ? 'hide' : 'show'}.`}
                        >
                          {item.recipe_count}
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={expandedItems.has(item.id) ? styles.chevronUp : ''}
                          >
                            <polyline points="6 9 12 15 18 9"></polyline>
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className={styles.itemActions}>
                      <select
                        value={item.preferred_store || ''}
                        onChange={async (e) => {
                          const newStore = e.target.value;
                          try {
                            await api.updatePantryItem(item.id, { preferred_store: newStore || undefined });
                            loadPantry();
                          } catch {
                            // Failed to update store
                          }
                        }}
                        className={`${styles.storeSelect} ${!item.preferred_store ? styles.storeSelectEmpty : ''}`}
                        title="Select preferred store"
                      >
                        <option value="">Store</option>
                        {lists.map((list) => (
                          <option key={list.id} value={list.name}>
                            {list.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleStatusChange(item)}
                        className={`${styles.statusBtn} ${styles[`statusBtn${item.status.charAt(0).toUpperCase() + item.status.slice(1)}` as keyof typeof styles]}`}
                        title="Click to change status"
                      >
                        {STATUS_LABELS[item.status]}
                      </button>
                      {/* Fixed width container for cart icon - prevents layout shift */}
                      <div className={styles.cartBtnWrapper}>
                        <button
                          onClick={() => handleAddToShoppingList(item)}
                          className={`${styles.cartBtn} ${item.status === 'have' ? styles.cartBtnHidden : ''}`}
                          title="Add to shopping list"
                          disabled={item.status === 'have'}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                          </svg>
                        </button>
                      </div>
                      {/* Edit button */}
                      <button
                        onClick={() => handleStartEdit(item)}
                        className={styles.iconBtn}
                        title="Edit item"
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
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteItem(item)}
                        className={styles.iconBtn}
                        title="Remove from pantry"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Expandable recipe list */}
                  {expandedItems.has(item.id) && item.recipes.length > 0 && (
                    <div className={styles.recipeList}>
                      {item.recipes.map((recipe) => (
                        <a
                          key={recipe.id}
                          href={`/recipes/${recipe.id}`}
                          className={styles.recipeChip}
                          style={{ backgroundColor: recipe.label_color || '#6b7280' }}
                        >
                          {recipe.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            ))}
          </div>
        </div>
      ))}

      {/* Empty states */}
      {items.length === 0 && (
        <div className={styles.emptyState}>
          <p>Your pantry is empty.</p>
          <p className={styles.emptySubtext}>
            Add items you always have at home (spices, oils, staples).
          </p>
        </div>
      )}

      {items.length > 0 && filteredItems.length === 0 && searchTerm && (
        <div className={styles.emptyState}>
          <p>No items match &quot;{searchTerm}&quot;</p>
          <button onClick={() => setSearchTerm('')} className={styles.clearSearchLink}>
            Clear search
          </button>
        </div>
      )}

      {/* Add item form */}
      {showAddForm ? (
        <form onSubmit={handleAddItem} className={styles.addForm}>
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Item name (e.g., Olive Oil)"
            autoFocus
            className={styles.formInput}
          />
          <input
            type="text"
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            placeholder="Category (optional, e.g., Spices)"
            list="categories"
            className={styles.formInput}
          />
          <datalist id="categories">
            {existingCategories.map((cat) => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
          <select
            value={newItemStore}
            onChange={(e) => setNewItemStore(e.target.value)}
            className={styles.formInput}
          >
            <option value="">Preferred Store (optional)</option>
            {lists.map((list) => (
              <option key={list.id} value={list.name}>
                {list.name}
              </option>
            ))}
          </select>
          <div className={styles.formBtns}>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewItemName('');
                setNewItemCategory('');
                setNewItemStore('');
              }}
              className={styles.formCancelBtn}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newItemName.trim()}
              className={`${styles.formSubmitBtn} ${!newItemName.trim() ? styles.formSubmitBtnDisabled : ''}`}
            >
              Add to Pantry
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAddForm(true)} className={styles.addItemBtn}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add Pantry Item</span>
        </button>
      )}
    </div>
  );
}
