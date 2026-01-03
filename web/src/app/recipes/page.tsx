'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListRecipesApiV1RecipesGet,
  useGetLabelColorsApiV1RecipesColorsGet,
  useBulkCheckPantryApiV1RecipesPantryStatusGet,
  useUpdateRecipeApiV1RecipesRecipeIdPut,
  useDeleteRecipeApiV1RecipesRecipeIdDelete,
  getListRecipesApiV1RecipesGetQueryKey,
  type RecipeListResponse,
  type RecipePantryStatus,
  RecipeSortBy,
} from '@/generated/api';
import { getCurrentUser } from '@/lib/auth';
import IconButton from '@/components/IconButton';
import Dropdown from '@/components/Dropdown';
import ViewToggle, { type ViewMode } from '@/components/ViewToggle';
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
  { value: 'updated_at_desc', label: 'Recently Modified', emoji: '✏️' },
];

const SORT_STORAGE_KEY = 'recipeSortBy';
const VIEW_MODE_STORAGE_KEY = 'recipeViewMode';

export default function RecipesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, alert } = useConfirmDialog();
  const [colorPickerOpen, setColorPickerOpen] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('name_asc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // For client-side sorts, fetch with default backend sort
  const backendSort: RecipeSortBy = sortBy === 'pantry_coverage_desc' ? 'name_asc' : sortBy;

  // Queries
  const { data: recipes = [], isLoading } = useListRecipesApiV1RecipesGet({ sort_by: backendSort });
  const { data: colorsData } = useGetLabelColorsApiV1RecipesColorsGet();
  const { data: pantryData } = useBulkCheckPantryApiV1RecipesPantryStatusGet();

  // Type cast since generated API doesn't have proper response type
  const availableColors = (colorsData as { colors?: string[] } | undefined)?.colors ?? [];

  // Build pantry status map
  const pantryStatus = useMemo(() => {
    const map = new Map<number, RecipePantryStatus>();
    if (pantryData?.recipes) {
      for (const status of pantryData.recipes) {
        map.set(status.recipe_id, status);
      }
    }
    return map;
  }, [pantryData]);

  // Mutations
  const updateRecipeMutation = useUpdateRecipeApiV1RecipesRecipeIdPut({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRecipesApiV1RecipesGetQueryKey({ sort_by: backendSort }) });
      },
    },
  });

  const deleteRecipeMutation = useDeleteRecipeApiV1RecipesRecipeIdDelete({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRecipesApiV1RecipesGetQueryKey({ sort_by: backendSort }) });
      },
    },
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Intentional: initialize state from localStorage on mount */
  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    const savedSort = localStorage.getItem(SORT_STORAGE_KEY) as SortOption | null;
    if (savedSort && SORT_OPTIONS.some((o) => o.value === savedSort)) {
      setSortBy(savedSort);
    }
    const savedViewMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY) as ViewMode | null;
    if (savedViewMode && (savedViewMode === 'list' || savedViewMode === 'gallery')) {
      setViewMode(savedViewMode);
    }
  }, [router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setColorPickerOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Apply client-side sorting when pantry data is available
  const getSortedRecipes = (): RecipeListResponse[] => {
    if (sortBy !== 'pantry_coverage_desc' || pantryStatus.size === 0) {
      return recipes;
    }

    return [...recipes].sort((a, b) => {
      const statusA = pantryStatus.get(a.id);
      const statusB = pantryStatus.get(b.id);

      // Calculate coverage (have_count / total_ingredients)
      const coverageA = statusA && statusA.total_ingredients > 0
        ? (statusA.have_count ?? 0) / statusA.total_ingredients
        : 0;
      const coverageB = statusB && statusB.total_ingredients > 0
        ? (statusB.have_count ?? 0) / statusB.total_ingredients
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

  const handleColorChange = async (recipeId: number, color: string) => {
    try {
      await updateRecipeMutation.mutateAsync({
        recipeId,
        data: { label_color: color },
      });
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
      await deleteRecipeMutation.mutateAsync({ recipeId: id });
    } catch {
      await alert({ message: 'Failed to delete recipe. Please try again.' });
    }
  };

  if (isLoading) {
    return (
      <div className={`${styles.container} ${styles.loading}`}>
        <p className={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${viewMode === 'gallery' ? styles.containerWide : ''}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>Recipes</h1>
        <div className={styles.headerControls}>
          <ViewToggle value={viewMode} onChange={handleViewModeChange} />
          <Dropdown
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={(value) => handleSortChange(value as SortOption)}
            className={styles.sortDropdown}
          />
        </div>
      </div>

      {/* List View */}
      {viewMode === 'list' && (
        <div className={styles.recipeList}>
          {getSortedRecipes().map((recipe) => (
            <div
              key={recipe.id}
              className={styles.recipeCard}
              onClick={() => router.push(`/recipes/${recipe.id}`)}
            >
              {recipe.thumbnail_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={recipe.thumbnail_url}
                  alt=""
                  className={styles.recipeThumbnail}
                />
              ) : (
                <div className={styles.recipeThumbnailPlaceholder}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                </div>
              )}
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
                  const haveCount = status.have_count ?? 0;
                  const lowCount = status.low_count ?? 0;
                  const outCount = status.out_count ?? 0;
                  const unmatchedCount = status.unmatched_count ?? 0;
                  const havePercent = (haveCount / total) * 100;
                  const lowPercent = (lowCount / total) * 100;
                  const outPercent = (outCount / total) * 100;
                  const unmatchedPercent = (unmatchedCount / total) * 100;
                  const matchedCount = haveCount + lowCount + outCount;
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
                      {availableColors.map((color: string) => (
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
        </div>
      )}

      {/* Gallery View */}
      {viewMode === 'gallery' && (
        <div className={styles.recipeGrid}>
          {getSortedRecipes().map((recipe) => (
            <div
              key={recipe.id}
              className={styles.galleryCard}
              onClick={() => router.push(`/recipes/${recipe.id}`)}
            >
              {/* Color indicator */}
              <div
                className={styles.galleryColorDot}
                style={{ backgroundColor: recipe.label_color || '#e6194b' }}
              />

              {/* Image or placeholder */}
              {recipe.thumbnail_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={recipe.thumbnail_url.replace('_thumb', '')}
                  alt={recipe.name}
                  className={styles.galleryImage}
                />
              ) : (
                <div className={styles.galleryPlaceholder}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                </div>
              )}

              {/* Action buttons (show on hover) */}
              <div className={styles.galleryActions}>
                <div
                  className={styles.colorPickerWrapper}
                  ref={colorPickerOpen === recipe.id ? colorPickerRef : null}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorPickerOpen(colorPickerOpen === recipe.id ? null : recipe.id);
                    }}
                    className={styles.galleryColorSwatch}
                    style={{ backgroundColor: recipe.label_color || '#e6194b' }}
                    title="Change label color"
                  />
                  {colorPickerOpen === recipe.id && (
                    <div className={styles.colorPicker} onClick={(e) => e.stopPropagation()}>
                      {availableColors.map((color: string) => (
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteRecipe(recipe.id, recipe.name);
                  }}
                  className={styles.galleryActionBtn}
                  title="Delete recipe"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>

              {/* Overlay with info */}
              <div className={styles.galleryOverlay}>
                <h2 className={styles.galleryName}>{recipe.name}</h2>
                <p className={styles.galleryDetails}>
                  {recipe.ingredient_count} ingredient{recipe.ingredient_count !== 1 ? 's' : ''}
                  {recipe.servings && ` · ${recipe.servings} servings`}
                </p>
                {recipe.calories_per_serving != null && (
                  <div className={styles.galleryNutrition}>
                    <span className={styles.galleryCalories}>{recipe.calories_per_serving} cal</span>
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
              </div>
            </div>
          ))}
        </div>
      )}

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
  );
}
