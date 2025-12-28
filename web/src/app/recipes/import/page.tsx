'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, RecipeImport } from '@/lib/api';
import MarkdownInstructions from '@/components/MarkdownInstructions';
import styles from './page.module.css';

type Stage = 'loading' | 'input' | 'processing' | 'preview' | 'saving';

const STORAGE_KEY = 'pendingRecipeImportId';

export default function ImportRecipePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [rawText, setRawText] = useState('');
  const [importData, setImportData] = useState<RecipeImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable fields for preview
  const [name, setName] = useState('');
  const [servings, setServings] = useState<number | null>(null);
  const [ingredients, setIngredients] = useState<{ name: string; quantity: string | null; description: string | null }[]>([]);
  const [instructions, setInstructions] = useState('');

  // Check for pending import on mount
  useEffect(() => {
    if (!api.getCurrentUser()) {
      router.push('/login');
      return;
    }

    const savedImportId = localStorage.getItem(STORAGE_KEY);
    if (savedImportId) {
      // Resume pending import
      api.getRecipeImport(parseInt(savedImportId, 10))
        .then((data) => {
          setImportData(data);
          if (data.status === 'completed' && data.parsed_recipe) {
            setName(data.parsed_recipe.name);
            setServings(data.parsed_recipe.servings);
            setIngredients(data.parsed_recipe.ingredients);
            setInstructions(data.parsed_recipe.instructions);
            setStage('preview');
          } else if (data.status === 'failed') {
            setError(data.error_message || 'Failed to parse recipe');
            localStorage.removeItem(STORAGE_KEY);
            setStage('input');
          } else {
            // Still pending or processing
            setStage('processing');
          }
        })
        .catch(() => {
          // Import not found or error - clear and start fresh
          localStorage.removeItem(STORAGE_KEY);
          setStage('input');
        });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: set initial stage based on localStorage
      setStage('input');
    }
  }, [router]);

  // Poll for completion
  useEffect(() => {
    if (stage !== 'processing' || !importData?.id) return;

    const pollInterval = setInterval(async () => {
      try {
        const updated = await api.getRecipeImport(importData.id);
        setImportData(updated);

        if (updated.status === 'completed' && updated.parsed_recipe) {
          setName(updated.parsed_recipe.name);
          setServings(updated.parsed_recipe.servings);
          setIngredients(updated.parsed_recipe.ingredients);
          setInstructions(updated.parsed_recipe.instructions);
          setStage('preview');
        } else if (updated.status === 'failed') {
          setError(updated.error_message || 'Failed to parse recipe');
          localStorage.removeItem(STORAGE_KEY);
          setStage('input');
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [stage, importData?.id]);

  const handleSubmit = async () => {
    if (!rawText.trim()) return;
    setError(null);

    try {
      const result = await api.importRecipe(rawText);
      setImportData(result);
      localStorage.setItem(STORAGE_KEY, result.id.toString());
      setStage('processing');
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to start import';
      setError(errorMessage);
    }
  };

  const handleConfirm = async () => {
    if (!importData?.id) return;
    setStage('saving');

    try {
      const recipe = await api.confirmRecipeImport(importData.id, {
        name,
        servings: servings || undefined,
        ingredients: ingredients.map(i => ({
          name: i.name,
          quantity: i.quantity || undefined,
          description: i.description || undefined,
        })),
        instructions,
      });
      localStorage.removeItem(STORAGE_KEY);
      router.push(`/recipes/${recipe.id}`);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to save recipe';
      setError(errorMessage);
      setStage('preview');
    }
  };

  const handleCancel = async () => {
    localStorage.removeItem(STORAGE_KEY);
    if (importData?.id) {
      try {
        await api.deleteRecipeImport(importData.id);
      } catch {
        // Ignore errors on cleanup
      }
    }
    router.push('/recipes');
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Import Recipe</h1>

      {error && (
        <div className={styles.error}>
          {error}
        </div>
      )}

      {stage === 'loading' && (
        <div className={styles.loading}>
          <p className={styles.loadingText}>Loading...</p>
        </div>
      )}

      {stage === 'input' && (
        <>
          <p className={styles.description}>
            Paste a recipe from any source and we&apos;ll automatically parse it.
          </p>
          <textarea
            className={styles.textarea}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste your recipe here..."
          />
          <div className={styles.buttonRow}>
            <button
              onClick={handleSubmit}
              disabled={!rawText.trim()}
              className={styles.primaryBtn}
            >
              Import Recipe
            </button>
            <button
              onClick={() => router.push('/recipes')}
              className={styles.secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {stage === 'processing' && (
        <div className={styles.processing}>
          <div className={styles.spinner} />
          <p>Parsing recipe...</p>
        </div>
      )}

      {stage === 'preview' && (
        <>
          <p className={styles.description}>
            Review and edit the parsed recipe before saving.
          </p>

          {/* Name */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Servings */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Servings</label>
            <input
              type="number"
              className={styles.smallInput}
              value={servings || ''}
              onChange={(e) => setServings(e.target.value ? parseInt(e.target.value) : null)}
            />
          </div>

          {/* Ingredients */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Ingredients ({ingredients.length})
            </label>
            <div className={styles.ingredientsList}>
              {ingredients.map((ing, idx) => (
                <div key={idx} className={styles.ingredientItem}>
                  <input
                    className={styles.qtyInput}
                    value={ing.quantity || ''}
                    onChange={(e) => {
                      const newIngs = [...ingredients];
                      newIngs[idx] = { ...ing, quantity: e.target.value || null };
                      setIngredients(newIngs);
                    }}
                    placeholder="Qty"
                  />
                  <input
                    className={styles.nameInput}
                    value={ing.name}
                    onChange={(e) => {
                      const newIngs = [...ingredients];
                      newIngs[idx] = { ...ing, name: e.target.value };
                      setIngredients(newIngs);
                    }}
                    placeholder="Name"
                  />
                  <input
                    className={styles.notesInput}
                    value={ing.description || ''}
                    onChange={(e) => {
                      const newIngs = [...ingredients];
                      newIngs[idx] = { ...ing, description: e.target.value || null };
                      setIngredients(newIngs);
                    }}
                    placeholder="Notes"
                  />
                  <button
                    onClick={() => setIngredients(ingredients.filter((_, i) => i !== idx))}
                    className={styles.removeBtn}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Instructions</label>
            <textarea
              className={styles.instructionsTextarea}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          {/* Preview */}
          {instructions && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Preview</label>
              <div className={styles.previewBox}>
                <MarkdownInstructions
                  markdown={instructions}
                  completedSteps={[]}
                  onToggleStep={() => {}}
                />
              </div>
            </div>
          )}

          <div className={styles.buttonRow}>
            <button onClick={handleConfirm} className={styles.primaryBtn}>
              Save Recipe
            </button>
            <button onClick={handleCancel} className={styles.secondaryBtn}>
              Cancel
            </button>
          </div>
        </>
      )}

      {stage === 'saving' && (
        <div className={styles.saving}>
          <p>Saving recipe...</p>
        </div>
      )}
    </div>
  );
}
