'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type RecipeListItem } from '@/lib/api';

export default function RecipesPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentUser = api.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    loadRecipes();
  }, [router]);

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

  const handleDeleteRecipe = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteRecipe(id);
      loadRecipes();
    } catch (error) {
      console.error('Failed to delete recipe:', error);
      alert('Failed to delete recipe. Please try again.');
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
            <div>
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteRecipe(recipe.id, recipe.name);
                }}
                style={{
                  color: 'var(--text-secondary)',
                  padding: '0.5rem',
                  flexShrink: 0,
                }}
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
              </button>
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

        <button
          onClick={() => router.push('/recipes/new')}
          className="card"
          style={{
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
      </div>
    </div>
  );
}
