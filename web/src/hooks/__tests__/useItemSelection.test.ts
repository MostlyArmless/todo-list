import { renderHook, act } from '@testing-library/react';
import { useItemSelection, type SelectableItem } from '../useItemSelection';

describe('useItemSelection', () => {
  const mockItems: SelectableItem[] = [
    { id: 1, category_id: 1 },
    { id: 2, category_id: 1 },
    { id: 3, category_id: 2 },
    { id: 4, category_id: 2 },
    { id: 5, category_id: null }, // uncategorized
    { id: 6, category_id: null }, // uncategorized
  ];

  describe('toggleItemSelection', () => {
    it('should add item to selection when not selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
      });

      expect(result.current.selectedItems.has(1)).toBe(true);
      expect(result.current.selectedItems.size).toBe(1);
    });

    it('should remove item from selection when already selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
      });

      expect(result.current.selectedItems.has(1)).toBe(true);

      act(() => {
        result.current.toggleItemSelection(1);
      });

      expect(result.current.selectedItems.has(1)).toBe(false);
      expect(result.current.selectedItems.size).toBe(0);
    });

    it('should handle multiple items independently', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
        result.current.toggleItemSelection(3);
        result.current.toggleItemSelection(5);
      });

      expect(result.current.selectedItems.has(1)).toBe(true);
      expect(result.current.selectedItems.has(3)).toBe(true);
      expect(result.current.selectedItems.has(5)).toBe(true);
      expect(result.current.selectedItems.size).toBe(3);
    });
  });

  describe('toggleCategorySelection', () => {
    it('should select all items in category when none are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleCategorySelection(1, mockItems);
      });

      expect(result.current.selectedItems.has(1)).toBe(true);
      expect(result.current.selectedItems.has(2)).toBe(true);
      expect(result.current.selectedItems.size).toBe(2);
    });

    it('should deselect all items in category when all are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      // First select all in category 1
      act(() => {
        result.current.toggleCategorySelection(1, mockItems);
      });

      expect(result.current.selectedItems.size).toBe(2);

      // Then deselect all in category 1
      act(() => {
        result.current.toggleCategorySelection(1, mockItems);
      });

      expect(result.current.selectedItems.has(1)).toBe(false);
      expect(result.current.selectedItems.has(2)).toBe(false);
      expect(result.current.selectedItems.size).toBe(0);
    });

    it('should select all items in category when partially selected', () => {
      const { result } = renderHook(() => useItemSelection());

      // Select only one item from category 1
      act(() => {
        result.current.toggleItemSelection(1);
      });

      expect(result.current.selectedItems.size).toBe(1);

      // Toggle category should select all
      act(() => {
        result.current.toggleCategorySelection(1, mockItems);
      });

      expect(result.current.selectedItems.has(1)).toBe(true);
      expect(result.current.selectedItems.has(2)).toBe(true);
      expect(result.current.selectedItems.size).toBe(2);
    });

    it('should handle null category (uncategorized items)', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleCategorySelection(null, mockItems);
      });

      expect(result.current.selectedItems.has(5)).toBe(true);
      expect(result.current.selectedItems.has(6)).toBe(true);
      expect(result.current.selectedItems.size).toBe(2);
    });

    it('should not affect items in other categories', () => {
      const { result } = renderHook(() => useItemSelection());

      // Select item from category 2
      act(() => {
        result.current.toggleItemSelection(3);
      });

      // Toggle category 1
      act(() => {
        result.current.toggleCategorySelection(1, mockItems);
      });

      // Item from category 2 should still be selected
      expect(result.current.selectedItems.has(3)).toBe(true);
      // Items from category 1 should also be selected
      expect(result.current.selectedItems.has(1)).toBe(true);
      expect(result.current.selectedItems.has(2)).toBe(true);
      expect(result.current.selectedItems.size).toBe(3);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selected items', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
        result.current.toggleItemSelection(2);
        result.current.toggleItemSelection(3);
      });

      expect(result.current.selectedItems.size).toBe(3);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedItems.size).toBe(0);
    });
  });

  describe('isCategoryFullySelected', () => {
    it('should return true when all items in category are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
        result.current.toggleItemSelection(2);
      });

      expect(result.current.isCategoryFullySelected(1, mockItems)).toBe(true);
    });

    it('should return false when some items in category are not selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
      });

      expect(result.current.isCategoryFullySelected(1, mockItems)).toBe(false);
    });

    it('should return false when no items in category are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      expect(result.current.isCategoryFullySelected(1, mockItems)).toBe(false);
    });

    it('should return false for empty category', () => {
      const { result } = renderHook(() => useItemSelection());

      // Category 99 doesn't exist
      expect(result.current.isCategoryFullySelected(99, mockItems)).toBe(false);
    });

    it('should handle null category correctly', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(5);
        result.current.toggleItemSelection(6);
      });

      expect(result.current.isCategoryFullySelected(null, mockItems)).toBe(true);
    });
  });

  describe('isCategoryPartiallySelected', () => {
    it('should return true when some but not all items are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
      });

      expect(result.current.isCategoryPartiallySelected(1, mockItems)).toBe(true);
    });

    it('should return false when all items are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
        result.current.toggleItemSelection(2);
      });

      expect(result.current.isCategoryPartiallySelected(1, mockItems)).toBe(false);
    });

    it('should return false when no items are selected', () => {
      const { result } = renderHook(() => useItemSelection());

      expect(result.current.isCategoryPartiallySelected(1, mockItems)).toBe(false);
    });

    it('should handle null category correctly', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(5);
      });

      expect(result.current.isCategoryPartiallySelected(null, mockItems)).toBe(true);
    });
  });

  describe('getSelectedIds', () => {
    it('should return array of selected item IDs', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleItemSelection(1);
        result.current.toggleItemSelection(3);
        result.current.toggleItemSelection(5);
      });

      const ids = result.current.getSelectedIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain(1);
      expect(ids).toContain(3);
      expect(ids).toContain(5);
    });

    it('should return empty array when nothing is selected', () => {
      const { result } = renderHook(() => useItemSelection());

      expect(result.current.getSelectedIds()).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty items array', () => {
      const { result } = renderHook(() => useItemSelection());

      act(() => {
        result.current.toggleCategorySelection(1, []);
      });

      expect(result.current.selectedItems.size).toBe(0);
      expect(result.current.isCategoryFullySelected(1, [])).toBe(false);
      expect(result.current.isCategoryPartiallySelected(1, [])).toBe(false);
    });

    it('should handle selecting item not in items array', () => {
      const { result } = renderHook(() => useItemSelection());

      // This should still work - selection state is independent of items array
      act(() => {
        result.current.toggleItemSelection(999);
      });

      expect(result.current.selectedItems.has(999)).toBe(true);
    });
  });
});
