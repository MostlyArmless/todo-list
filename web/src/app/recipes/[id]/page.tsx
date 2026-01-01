'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, type Recipe, type RecipeIngredient, type AddToListResult, type CheckPantryIngredient, type PantryItem } from '@/lib/api';
import { useIngredientKeyboard } from '@/hooks/useIngredientKeyboard';
import PantryCheckModal from '@/components/PantryCheckModal';
import IconButton from '@/components/IconButton';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import MarkdownInstructions from '@/components/MarkdownInstructions';
import styles from './page.module.css';

// Ingredients that are auto-skipped (never shopped for)
// SYNC: Keep in sync with src/services/recipe_service.py SKIP_INGREDIENTS
const SKIP_INGREDIENTS = new Set([
  'water',
  'tap water',
  'cold water',
  'hot water',
  'warm water',
  'boiling water',
  'ice',
  'ice water',
  'ice cubes',
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
  const [calculatingNutrition, setCalculatingNutrition] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pantryCheck, setPantryCheck] = useState<PantryCheckState>({ isOpen: false, ingredients: [] });

  const imageInputRef = useRef<HTMLInputElement>(null);

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

  // Title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState('');

  // Metadata editing state (description, servings)
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDescription, setMetaDescription] = useState('');
  const [metaServings, setMetaServings] = useState('');

  // Last cooked editing state
  const [editingLastCooked, setEditingLastCooked] = useState(false);
  const [lastCookedDate, setLastCookedDate] = useState('');

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

  const loadRecipe = useCallback(async () => {
    try {
      setRecipe(await api.getRecipe(recipeId));
    } catch {
      router.push('/recipes');
    } finally {
      setLoading(false);
    }
  }, [recipeId, router]);

  useEffect(() => {
    if (!api.getCurrentUser()) {
      router.push('/login');
      return;
    }
    loadRecipe();
  }, [router, loadRecipe]);

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
    } catch {
      // Failed to load pantry items
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
    } catch {
      // Failed to toggle step
    }
  };

  const handleResetProgress = async () => {
    if (!recipe) return;
    try {
      await api.resetStepCompletions(recipe.id);
      setCompletedSteps([]);
    } catch {
      // Failed to reset progress
    }
  };

  const handleCalculateNutrition = async () => {
    if (!recipe) return;
    setCalculatingNutrition(true);
    try {
      await api.computeRecipeNutrition(recipe.id);
      // Poll for updated recipe with nutrition data
      let attempts = 0;
      const pollForNutrition = async () => {
        const updated = await api.getRecipe(recipe.id);
        if (updated.nutrition_computed_at || attempts >= 10) {
          setRecipe(updated);
          if (updated.calories_per_serving != null) {
            setToast({ message: 'Nutrition calculated successfully', eventId: null, type: 'success' });
          } else {
            setToast({ message: 'Could not calculate nutrition for these ingredients', eventId: null, type: 'error' });
          }
        } else {
          attempts++;
          setTimeout(pollForNutrition, 1000);
        }
      };
      setTimeout(pollForNutrition, 1000);
    } catch {
      setToast({ message: 'Failed to calculate nutrition', eventId: null, type: 'error' });
    } finally {
      setCalculatingNutrition(false);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !recipe) return;

    setUploadingImage(true);
    try {
      const updated = await api.uploadRecipeImage(recipe.id, file);
      setRecipe(updated);
      setToast({ message: 'Image uploaded', eventId: null, type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to upload image',
        eventId: null,
        type: 'error',
      });
    } finally {
      setUploadingImage(false);
      // Reset file input so same file can be re-selected
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  };

  const handleDeleteImage = async () => {
    if (!recipe) return;
    try {
      await api.deleteRecipeImage(recipe.id);
      setRecipe({ ...recipe, image_url: null, thumbnail_url: null });
      setToast({ message: 'Image deleted', eventId: null, type: 'success' });
    } catch {
      setToast({ message: 'Failed to delete image', eventId: null, type: 'error' });
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

  const startEditTitle = () => {
    setEditingTitle(true);
    setTitleText(recipe?.name || '');
  };

  const saveTitle = async () => {
    if (!recipe || !titleText.trim()) return;
    try {
      await api.updateRecipe(recipe.id, { name: titleText.trim() });
      setRecipe({ ...recipe, name: titleText.trim() });
      setEditingTitle(false);
    } catch {
      // Failed to update title
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingTitle(false);
    }
  };

  const startEditMeta = () => {
    setEditingMeta(true);
    setMetaDescription(recipe?.description || '');
    setMetaServings(recipe?.servings?.toString() || '');
  };

  const saveMeta = async () => {
    if (!recipe) return;
    try {
      const servingsNum = metaServings.trim() ? parseInt(metaServings, 10) : undefined;
      const descriptionVal = metaDescription.trim() || undefined;
      await api.updateRecipe(recipe.id, {
        description: descriptionVal,
        servings: servingsNum,
      });
      setRecipe({
        ...recipe,
        description: descriptionVal || null,
        servings: servingsNum ?? null,
      });
      setEditingMeta(false);
    } catch {
      // Failed to update metadata
    }
  };

  const handleMetaKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveMeta();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingMeta(false);
    }
  };

  const startEditLastCooked = () => {
    setEditingLastCooked(true);
    // Convert ISO date to YYYY-MM-DD for input
    if (recipe?.last_cooked_at) {
      const date = new Date(recipe.last_cooked_at);
      setLastCookedDate(date.toISOString().split('T')[0]);
    } else {
      // Default to today
      setLastCookedDate(new Date().toISOString().split('T')[0]);
    }
  };

  const saveLastCooked = async () => {
    if (!recipe) return;
    try {
      // Convert date input to ISO string with time
      const isoDate = lastCookedDate ? new Date(lastCookedDate + 'T12:00:00').toISOString() : null;
      await api.updateRecipe(recipe.id, { last_cooked_at: isoDate });
      setRecipe({ ...recipe, last_cooked_at: isoDate });
      setEditingLastCooked(false);
    } catch {
      // Failed to update last cooked date
    }
  };

  const clearLastCooked = async () => {
    if (!recipe) return;
    try {
      await api.updateRecipe(recipe.id, { last_cooked_at: null });
      setRecipe({ ...recipe, last_cooked_at: null });
      setEditingLastCooked(false);
    } catch {
      // Failed to clear last cooked date
    }
  };

  const handleLastCookedKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLastCooked();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingLastCooked(false);
    }
  };

  const formatLastCooked = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString();
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
    } catch {
      // Failed to update
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
    } catch {
      // Failed to delete
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
    } catch {
      // Failed to add
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
    } catch {
      // Failed to add
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
  // Uses EXACT matching only - we want to modify this specific ingredient, not a fuzzy match
  const handlePantryStatusChange = async (
    ingredientName: string,
    newStatus: 'have' | 'low' | 'out' | ''
  ) => {
    const normalized = ingredientName.toLowerCase().trim();
    // Only look for exact match when modifying - don't accidentally modify a different item
    const exactMatch = pantryByName.get(normalized);

    try {
      if (newStatus === '') {
        // Remove from pantry - only if there's an exact match for this ingredient
        if (exactMatch) {
          await api.deletePantryItem(exactMatch.id);
        }
        // If no exact match, nothing to delete (fuzzy match doesn't count)
      } else if (exactMatch) {
        // Update existing exact match
        await api.updatePantryItem(exactMatch.id, { status: newStatus });
      } else {
        // Create new pantry item for this specific ingredient
        await api.createPantryItem({ name: ingredientName, status: newStatus });
      }
      // Reload pantry items to reflect changes
      await loadPantryItems();
    } catch {
      // Failed to update pantry status
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <p className={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  if (!recipe) return null;

  return (
    <div className={styles.container}>
      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          <span>{toast.message}</span>
          {toast.eventId && (
            <button onClick={handleUndo} className={styles.undoBtn}>
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} className={styles.closeToastBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          {editingTitle ? (
            <div className={styles.titleRow}>
              <input
                type="text"
                className={styles.titleInput}
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                autoFocus
              />
              <IconButton onClick={saveTitle} variant="accent" size="sm" title="Save">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </IconButton>
              <IconButton onClick={() => setEditingTitle(false)} size="sm" title="Cancel">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </IconButton>
            </div>
          ) : (
            <div className={styles.titleRow}>
              <h1
                className={styles.title}
                onClick={startEditTitle}
                title="Click to edit"
              >
                {recipe.name}
              </h1>
              <IconButton onClick={startEditTitle} size="sm" title="Edit title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </IconButton>
            </div>
          )}
          {editingMeta ? (
            <div className={styles.metaEditRow}>
              <input
                type="text"
                className={styles.metaDescInput}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                onKeyDown={handleMetaKeyDown}
                placeholder="Description (optional)"
                autoFocus
              />
              <input
                type="number"
                className={styles.metaServingsInput}
                value={metaServings}
                onChange={(e) => setMetaServings(e.target.value)}
                onKeyDown={handleMetaKeyDown}
                placeholder="Servings"
                min="1"
              />
              <IconButton onClick={saveMeta} variant="accent" size="sm" title="Save">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </IconButton>
              <IconButton onClick={() => setEditingMeta(false)} size="sm" title="Cancel">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </IconButton>
            </div>
          ) : (
            <div className={styles.metaRow} onClick={startEditMeta} title="Click to edit">
              <p className={styles.subtitle}>
                {recipe.description || recipe.servings ? (
                  <>
                    {recipe.description}{recipe.description && recipe.servings ? ' · ' : ''}{recipe.servings ? `${recipe.servings} servings` : ''}
                  </>
                ) : (
                  <span className={styles.metaPlaceholder}>Add description & servings</span>
                )}
              </p>
              <IconButton onClick={startEditMeta} size="sm" title="Edit details">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </IconButton>
            </div>
          )}
          {/* Last Cooked */}
          {editingLastCooked ? (
            <div className={styles.lastCookedEditRow}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.lastCookedIcon}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <input
                type="date"
                className={styles.lastCookedInput}
                value={lastCookedDate}
                onChange={(e) => setLastCookedDate(e.target.value)}
                onKeyDown={handleLastCookedKeyDown}
                autoFocus
              />
              <IconButton onClick={saveLastCooked} variant="accent" size="sm" title="Save">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </IconButton>
              {recipe.last_cooked_at && (
                <IconButton onClick={clearLastCooked} size="sm" title="Clear date">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </IconButton>
              )}
              <IconButton onClick={() => setEditingLastCooked(false)} size="sm" title="Cancel">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </IconButton>
            </div>
          ) : (
            <div className={styles.lastCookedRow} onClick={startEditLastCooked} title="Click to edit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.lastCookedIcon}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span className={styles.lastCookedText}>
                {recipe.last_cooked_at ? (
                  <>Last cooked: {formatLastCooked(recipe.last_cooked_at)}</>
                ) : (
                  <span className={styles.lastCookedPlaceholder}>Set last cooked date</span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Recipe Image */}
      <div className={styles.imageSection}>
        {recipe.image_url ? (
          <div className={styles.imageContainer}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={recipe.image_url}
              alt={recipe.name}
              className={styles.recipeImage}
            />
            <div className={styles.imageActions}>
              <button
                onClick={() => imageInputRef.current?.click()}
                className={styles.imageBtn}
                disabled={uploadingImage}
              >
                {uploadingImage ? 'Uploading...' : 'Change'}
              </button>
              <button
                onClick={handleDeleteImage}
                className={`${styles.imageBtn} ${styles.imageBtnDanger}`}
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => imageInputRef.current?.click()}
            className={styles.uploadBtn}
            disabled={uploadingImage}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            {uploadingImage ? 'Uploading...' : 'Add Photo'}
          </button>
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleImageSelect}
          className={styles.hiddenInput}
        />
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

      {/* Nutrition Section */}
      <div className={styles.nutritionCard}>
        {recipe.calories_per_serving != null ? (
          <div className={styles.nutritionInfo}>
            <span className={styles.caloriesText}>
              {recipe.calories_per_serving} cal
            </span>
            {recipe.protein_grams != null && (
              <span className={`${styles.macroBadge} ${styles.macroBadgeProtein}`}>
                <span className={styles.macroValue}>{recipe.protein_grams}g</span> Protein
              </span>
            )}
            {recipe.carbs_grams != null && (
              <span className={`${styles.macroBadge} ${styles.macroBadgeCarbs}`}>
                <span className={styles.macroValue}>{recipe.carbs_grams}g</span> Carbs
              </span>
            )}
            {recipe.fat_grams != null && (
              <span className={`${styles.macroBadge} ${styles.macroBadgeFat}`}>
                <span className={styles.macroValue}>{recipe.fat_grams}g</span> Fat
              </span>
            )}
            <span className={styles.perServing}>per serving</span>
          </div>
        ) : (
          <span className={styles.noNutrition}>
            No nutrition data
          </span>
        )}
        <button
          onClick={handleCalculateNutrition}
          disabled={calculatingNutrition || recipe.ingredients.length === 0}
          className={styles.calcBtn}
        >
          {calculatingNutrition ? 'Calculating...' : recipe.calories_per_serving != null ? 'Recalculate' : 'Calculate'}
        </button>
      </div>

      {/* Add to List Button */}
      <button
        onClick={handleAddToList}
        disabled={adding || checkingPantry || recipe.ingredients.length === 0}
        className={styles.addToListBtn}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        {checkingPantry ? 'Checking pantry...' : adding ? 'Adding...' : 'Add to Shopping List'}
      </button>

      {/* Ingredients */}
      <div className={styles.card} ref={ingredientsContainerRef}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Ingredients ({recipe.ingredients.length})</h2>
          <span className={styles.shortcut}>{isMac ? '⌥A' : 'Alt+A'} to add</span>
        </div>

        {recipe.ingredients.length > 0 && (
          <div className={styles.ingredientHeader}>
            <span className={styles.ingredientName}>Name</span>
            <span className={styles.ingredientQty}>Quantity</span>
            <span style={{ width: '70px' }}>Pantry</span>
            <span className={styles.ingredientNotes}>Notes</span>
            <span style={{ width: '70px' }}>Store</span>
            <span style={{ width: '48px' }}></span>
          </div>
        )}

        {recipe.ingredients.map((ing) =>
          editingId === ing.id ? (
            <div key={ing.id} className={styles.ingredientRow}>
              <input
                type="text"
                className={styles.nameInput}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleEditRowKeyDown}
                autoFocus
              />
              <input
                type="text"
                className={styles.qtyInput}
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                onKeyDown={handleEditRowKeyDown}
              />
              {/* Pantry status - read-only display in edit mode, matching width */}
              {(() => {
                const isSkip = isSkipIngredient(ing.name);
                const pantryItem = findPantryItem(ing.name);
                return (
                  <select
                    className={styles.pantrySelect}
                    value={isSkip ? 'skip' : (pantryItem?.status || '')}
                    disabled={isSkip}
                    onChange={(e) => handlePantryStatusChange(ing.name, e.target.value as 'have' | 'low' | 'out' | '')}
                    onClick={(e) => e.stopPropagation()}
                    style={{ opacity: isSkip ? 0.5 : 1 }}
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
                className={styles.notesInput}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                onKeyDown={handleEditRowKeyDown}
                maxLength={200}
              />
              <select className={styles.storeSelect} value={editStore} onChange={(e) => setEditStore(e.target.value)} onKeyDown={handleEditRowKeyDown}>
                <option value="">Default</option>
                <option value="Grocery">Grocery</option>
                <option value="Costco">Costco</option>
              </select>
              <div className={styles.actionBtns}>
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
              className={styles.ingredientRow}
              onClick={() => startEdit(ing)}
            >
              <span className={styles.ingredientName}>
                {ing.name}
                {ing.store_preference && (
                  <span className={`${styles.storeBadge} ${ing.store_preference === 'Grocery' ? styles.storeBadgeGrocery : styles.storeBadgeCostco}`}>
                    {ing.store_preference}
                  </span>
                )}
              </span>
              <span className={styles.ingredientQty}>{ing.quantity || '-'}</span>
              {/* Pantry status cell - editable dropdown */}
              {(() => {
                const isSkip = isSkipIngredient(ing.name);
                const pantryItem = findPantryItem(ing.name);
                const status = pantryItem?.status;
                const statusClass = status === 'have' ? styles.pantrySelectHave
                  : status === 'low' ? styles.pantrySelectLow
                  : status === 'out' ? styles.pantrySelectOut : '';
                return (
                  <select
                    className={`${styles.pantrySelect} ${statusClass}`}
                    value={isSkip ? 'skip' : (status || '')}
                    disabled={isSkip}
                    onChange={(e) => handlePantryStatusChange(ing.name, e.target.value as 'have' | 'low' | 'out' | '')}
                    onClick={(e) => e.stopPropagation()}
                    style={{ opacity: isSkip ? 0.5 : 1 }}
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
              <span className={styles.ingredientNotes} data-empty={!ing.description}>{ing.description || '-'}</span>
              <span style={{ width: '70px' }}></span>
              <div className={styles.actionBtns} style={{ width: '48px' }}>
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
          <div className={styles.ingredientRow}>
            <input
              ref={newNameRef}
              type="text"
              className={styles.nameInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="Ingredient *"
            />
            <input
              type="text"
              className={styles.qtyInput}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="Qty"
            />
            {/* Empty placeholder for pantry column in new row */}
            <span style={{ width: '70px' }}></span>
            <input
              type="text"
              className={styles.notesInput}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="Notes"
              maxLength={200}
            />
            <select className={styles.storeSelect} value={newStore} onChange={(e) => setNewStore(e.target.value)} onKeyDown={handleNewRowKeyDown}>
              <option value="">Default</option>
              <option value="Grocery">Grocery</option>
              <option value="Costco">Costco</option>
            </select>
            <div className={styles.actionBtns}>
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
          <button type="button" onClick={openNewRow} className={styles.addBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Ingredient
          </button>
        )}
      </div>

      {/* Instructions Section */}
      <div className={styles.instructionsCard}>
        <div className={styles.instructionsHeader}>
          <h2 className={styles.instructionsTitle}>Instructions</h2>
          {recipe.instructions && (
            <div className={styles.instructionsBtns}>
              {completedSteps.length > 0 && (
                <button onClick={handleResetProgress} className={styles.instructionsBtn}>
                  Reset Progress
                </button>
              )}
              <button
                onClick={() => {
                  setEditingInstructions(!editingInstructions);
                  setInstructionsText(recipe.instructions || '');
                }}
                className={styles.instructionsBtn}
              >
                {editingInstructions ? 'Cancel' : 'Edit'}
              </button>
            </div>
          )}
        </div>

        {editingInstructions ? (
          <div>
            <textarea
              className={styles.textarea}
              value={instructionsText}
              onChange={(e) => setInstructionsText(e.target.value)}
              placeholder="Enter recipe instructions here. You can use markdown formatting:&#10;&#10;1. First step&#10;2. Second step&#10;&#10;**Bold text** and *italic text* are supported."
              autoFocus={!recipe.instructions}
            />
            <div className={styles.instructionsBtns} style={{ marginTop: '0.5rem' }}>
              <button
                onClick={async () => {
                  await api.updateRecipe(recipe.id, { instructions: instructionsText });
                  setRecipe({ ...recipe, instructions: instructionsText });
                  setEditingInstructions(false);
                  // Reset completions when instructions change
                  await api.resetStepCompletions(recipe.id);
                  setCompletedSteps([]);
                }}
                className={styles.saveInstructionsBtn}
              >
                Save Instructions
              </button>
              {!recipe.instructions && (
                <button
                  onClick={() => {
                    setEditingInstructions(false);
                    setInstructionsText('');
                  }}
                  className={styles.cancelBtn}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : recipe.instructions ? (
          <MarkdownInstructions
            markdown={recipe.instructions}
            completedSteps={completedSteps}
            onToggleStep={handleToggleStep}
          />
        ) : (
          <div className={styles.emptyInstructions}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={styles.emptyIcon}
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <p className={styles.emptyText}>
              No instructions yet
            </p>
            <button
              onClick={() => {
                setInstructionsText('');
                setEditingInstructions(true);
              }}
              className={styles.addInstructionsBtn}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add Instructions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
