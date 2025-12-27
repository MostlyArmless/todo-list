'use client';

import { useState } from 'react';
import type { CheckPantryIngredient } from '@/lib/api';

interface PantryCheckModalProps {
  recipeName: string;
  ingredients: CheckPantryIngredient[];
  onConfirm: (overrides: { name: string; add_to_list: boolean }[]) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  have: '#22c55e',
  low: '#eab308',
  out: '#ef4444',
};

export default function PantryCheckModal({
  recipeName,
  ingredients,
  onConfirm,
  onCancel,
  isSubmitting,
}: PantryCheckModalProps) {
  // Initialize checkboxes based on the add_to_list suggestions
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    ingredients.forEach((ing) => {
      initial[ing.name] = ing.add_to_list;
    });
    return initial;
  });

  const toggleIngredient = (name: string) => {
    setCheckedState((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleConfirm = () => {
    const overrides = ingredients.map((ing) => ({
      name: ing.name,
      add_to_list: checkedState[ing.name] ?? true,
    }));
    onConfirm(overrides);
  };

  const itemsToAdd = Object.values(checkedState).filter(Boolean).length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '500px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1rem',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>
            Add &ldquo;{recipeName}&rdquo; to Shopping List
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Select which ingredients to add. Items in your pantry are unchecked.
          </p>
        </div>

        {/* Ingredient list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.5rem 0',
          }}
        >
          {ingredients.map((ing) => {
            const isChecked = checkedState[ing.name] ?? true;
            const hasPantryMatch = ing.pantry_match !== null;

            return (
              <label
                key={ing.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                  backgroundColor: isChecked ? 'transparent' : 'var(--bg-secondary)',
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = isChecked ? 'transparent' : 'var(--bg-secondary)')}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleIngredient(ing.name)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginRight: '0.75rem',
                    accentColor: 'var(--accent)',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        textDecoration: isChecked ? 'none' : 'line-through',
                        color: isChecked ? 'inherit' : 'var(--text-secondary)',
                      }}
                    >
                      {ing.name}
                    </span>
                    {ing.quantity && (
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        ({ing.quantity})
                      </span>
                    )}
                  </div>
                  {hasPantryMatch && ing.pantry_match && (
                    <div
                      style={{
                        fontSize: '0.75rem',
                        marginTop: '0.125rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                    >
                      <span
                        style={{
                          color: STATUS_COLORS[ing.pantry_match.status],
                        }}
                      >
                        {ing.pantry_match.status === 'have' && 'In pantry'}
                        {ing.pantry_match.status === 'low' && 'Running low'}
                        {ing.pantry_match.status === 'out' && 'Out of stock'}
                      </span>
                      {ing.pantry_match.name !== ing.name && (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          (matched: {ing.pantry_match.name})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '0.5rem',
          }}
        >
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || itemsToAdd === 0}
            className="btn btn-primary"
            style={{
              flex: 1,
              padding: '0.75rem',
              opacity: isSubmitting || itemsToAdd === 0 ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'Adding...' : `Add ${itemsToAdd} Item${itemsToAdd !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
