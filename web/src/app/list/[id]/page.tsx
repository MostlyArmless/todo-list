'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, type List, type Category, type Item, type PantryItem } from '@/lib/api';
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

export default function ListDetailPage() {
  const router = useRouter();
  const params = useParams();
  const listId = parseInt(params.id as string);
  const { confirm, alert } = useConfirmDialog();

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
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [autoCategorizing, setAutoCategorizing] = useState(false);
  const [recentlyChecked, setRecentlyChecked] = useState<string[]>([]);
  const [showPantryPrompt, setShowPantryPrompt] = useState(false);
  const [existingPantryItems, setExistingPantryItems] = useState<PantryItem[]>([]);
  const [addingToPantry, setAddingToPantry] = useState(false);
  const [addedItemMessage, setAddedItemMessage] = useState<string | null>(null);

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
      // Check if item with same name already exists (for merge detection)
      const existingItem = items.find(
        i => i.name.toLowerCase().trim() === newItemName.toLowerCase().trim() && !i.checked
      );

      const createdItem = await api.createItem(listId, {
        name: newItemName,
        category_id: newItemCategory || undefined,
      });
      setNewItemName('');
      setNewItemCategory(null);

      // Show ghost message indicating what happened
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

      loadData();
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  };

  const handleToggleCheck = async (item: Item) => {
    try {
      if (item.checked) {
        await api.uncheckItem(item.id);
        // Remove from recently checked if unchecking
        setRecentlyChecked((prev) => prev.filter((name) => name !== item.name));
      } else {
        await api.checkItem(item.id);
        // Track the checked item name for pantry prompt
        setRecentlyChecked((prev) => {
          // Avoid duplicates
          if (prev.includes(item.name)) return prev;
          const updated = [...prev, item.name];
          // Show prompt after 2+ items checked
          if (updated.length >= 2 && !showPantryPrompt) {
            // Load pantry items to check for existing
            loadPantryForPrompt();
          }
          return updated;
        });
      }
      loadData();
    } catch (error) {
      console.error('Failed to toggle item:', error);
    }
  };

  const loadPantryForPrompt = async () => {
    try {
      const pantryItems = await api.getPantryItems();
      setExistingPantryItems(pantryItems);
      setShowPantryPrompt(true);
    } catch (error) {
      console.error('Failed to load pantry:', error);
    }
  };

  const handleAddToPantry = async () => {
    setAddingToPantry(true);
    try {
      // Filter out items that are already in pantry
      const existingNames = new Set(existingPantryItems.map((p) => p.normalized_name));
      const newItems = recentlyChecked.filter(
        (name) => !existingNames.has(name.toLowerCase().trim())
      );

      if (newItems.length > 0) {
        await api.bulkAddPantryItems(newItems.map((name) => ({ name, status: 'have' })));
      }

      // Clear and close
      setRecentlyChecked([]);
      setShowPantryPrompt(false);
    } catch (error) {
      console.error('Failed to add to pantry:', error);
    } finally {
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
    try {
      await api.deleteItem(id);
      loadData();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleUpdateItem = async (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => {
    try {
      await api.updateItem(id, data);
      loadData();
    } catch (error) {
      console.error('Failed to update item:', error);
      throw error;
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
    const confirmed = await confirm({
      title: 'Delete Category',
      message: 'Delete this category? Items in it will become uncategorized.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
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

    try {
      await api.bulkDeleteItems(listId, Array.from(selectedItems));
      setSelectedItems(new Set());
      loadData();
    } catch (error) {
      console.error('Failed to bulk delete:', error);
    }
  };

  const handleAutoCategorize = async () => {
    setAutoCategorizing(true);
    try {
      const result = await api.autoCategorizeItems(listId);
      if (result.categorized > 0) {
        await alert({
          title: 'Auto-Categorize Complete',
          message: `Categorized ${result.categorized} item${result.categorized > 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} could not be categorized)` : ''}`,
        });
        loadData();
      } else if (result.failed > 0) {
        await alert({
          title: 'Auto-Categorize',
          message: `Could not categorize any items. ${result.failed} item${result.failed > 1 ? 's' : ''} remain uncategorized.`,
        });
      }
    } catch (error) {
      console.error('Failed to auto-categorize:', error);
      await alert({
        title: 'Error',
        message: 'Failed to auto-categorize items. Please try again.',
      });
    } finally {
      setAutoCategorizing(false);
    }
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
          {addedItemMessage && (
            <span
              style={{
                color: 'var(--success)',
                fontSize: '0.875rem',
                opacity: 1,
                animation: 'fadeOut 3s ease-out forwards',
                whiteSpace: 'nowrap',
              }}
            >
              {addedItemMessage}
            </span>
          )}
        </div>
      </form>

      <style jsx>{`
        @keyframes fadeOut {
          0% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Toggle Checked Items & Bulk Actions */}
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
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

        {selectedItems.size > 0 && (
          <button
            onClick={handleBulkDelete}
            className="btn"
            style={{
              background: '#ef4444',
              color: 'white',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Uncategorized Items */}
      {getItemsByCategory(null).length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <input
              type="checkbox"
              checked={isCategoryFullySelected(null)}
              ref={(el) => {
                if (el) el.indeterminate = isCategoryPartiallySelected(null);
              }}
              onChange={() => toggleCategorySelection(null)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              title="Select all uncategorized items"
            />
            <h2
              style={{
                fontSize: '1.125rem',
                color: 'var(--text-secondary)',
                margin: 0,
                flex: 1,
              }}
            >
              Uncategorized
            </h2>
            {categories.length > 0 && (
              <button
                onClick={handleAutoCategorize}
                disabled={autoCategorizing}
                className="btn btn-secondary"
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
                title="Auto-categorize items using AI"
              >
                {autoCategorizing ? (
                  <>
                    <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                    Categorizing...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                    </svg>
                    Auto-categorize
                  </>
                )}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {getItemsByCategory(null).map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={handleToggleCheck}
                onDelete={handleDeleteItem}
                onUpdate={handleUpdateItem}
                selected={selectedItems.has(item.id)}
                onSelect={() => toggleItemSelection(item.id)}
                categories={categories}
              />
            ))}
          </div>
        </div>
      )}

      {/* Categorized Items with dnd-kit */}
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
              selectedItems={selectedItems}
              onToggleItemSelection={toggleItemSelection}
              onToggleItemCheck={handleToggleCheck}
              onDeleteItem={handleDeleteItem}
              onUpdateItem={handleUpdateItem}
              allCategories={categories}
            />
          ))}
        </SortableContext>
      </DndContext>

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

      {/* Post-Shopping Pantry Prompt */}
      {showPantryPrompt && recentlyChecked.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '1rem',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            zIndex: 1000,
            maxWidth: '400px',
            width: 'calc(100% - 2rem)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <div>
              <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Add to pantry?</p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
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
          <div
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
              marginBottom: '0.75rem',
              maxHeight: '100px',
              overflowY: 'auto',
            }}
          >
            {recentlyChecked.slice(0, 5).join(', ')}
            {recentlyChecked.length > 5 && ` and ${recentlyChecked.length - 5} more`}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={dismissPantryPrompt}
              disabled={addingToPantry}
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
              }}
            >
              Skip
            </button>
            <button
              onClick={handleAddToPantry}
              disabled={addingToPantry}
              className="btn btn-primary"
              style={{
                flex: 1,
                padding: '0.5rem',
              }}
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
  selectedItems,
  onToggleItemSelection,
  onToggleItemCheck,
  onDeleteItem,
  onUpdateItem,
  allCategories,
}: {
  category: Category;
  items: Item[];
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
  selectedItems: Set<number>;
  onToggleItemSelection: (id: number) => void;
  onToggleItemCheck: (item: Item) => void;
  onDeleteItem: (id: number) => void;
  onUpdateItem: (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => Promise<void>;
  allCategories: Category[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginBottom: '2rem',
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {/* Category selection checkbox */}
        {items.length > 0 && (
          <input
            type="checkbox"
            checked={isFullySelected}
            ref={(el) => {
              if (el) el.indeterminate = isPartiallySelected;
            }}
            onChange={onToggleCategorySelection}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            title={`Select all items in ${category.name}`}
          />
        )}

        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            color: 'var(--text-secondary)',
            padding: '0.25rem',
            flexShrink: 0,
            touchAction: 'none',
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
        {isEditing ? (
          <>
            <input
              type="text"
              className="input"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
              style={{ flex: 1, marginRight: '0.5rem' }}
            />
            <button
              onClick={onSaveEdit}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              Save
            </button>
            <button
              onClick={onCancelEdit}
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
              onClick={onStartEdit}
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
              onClick={onDelete}
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

      {items.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onToggle={onToggleItemCheck}
              onDelete={onDeleteItem}
              onUpdate={onUpdateItem}
              selected={selectedItems.has(item.id)}
              onSelect={() => onToggleItemSelection(item.id)}
              categories={allCategories}
            />
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontStyle: 'italic', marginLeft: '26px' }}>
          No items in this category yet
        </p>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onDelete,
  onUpdate,
  selected,
  onSelect,
  categories,
}: {
  item: Item;
  onToggle: (item: Item) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, data: { name?: string; quantity?: string; description?: string; category_id?: number | null }) => Promise<void>;
  selected: boolean;
  onSelect: () => void;
  categories: Category[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const [editQuantity, setEditQuantity] = useState(item.quantity || '');
  const [editDescription, setEditDescription] = useState(item.description || '');
  const [editCategoryId, setEditCategoryId] = useState<number | null>(item.category_id);
  const [saving, setSaving] = useState(false);

  const handleStartEdit = () => {
    setEditName(item.name);
    setEditQuantity(item.quantity || '');
    setEditDescription(item.description || '');
    setEditCategoryId(item.category_id);
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
        quantity: editQuantity.trim() || undefined,
        description: editDescription.trim() || undefined,
        category_id: editCategoryId,
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update item:', error);
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <input
          type="text"
          className="input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Item name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveEdit();
            if (e.key === 'Escape') handleCancelEdit();
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input"
            value={editQuantity}
            onChange={(e) => setEditQuantity(e.target.value)}
            placeholder="Quantity (e.g., 2 lbs)"
            style={{ flex: '1 1 120px' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
          <input
            type="text"
            className="input"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
            style={{ flex: '1 1 150px' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
          />
        </div>
        <select
          className="input"
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleSaveEdit}
            disabled={saving || !editName.trim()}
            className="btn btn-primary"
            style={{ flex: 1 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={saving}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        opacity: item.checked ? 0.5 : 1,
        background: selected ? 'var(--bg-hover, rgba(59, 130, 246, 0.1))' : undefined,
      }}
    >
      {/* Selection checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        style={{ width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
        title="Select item"
      />

      {/* Check/uncheck circle button */}
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

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            textDecoration: item.checked ? 'line-through' : 'none',
            marginBottom: item.quantity || item.description || item.recipe_sources?.length ? '0.25rem' : 0,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <span>{item.name}</span>
          {/* Recipe source badges */}
          {item.recipe_sources && item.recipe_sources.length > 0 && (
            <span style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {item.recipe_sources.map((source, idx) => (
                <span
                  key={source.recipe_id ?? `adhoc-${idx}`}
                  style={{
                    fontSize: '0.65rem',
                    backgroundColor: source.label_color || (source.recipe_id ? '#e6194b' : 'var(--text-secondary)'),
                    color: 'white',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '3px',
                    whiteSpace: 'nowrap',
                  }}
                  title={source.recipe_id ? `From recipe: ${source.recipe_name}` : 'Manually added'}
                >
                  {source.recipe_name}
                </span>
              ))}
            </span>
          )}
        </div>
        {(item.quantity || item.description) && (
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {item.quantity && <span>{formatQuantityTotal(item.quantity)}</span>}
            {item.quantity && item.description && <span> - </span>}
            {item.description && <span>{item.description}</span>}
          </div>
        )}
      </div>

      {/* Edit button */}
      <button
        onClick={handleStartEdit}
        style={{
          color: 'var(--text-secondary)',
          padding: '0.5rem',
          flexShrink: 0,
        }}
        title="Edit item"
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

      <button
        onClick={() => onDelete(item.id)}
        style={{
          color: 'var(--text-secondary)',
          padding: '0.5rem',
          flexShrink: 0,
        }}
        title="Delete item"
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
