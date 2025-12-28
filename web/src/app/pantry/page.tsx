'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, type PantryItem, type List, type ReceiptScanResponse } from '@/lib/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';

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

const STORE_OPTIONS = ['Grocery', 'Costco'] as const;
type StoreOption = (typeof STORE_OPTIONS)[number];
const STORE_COLORS: Record<string, string> = {
  Grocery: '#3b82f6', // blue
  Costco: '#ef4444', // red
};

const SORT_OPTIONS = [
  { value: 'category', label: 'Category' },
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'status', label: 'Status' },
  { value: 'store', label: 'Store' },
  { value: 'created', label: 'Newest' },
  { value: 'updated', label: 'Recently Updated' },
] as const;
type SortOption = (typeof SORT_OPTIONS)[number]['value'];

export default function PantryPage() {
  const router = useRouter();
  const { confirm, alert } = useConfirmDialog();
  const [items, setItems] = useState<PantryItem[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemStore, setNewItemStore] = useState<StoreOption | ''>('');
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
  const [editStore, setEditStore] = useState<StoreOption | ''>('');
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
        api.getPantryItems(),
        api.getLists(),
      ]);
      setItems(pantryData);
      setLists(listsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPantry = async () => {
    try {
      const data = await api.getPantryItems();
      setItems(data);
    } catch (error) {
      console.error('Failed to load pantry:', error);
    } finally {
      setLoading(false);
    }
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
    } catch (error) {
      console.error('Failed to add item:', error);
      await alert({ message: 'Failed to add item. It may already exist in your pantry.' });
    }
  };

  const handleStatusChange = async (item: PantryItem) => {
    const currentIndex = STATUS_ORDER.indexOf(item.status);
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];

    try {
      await api.updatePantryItem(item.id, { status: nextStatus });
      loadPantry();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const handleDeleteItem = async (item: PantryItem) => {
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
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleAddToShoppingList = async (item: PantryItem) => {
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
    } catch (error) {
      console.error('Failed to add to shopping list:', error);
      await alert({ message: 'Failed to add to shopping list' });
    }
  };

  const handleStartEdit = (item: PantryItem) => {
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
    } catch (error) {
      console.error('Failed to update item:', error);
      await alert({ message: 'Failed to update item. The name may already exist in your pantry.' });
    } finally {
      setSaving(false);
    }
  };

  const handleStoreChange = async (item: PantryItem) => {
    const stores: (StoreOption | null)[] = [null, 'Grocery', 'Costco'];
    const currentIndex = stores.indexOf(item.preferred_store);
    const nextStore = stores[(currentIndex + 1) % stores.length];

    try {
      await api.updatePantryItem(item.id, { preferred_store: nextStore || undefined });
      loadPantry();
    } catch (error) {
      console.error('Failed to update store:', error);
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
      console.error('Failed to upload receipt:', error);
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
    } catch (error) {
      console.error('Failed to poll scan status:', error);
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
  const sortItems = (items: PantryItem[]): PantryItem[] => {
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
        // Costco first, Grocery second, no store last
        const storePriority: Record<string, number> = { Costco: 0, Grocery: 1 };
        return sorted.sort((a, b) => {
          const aPriority = a.preferred_store ? storePriority[a.preferred_store] : 2;
          const bPriority = b.preferred_store ? storePriority[b.preferred_store] : 2;
          const storeDiff = aPriority - bPriority;
          if (storeDiff !== 0) return storeDiff;
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
        {} as Record<string, PantryItem[]>
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
      <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '1rem', paddingBottom: '5rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Pantry</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
        Track what staples you have at home. Tap status to cycle: Have &rarr; Low &rarr; Out
      </p>

      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search pantry..."
          className="input"
          style={{
            paddingLeft: '2.5rem',
            paddingRight: searchTerm ? '2.5rem' : '1rem',
          }}
        />
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          style={{
            position: 'absolute',
            left: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            style={{
              position: 'absolute',
              right: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-secondary)',
              padding: '0.25rem',
            }}
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
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label
          htmlFor="sort-select"
          style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
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
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-secondary)',
            fontSize: '0.875rem',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Selection controls */}
      {filteredItems.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem',
            flexWrap: 'wrap',
          }}
        >
          {/* Select all checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el) {
                  el.indeterminate = someFilteredSelected && !allFilteredSelected;
                }
              }}
              onChange={() => {
                if (allFilteredSelected) {
                  deselectAllItems();
                } else {
                  selectAllItems();
                }
              }}
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: 'var(--accent)',
              }}
            />
            <span>
              {allFilteredSelected ? 'Deselect all' : 'Select all'}
              {selectedItems.size > 0 && ` (${selectedItems.size})`}
            </span>
          </label>

          {/* Quick-select buttons */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => selectItemsByStatus('low')}
              style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                backgroundColor: STATUS_COLORS.low + '20',
                color: STATUS_COLORS.low,
                border: `1px solid ${STATUS_COLORS.low}40`,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              title="Select all items with Low status"
            >
              Select Low
            </button>
            <button
              onClick={() => selectItemsByStatus('out')}
              style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                backgroundColor: STATUS_COLORS.out + '20',
                color: STATUS_COLORS.out,
                border: `1px solid ${STATUS_COLORS.out}40`,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              title="Select all items with Out status"
            >
              Select Out
            </button>
          </div>
        </div>
      )}

      {/* Receipt Scan Section */}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleReceiptUpload}
          style={{ display: 'none' }}
          id="receipt-upload"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={pendingScan !== null}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            width: '100%',
            padding: '0.75rem',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px dashed var(--border)',
            borderRadius: '8px',
            color: pendingScan ? 'var(--text-secondary)' : 'var(--accent)',
            cursor: pendingScan ? 'default' : 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {pendingScan ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
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
          <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.5rem' }}>
            {scanError}
          </p>
        )}
      </div>

      {/* Category sections */}
      {sortedCategories.map((category) => (
        <div key={category} style={{ marginBottom: '1.5rem' }}>
          {useCategoryGrouping && category !== 'Uncategorized' && (
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {category}
            </h2>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {groupedItems[category].map((item) => (
              editingItemId === item.id ? (
                /* Edit mode */
                <div
                  key={item.id}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    padding: '0.75rem',
                  }}
                >
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
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-secondary)',
                      fontSize: '0.9rem',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as PantryStatus)}
                      style={{
                        flex: '1 1 80px',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        fontSize: '0.875rem',
                      }}
                    >
                      {STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={editStore}
                      onChange={(e) => setEditStore(e.target.value as StoreOption | '')}
                      style={{
                        flex: '1 1 100px',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        fontSize: '0.875rem',
                        color: editStore ? STORE_COLORS[editStore] : 'var(--text-primary)',
                      }}
                    >
                      <option value="">No Store</option>
                      {STORE_OPTIONS.map((store) => (
                        <option key={store} value={store}>
                          {store}
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
                      style={{
                        flex: '1 1 150px',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        fontSize: '0.875rem',
                      }}
                    />
                    <datalist id="edit-categories">
                      {existingCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        backgroundColor: 'transparent',
                        fontSize: '0.875rem',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving || !editName.trim()}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        backgroundColor: 'var(--accent)',
                        color: 'white',
                        fontSize: '0.875rem',
                        opacity: editName.trim() && !saving ? 1 : 0.5,
                      }}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Display mode */
                <div
                  key={item.id}
                  className="card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1, marginRight: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItemSelection(item.id)}
                      style={{
                        width: '18px',
                        height: '18px',
                        marginRight: '0.75rem',
                        cursor: 'pointer',
                        accentColor: 'var(--accent)',
                        flexShrink: 0,
                      }}
                      title={selectedItems.has(item.id) ? 'Deselect item' : 'Select item'}
                    />
                    <span style={{ fontSize: '0.9rem' }}>{item.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      onClick={() => handleStoreChange(item)}
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        backgroundColor: item.preferred_store
                          ? STORE_COLORS[item.preferred_store] + '20'
                          : 'var(--bg-secondary)',
                        color: item.preferred_store
                          ? STORE_COLORS[item.preferred_store]
                          : 'var(--text-secondary)',
                        border: `1px solid ${
                          item.preferred_store
                            ? STORE_COLORS[item.preferred_store] + '40'
                            : 'var(--border)'
                        }`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        minWidth: '55px',
                        textAlign: 'center',
                      }}
                      title="Click to change preferred store"
                    >
                      {item.preferred_store || 'Store'}
                    </button>
                    <button
                      onClick={() => handleStatusChange(item)}
                      style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: STATUS_COLORS[item.status] + '20',
                        color: STATUS_COLORS[item.status],
                        border: `1px solid ${STATUS_COLORS[item.status]}40`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        minWidth: '50px',
                        textAlign: 'center',
                      }}
                      title="Click to change status"
                    >
                      {STATUS_LABELS[item.status]}
                    </button>
                    {/* Fixed width container for cart icon - prevents layout shift */}
                    <div style={{ width: '24px', display: 'flex', justifyContent: 'center' }}>
                      <button
                        onClick={() => handleAddToShoppingList(item)}
                        style={{
                          color: 'var(--accent)',
                          padding: '0.25rem',
                          opacity: 0.8,
                          visibility: item.status === 'have' ? 'hidden' : 'visible',
                        }}
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
                      style={{
                        color: 'var(--text-secondary)',
                        padding: '0.25rem',
                        opacity: 0.6,
                      }}
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
                      style={{
                        color: 'var(--text-secondary)',
                        padding: '0.25rem',
                        opacity: 0.6,
                      }}
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
              )
            ))}
          </div>
        </div>
      ))}

      {/* Empty states */}
      {items.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem',
            color: 'var(--text-secondary)',
          }}
        >
          <p>Your pantry is empty.</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Add items you always have at home (spices, oils, staples).
          </p>
        </div>
      )}

      {items.length > 0 && filteredItems.length === 0 && searchTerm && (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem',
            color: 'var(--text-secondary)',
          }}
        >
          <p>No items match &quot;{searchTerm}&quot;</p>
          <button
            onClick={() => setSearchTerm('')}
            style={{
              marginTop: '0.5rem',
              color: 'var(--accent)',
              fontSize: '0.875rem',
            }}
          >
            Clear search
          </button>
        </div>
      )}

      {/* Add item form */}
      {showAddForm ? (
        <form
          onSubmit={handleAddItem}
          className="card"
          style={{
            marginTop: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Item name (e.g., Olive Oil)"
            autoFocus
            style={{
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          />
          <input
            type="text"
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            placeholder="Category (optional, e.g., Spices)"
            list="categories"
            style={{
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          />
          <datalist id="categories">
            {existingCategories.map((cat) => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
          <select
            value={newItemStore}
            onChange={(e) => setNewItemStore(e.target.value as StoreOption | '')}
            style={{
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-secondary)',
              color: newItemStore ? STORE_COLORS[newItemStore] : 'var(--text-secondary)',
            }}
          >
            <option value="">Preferred Store (optional)</option>
            {STORE_OPTIONS.map((store) => (
              <option key={store} value={store} style={{ color: STORE_COLORS[store] }}>
                {store}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewItemName('');
                setNewItemCategory('');
                setNewItemStore('');
              }}
              style={{
                flex: 1,
                padding: '0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--border)',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newItemName.trim()}
              style={{
                flex: 1,
                padding: '0.75rem',
                borderRadius: '0.5rem',
                backgroundColor: 'var(--accent)',
                color: 'white',
                opacity: newItemName.trim() ? 1 : 0.5,
              }}
            >
              Add to Pantry
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="card"
          style={{
            marginTop: '1rem',
            width: '100%',
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
