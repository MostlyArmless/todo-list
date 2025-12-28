'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, type Recipe, type RecipeIngredient, type AddToListResult, type CheckPantryIngredient, type PantryItem } from '@/lib/api';
import {
  useIngredientKeyboard,
  ingredientStyles,
} from '@/hooks/useIngredientKeyboard';
import PantryCheckModal from '@/components/PantryCheckModal';
import IconButton from '@/components/IconButton';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import MarkdownInstructions from '@/components/MarkdownInstructions';

// Ingredients that are auto-skipped (never shopped for) - matches backend SKIP_INGREDIENTS
const SKIP_INGREDIENTS = new Set([
  'water',
  'tap water',
  'cold water',
  'hot water',
  'warm water',
]);

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

  // Instructions state
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsText, setInstructionsText] = useState('');

  // Pantry state - maps normalized ingredient name to pantry item
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [pantryByName, setPantryByName] = useState<Map<string, PantryItem>>(new Map());

  const newNameRef = useRef<HTMLInputElement>(null);
  const ingredientsContainerRef = useRef<HTMLDivElement>(null);

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

  // Fetch step completions when recipe loads
  useEffect(() => {
    if (recipe?.id) {
      api.getStepCompletions(recipe.id).then(data => {
        setCompletedSteps(data.completed_steps);
      }).catch(() => {
        // If endpoint not available yet, just use empty array
        setCompletedSteps([]);
      });
    }
  }, [recipe?.id]);

  // Fetch pantry items to display pantry status for ingredients
  const loadPantryItems = useCallback(async () => {
    try {
      const items = await api.getPantryItems();
      setPantryItems(items);
      // Build lookup map by normalized name
      const byName = new Map<string, PantryItem>();
      for (const item of items) {
        byName.set(item.normalized_name, item);
      }
      setPantryByName(byName);
    } catch (e) {
      console.error('Failed to load pantry items:', e);
    }
  }, []);

  useEffect(() => {
    loadPantryItems();
  }, [loadPantryItems]);

  // Click-outside handler to cancel editing
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        editingId !== null &&
        ingredientsContainerRef.current &&
        !ingredientsContainerRef.current.contains(e.target as Node)
      ) {
        setEditingId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingId]);

  const handleToggleStep = async (stepIndex: number) => {
    if (!recipe) return;
    try {
      const result = await api.toggleStep(recipe.id, stepIndex);
      if (result.completed) {
        setCompletedSteps(prev => [...prev, stepIndex]);
      } else {
        setCompletedSteps(prev => prev.filter(i => i !== stepIndex));
      }
    } catch (e) {
      console.error('Failed to toggle step:', e);
    }
  };

  const handleResetProgress = async () => {
    if (!recipe) return;
    try {
      await api.resetStepCompletions(recipe.id);
      setCompletedSteps([]);
    } catch (e) {
      console.error('Failed to reset progress:', e);
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

  const handleEditRowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
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

  // Find pantry item for an ingredient (by normalized name match)
  const findPantryItem = (ingredientName: string): PantryItem | undefined => {
    const normalized = ingredientName.toLowerCase().trim();
    // Try exact match first
    if (pantryByName.has(normalized)) {
      return pantryByName.get(normalized);
    }
    // Try substring match (e.g., "garlic" matches "garlic cloves")
    for (const [pantryName, item] of pantryByName.entries()) {
      if (normalized.includes(pantryName) || pantryName.includes(normalized)) {
        return item;
      }
    }
    return undefined;
  };

  // Check if ingredient should be auto-skipped (like water)
  const isSkipIngredient = (ingredientName: string): boolean => {
    return SKIP_INGREDIENTS.has(ingredientName.toLowerCase().trim());
  };

  // Update pantry status for an ingredient
  const handlePantryStatusChange = async (
    ingredientName: string,
    newStatus: 'have' | 'low' | 'out' | ''
  ) => {
    const normalized = ingredientName.toLowerCase().trim();
    const existingItem = findPantryItem(ingredientName);

    try {
      if (newStatus === '') {
        // Remove from pantry
        if (existingItem) {
          await api.deletePantryItem(existingItem.id);
        }
      } else if (existingItem) {
        // Update existing item
        await api.updatePantryItem(existingItem.id, { status: newStatus });
      } else {
        // Create new pantry item
        await api.createPantryItem({ name: ingredientName, status: newStatus });
      }
      // Reload pantry items to reflect changes
      await loadPantryItems();
    } catch (e) {
      console.error('Failed to update pantry status:', e);
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
      <div className="card" ref={ingredientsContainerRef} style={{ padding: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Ingredients ({recipe.ingredients.length})</h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isMac ? '⌥A' : 'Alt+A'} to add</span>
        </div>

        {recipe.ingredients.length > 0 && (
          <div style={ingredientStyles.header}>
            <span style={{ flex: 2 }}>Name</span>
            <span style={{ flex: 1 }}>Quantity</span>
            <span style={{ width: '70px' }}>Pantry</span>
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
                onKeyDown={handleEditRowKeyDown}
                style={ingredientStyles.nameInput}
                autoFocus
              />
              <input
                type="text"
                className="input"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                onKeyDown={handleEditRowKeyDown}
                style={ingredientStyles.qtyInput}
              />
              {/* Pantry status - read-only display in edit mode, matching width */}
              {(() => {
                const isSkip = isSkipIngredient(ing.name);
                const pantryItem = findPantryItem(ing.name);
                return (
                  <select
                    className="input"
                    value={isSkip ? 'skip' : (pantryItem?.status || '')}
                    disabled={isSkip}
                    onChange={(e) => handlePantryStatusChange(ing.name, e.target.value as 'have' | 'low' | 'out' | '')}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '70px',
                      padding: '0.35rem 0.25rem',
                      fontSize: '0.75rem',
                      opacity: isSkip ? 0.5 : 1,
                    }}
                  >
                    {isSkip ? (
                      <option value="skip">N/A</option>
                    ) : (
                      <>
                        <option value="">-</option>
                        <option value="have">Have</option>
                        <option value="low">Low</option>
                        <option value="out">Out</option>
                      </>
                    )}
                  </select>
                );
              })()}
              <input
                type="text"
                className="input"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                onKeyDown={handleEditRowKeyDown}
                maxLength={200}
                style={ingredientStyles.notesInput}
              />
              <select className="input" value={editStore} onChange={(e) => setEditStore(e.target.value)} onKeyDown={handleEditRowKeyDown} style={ingredientStyles.storeSelect}>
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
              {/* Pantry status cell - editable dropdown */}
              {(() => {
                const isSkip = isSkipIngredient(ing.name);
                const pantryItem = findPantryItem(ing.name);
                const status = pantryItem?.status;
                const statusColors: Record<string, string> = {
                  have: '#22c55e',
                  low: '#f59e0b',
                  out: '#ef4444',
                };
                return (
                  <select
                    className="input"
                    value={isSkip ? 'skip' : (status || '')}
                    disabled={isSkip}
                    onChange={(e) => handlePantryStatusChange(ing.name, e.target.value as 'have' | 'low' | 'out' | '')}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '70px',
                      padding: '0.35rem 0.25rem',
                      fontSize: '0.75rem',
                      opacity: isSkip ? 0.5 : 1,
                      color: status && statusColors[status] ? statusColors[status] : 'inherit',
                      fontWeight: status ? 500 : 'normal',
                    }}
                  >
                    {isSkip ? (
                      <option value="skip">N/A</option>
                    ) : (
                      <>
                        <option value="">-</option>
                        <option value="have" style={{ color: statusColors.have }}>Have</option>
                        <option value="low" style={{ color: statusColors.low }}>Low</option>
                        <option value="out" style={{ color: statusColors.out }}>Out</option>
                      </>
                    )}
                  </select>
                );
              })()}
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
            {/* Empty placeholder for pantry column in new row */}
            <span style={{ width: '70px' }}></span>
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

      {/* Instructions Section */}
      {recipe.instructions && (
        <div className="card" style={{ padding: '0.75rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 500 }}>Instructions</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {completedSteps.length > 0 && (
                <button
                  onClick={handleResetProgress}
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.875rem',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  Reset Progress
                </button>
              )}
              <button
                onClick={() => {
                  setEditingInstructions(!editingInstructions);
                  setInstructionsText(recipe.instructions || '');
                }}
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.875rem',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                {editingInstructions ? 'Cancel' : 'Edit'}
              </button>
            </div>
          </div>

          {editingInstructions ? (
            <div>
              <textarea
                value={instructionsText}
                onChange={(e) => setInstructionsText(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '200px',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                }}
              />
              <button
                onClick={async () => {
                  await api.updateRecipe(recipe.id, { instructions: instructionsText });
                  setRecipe({ ...recipe, instructions: instructionsText });
                  setEditingInstructions(false);
                  // Reset completions when instructions change
                  await api.resetStepCompletions(recipe.id);
                  setCompletedSteps([]);
                }}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                Save Instructions
              </button>
            </div>
          ) : (
            <MarkdownInstructions
              markdown={recipe.instructions}
              completedSteps={completedSteps}
              onToggleStep={handleToggleStep}
            />
          )}
        </div>
      )}
    </div>
  );
}
