import { useEffect, useState, useCallback } from 'react';

/**
 * Hook for ingredient keyboard shortcuts and OS detection.
 * Returns isMac for UI hints and sets up Alt/Option+A hotkey.
 */
export function useIngredientKeyboard(onAddIngredient: () => void) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // Detect macOS
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use e.code ('KeyA') instead of e.key because Option+A on Mac produces 'å'
      if (e.altKey && e.code === 'KeyA') {
        e.preventDefault();
        onAddIngredient();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onAddIngredient]);

  return { isMac };
}

/**
 * Shared styles for compact ingredient rows.
 */
export const ingredientStyles = {
  row: {
    display: 'flex',
    gap: '0.25rem',
    marginBottom: '0.25rem',
    alignItems: 'center',
  } as const,
  input: {
    padding: '0.35rem 0.5rem',
    fontSize: '0.875rem',
  } as const,
  nameInput: {
    flex: 2,
    padding: '0.35rem 0.5rem',
    fontSize: '0.875rem',
  } as const,
  qtyInput: {
    flex: 1,
    padding: '0.35rem 0.5rem',
    fontSize: '0.875rem',
  } as const,
  notesInput: {
    flex: 1.5,
    padding: '0.35rem 0.5rem',
    fontSize: '0.875rem',
  } as const,
  storeSelect: {
    width: '70px',
    padding: '0.35rem 0.25rem',
    fontSize: '0.75rem',
  } as const,
  deleteButton: {
    color: 'var(--text-secondary)',
    padding: '0.25rem',
    lineHeight: 0,
  } as const,
  addButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    width: '100%',
    padding: '0.4rem',
    marginTop: '0.25rem',
    color: 'var(--accent)',
    border: '1px dashed var(--border)',
    borderRadius: '4px',
    background: 'none',
    cursor: 'pointer',
    fontSize: '0.875rem',
  } as const,
  header: {
    display: 'flex',
    gap: '0.25rem',
    marginBottom: '0.25rem',
    fontSize: '0.7rem',
    color: 'var(--text-secondary)',
    paddingLeft: '0.25rem',
  } as const,
  storeBadge: (store: string) => ({
    marginLeft: '0.5rem',
    fontSize: '0.7rem',
    backgroundColor: store === 'Costco' ? '#3b82f6' : '#22c55e',
    color: 'white',
    padding: '0.1rem 0.4rem',
    borderRadius: '3px',
  }) as const,
};

