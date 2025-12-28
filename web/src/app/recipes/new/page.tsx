'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  useIngredientKeyboard,
  ingredientStyles,
} from '@/hooks/useIngredientKeyboard';
import { useConfirmDialog } from '@/components/ConfirmDialog';

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
    <div className="container" style={{ paddingTop: '1rem', paddingBottom: '5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem' }}>New Recipe</h1>
        <button onClick={() => router.push('/recipes')} className="btn btn-secondary" style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: '0.75rem', padding: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Recipe name *"
              required
              style={{ flex: 2, padding: '0.5rem' }}
            />
            <input
              type="text"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              style={{ flex: 2, padding: '0.5rem' }}
            />
            <input
              type="number"
              className="input"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="Servings"
              min="1"
              style={{ width: '80px', padding: '0.5rem' }}
            />
          </div>
        </div>

        <div className="card" style={{ padding: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Ingredients</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isMac ? '⌥A' : 'Alt+A'} to add</span>
          </div>

          {ingredients.length > 0 && (
            <div style={ingredientStyles.header}>
              <span style={{ flex: 2 }}>Name</span>
              <span style={{ flex: 1 }}>Quantity</span>
              <span style={{ flex: 1.5 }}>Notes</span>
              <span style={{ width: '70px' }}>Store</span>
              <span style={{ width: '24px' }}></span>
            </div>
          )}

          {ingredients.map((ing) => (
            <div key={ing.id} style={ingredientStyles.row}>
              <input
                ref={(el) => { if (el) ingredientRefs.current.set(ing.id, el); }}
                type="text"
                className="input"
                value={ing.name}
                onChange={(e) => updateIngredient(ing.id, 'name', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                placeholder="Ingredient *"
                style={ingredientStyles.nameInput}
              />
              <input
                type="text"
                className="input"
                value={ing.quantity}
                onChange={(e) => updateIngredient(ing.id, 'quantity', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                placeholder="Qty"
                style={ingredientStyles.qtyInput}
              />
              <input
                type="text"
                className="input"
                value={ing.description}
                onChange={(e) => updateIngredient(ing.id, 'description', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                placeholder="Notes"
                maxLength={200}
                style={ingredientStyles.notesInput}
              />
              <select
                className="input"
                value={ing.store_preference}
                onChange={(e) => updateIngredient(ing.id, 'store_preference', e.target.value)}
                onKeyDown={(e) => handleIngredientKeyDown(e, ing.id)}
                style={ingredientStyles.storeSelect}
              >
                <option value="">Default</option>
                <option value="Grocery">Grocery</option>
                <option value="Costco">Costco</option>
              </select>
              <button type="button" onClick={() => removeIngredient(ing.id)} style={ingredientStyles.deleteButton} title="Remove">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ))}

          <button type="button" onClick={addIngredient} style={ingredientStyles.addButton}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Ingredient
          </button>
        </div>

        <div className="card" style={{ padding: '0.75rem', marginTop: '0.75rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500, fontSize: '1rem' }}>
              Instructions (Markdown)
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="1. Preheat oven to 350F&#10;2. Mix dry ingredients..."
              style={{
                width: '100%',
                minHeight: '150px',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'inherit',
                fontSize: '14px',
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%', padding: '0.75rem' }}>
            {saving ? 'Creating...' : 'Create Recipe'}
          </button>
        </div>
      </form>
    </div>
  );
}
