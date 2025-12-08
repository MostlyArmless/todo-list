'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, type List, type Category, type Item } from '@/lib/api';

export default function ListDetailPage() {
  const router = useRouter();
  const params = useParams();
  const listId = parseInt(params.id as string);

  const [list, setList] = useState<List | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChecked, setShowChecked] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<number | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');

  useEffect(() => {
    if (!api.getCurrentUser()) {
      router.push('/login');
      return;
    }
    loadData();
  }, [router, listId]);

  const loadData = async () => {
    try {
      const [listData, categoriesData, itemsData] = await Promise.all([
        api.getList(listId),
        api.getCategories(listId),
        api.getItems(listId, showChecked),
      ]);
      setList(listData);
      setCategories(categoriesData.sort((a, b) => a.sort_order - b.sort_order));
      setItems(itemsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    try {
      await api.createItem(listId, {
        name: newItemName,
        category_id: newItemCategory || undefined,
      });
      setNewItemName('');
      setNewItemCategory(null);
      loadData();
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  };

  const handleToggleCheck = async (item: Item) => {
    try {
      if (item.checked) {
        await api.uncheckItem(item.id);
      } else {
        await api.checkItem(item.id);
      }
      loadData();
    } catch (error) {
      console.error('Failed to toggle item:', error);
    }
  };

  const handleDeleteItem = async (id: number) => {
    if (!confirm('Delete this item?')) return;
    try {
      await api.deleteItem(id);
      loadData();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await api.createCategory(listId, {
        name: newCategoryName,
        sort_order: categories.length,
      });
      setNewCategoryName('');
      setShowNewCategory(false);
      loadData();
    } catch (error) {
      console.error('Failed to create category:', error);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('Delete this category? Items in it will become uncategorized.')) return;
    try {
      await api.deleteCategory(id);
      loadData();
    } catch (error) {
      console.error('Failed to delete category:', error);
    }
  };

  const handleStartEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setEditCategoryName(category.name);
  };

  const handleCancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryName('');
  };

  const handleSaveEditCategory = async (id: number) => {
    if (!editCategoryName.trim()) return;
    try {
      await api.updateCategory(id, { name: editCategoryName });
      setEditingCategoryId(null);
      setEditCategoryName('');
      loadData();
    } catch (error) {
      console.error('Failed to update category:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', index.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/html'));

    if (dragIndex === dropIndex) return;

    // Reorder categories array
    const reordered = [...categories];
    const [draggedItem] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, draggedItem);

    // Update sort_order for all categories
    const updates = reordered.map((cat, idx) => ({
      ...cat,
      sort_order: idx,
    }));

    // Optimistically update UI
    setCategories(updates);

    // Save to backend
    try {
      await Promise.all(
        updates.map((cat) =>
          api.updateCategory(cat.id, { sort_order: cat.sort_order })
        )
      );
    } catch (error) {
      console.error('Failed to update category order:', error);
      loadData(); // Reload on error
    }
  };

  const getItemsByCategory = (categoryId: number | null) => {
    return items.filter((item) => item.category_id === categoryId);
  };

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>List not found</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '1rem', paddingBottom: '5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => router.push('/lists')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
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
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          Back to Lists
        </button>
        <h1 style={{ fontSize: '2rem' }}>
          {list.icon && <span style={{ marginRight: '0.5rem' }}>{list.icon}</span>}
          {list.name}
        </h1>
        {list.description && (
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {list.description}
          </p>
        )}
      </div>

      {/* Add Item Form */}
      <form onSubmit={handleAddItem} className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Add item..."
            className="input"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            style={{ flex: '1 1 200px' }}
          />
          <select
            className="input"
            value={newItemCategory || ''}
            onChange={(e) => setNewItemCategory(e.target.value ? parseInt(e.target.value) : null)}
            style={{ flex: '1 1 150px' }}
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" style={{ flex: '0 0 auto' }}>
            Add
          </button>
        </div>
      </form>

      {/* Toggle Checked Items */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showChecked}
            onChange={(e) => {
              setShowChecked(e.target.checked);
              api.getItems(listId, e.target.checked).then(setItems);
            }}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Show checked items
          </span>
        </label>
      </div>

      {/* Uncategorized Items */}
      {getItemsByCategory(null).length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2
            style={{
              fontSize: '1.125rem',
              marginBottom: '0.75rem',
              color: 'var(--text-secondary)',
            }}
          >
            Uncategorized
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {getItemsByCategory(null).map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={handleToggleCheck}
                onDelete={handleDeleteItem}
              />
            ))}
          </div>
        </div>
      )}

      {/* Categorized Items */}
      {categories.map((category, index) => {
        const categoryItems = getItemsByCategory(category.id);

        return (
          <div
            key={category.id}
            style={{ marginBottom: '2rem' }}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              {/* Drag handle */}
              <div
                style={{
                  cursor: 'grab',
                  color: 'var(--text-secondary)',
                  padding: '0.25rem',
                  flexShrink: 0,
                }}
                title="Drag to reorder"
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
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              </div>

              {/* Category name or edit input */}
              {editingCategoryId === category.id ? (
                <>
                  <input
                    type="text"
                    className="input"
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEditCategory(category.id);
                      if (e.key === 'Escape') handleCancelEditCategory();
                    }}
                    autoFocus
                    style={{ flex: 1, marginRight: '0.5rem' }}
                  />
                  <button
                    onClick={() => handleSaveEditCategory(category.id)}
                    className="btn btn-primary"
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancelEditCategory}
                    className="btn btn-secondary"
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', marginLeft: '0.5rem' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <h2
                    style={{
                      fontSize: '1.125rem',
                      flex: 1,
                      color: category.color || 'var(--text-primary)',
                      margin: 0,
                    }}
                  >
                    {category.name}
                  </h2>

                  {/* Edit button */}
                  <button
                    onClick={() => handleStartEditCategory(category)}
                    style={{
                      color: 'var(--text-secondary)',
                      padding: '0.5rem',
                      flexShrink: 0,
                    }}
                    title="Edit category name"
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
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteCategory(category.id)}
                    style={{
                      color: 'var(--text-secondary)',
                      padding: '0.5rem',
                      flexShrink: 0,
                    }}
                    title="Delete category"
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
                </>
              )}
            </div>

            {categoryItems.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {categoryItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={handleToggleCheck}
                    onDelete={handleDeleteItem}
                  />
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontStyle: 'italic' }}>
                No items in this category yet
              </p>
            )}
          </div>
        );
      })}

      {/* Empty State */}
      {items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
          <p>No items yet. Add your first item above!</p>
        </div>
      )}

      {/* Add Category */}
      <div style={{ marginTop: '2rem' }}>
        {showNewCategory ? (
          <form onSubmit={handleAddCategory} className="card">
            <input
              type="text"
              placeholder="Category name"
              className="input"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              autoFocus
              style={{ marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                Add Category
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewCategory(false);
                  setNewCategoryName('');
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
            onClick={() => setShowNewCategory(true)}
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
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
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Category
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
}: {
  item: Item;
  onToggle: (item: Item) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        opacity: item.checked ? 0.5 : 1,
      }}
    >
      <button
        onClick={() => onToggle(item)}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          border: '2px solid var(--accent)',
          background: item.checked ? 'var(--accent)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {item.checked && (
          <svg
            width="16"
            height="16"
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

      <div style={{ flex: 1 }}>
        <div
          style={{
            textDecoration: item.checked ? 'line-through' : 'none',
            marginBottom: item.quantity || item.description ? '0.25rem' : 0,
          }}
        >
          {item.name}
        </div>
        {(item.quantity || item.description) && (
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {item.quantity && <span>{item.quantity}</span>}
            {item.quantity && item.description && <span> • </span>}
            {item.description && <span>{item.description}</span>}
          </div>
        )}
      </div>

      <button
        onClick={() => onDelete(item.id)}
        style={{
          color: 'var(--text-secondary)',
          padding: '0.5rem',
          flexShrink: 0,
        }}
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
    </div>
  );
}
