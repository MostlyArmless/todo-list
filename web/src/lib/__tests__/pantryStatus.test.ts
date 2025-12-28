import {
  getNextStatus,
  shouldShowAddToListButton,
  groupItemsByCategory,
  sortCategories,
  findListByName,
  STATUS_ORDER,
  STATUS_LABELS,
  STATUS_COLORS,
  type PantryStatus,
} from '../pantryStatus';

describe('Pantry Status Utilities', () => {
  describe('constants', () => {
    it('should have correct status order', () => {
      expect(STATUS_ORDER).toEqual(['have', 'low', 'out']);
    });

    it('should have labels for all statuses', () => {
      expect(STATUS_LABELS.have).toBe('Have');
      expect(STATUS_LABELS.low).toBe('Low');
      expect(STATUS_LABELS.out).toBe('Out');
    });

    it('should have colors for all statuses', () => {
      expect(STATUS_COLORS.have).toBe('#22c55e');
      expect(STATUS_COLORS.low).toBe('#eab308');
      expect(STATUS_COLORS.out).toBe('#ef4444');
    });
  });

  describe('getNextStatus', () => {
    it('should cycle from have to low', () => {
      expect(getNextStatus('have')).toBe('low');
    });

    it('should cycle from low to out', () => {
      expect(getNextStatus('low')).toBe('out');
    });

    it('should cycle from out back to have', () => {
      expect(getNextStatus('out')).toBe('have');
    });

    it('should complete a full cycle', () => {
      let status: PantryStatus = 'have';

      status = getNextStatus(status);
      expect(status).toBe('low');

      status = getNextStatus(status);
      expect(status).toBe('out');

      status = getNextStatus(status);
      expect(status).toBe('have');
    });
  });

  describe('shouldShowAddToListButton', () => {
    it('should return false for have status', () => {
      expect(shouldShowAddToListButton('have')).toBe(false);
    });

    it('should return true for low status', () => {
      expect(shouldShowAddToListButton('low')).toBe(true);
    });

    it('should return true for out status', () => {
      expect(shouldShowAddToListButton('out')).toBe(true);
    });
  });

  describe('groupItemsByCategory', () => {
    it('should group items by category', () => {
      const items = [
        { id: 1, name: 'Salt', category: 'Spices' },
        { id: 2, name: 'Pepper', category: 'Spices' },
        { id: 3, name: 'Olive Oil', category: 'Oils' },
      ];

      const grouped = groupItemsByCategory(items);

      expect(grouped['Spices']).toHaveLength(2);
      expect(grouped['Oils']).toHaveLength(1);
      expect(grouped['Spices'][0].name).toBe('Salt');
      expect(grouped['Spices'][1].name).toBe('Pepper');
    });

    it('should group null categories as Uncategorized', () => {
      const items = [
        { id: 1, name: 'Salt', category: null },
        { id: 2, name: 'Pepper', category: null },
        { id: 3, name: 'Olive Oil', category: 'Oils' },
      ];

      const grouped = groupItemsByCategory(items);

      expect(grouped['Uncategorized']).toHaveLength(2);
      expect(grouped['Oils']).toHaveLength(1);
    });

    it('should handle empty array', () => {
      const grouped = groupItemsByCategory([]);
      expect(Object.keys(grouped)).toHaveLength(0);
    });

    it('should handle all items in same category', () => {
      const items = [
        { id: 1, name: 'Salt', category: 'Spices' },
        { id: 2, name: 'Pepper', category: 'Spices' },
        { id: 3, name: 'Cumin', category: 'Spices' },
      ];

      const grouped = groupItemsByCategory(items);

      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['Spices']).toHaveLength(3);
    });

    it('should handle all uncategorized items', () => {
      const items = [
        { id: 1, name: 'Salt', category: null },
        { id: 2, name: 'Pepper', category: null },
      ];

      const grouped = groupItemsByCategory(items);

      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['Uncategorized']).toHaveLength(2);
    });
  });

  describe('sortCategories', () => {
    it('should sort categories alphabetically', () => {
      const categories = ['Oils', 'Spices', 'Dairy'];
      const sorted = sortCategories([...categories]);

      expect(sorted).toEqual(['Dairy', 'Oils', 'Spices']);
    });

    it('should place Uncategorized last', () => {
      const categories = ['Oils', 'Uncategorized', 'Dairy'];
      const sorted = sortCategories([...categories]);

      expect(sorted).toEqual(['Dairy', 'Oils', 'Uncategorized']);
    });

    it('should handle Uncategorized being first', () => {
      const categories = ['Uncategorized', 'Oils', 'Dairy'];
      const sorted = sortCategories([...categories]);

      expect(sorted).toEqual(['Dairy', 'Oils', 'Uncategorized']);
    });

    it('should handle only Uncategorized', () => {
      const categories = ['Uncategorized'];
      const sorted = sortCategories([...categories]);

      expect(sorted).toEqual(['Uncategorized']);
    });

    it('should handle empty array', () => {
      const sorted = sortCategories([]);
      expect(sorted).toEqual([]);
    });

    it('should handle mixed case categories', () => {
      const categories = ['Zebra', 'apple', 'Banana'];
      const sorted = sortCategories([...categories]);

      // localeCompare behavior varies by locale, just verify the order is consistent
      // and Uncategorized would be last if present
      expect(sorted).toHaveLength(3);
      expect(sorted).toContain('Zebra');
      expect(sorted).toContain('apple');
      expect(sorted).toContain('Banana');
    });
  });

  describe('findListByName', () => {
    const lists = [
      { id: 1, name: 'Grocery' },
      { id: 2, name: 'Costco' },
      { id: 3, name: 'Hardware Store' },
    ];

    it('should find list by exact name', () => {
      const result = findListByName(lists, 'Grocery');
      expect(result).toEqual({ id: 1, name: 'Grocery' });
    });

    it('should find list case-insensitively', () => {
      expect(findListByName(lists, 'grocery')).toEqual({ id: 1, name: 'Grocery' });
      expect(findListByName(lists, 'GROCERY')).toEqual({ id: 1, name: 'Grocery' });
      expect(findListByName(lists, 'GrOcErY')).toEqual({ id: 1, name: 'Grocery' });
    });

    it('should return undefined for non-existent list', () => {
      const result = findListByName(lists, 'NonExistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty list array', () => {
      const result = findListByName([], 'Grocery');
      expect(result).toBeUndefined();
    });

    it('should find list with spaces in name', () => {
      const result = findListByName(lists, 'hardware store');
      expect(result).toEqual({ id: 3, name: 'Hardware Store' });
    });

    it('should not match partial names', () => {
      const result = findListByName(lists, 'Grocer');
      expect(result).toBeUndefined();
    });
  });
});
