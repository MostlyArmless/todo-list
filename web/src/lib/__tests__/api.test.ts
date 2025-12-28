import { api } from '../api';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper to set up localStorage mock for each test
function setupLocalStorageMock() {
  const storage: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => storage[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
    }),
    clear: jest.fn(() => {
      Object.keys(storage).forEach(key => delete storage[key]);
    }),
  };
}

describe('API Client', () => {
  let localStorageMock: ReturnType<typeof setupLocalStorageMock>;

  beforeEach(() => {
    mockFetch.mockClear();
    localStorageMock = setupLocalStorageMock();
    Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
  });

  describe('Authentication', () => {
    it('should store token and user on successful registration', async () => {
      const mockResponse = {
        access_token: 'test-token',
        user: { id: 1, email: 'test@example.com', name: 'Test User' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        headers: new Headers({ 'content-length': '100' }),
      });

      await api.register('test@example.com', 'password123', 'Test User');

      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'test-token');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'user',
        JSON.stringify(mockResponse.user)
      );
    });

    it('should store token and user on successful login', async () => {
      const mockResponse = {
        access_token: 'test-token',
        user: { id: 1, email: 'test@example.com', name: 'Test User' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        headers: new Headers({ 'content-length': '100' }),
      });

      await api.login('test@example.com', 'password123');

      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'test-token');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'user',
        JSON.stringify(mockResponse.user)
      );
    });

    it('should clear storage on logout', () => {
      api.logout();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
    });

    it('should handle corrupted user data in localStorage', () => {
      localStorageMock.getItem.mockReturnValue('undefined');

      const user = api.getCurrentUser();

      expect(user).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
    });

    it('should parse valid user data from localStorage', () => {
      const mockUser = { id: 1, email: 'test@example.com', name: 'Test User' };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockUser));

      const user = api.getCurrentUser();

      expect(user).toEqual(mockUser);
    });

    it('should handle null user data in localStorage', () => {
      localStorageMock.getItem.mockReturnValue('null');

      const user = api.getCurrentUser();

      expect(user).toBeNull();
    });

    it('should handle invalid JSON in localStorage', () => {
      localStorageMock.getItem.mockReturnValue('{invalid json}');

      const user = api.getCurrentUser();

      expect(user).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
    });
  });

  describe('API Requests', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockImplementation((key) => {
        if (key === 'token') return 'test-token';
        return null;
      });
    });

    it('should include authorization header when token exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers({ 'content-length': '2' }),
      });

      await api.getLists();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should handle empty responses from DELETE requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      const result = await api.deleteList(1);

      expect(result).toBeUndefined();
    });

    it('should clear localStorage on 401 error', async () => {
      // Mock window.location.href
      delete (window as unknown as { location?: unknown }).location;
      (window as unknown as { location: { href: string } }).location = { href: '' };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Unauthorized' }),
      });

      await expect(api.getLists()).rejects.toThrow();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
    });

    it('should throw error with detail message on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Bad request message' }),
      });

      await expect(api.getLists()).rejects.toThrow('Bad request message');
    });

    it('should throw generic error when no detail', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(api.getLists()).rejects.toThrow('HTTP 500');
    });
  });

  describe('Lists', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('test-token');
    });

    it('should create a list', async () => {
      const mockList = { id: 1, name: 'Shopping', icon: '🛒', description: 'Weekly shopping' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockList,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.createList({
        name: 'Shopping',
        icon: '🛒',
        description: 'Weekly shopping',
      });

      expect(result).toEqual(mockList);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lists'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Shopping', icon: '🛒', description: 'Weekly shopping' }),
        })
      );
    });

    it('should get all lists', async () => {
      const mockLists = [
        { id: 1, name: 'Shopping' },
        { id: 2, name: 'Todo' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockLists,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getLists();

      expect(result).toEqual(mockLists);
    });

    it('should get a single list', async () => {
      const mockList = { id: 1, name: 'Shopping' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockList,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getList(1);

      expect(result).toEqual(mockList);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lists/1'),
        expect.anything()
      );
    });

    it('should update a list', async () => {
      const mockList = { id: 1, name: 'Updated Shopping' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockList,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.updateList(1, { name: 'Updated Shopping' });

      expect(result).toEqual(mockList);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lists/1'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should delete a list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.deleteList(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lists/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Categories', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('test-token');
    });

    it('should get categories for a list', async () => {
      const mockCategories = [{ id: 1, name: 'Produce', list_id: 1 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCategories,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getCategories(1);

      expect(result).toEqual(mockCategories);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lists/1/categories'),
        expect.anything()
      );
    });

    it('should create a category', async () => {
      const mockCategory = { id: 1, name: 'Dairy', list_id: 1, sort_order: 0 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCategory,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.createCategory(1, { name: 'Dairy', sort_order: 0 });

      expect(result).toEqual(mockCategory);
    });

    it('should update category', async () => {
      const mockCategory = { id: 1, name: 'Dairy Updated', list_id: 1, sort_order: 0 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCategory,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.updateCategory(1, { name: 'Dairy Updated' });

      expect(result).toEqual(mockCategory);
    });

    it('should delete a category', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.deleteCategory(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/categories/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Items', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('test-token');
    });

    it('should get items for a list', async () => {
      const mockItems = [{ id: 1, name: 'Milk', list_id: 1 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItems,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getItems(1);

      expect(result).toEqual(mockItems);
    });

    it('should get items with checked included', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers({ 'content-length': '2' }),
      });

      await api.getItems(1, true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('include_checked=true'),
        expect.anything()
      );
    });

    it('should create an item', async () => {
      const mockItem = { id: 1, name: 'Bread', list_id: 1 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItem,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.createItem(1, { name: 'Bread' });

      expect(result).toEqual(mockItem);
    });

    it('should update an item', async () => {
      const mockItem = { id: 1, name: 'Updated Bread', list_id: 1 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItem,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.updateItem(1, { name: 'Updated Bread' });

      expect(result).toEqual(mockItem);
    });

    it('should check an item', async () => {
      const mockItem = { id: 1, name: 'Milk', checked: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItem,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.checkItem(1);

      expect(result).toEqual(mockItem);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/items/1/check'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should uncheck an item', async () => {
      const mockItem = { id: 1, name: 'Milk', checked: false };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItem,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.uncheckItem(1);

      expect(result).toEqual(mockItem);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/items/1/uncheck'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should delete an item', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.deleteItem(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/items/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should bulk delete items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.bulkDeleteItems(1, [1, 2, 3]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lists/1/items/bulk-delete'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify([1, 2, 3]),
        })
      );
    });

    it('should auto-categorize items', async () => {
      const mockResult = { categorized: 5, failed: 1, results: [] };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.autoCategorizeItems(1);

      expect(result).toEqual(mockResult);
    });
  });

  describe('Recipes', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('test-token');
    });

    it('should get all recipes', async () => {
      const mockRecipes = [{ id: 1, name: 'Pasta', ingredient_count: 5 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRecipes,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getRecipes();

      expect(result).toEqual(mockRecipes);
    });

    it('should get a single recipe', async () => {
      const mockRecipe = { id: 1, name: 'Pasta', ingredients: [] };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRecipe,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getRecipe(1);

      expect(result).toEqual(mockRecipe);
    });

    it('should create a recipe', async () => {
      const mockRecipe = { id: 1, name: 'New Recipe', ingredients: [] };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRecipe,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.createRecipe({ name: 'New Recipe' });

      expect(result).toEqual(mockRecipe);
    });

    it('should update a recipe', async () => {
      const mockRecipe = { id: 1, name: 'Updated Recipe' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRecipe,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.updateRecipe(1, { name: 'Updated Recipe' });

      expect(result).toEqual(mockRecipe);
    });

    it('should delete a recipe', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.deleteRecipe(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/recipes/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should add ingredient to recipe', async () => {
      const mockIngredient = { id: 1, name: 'Tomatoes', recipe_id: 1 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIngredient,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.addIngredient(1, { name: 'Tomatoes' });

      expect(result).toEqual(mockIngredient);
    });

    it('should update an ingredient', async () => {
      const mockIngredient = { id: 1, name: 'Updated Tomatoes' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIngredient,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.updateIngredient(1, { name: 'Updated Tomatoes' });

      expect(result).toEqual(mockIngredient);
    });

    it('should delete an ingredient', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.deleteIngredient(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/recipes/ingredients/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should add recipes to list', async () => {
      const mockResult = { event_id: 1, grocery_items_added: 3, costco_items_added: 2, items_merged: 1, items_skipped: 0 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.addRecipesToList([1, 2]);

      expect(result).toEqual(mockResult);
    });

    it('should undo add to list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'undone' }),
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.undoAddToList(1);

      expect(result).toEqual({ status: 'undone' });
    });

    it('should get store defaults', async () => {
      const mockDefaults = [{ id: 1, normalized_name: 'milk', store_preference: 'costco' }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDefaults,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getStoreDefaults();

      expect(result).toEqual(mockDefaults);
    });

    it('should set store default', async () => {
      const mockDefault = { id: 1, normalized_name: 'milk', store_preference: 'costco' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDefault,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.setStoreDefault('milk', 'costco');

      expect(result).toEqual(mockDefault);
    });

    it('should check recipe pantry', async () => {
      const mockResult = { recipe_id: 1, recipe_name: 'Pasta', ingredients: [] };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.checkRecipePantry(1);

      expect(result).toEqual(mockResult);
    });

    it('should add recipes to list with overrides', async () => {
      const mockResult = { event_id: 1, grocery_items_added: 2, costco_items_added: 1, items_merged: 0, items_skipped: 1 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.addRecipesToListWithOverrides([1], [{ name: 'salt', add_to_list: false }]);

      expect(result).toEqual(mockResult);
    });
  });

  describe('Pantry', () => {
    beforeEach(() => {
      localStorageMock.getItem.mockReturnValue('test-token');
    });

    it('should get pantry items', async () => {
      const mockItems = [{ id: 1, name: 'Olive Oil', status: 'have' }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItems,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.getPantryItems();

      expect(result).toEqual(mockItems);
    });

    it('should create pantry item', async () => {
      const mockItem = { id: 1, name: 'Salt', status: 'have' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItem,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.createPantryItem({ name: 'Salt' });

      expect(result).toEqual(mockItem);
    });

    it('should update pantry item', async () => {
      const mockItem = { id: 1, name: 'Salt', status: 'low' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItem,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.updatePantryItem(1, { status: 'low' });

      expect(result).toEqual(mockItem);
    });

    it('should delete pantry item', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
      });

      await api.deletePantryItem(1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/pantry/1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should bulk add pantry items', async () => {
      const mockResult = { added: 2, updated: 1, items: [] };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
        headers: new Headers({ 'content-length': '100' }),
      });

      const result = await api.bulkAddPantryItems([{ name: 'Salt' }, { name: 'Pepper' }]);

      expect(result).toEqual(mockResult);
    });
  });
});
