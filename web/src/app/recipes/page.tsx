'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type RecipeListItem } from '@/lib/api';
import IconButton from '@/components/IconButton';
import { useConfirmDialog } from '@/components/ConfirmDialog';

export default function RecipesPage() {
  const router = useRouter();
  const { confirm, alert } = useConfirmDialog();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [colorPickerOpen, setColorPickerOpen] = useState<number | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentUser = api.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    loadRecipes();
    loadColors();
  }, [router]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setColorPickerOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadRecipes = async () => {
    try {
      const data = await api.getRecipes();
      setRecipes(data);
    } catch (error) {
      console.error('Failed to load recipes:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadColors = async () => {
    try {
      const data = await api.getRecipeLabelColors();
      setAvailableColors(data.colors);
    } catch (error) {
      console.error('Failed to load colors:', error);
    }
  };

  const handleColorChange = async (recipeId: number, color: string) => {
    try {
      await api.updateRecipe(recipeId, { label_color: color });
      setRecipes(recipes.map(r => r.id === recipeId ? { ...r, label_color: color } : r));
      setColorPickerOpen(null);
    } catch (error) {
      console.error('Failed to update color:', error);
    }
  };

  const handleDeleteRecipe = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: 'Delete Recipe',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.deleteRecipe(id);
      loadRecipes();
    } catch (error) {
      console.error('Failed to delete recipe:', error);
      await alert({ message: 'Failed to delete recipe. Please try again.' });
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '1rem', paddingBottom: '5rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Recipes</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {recipes.map((recipe) => (
          <div
            key={recipe.id}
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s',
              cursor: 'pointer',
              border: '1px solid var(--border)',
            }}
            onClick={() => router.push(`/recipes/${recipe.id}`)}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.transform = 'translateX(4px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{recipe.name}</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {recipe.ingredient_count} ingredient{recipe.ingredient_count !== 1 ? 's' : ''}
                {recipe.servings && ` | ${recipe.servings} servings`}
              </p>
              {recipe.description && (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {recipe.description}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {/* Color swatch - circle on RHS */}
              <div style={{ position: 'relative' }} ref={colorPickerOpen === recipe.id ? colorPickerRef : null}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerOpen(colorPickerOpen === recipe.id ? null : recipe.id);
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: recipe.label_color || '#e6194b',
                    border: '2px solid rgba(255,255,255,0.3)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title="Change label color"
                />
                {colorPickerOpen === recipe.id && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      right: 0,
                      marginBottom: '0.5rem',
                      padding: '0.5rem',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: '0.5rem',
                      zIndex: 100,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {availableColors.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleColorChange(recipe.id, color)}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: color,
                          border: recipe.label_color === color ? '2px solid white' : '2px solid transparent',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteRecipe(recipe.id, recipe.name);
                }}
                variant="default"
                title="Delete recipe"
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
              </IconButton>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => router.push('/recipes/new')}
            className="card"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              color: 'var(--accent)',
              cursor: 'pointer',
              border: '2px dashed var(--border)',
            }}
          >
            <svg
              width="24"
              height="24"
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
            <span>New Recipe</span>
          </button>
          <Link
            href="/recipes/import"
            className="card"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              color: 'var(--accent)',
              cursor: 'pointer',
              border: '1px solid var(--accent)',
              textDecoration: 'none',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>Import Recipe</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
