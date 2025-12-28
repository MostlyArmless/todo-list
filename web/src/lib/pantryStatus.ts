/**
 * Pantry status types and utilities
 */

export type PantryStatus = 'have' | 'low' | 'out';

export const STATUS_ORDER: readonly PantryStatus[] = ['have', 'low', 'out'] as const;

export const STATUS_LABELS: Record<PantryStatus, string> = {
  have: 'Have',
  low: 'Low',
  out: 'Out',
};

export const STATUS_COLORS: Record<PantryStatus, string> = {
  have: '#22c55e', // green
  low: '#eab308', // yellow
  out: '#ef4444', // red
};

/**
 * Get the next status in the cycle: have -> low -> out -> have
 */
export function getNextStatus(currentStatus: PantryStatus): PantryStatus {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  return STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];
}

/**
 * Check if a pantry item should show the "add to shopping list" button
 * Only show for items that are low or out
 */
export function shouldShowAddToListButton(status: PantryStatus): boolean {
  return status !== 'have';
}

/**
 * Group items by category, with 'Uncategorized' for null categories
 */
export function groupItemsByCategory<T extends { category: string | null }>(
  items: T[]
): Record<string, T[]> {
  return items.reduce(
    (acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    },
    {} as Record<string, T[]>
  );
}

/**
 * Sort categories alphabetically with 'Uncategorized' last
 */
export function sortCategories(categories: string[]): string[] {
  return categories.sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b);
  });
}

/**
 * Find a list by name (case-insensitive)
 */
export function findListByName<T extends { name: string }>(
  lists: T[],
  name: string
): T | undefined {
  return lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
}
