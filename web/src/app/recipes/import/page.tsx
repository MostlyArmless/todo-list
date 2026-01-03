'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  useGetRecipeImportApiV1RecipesImportImportIdGet,
  useCreateRecipeImportApiV1RecipesImportPost,
  useConfirmRecipeImportApiV1RecipesImportImportIdConfirmPost,
  useDeleteRecipeImportApiV1RecipesImportImportIdDelete,
  type RecipeImportResponse,
} from '@/generated/api';
import { getCurrentUser } from '@/lib/auth';
import MarkdownInstructions from '@/components/MarkdownInstructions';
import styles from './page.module.css';

type Stage = 'loading' | 'input' | 'processing' | 'preview' | 'saving';

const STORAGE_KEY = 'pendingRecipeImportId';

export default function ImportRecipePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [rawText, setRawText] = useState('');
  const [importId, setImportId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable fields for preview
  const [name, setName] = useState('');
  const [servings, setServings] = useState<number | null>(null);
  const [ingredients, setIngredients] = useState<{ name: string; quantity: string | null; description: string | null }[]>([]);
  const [instructions, setInstructions] = useState('');

  // Query for import status - only enabled when we have an import ID
  const { data: importData } = useGetRecipeImportApiV1RecipesImportImportIdGet(
    importId ?? 0,
    {
      query: {
        enabled: !!importId && stage === 'processing',
        refetchInterval: (query) => {
          const data = query.state.data as RecipeImportResponse | undefined;
          if (data && (data.status === 'completed' || data.status === 'failed')) {
            return false;
          }
          return 2000;
        },
      },
    }
  );

  // Mutations
  const createImportMutation = useCreateRecipeImportApiV1RecipesImportPost();
  const confirmImportMutation = useConfirmRecipeImportApiV1RecipesImportImportIdConfirmPost();
  const deleteImportMutation = useDeleteRecipeImportApiV1RecipesImportImportIdDelete();

  /* eslint-disable react-hooks/set-state-in-effect -- Effects intentionally sync external state to local form state */
  // Initialize state on mount
  useEffect(() => {
    if (!getCurrentUser()) {
      router.push('/login');
      return;
    }

    const savedImportId = localStorage.getItem(STORAGE_KEY);
    if (savedImportId) {
      setImportId(parseInt(savedImportId, 10));
      setStage('processing');
    } else {
      setStage('input');
    }
  }, [router]);

  // Handle import status updates - sync React Query data to local editable state
  useEffect(() => {
    if (!importData) return;

    if (importData.status === 'completed' && importData.parsed_recipe) {
      setName(importData.parsed_recipe.name);
      setServings(importData.parsed_recipe.servings ?? null);
      setIngredients(importData.parsed_recipe.ingredients.map(ing => ({
        name: ing.name,
        quantity: ing.quantity ?? null,
        description: ing.description ?? null,
      })));
      setInstructions(importData.parsed_recipe.instructions);
      setStage('preview');
    } else if (importData.status === 'failed') {
      setError(importData.error_message || 'Failed to parse recipe');
      localStorage.removeItem(STORAGE_KEY);
      setImportId(null);
      setStage('input');
    }
  }, [importData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async () => {
    if (!rawText.trim()) return;
    setError(null);

    try {
      const result = await createImportMutation.mutateAsync({
        data: { raw_text: rawText },
      });
      setImportId(result.id);
      localStorage.setItem(STORAGE_KEY, result.id.toString());
      setStage('processing');
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to start import';
      setError(errorMessage);
    }
  };

  const handleConfirm = async () => {
    if (!importId) return;
    setStage('saving');

    try {
      const recipe = await confirmImportMutation.mutateAsync({
        importId,
        data: {
          name,
          servings: servings || undefined,
          ingredients: ingredients.map(i => ({
            name: i.name,
            quantity: i.quantity || undefined,
            description: i.description || undefined,
          })),
          instructions,
        },
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
    if (importId) {
      try {
        await deleteImportMutation.mutateAsync({ importId });
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
