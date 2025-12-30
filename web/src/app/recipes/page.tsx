'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type RecipeListItem, type RecipePantryStatus, type RecipeSortBy } from '@/lib/api';
import IconButton from '@/components/IconButton';
import Dropdown from '@/components/Dropdown';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import styles from './page.module.css';

// Extend backend sort options with client-side only options
type SortOption = RecipeSortBy | 'pantry_coverage_desc';

const SORT_OPTIONS: { value: SortOption; label: string; emoji: string }[] = [
  { value: 'name_asc', label: 'Name (A-Z)', emoji: '🔤' },
  { value: 'name_desc', label: 'Name (Z-A)', emoji: '🔤' },
  { value: 'pantry_coverage_desc', label: 'Ready to Cook', emoji: '✅' },
  { value: 'ingredients_asc', label: 'Fewest Ingredients', emoji: '📉' },
  { value: 'ingredients_desc', label: 'Most Ingredients', emoji: '📈' },
  { value: 'last_cooked_desc', label: 'Recently Cooked', emoji: '🍳' },
  { value: 'last_cooked_asc', label: 'Not Cooked Recently', emoji: '⏰' },
  { value: 'calories_asc', label: 'Lowest Calories', emoji: '🥗' },
  { value: 'calories_desc', label: 'Highest Calories', emoji: '🍔' },
  { value: 'protein_desc', label: 'Highest Protein', emoji: '💪' },
  { value: 'created_at_desc', label: 'Recently Added', emoji: '🆕' },
];

const SORT_STORAGE_KEY = 'recipeSortBy';

export default function RecipesPage() {
  const router = useRouter();
  const { confirm, alert } = useConfirmDialog();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  const [colorPickerOpen, setColorPickerOpen] = useState<number | null>(null);
  const [pantryStatus, setPantryStatus] = useState<Map<number, RecipePantryStatus>>(new Map());
  const [sortBy, setSortBy] = useState<SortOption>('name_asc');
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentUser = api.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    const savedSort = localStorage.getItem(SORT_STORAGE_KEY) as SortOption | null;
    if (savedSort && SORT_OPTIONS.some((o) => o.value === savedSort)) {
      setSortBy(savedSort);
    }
    loadColors();
    loadPantryStatus();
  }, [router]);

  useEffect(() => {
    loadRecipes(sortBy);
  }, [sortBy]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setColorPickerOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadRecipes = async (sort: SortOption) => {
    try {
      // For client-side sorts, fetch with default backend sort
      const backendSort: RecipeSortBy = sort === 'pantry_coverage_desc' ? 'name_asc' : sort;
      const data = await api.getRecipes(backendSort);
      setRecipes(data);
    } catch {
      // Failed to load recipes
    } finally {
      setLoading(false);
    }
  };

  // Apply client-side sorting when pantry data is available
  const getSortedRecipes = (): RecipeListItem[] => {
    if (sortBy !== 'pantry_coverage_desc' || pantryStatus.size === 0) {
      return recipes;
    }

    return [...recipes].sort((a, b) => {
      const statusA = pantryStatus.get(a.id);
      const statusB = pantryStatus.get(b.id);

      // Calculate coverage (have_count / total_ingredients)
      const coverageA = statusA && statusA.total_ingredients > 0
        ? statusA.have_count / statusA.total_ingredients
        : 0;
      const coverageB = statusB && statusB.total_ingredients > 0
        ? statusB.have_count / statusB.total_ingredients
        : 0;

      // Sort descending by coverage, then by name for ties
      if (coverageB !== coverageA) {
        return coverageB - coverageA;
      }
      return a.name.localeCompare(b.name);
    });
  };

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    localStorage.setItem(SORT_STORAGE_KEY, newSort);
  };

  const loadColors = async () => {
    try {
      const data = await api.getRecipeLabelColors();
      setAvailableColors(data.colors);
    } catch {
      // Failed to load colors
    }
  };

  const loadPantryStatus = async () => {
    try {
      const data = await api.getRecipesPantryStatus();
      const statusMap = new Map<number, RecipePantryStatus>();
      for (const status of data.recipes) {
        statusMap.set(status.recipe_id, status);
      }
      setPantryStatus(statusMap);
    } catch {
      // Failed to load pantry status
    }
  };

  const handleColorChange = async (recipeId: number, color: string) => {
    try {
      await api.updateRecipe(recipeId, { label_color: color });
      setRecipes(recipes.map((r) => (r.id === recipeId ? { ...r, label_color: color } : r)));
      setColorPickerOpen(null);
    } catch {
      // Failed to update color
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
      loadRecipes(sortBy);
    } catch {
      await alert({ message: 'Failed to delete recipe. Please try again.' });
    }
  };

  if (loading) {
    return (
      <div className={`${styles.container} ${styles.loading}`}>
        <p className={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Recipes</h1>
        <Dropdown
          options={SORT_OPTIONS}
          value={sortBy}
          onChange={(value) => handleSortChange(value as SortOption)}
          className={styles.sortDropdown}
        />
      </div>

      <div className={styles.recipeList}>
        {getSortedRecipes().map((recipe) => (
          <div
            key={recipe.id}
            className={styles.recipeCard}
            onClick={() => router.push(`/recipes/${recipe.id}`)}
          >
            <div className={styles.recipeInfo}>
              <h2 className={styles.recipeName}>{recipe.name}</h2>
              <p className={styles.recipeDetails}>
                {recipe.ingredient_count} ingredient{recipe.ingredient_count !== 1 ? 's' : ''}
                {recipe.servings && ` | ${recipe.servings} servings`}
              </p>
              {recipe.description && (
                <p className={styles.recipeDescription}>{recipe.description}</p>
              )}

              {/* Nutrition Info */}
              {recipe.calories_per_serving != null && (
                <div className={styles.nutritionRow}>
                  <span className={styles.caloriesText}>{recipe.calories_per_serving} cal</span>
                  {recipe.protein_grams != null && (
                    <span className={`${styles.macroBadge} ${styles.macroBadgeProtein}`}>
                      <span className={styles.macroValue}>{recipe.protein_grams}g</span> P
                    </span>
                  )}
                  {recipe.carbs_grams != null && (
                    <span className={`${styles.macroBadge} ${styles.macroBadgeCarbs}`}>
                      <span className={styles.macroValue}>{recipe.carbs_grams}g</span> C
                    </span>
                  )}
                  {recipe.fat_grams != null && (
                    <span className={`${styles.macroBadge} ${styles.macroBadgeFat}`}>
                      <span className={styles.macroValue}>{recipe.fat_grams}g</span> F
                    </span>
                  )}
                </div>
              )}

              {/* Pantry Progress */}
              {(() => {
                const status = pantryStatus.get(recipe.id);
                if (!status || status.total_ingredients === 0) return null;
                const total = status.total_ingredients;
                const havePercent = (status.have_count / total) * 100;
                const lowPercent = (status.low_count / total) * 100;
                const outPercent = (status.out_count / total) * 100;
                const unmatchedPercent = (status.unmatched_count / total) * 100;
                const matchedCount = status.have_count + status.low_count + status.out_count;
                return (
                  <div className={styles.pantryProgress}>
                    <div className={styles.pantryProgressRow}>
                      <div className={styles.progressBar}>
                        {havePercent > 0 && (
                          <div className={styles.progressHave} style={{ width: `${havePercent}%` }} />
                        )}
                        {lowPercent > 0 && (
                          <div className={styles.progressLow} style={{ width: `${lowPercent}%` }} />
                        )}
                        {outPercent > 0 && (
                          <div className={styles.progressOut} style={{ width: `${outPercent}%` }} />
                        )}
                        {unmatchedPercent > 0 && (
                          <div className={styles.progressUnmatched} style={{ width: `${unmatchedPercent}%` }} />
                        )}
                      </div>
                      <span>
                        {matchedCount}/{total} in pantry
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className={styles.recipeActions}>
              {/* Color Picker */}
              <div
                className={styles.colorPickerWrapper}
                ref={colorPickerOpen === recipe.id ? colorPickerRef : null}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerOpen(colorPickerOpen === recipe.id ? null : recipe.id);
                  }}
                  className={styles.colorSwatch}
                  style={{ backgroundColor: recipe.label_color || '#e6194b' }}
                  title="Change label color"
                />
                {colorPickerOpen === recipe.id && (
                  <div className={styles.colorPicker} onClick={(e) => e.stopPropagation()}>
                    {availableColors.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleColorChange(recipe.id, color)}
                        className={`${styles.colorOption} ${
                          recipe.label_color === color ? styles.colorOptionSelected : ''
                        }`}
                        style={{ backgroundColor: color }}
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

        <div className={styles.addButtonRow}>
          <button onClick={() => router.push('/recipes/new')} className={styles.addButton}>
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
          <Link href="/recipes/import" className={styles.importButton}>
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
