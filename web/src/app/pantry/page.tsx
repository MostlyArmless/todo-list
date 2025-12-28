'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type PantryItem, type List } from '@/lib/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';

const STATUS_ORDER = ['have', 'low', 'out'] as const;
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

export default function PantryPage() {
  const router = useRouter();
  const { confirm, alert } = useConfirmDialog();
  const [items, setItems] = useState<PantryItem[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

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
      });
      setNewItemName('');
      setNewItemCategory('');
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

  // Filter items by search term
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group filtered items by category
  const groupedItems = filteredItems.reduce(
    (acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    },
    {} as Record<string, PantryItem[]>
  );

  // Sort categories (Uncategorized last, case-insensitive)
  const sortedCategories = Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  // Sort items within each category alphabetically (case-insensitive)
  for (const category of sortedCategories) {
    groupedItems[category].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
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

      {/* Category sections */}
      {sortedCategories.map((category) => (
        <div key={category} style={{ marginBottom: '1.5rem' }}>
          {category !== 'Uncategorized' && (
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
                <span style={{ flex: 1, marginRight: '0.5rem', fontSize: '0.9rem' }}>{item.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewItemName('');
                setNewItemCategory('');
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
