function getApiUrl(): string {
  // In browser, use current origin so requests go through nginx
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Server-side rendering: use environment variable or default
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

class ApiClient {
  private getBaseUrl(): string {
    return getApiUrl();
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    // Handle empty responses (e.g., 204 No Content from DELETE)
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string) {
    const response = await this.request<{ access_token: string; user: User }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem('token', response.access_token);
      localStorage.setItem('user', JSON.stringify(response.user));
    }

    return response;
  }

  async register(email: string, password: string, name: string) {
    const response = await this.request<{ access_token: string; user: User }>(
      '/api/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem('token', response.access_token);
      localStorage.setItem('user', JSON.stringify(response.user));
    }

    return response;
  }

  logout() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }

  getCurrentUser(): User | null {
    if (typeof window === 'undefined') return null;
    try {
      const user = localStorage.getItem('user');
      if (!user || user === 'undefined' || user === 'null') {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        return null;
      }
      return JSON.parse(user);
    } catch (error) {
      // Clear corrupted data
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      return null;
    }
  }

  // Lists
  async getLists() {
    return this.request<List[]>('/api/v1/lists');
  }

  async getList(id: number) {
    return this.request<List>(`/api/v1/lists/${id}`);
  }

  async createList(data: { name: string; description?: string; icon?: string }) {
    return this.request<List>('/api/v1/lists', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateList(id: number, data: Partial<List>) {
    return this.request<List>(`/api/v1/lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteList(id: number) {
    return this.request<void>(`/api/v1/lists/${id}`, {
      method: 'DELETE',
    });
  }

  // Categories
  async getCategories(listId: number) {
    return this.request<Category[]>(`/api/v1/lists/${listId}/categories`);
  }

  async createCategory(listId: number, data: { name: string; sort_order?: number; color?: string }) {
    return this.request<Category>(`/api/v1/lists/${listId}/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCategory(id: number, data: Partial<Category>) {
    return this.request<Category>(`/api/v1/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCategory(id: number) {
    return this.request<void>(`/api/v1/categories/${id}`, {
      method: 'DELETE',
    });
  }

  // Items
  async getItems(listId: number, includeChecked = false) {
    const params = new URLSearchParams();
    if (includeChecked) params.set('include_checked', 'true');
    return this.request<Item[]>(`/api/v1/lists/${listId}/items?${params}`);
  }

  async createItem(listId: number, data: {
    name: string;
    category_id?: number;
    quantity?: string;
    description?: string;
  }) {
    return this.request<Item>(`/api/v1/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateItem(id: number, data: Partial<Item>) {
    return this.request<Item>(`/api/v1/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async checkItem(id: number) {
    return this.request<Item>(`/api/v1/items/${id}/check`, {
      method: 'POST',
    });
  }

  async uncheckItem(id: number) {
    return this.request<Item>(`/api/v1/items/${id}/uncheck`, {
      method: 'POST',
    });
  }

  async deleteItem(id: number) {
    return this.request<void>(`/api/v1/items/${id}`, {
      method: 'DELETE',
    });
  }

  async bulkDeleteItems(listId: number, itemIds: number[]) {
    return this.request<void>(`/api/v1/lists/${listId}/items/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify(itemIds),
    });
  }

  async autoCategorizeItems(listId: number) {
    return this.request<AutoCategorizeResult>(`/api/v1/lists/${listId}/items/auto-categorize`, {
      method: 'POST',
    });
  }

  // Recipes
  async getRecipes() {
    return this.request<RecipeListItem[]>('/api/v1/recipes');
  }

  async getRecipeLabelColors() {
    return this.request<{ colors: string[] }>('/api/v1/recipes/colors');
  }

  async getRecipe(id: number) {
    return this.request<Recipe>(`/api/v1/recipes/${id}`);
  }

  async createRecipe(data: {
    name: string;
    description?: string;
    servings?: number;
    instructions?: string;
    ingredients?: {
      name: string;
      quantity?: string;
      description?: string;
      store_preference?: string;
    }[];
  }) {
    return this.request<Recipe>('/api/v1/recipes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRecipe(id: number, data: { name?: string; description?: string; servings?: number; label_color?: string; instructions?: string }) {
    return this.request<Recipe>(`/api/v1/recipes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteRecipe(id: number) {
    return this.request<void>(`/api/v1/recipes/${id}`, {
      method: 'DELETE',
    });
  }

  async addIngredient(
    recipeId: number,
    data: { name: string; quantity?: string; description?: string; store_preference?: string }
  ) {
    return this.request<RecipeIngredient>(`/api/v1/recipes/${recipeId}/ingredients`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateIngredient(
    id: number,
    data: { name?: string; quantity?: string; description?: string; store_preference?: string }
  ) {
    return this.request<RecipeIngredient>(`/api/v1/recipes/ingredients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteIngredient(id: number) {
    return this.request<void>(`/api/v1/recipes/ingredients/${id}`, {
      method: 'DELETE',
    });
  }

  async addRecipesToList(recipeIds: number[]) {
    return this.request<AddToListResult>('/api/v1/recipes/add-to-list', {
      method: 'POST',
      body: JSON.stringify({ recipe_ids: recipeIds }),
    });
  }

  async undoAddToList(eventId: number) {
    return this.request<{ status: string }>(`/api/v1/recipes/add-events/${eventId}/undo`, {
      method: 'POST',
    });
  }

  async getStoreDefaults() {
    return this.request<IngredientStoreDefault[]>('/api/v1/recipes/store-defaults');
  }

  async setStoreDefault(ingredientName: string, storePreference: string) {
    return this.request<IngredientStoreDefault>('/api/v1/recipes/store-defaults', {
      method: 'POST',
      body: JSON.stringify({ ingredient_name: ingredientName, store_preference: storePreference }),
    });
  }

  // Pantry
  async getPantryItems() {
    return this.request<PantryItem[]>('/api/v1/pantry');
  }

  async createPantryItem(data: { name: string; status?: string; category?: string }) {
    return this.request<PantryItem>('/api/v1/pantry', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePantryItem(id: number, data: { name?: string; status?: string; category?: string }) {
    return this.request<PantryItem>(`/api/v1/pantry/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePantryItem(id: number) {
    return this.request<void>(`/api/v1/pantry/${id}`, {
      method: 'DELETE',
    });
  }

  async bulkAddPantryItems(items: { name: string; status?: string; category?: string }[]) {
    return this.request<PantryBulkAddResult>('/api/v1/pantry/bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  // Recipe Pantry Check
  async checkRecipePantry(recipeId: number) {
    return this.request<CheckPantryResponse>(`/api/v1/recipes/${recipeId}/check-pantry`, {
      method: 'POST',
    });
  }

  async addRecipesToListWithOverrides(
    recipeIds: number[],
    ingredientOverrides?: { name: string; add_to_list: boolean }[]
  ) {
    return this.request<AddToListResult>('/api/v1/recipes/add-to-list', {
      method: 'POST',
      body: JSON.stringify({
        recipe_ids: recipeIds,
        ingredient_overrides: ingredientOverrides,
      }),
    });
  }

  // Recipe Import
  async importRecipe(rawText: string): Promise<RecipeImport> {
    return this.request('/api/v1/recipes/import', {
      method: 'POST',
      body: JSON.stringify({ raw_text: rawText }),
    });
  }

  async getRecipeImport(importId: number): Promise<RecipeImport> {
    return this.request(`/api/v1/recipes/import/${importId}`);
  }

  async confirmRecipeImport(importId: number, edits?: {
    name?: string;
    servings?: number;
    ingredients?: { name: string; quantity?: string; description?: string; store_preference?: string }[];
    instructions?: string;
  }): Promise<Recipe> {
    return this.request(`/api/v1/recipes/import/${importId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(edits || {}),
    });
  }

  async deleteRecipeImport(importId: number): Promise<void> {
    return this.request(`/api/v1/recipes/import/${importId}`, { method: 'DELETE' });
  }

  // Step Completions
  async getStepCompletions(recipeId: number): Promise<StepCompletionsResponse> {
    return this.request(`/api/v1/recipes/${recipeId}/step-completions`);
  }

  async toggleStep(recipeId: number, stepIndex: number): Promise<StepToggleResponse> {
    return this.request(`/api/v1/recipes/${recipeId}/steps/${stepIndex}/toggle`, { method: 'POST' });
  }

  async resetStepCompletions(recipeId: number): Promise<void> {
    return this.request(`/api/v1/recipes/${recipeId}/step-completions`, { method: 'DELETE' });
  }
}

// Types
export interface User {
  id: number;
  email: string;
  name: string | null;
}

export interface List {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  owner_id: number;
  created_at: string;
}

export interface Category {
  id: number;
  list_id: number;
  name: string;
  sort_order: number;
  color: string | null;
  created_at: string;
}

export interface Item {
  id: number;
  list_id: number;
  category_id: number | null;
  name: string;
  description: string | null;
  quantity: string | null;
  checked: boolean;
  checked_at: string | null;
  sort_order: number;
  created_at: string;
  recipe_sources: { recipe_id: number; recipe_name: string; label_color?: string }[] | null;
}

export interface Recipe {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  servings: number | null;
  label_color: string | null;
  instructions: string | null;
  ingredients: RecipeIngredient[];
  created_at: string;
  updated_at: string;
}

export interface RecipeListItem {
  id: number;
  name: string;
  description: string | null;
  servings: number | null;
  label_color: string | null;
  ingredient_count: number;
  created_at: string;
}

export interface RecipeIngredient {
  id: number;
  recipe_id: number;
  name: string;
  quantity: string | null;
  description: string | null;
  store_preference: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddToListResult {
  event_id: number;
  grocery_items_added: number;
  costco_items_added: number;
  items_merged: number;
  items_skipped: number;
}

export interface IngredientStoreDefault {
  id: number;
  normalized_name: string;
  store_preference: string;
}

export interface AutoCategorizeResult {
  categorized: number;
  failed: number;
  results: {
    item_id: number;
    item_name: string;
    category_id: number | null;
    confidence: number;
    source: string;
    reasoning: string;
  }[];
}

export interface PantryItem {
  id: number;
  user_id: number;
  name: string;
  normalized_name: string;
  status: 'have' | 'low' | 'out';
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface PantryBulkAddResult {
  added: number;
  updated: number;
  items: PantryItem[];
}

export interface PantryMatch {
  id: number;
  name: string;
  status: 'have' | 'low' | 'out';
}

export interface CheckPantryIngredient {
  name: string;
  quantity: string | null;
  pantry_match: PantryMatch | null;
  confidence: number;
  add_to_list: boolean;
  always_skip?: boolean;  // True for items like "water" that are never added
}

export interface CheckPantryResponse {
  recipe_id: number;
  recipe_name: string;
  ingredients: CheckPantryIngredient[];
}

export interface RecipeImport {
  id: number;
  user_id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  parsed_recipe: ParsedRecipe | null;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface ParsedRecipe {
  name: string;
  servings: number | null;
  ingredients: { name: string; quantity: string | null; description: string | null }[];
  instructions: string;
}

export interface StepCompletionsResponse {
  completed_steps: number[];
}

export interface StepToggleResponse {
  completed: boolean;
}

export const api = new ApiClient();
