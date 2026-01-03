import { render, screen, fireEvent } from '@testing-library/react';
import PantryCheckModal from '../PantryCheckModal';
import type { CheckPantryIngredient } from '@/generated/api';

describe('PantryCheckModal', () => {
  const mockOnConfirm = jest.fn();
  const mockOnCancel = jest.fn();

  const defaultIngredients: CheckPantryIngredient[] = [
    {
      name: 'Tomatoes',
      quantity: '2 lbs',
      pantry_match: null,
      confidence: 0,
      add_to_list: true,
    },
    {
      name: 'Olive Oil',
      quantity: '2 tbsp',
      pantry_match: { id: 1, name: 'Olive Oil', status: 'have' },
      confidence: 1.0,
      add_to_list: false,
    },
    {
      name: 'Salt',
      quantity: '1 tsp',
      pantry_match: null,
      confidence: 0,
      add_to_list: true,
    },
  ];

  const defaultProps = {
    recipeName: 'Test Recipe',
    ingredients: defaultIngredients,
    onConfirm: mockOnConfirm,
    onCancel: mockOnCancel,
    isSubmitting: false,
  };

  beforeEach(() => {
    mockOnConfirm.mockClear();
    mockOnCancel.mockClear();
  });

  describe('initial state', () => {
    it('should render recipe name in header', () => {
      render(<PantryCheckModal {...defaultProps} />);
      // The heading contains the recipe name - use a function matcher for broken text
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toContain('Test Recipe');
    });

    it('should respect add_to_list suggestions for initial checkbox state', () => {
      render(<PantryCheckModal {...defaultProps} />);

      const tomatoesCheckbox = screen.getByRole('checkbox', { name: /tomatoes/i });
      const oliveOilCheckbox = screen.getByRole('checkbox', { name: /olive oil/i });
      const saltCheckbox = screen.getByRole('checkbox', { name: /salt/i });

      expect(tomatoesCheckbox).toBeChecked();
      expect(oliveOilCheckbox).not.toBeChecked();
      expect(saltCheckbox).toBeChecked();
    });

    it('should show correct initial item count in submit button', () => {
      render(<PantryCheckModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Add 2 Items/i })).toBeInTheDocument();
    });

    it('should show quantity next to ingredient name', () => {
      render(<PantryCheckModal {...defaultProps} />);
      expect(screen.getByText('(2 lbs)')).toBeInTheDocument();
      expect(screen.getByText('(2 tbsp)')).toBeInTheDocument();
    });
  });

  describe('always_skip items', () => {
    it('should disable checkbox for always_skip items', () => {
      const ingredientsWithSkip: CheckPantryIngredient[] = [
        {
          name: 'Water',
          quantity: '1 cup',
          pantry_match: null,
          confidence: 0,
          add_to_list: false,
          always_skip: true,
        },
        ...defaultIngredients,
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredientsWithSkip} />);

      const waterCheckbox = screen.getByRole('checkbox', { name: /water/i });
      expect(waterCheckbox).toBeDisabled();
      expect(waterCheckbox).not.toBeChecked();
    });

    it('should show "Never added to lists" text for always_skip items', () => {
      const ingredientsWithSkip: CheckPantryIngredient[] = [
        {
          name: 'Water',
          quantity: '1 cup',
          pantry_match: null,
          confidence: 0,
          add_to_list: false,
          always_skip: true,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredientsWithSkip} />);
      expect(screen.getByText('Never added to lists')).toBeInTheDocument();
    });

    it('should not allow toggling always_skip items', () => {
      const ingredientsWithSkip: CheckPantryIngredient[] = [
        {
          name: 'Water',
          quantity: '1 cup',
          pantry_match: null,
          confidence: 0,
          add_to_list: false,
          always_skip: true,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredientsWithSkip} />);

      const waterCheckbox = screen.getByRole('checkbox', { name: /water/i });
      fireEvent.click(waterCheckbox);

      // Should still be unchecked
      expect(waterCheckbox).not.toBeChecked();
    });
  });

  describe('toggling ingredients', () => {
    it('should toggle ingredient checkbox state when clicked', () => {
      render(<PantryCheckModal {...defaultProps} />);

      const tomatoesCheckbox = screen.getByRole('checkbox', { name: /tomatoes/i });
      expect(tomatoesCheckbox).toBeChecked();

      fireEvent.click(tomatoesCheckbox);
      expect(tomatoesCheckbox).not.toBeChecked();

      fireEvent.click(tomatoesCheckbox);
      expect(tomatoesCheckbox).toBeChecked();
    });

    it('should update item count in submit button when toggling', () => {
      render(<PantryCheckModal {...defaultProps} />);

      // Initially 2 items (Tomatoes and Salt)
      expect(screen.getByRole('button', { name: /Add 2 Items/i })).toBeInTheDocument();

      // Uncheck Tomatoes
      const tomatoesCheckbox = screen.getByRole('checkbox', { name: /tomatoes/i });
      fireEvent.click(tomatoesCheckbox);

      expect(screen.getByRole('button', { name: /Add 1 Item$/i })).toBeInTheDocument();

      // Check Olive Oil
      const oliveOilCheckbox = screen.getByRole('checkbox', { name: /olive oil/i });
      fireEvent.click(oliveOilCheckbox);

      expect(screen.getByRole('button', { name: /Add 2 Items/i })).toBeInTheDocument();
    });
  });

  describe('pantry match display', () => {
    it('should show "In pantry" for items with have status', () => {
      render(<PantryCheckModal {...defaultProps} />);
      expect(screen.getByText('In pantry')).toBeInTheDocument();
    });

    it('should show "Running low" for items with low status', () => {
      const ingredients: CheckPantryIngredient[] = [
        {
          name: 'Butter',
          quantity: '1 tbsp',
          pantry_match: { id: 2, name: 'Butter', status: 'low' },
          confidence: 1.0,
          add_to_list: true,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredients} />);
      expect(screen.getByText('Running low')).toBeInTheDocument();
    });

    it('should show "Out of stock" for items with out status', () => {
      const ingredients: CheckPantryIngredient[] = [
        {
          name: 'Milk',
          quantity: '1 cup',
          pantry_match: { id: 3, name: 'Milk', status: 'out' },
          confidence: 1.0,
          add_to_list: true,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredients} />);
      expect(screen.getByText('Out of stock')).toBeInTheDocument();
    });

    it('should show matched name when different from ingredient name', () => {
      const ingredients: CheckPantryIngredient[] = [
        {
          name: 'Extra Virgin Olive Oil',
          quantity: '2 tbsp',
          pantry_match: { id: 1, name: 'Olive Oil', status: 'have' },
          confidence: 0.8,
          add_to_list: false,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredients} />);
      expect(screen.getByText('(matched: Olive Oil)')).toBeInTheDocument();
    });
  });

  describe('confirm action', () => {
    it('should call onConfirm with correct overrides when clicking Add button', () => {
      render(<PantryCheckModal {...defaultProps} />);

      const addButton = screen.getByRole('button', { name: /Add 2 Items/i });
      fireEvent.click(addButton);

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      expect(mockOnConfirm).toHaveBeenCalledWith([
        { name: 'Tomatoes', add_to_list: true },
        { name: 'Olive Oil', add_to_list: false },
        { name: 'Salt', add_to_list: true },
      ]);
    });

    it('should include toggled state in overrides', () => {
      render(<PantryCheckModal {...defaultProps} />);

      // Toggle Tomatoes off and Olive Oil on
      fireEvent.click(screen.getByRole('checkbox', { name: /tomatoes/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /olive oil/i }));

      const addButton = screen.getByRole('button', { name: /Add 2 Items/i });
      fireEvent.click(addButton);

      expect(mockOnConfirm).toHaveBeenCalledWith([
        { name: 'Tomatoes', add_to_list: false },
        { name: 'Olive Oil', add_to_list: true },
        { name: 'Salt', add_to_list: true },
      ]);
    });
  });

  describe('cancel action', () => {
    it('should call onCancel when clicking Cancel button', () => {
      render(<PantryCheckModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('should call onCancel when clicking backdrop', () => {
      const { container } = render(<PantryCheckModal {...defaultProps} />);

      // The backdrop is the outermost fixed div
      const backdrop = container.firstChild as HTMLElement;
      fireEvent.click(backdrop);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('submit button state', () => {
    it('should disable submit button when no items selected', () => {
      const ingredients: CheckPantryIngredient[] = [
        {
          name: 'Tomatoes',
          quantity: '2 lbs',
          pantry_match: null,
          confidence: 0,
          add_to_list: false,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredients} />);

      const addButton = screen.getByRole('button', { name: /Add 0 Items/i });
      expect(addButton).toBeDisabled();
    });

    it('should disable submit button when isSubmitting is true', () => {
      render(<PantryCheckModal {...defaultProps} isSubmitting={true} />);

      const addingButton = screen.getByRole('button', { name: /Adding.../i });
      expect(addingButton).toBeDisabled();
    });

    it('should show "Adding..." text when isSubmitting is true', () => {
      render(<PantryCheckModal {...defaultProps} isSubmitting={true} />);
      expect(screen.getByText('Adding...')).toBeInTheDocument();
    });

    it('should disable cancel button when isSubmitting is true', () => {
      render(<PantryCheckModal {...defaultProps} isSubmitting={true} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeDisabled();
    });
  });

  describe('pluralization', () => {
    it('should show "Item" for singular', () => {
      const ingredients: CheckPantryIngredient[] = [
        {
          name: 'Tomatoes',
          quantity: '2 lbs',
          pantry_match: null,
          confidence: 0,
          add_to_list: true,
        },
      ];

      render(<PantryCheckModal {...defaultProps} ingredients={ingredients} />);
      expect(screen.getByRole('button', { name: /Add 1 Item$/i })).toBeInTheDocument();
    });

    it('should show "Items" for plural', () => {
      render(<PantryCheckModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Add 2 Items/i })).toBeInTheDocument();
    });
  });
});
