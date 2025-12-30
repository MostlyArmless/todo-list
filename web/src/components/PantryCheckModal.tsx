'use client';

import { useState } from 'react';
import type { CheckPantryIngredient } from '@/lib/api';
import styles from './PantryCheckModal.module.css';

interface PantryCheckModalProps {
  recipeName: string;
  ingredients: CheckPantryIngredient[];
  onConfirm: (overrides: { name: string; add_to_list: boolean }[]) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

const STATUS_CLASSES: Record<string, string> = {
  have: styles.statusHave,
  low: styles.statusLow,
  out: styles.statusOut,
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
      // always_skip items are never added
      initial[ing.name] = ing.always_skip ? false : ing.add_to_list;
    });
    return initial;
  });

  const toggleIngredient = (name: string, alwaysSkip: boolean) => {
    // Don't allow toggling always_skip items
    if (alwaysSkip) return;
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
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            Add &ldquo;{recipeName}&rdquo; to Shopping List
          </h2>
          <p className={styles.subtitle}>
            Select which ingredients to add. Items in your pantry are unchecked.
          </p>
        </div>

        {/* Ingredient list */}
        <div className={styles.ingredientList}>
          {ingredients.map((ing) => {
            const isChecked = checkedState[ing.name] ?? true;
            const hasPantryMatch = ing.pantry_match !== null;
            const alwaysSkip = ing.always_skip ?? false;

            const labelClasses = [
              styles.ingredientLabel,
              !isChecked && styles.ingredientLabelUnchecked,
              alwaysSkip && styles.ingredientLabelSkipped,
            ]
              .filter(Boolean)
              .join(' ');

            const nameClasses = (alwaysSkip || !isChecked)
              ? styles.ingredientNameStrikethrough
              : styles.ingredientName;

            const checkboxClasses = [
              styles.checkbox,
              alwaysSkip && styles.checkboxDisabled,
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <label key={ing.name} className={labelClasses}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleIngredient(ing.name, alwaysSkip)}
                  disabled={alwaysSkip}
                  className={checkboxClasses}
                />
                <div className={styles.ingredientContent}>
                  <div className={styles.ingredientNameRow}>
                    <span className={nameClasses}>{ing.name}</span>
                    {ing.quantity && (
                      <span className={styles.ingredientQuantity}>
                        ({ing.quantity})
                      </span>
                    )}
                  </div>
                  {alwaysSkip ? (
                    <div className={styles.skipInfo}>Never added to lists</div>
                  ) : hasPantryMatch && ing.pantry_match && (
                    <div className={styles.pantryInfo}>
                      <span className={STATUS_CLASSES[ing.pantry_match.status]}>
                        {ing.pantry_match.status === 'have' && 'In pantry'}
                        {ing.pantry_match.status === 'low' && 'Running low'}
                        {ing.pantry_match.status === 'out' && 'Out of stock'}
                      </span>
                      {ing.pantry_match.name !== ing.name && (
                        <span className={styles.pantryMatchName}>
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
        <div className={styles.footer}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className={styles.cancelButton}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || itemsToAdd === 0}
            className={`btn btn-primary ${styles.confirmButton} ${
              isSubmitting || itemsToAdd === 0 ? styles.confirmButtonDisabled : ''
            }`}
          >
            {isSubmitting ? 'Adding...' : `Add ${itemsToAdd} Item${itemsToAdd !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
