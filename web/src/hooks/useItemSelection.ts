import { useState, useCallback, useMemo } from 'react';

export interface SelectableItem {
  id: number;
  category_id: number | null;
}

export interface UseItemSelectionResult {
  selectedItems: Set<number>;
  toggleItemSelection: (itemId: number) => void;
  toggleCategorySelection: (categoryId: number | null, items: SelectableItem[]) => void;
  clearSelection: () => void;
  isCategoryFullySelected: (categoryId: number | null, items: SelectableItem[]) => boolean;
  isCategoryPartiallySelected: (categoryId: number | null, items: SelectableItem[]) => boolean;
  getSelectedIds: () => number[];
}

/**
 * Hook for managing item selection state including category-level operations.
 */
export function useItemSelection(): UseItemSelectionResult {
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const toggleItemSelection = useCallback((itemId: number) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  const getItemsByCategory = useCallback(
    (categoryId: number | null, items: SelectableItem[]) => {
      return items.filter((item) => item.category_id === categoryId);
    },
    []
  );

  const toggleCategorySelection = useCallback(
    (categoryId: number | null, items: SelectableItem[]) => {
      const categoryItems = getItemsByCategory(categoryId, items);
      const categoryItemIds = categoryItems.map((item) => item.id);

      setSelectedItems((prev) => {
        const allSelected = categoryItemIds.every((id) => prev.has(id));
        const newSet = new Set(prev);

        if (allSelected) {
          categoryItemIds.forEach((id) => newSet.delete(id));
        } else {
          categoryItemIds.forEach((id) => newSet.add(id));
        }

        return newSet;
      });
    },
    [getItemsByCategory]
  );

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const isCategoryFullySelected = useCallback(
    (categoryId: number | null, items: SelectableItem[]) => {
      const categoryItems = getItemsByCategory(categoryId, items);
      return categoryItems.length > 0 && categoryItems.every((item) => selectedItems.has(item.id));
    },
    [selectedItems, getItemsByCategory]
  );

  const isCategoryPartiallySelected = useCallback(
    (categoryId: number | null, items: SelectableItem[]) => {
      const categoryItems = getItemsByCategory(categoryId, items);
      const selectedCount = categoryItems.filter((item) => selectedItems.has(item.id)).length;
      return selectedCount > 0 && selectedCount < categoryItems.length;
    },
    [selectedItems, getItemsByCategory]
  );

  const getSelectedIds = useCallback(() => {
    return Array.from(selectedItems);
  }, [selectedItems]);

  return {
    selectedItems,
    toggleItemSelection,
    toggleCategorySelection,
    clearSelection,
    isCategoryFullySelected,
    isCategoryPartiallySelected,
    getSelectedIds,
  };
}
