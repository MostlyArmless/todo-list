'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, RecipeImport } from '@/lib/api';
import MarkdownInstructions from '@/components/MarkdownInstructions';

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
    <div style={{ padding: '1rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Import Recipe</h1>

      {error && (
        <div style={{
          padding: '0.75rem',
          background: 'var(--danger-muted)',
          color: 'var(--danger)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {stage === 'loading' && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
        </div>
      )}

      {stage === 'input' && (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Paste a recipe from any source and we&apos;ll automatically parse it.
          </p>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste your recipe here..."
            style={{
              width: '100%',
              minHeight: '300px',
              padding: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleSubmit}
              disabled={!rawText.trim()}
              style={{
                padding: '0.75rem 1.5rem',
                background: rawText.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: rawText.trim() ? 'white' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: rawText.trim() ? 'pointer' : 'not-allowed',
                fontWeight: 500,
              }}
            >
              Import Recipe
            </button>
            <button
              onClick={() => router.push('/recipes')}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {stage === 'processing' && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem',
          }} />
          <p>Parsing recipe...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {stage === 'preview' && (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Review and edit the parsed recipe before saving.
          </p>

          {/* Name */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            />
          </div>

          {/* Servings */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Servings</label>
            <input
              type="number"
              value={servings || ''}
              onChange={(e) => setServings(e.target.value ? parseInt(e.target.value) : null)}
              style={{
                width: '100px',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            />
          </div>

          {/* Ingredients */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
              Ingredients ({ingredients.length})
            </label>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              maxHeight: '200px',
              overflow: 'auto',
            }}>
              {ingredients.map((ing, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '0.5rem',
                    borderBottom: idx < ingredients.length - 1 ? '1px solid var(--border)' : 'none',
                    display: 'flex',
                    gap: '0.5rem',
                  }}
                >
                  <input
                    value={ing.quantity || ''}
                    onChange={(e) => {
                      const newIngs = [...ingredients];
                      newIngs[idx] = { ...ing, quantity: e.target.value || null };
                      setIngredients(newIngs);
                    }}
                    placeholder="Qty"
                    style={{ width: '70px', padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                  />
                  <input
                    value={ing.name}
                    onChange={(e) => {
                      const newIngs = [...ingredients];
                      newIngs[idx] = { ...ing, name: e.target.value };
                      setIngredients(newIngs);
                    }}
                    placeholder="Name"
                    style={{ flex: 1, padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                  />
                  <input
                    value={ing.description || ''}
                    onChange={(e) => {
                      const newIngs = [...ingredients];
                      newIngs[idx] = { ...ing, description: e.target.value || null };
                      setIngredients(newIngs);
                    }}
                    placeholder="Notes"
                    style={{ width: '120px', padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '4px', fontStyle: 'italic', color: 'var(--text-secondary)' }}
                  />
                  <button
                    onClick={() => setIngredients(ingredients.filter((_, i) => i !== idx))}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                      padding: '0.25rem',
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
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
          </div>

          {/* Preview */}
          {instructions && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Preview</label>
              <div style={{
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-secondary)',
              }}>
                <MarkdownInstructions
                  markdown={instructions}
                  completedSteps={[]}
                  onToggleStep={() => {}}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleConfirm}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Save Recipe
            </button>
            <button
              onClick={handleCancel}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {stage === 'saving' && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <p>Saving recipe...</p>
        </div>
      )}
    </div>
  );
}
