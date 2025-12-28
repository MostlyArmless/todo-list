'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, type Recipe, type RecipeIngredient, type AddToListResult, type CheckPantryIngredient } from '@/lib/api';
import {
  useIngredientKeyboard,
  ingredientStyles,
} from '@/hooks/useIngredientKeyboard';
import PantryCheckModal from '@/components/PantryCheckModal';
import IconButton from '@/components/IconButton';
import { useConfirmDialog } from '@/components/ConfirmDialog';

interface Toast {
  message: string;
  eventId: number | null;
  type: 'success' | 'error';
}

interface PantryCheckState {
  isOpen: boolean;
  ingredients: CheckPantryIngredient[];
}

export default function RecipeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const recipeId = parseInt(params.id as string, 10);
  const { confirm } = useConfirmDialog();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [checkingPantry, setCheckingPantry] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pantryCheck, setPantryCheck] = useState<PantryCheckState>({ isOpen: false, ingredients: [] });

  // Inline editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStore, setEditStore] = useState('');

  // New ingredient state
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newStore, setNewStore] = useState('');
  const [showNewRow, setShowNewRow] = useState(false);

  const newNameRef = useRef<HTMLInputElement>(null);

  const openNewRow = useCallback(() => {
    setShowNewRow(true);
    setTimeout(() => newNameRef.current?.focus(), 0);
  }, []);

  const { isMac } = useIngredientKeyboard(openNewRow);

  useEffect(() => {
    if (!api.getCurrentUser()) {
      router.push('/login');
      return;
    }
    loadRecipe();
  }, [router, recipeId]);

  const loadRecipe = async () => {
    try {
      setRecipe(await api.getRecipe(recipeId));
    } catch {
      router.push('/recipes');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToList = async () => {
    if (!recipe) return;
    setCheckingPantry(true);
    try {
      // First check pantry
      const result = await api.checkRecipePantry(recipe.id);
      setPantryCheck({ isOpen: true, ingredients: result.ingredients });
    } catch {
      // If pantry check fails, fall back to direct add
      await directAddToList([]);
    } finally {
      setCheckingPantry(false);
    }
  };

  const directAddToList = async (overrides: { name: string; add_to_list: boolean }[]) => {
    if (!recipe) return;
    setAdding(true);
    try {
      const result: AddToListResult = await api.addRecipesToListWithOverrides([recipe.id], overrides);
      const total = result.grocery_items_added + result.costco_items_added + result.items_merged;
      let msg = `Added ${total} item${total !== 1 ? 's' : ''} to shopping list`;
      if (result.items_merged > 0) msg += ` (${result.items_merged} merged)`;
      if (result.items_skipped > 0) msg += ` (${result.items_skipped} skipped)`;
      setToast({ message: msg, eventId: result.event_id, type: 'success' });
      setPantryCheck({ isOpen: false, ingredients: [] });
    } catch {
      setToast({ message: 'Failed to add to list', eventId: null, type: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const handleUndo = async () => {
    if (!toast?.eventId) return;
    try {
      await api.undoAddToList(toast.eventId);
      setToast({ message: 'Undone! Items removed.', eventId: null, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ message: 'Failed to undo', eventId: null, type: 'error' });
    }
  };

  const startEdit = (ing: RecipeIngredient) => {
    setEditingId(ing.id);
    setEditName(ing.name);
    setEditQty(ing.quantity || '');
    setEditNotes(ing.description || '');
    setEditStore(ing.store_preference || '');
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await api.updateIngredient(editingId, {
        name: editName.trim(),
        quantity: editQty.trim() || undefined,
        description: editNotes.trim() || undefined,
        store_preference: editStore || undefined,
      });
      setEditingId(null);
      loadRecipe();
    } catch (e) {
      console.error('Failed to update:', e);
    }
  };

  const deleteIngredient = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Ingredient',
      message: 'Are you sure you want to delete this ingredient?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.deleteIngredient(id);
      loadRecipe();
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  };

  const addIngredient = async () => {
    if (!newName.trim()) return;
    try {
      await api.addIngredient(recipeId, {
        name: newName.trim(),
        quantity: newQty.trim() || undefined,
        description: newNotes.trim() || undefined,
        store_preference: newStore || undefined,
      });
      setNewName('');
      setNewQty('');
      setNewNotes('');
      setNewStore('');
      setShowNewRow(false);
      loadRecipe();
    } catch (e) {
      console.error('Failed to add:', e);
    }
  };

  const handleNewRowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addIngredientAndContinue();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowNewRow(false);
      setNewName('');
      setNewQty('');
      setNewNotes('');
      setNewStore('');
    }
  };

  const addIngredientAndContinue = async () => {
    if (!newName.trim()) return;
    try {
      await api.addIngredient(recipeId, {
        name: newName.trim(),
        quantity: newQty.trim() || undefined,
        description: newNotes.trim() || undefined,
        store_preference: newStore || undefined,
      });
      // Clear fields but keep the row open for next ingredient
      setNewName('');
      setNewQty('');
      setNewNotes('');
      setNewStore('');
      loadRecipe();
      // Re-focus the name field
      setTimeout(() => newNameRef.current?.focus(), 0);
    } catch (e) {
      console.error('Failed to add:', e);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  if (!recipe) return null;

  return (
    <div className="container" style={{ paddingTop: '1rem', paddingBottom: '5rem' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: toast.type === 'success' ? 'var(--accent)' : '#ef4444',
            color: 'white',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            fontSize: '0.875rem',
          }}
        >
          <span>{toast.message}</span>
          {toast.eventId && (
            <button
              onClick={handleUndo}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'white', padding: '0.25rem', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem' }}>{recipe.name}</h1>
          {(recipe.description || recipe.servings) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {recipe.description}{recipe.description && recipe.servings ? ' · ' : ''}{recipe.servings ? `${recipe.servings} servings` : ''}
            </p>
          )}
        </div>
        <button onClick={() => router.push('/recipes')} className="btn btn-secondary" style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
          Back
        </button>
      </div>

      {/* Pantry Check Modal */}
      {pantryCheck.isOpen && recipe && (
        <PantryCheckModal
          recipeName={recipe.name}
          ingredients={pantryCheck.ingredients}
          onConfirm={directAddToList}
          onCancel={() => setPantryCheck({ isOpen: false, ingredients: [] })}
          isSubmitting={adding}
        />
      )}

      {/* Add to List Button */}
      <button
        onClick={handleAddToList}
        disabled={adding || checkingPantry || recipe.ingredients.length === 0}
        className="btn btn-primary"
        style={{
          width: '100%',
          marginBottom: '0.75rem',
          padding: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        {checkingPantry ? 'Checking pantry...' : adding ? 'Adding...' : 'Add to Shopping List'}
      </button>

      {/* Ingredients */}
      <div className="card" style={{ padding: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Ingredients ({recipe.ingredients.length})</h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isMac ? '⌥A' : 'Alt+A'} to add</span>
        </div>

        {recipe.ingredients.length > 0 && (
          <div style={ingredientStyles.header}>
            <span style={{ flex: 2 }}>Name</span>
            <span style={{ flex: 1 }}>Quantity</span>
            <span style={{ flex: 1.5 }}>Notes</span>
            <span style={{ width: '70px' }}>Store</span>
            <span style={{ width: '48px' }}></span>
          </div>
        )}

        {recipe.ingredients.map((ing) =>
          editingId === ing.id ? (
            <div key={ing.id} style={ingredientStyles.row}>
              <input
                type="text"
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                style={ingredientStyles.nameInput}
                autoFocus
              />
              <input
                type="text"
                className="input"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                style={ingredientStyles.qtyInput}
              />
              <input
                type="text"
                className="input"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                maxLength={200}
                style={ingredientStyles.notesInput}
              />
              <select className="input" value={editStore} onChange={(e) => setEditStore(e.target.value)} style={ingredientStyles.storeSelect}>
                <option value="">Default</option>
                <option value="Grocery">Grocery</option>
                <option value="Costco">Costco</option>
              </select>
              <div style={{ display: 'flex', gap: '0.125rem' }}>
                <IconButton onClick={saveEdit} variant="accent" size="sm" title="Save">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </IconButton>
                <IconButton onClick={() => setEditingId(null)} size="sm" title="Cancel">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </IconButton>
              </div>
            </div>
          ) : (
            <div
              key={ing.id}
              style={{ ...ingredientStyles.row, cursor: 'pointer' }}
              onClick={() => startEdit(ing)}
            >
              <span style={{ flex: 2, fontSize: '0.875rem' }}>
                {ing.name}
                {ing.store_preference && <span style={ingredientStyles.storeBadge(ing.store_preference)}>{ing.store_preference}</span>}
              </span>
              <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{ing.quantity || '-'}</span>
              <span style={{ flex: 1.5, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{ing.description || '-'}</span>
              <span style={{ width: '70px' }}></span>
              <div style={{ width: '48px', display: 'flex', gap: '0.125rem' }}>
                <IconButton
                  onClick={(e) => { e.stopPropagation(); startEdit(ing); }}
                  size="sm"
                  title="Edit"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </IconButton>
                <IconButton
                  onClick={(e) => { e.stopPropagation(); deleteIngredient(ing.id); }}
                  size="sm"
                  title="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </IconButton>
              </div>
            </div>
          )
        )}

        {/* New ingredient row */}
        {showNewRow ? (
          <div style={ingredientStyles.row}>
            <input
              ref={newNameRef}
              type="text"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="Ingredient *"
              style={ingredientStyles.nameInput}
            />
            <input
              type="text"
              className="input"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="Qty"
              style={ingredientStyles.qtyInput}
            />
            <input
              type="text"
              className="input"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="Notes"
              maxLength={200}
              style={ingredientStyles.notesInput}
            />
            <select className="input" value={newStore} onChange={(e) => setNewStore(e.target.value)} onKeyDown={handleNewRowKeyDown} style={ingredientStyles.storeSelect}>
              <option value="">Default</option>
              <option value="Grocery">Grocery</option>
              <option value="Costco">Costco</option>
            </select>
            <div style={{ display: 'flex', gap: '0.125rem' }}>
              <IconButton onClick={addIngredient} variant="accent" size="sm" title="Add">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </IconButton>
              <IconButton onClick={() => { setShowNewRow(false); setNewName(''); setNewQty(''); setNewNotes(''); setNewStore(''); }} size="sm" title="Cancel">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </IconButton>
            </div>
          </div>
        ) : (
          <button type="button" onClick={openNewRow} style={ingredientStyles.addButton}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Ingredient
          </button>
        )}
      </div>
    </div>
  );
}
