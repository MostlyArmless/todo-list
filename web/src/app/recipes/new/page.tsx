'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useIngredientKeyboard } from '@/hooks/useIngredientKeyboard';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import styles from './page.module.css';

interface IngredientDraft {
  id: string;
  name: string;
  quantity: string;
  description: string;
  store_preference: string;
}

export default function NewRecipePage() {
  const router = useRouter();
  const { alert } = useConfirmDialog();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [servings, setServings] = useState('');
  const [instructions, setInstructions] = useState('');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const ingredientRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const addIngredient = useCallback(() => {
    const newId = crypto.randomUUID();
    setIngredients((prev) => [
      ...prev,
      { id: newId, name: '', quantity: '', description: '', store_preference: '' },
    ]);
    setTimeout(() => ingredientRefs.current.get(newId)?.focus(), 0);
  }, []);

  const { isMac } = useIngredientKeyboard(addIngredient);

  useEffect(() => {
    if (!api.getCurrentUser()) router.push('/login');
  }, [router]);

  const updateIngredient = (id: string, field: keyof IngredientDraft, value: string) => {
    setIngredients(ingredients.map((ing) => (ing.id === id ? { ...ing, [field]: value } : ing)));
  };

  const removeIngredient = (id: string) => {
    setIngredients(ingredients.filter((ing) => ing.id !== id));
    ingredientRefs.current.delete(id);
  };

  const handleIngredientKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addIngredient();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      removeIngredient(id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const recipe = await api.createRecipe({
        name: name.trim(),
        description: description.trim() || undefined,
        servings: servings ? parseInt(servings, 10) : undefined,
        instructions: instructions.trim() || undefined,
        ingredients: ingredients
          .filter((ing) => ing.name.trim())
          .map((ing) => ({
            name: ing.name.trim(),
            quantity: ing.quantity.trim() || undefined,
            description: ing.description.trim() || undefined,
            store_preference: ing.store_preference || undefined,
          })),
      });
      router.push(`/recipes/${recipe.id}`);
    } catch (error) {
      console.error('Failed to create recipe:', error);
      await alert({ message: 'Failed to create recipe. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>New Recipe</h1>
        <button onClick={() => router.push('/recipes')} className={styles.cancelBtn}>
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className={styles.card}>
          <div className={styles.formRow}>
            <input
              type="text"
              className={styles.nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Recipe name *"
              required
            />
            <input
              type="text"
              className={styles.descInput}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
            />
            <input
              type="number"
              className={styles.servingsInput}
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="Servings"
              min="1"
            />
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Ingredients</h2>
            <span className={styles.shortcut}>{isMac ? '⌥A' : 'Alt+A'} to add</span>
          </div>

          {ingredients.length > 0 && (
            <div className={styles.ingredientHeader}>
              <span className={styles.ingredientName}>Name</span>
              <span className={styles.ingredientQty}>Quantity</span>
              <span className={styles.ingredientNotes}>Notes</span>
              <span style={{ width: '70px' }}>Store</span>
              <span style={{ width: '24px' }}></span>
            </div>
          )}

          {ingredients.map((ing) => (
            <div key={ing.id} className={styles.ingredientRow}>
              <input
                ref={(el) => { if (el) ingredientRefs.current.set(ing.id, el); }}
                type="text"
                className={styles.ingNameInput}
                value={ing.name}
                onChange={(e) => updateIngredient(ing.id, 'name', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                placeholder="Ingredient *"
              />
              <input
                type="text"
                className={styles.ingQtyInput}
                value={ing.quantity}
                onChange={(e) => updateIngredient(ing.id, 'quantity', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                placeholder="Qty"
              />
              <input
                type="text"
                className={styles.ingNotesInput}
                value={ing.description}
                onChange={(e) => updateIngredient(ing.id, 'description', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                placeholder="Notes"
                maxLength={200}
              />
              <select
                className={styles.storeSelect}
                value={ing.store_preference}
                onChange={(e) => updateIngredient(ing.id, 'store_preference', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
              >
                <option value="">Default</option>
                <option value="Grocery">Grocery</option>
                <option value="Costco">Costco</option>
              </select>
              <button type="button" onClick={() => removeIngredient(ing.id)} className={styles.deleteBtn} title="Remove">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ))}

          <button type="button" onClick={addIngredient} className={styles.addBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Ingredient
          </button>
        </div>

        <div className={styles.instructionsCard}>
          <div>
            <label className={styles.label}>
              Instructions (Markdown)
            </label>
            <textarea
              className={styles.textarea}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="1. Preheat oven to 350F&#10;2. Mix dry ingredients..."
            />
          </div>
        </div>

        <div className={styles.submitSection}>
          <button type="submit" className={styles.submitBtn} disabled={saving}>
            {saving ? 'Creating...' : 'Create Recipe'}
          </button>
        </div>
      </form>
    </div>
  );
}
