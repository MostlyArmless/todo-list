function getApiUrl(): string {
  // In browser, use current origin so requests go through nginx
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Server-side rendering: use environment variable or default
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

// Simple in-memory cache for GET requests
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTTL = 30000; // 30 seconds

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.defaultTTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}

const requestCache = new RequestCache();

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
    const method = options.method?.toUpperCase() || 'GET';
    const isGet = method === 'GET';

    // Check cache for GET requests
    if (isGet) {
      const cached = requestCache.get<T>(endpoint);
      if (cached) return cached;
    }

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

    const data = await response.json();

    // Cache GET responses
    if (isGet) {
      requestCache.set(endpoint, data);
    }

    return data;
  }

  // Helper for mutations that invalidates cache
  private async mutate<T>(
    endpoint: string,
    options: RequestInit,
    invalidatePatterns: string[]
  ): Promise<T> {
    const result = await this.request<T>(endpoint, options);
    invalidatePatterns.forEach(pattern => requestCache.invalidate(pattern));
    return result;
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

  async createList(data: { name: string; description?: string; icon?: string; list_type?: ListType }) {
    return this.mutate<List>('/api/v1/lists', {
      method: 'POST',
      body: JSON.stringify(data),
    }, ['/api/v1/lists']);
  }

  async updateList(id: number, data: Partial<List>) {
    return this.mutate<List>(`/api/v1/lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, ['/api/v1/lists']);
  }

  async deleteList(id: number) {
    return this.mutate<void>(`/api/v1/lists/${id}`, {
      method: 'DELETE',
    }, ['/api/v1/lists']);
  }

  // Categories
  async getCategories(listId: number) {
    return this.request<Category[]>(`/api/v1/lists/${listId}/categories`);
  }

  async createCategory(listId: number, data: { name: string; sort_order?: number; color?: string }) {
    return this.mutate<Category>(`/api/v1/lists/${listId}/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, [`/api/v1/lists/${listId}/categories`]);
  }

  async updateCategory(id: number, data: Partial<Category>) {
    return this.mutate<Category>(`/api/v1/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, ['/categories']);
  }

  async deleteCategory(id: number) {
    return this.mutate<void>(`/api/v1/categories/${id}`, {
      method: 'DELETE',
    }, ['/categories']);
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
    // Task-specific fields
    due_date?: string;
    reminder_at?: string;
    reminder_offset?: string;
    recurrence_pattern?: RecurrencePattern;
  }) {
    return this.mutate<Item>(`/api/v1/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, [`/api/v1/lists/${listId}/items`]);
  }

  async updateItem(id: number, data: Partial<Item>) {
    return this.mutate<Item>(`/api/v1/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, ['/items']);
  }

  async checkItem(id: number) {
    return this.mutate<Item>(`/api/v1/items/${id}/check`, {
      method: 'POST',
    }, ['/items']);
  }

  async uncheckItem(id: number) {
    return this.mutate<Item>(`/api/v1/items/${id}/uncheck`, {
      method: 'POST',
    }, ['/items']);
  }

  async completeItem(id: number) {
    return this.mutate<Item>(`/api/v1/items/${id}/complete`, {
      method: 'POST',
    }, ['/items']);
  }

  async deleteItem(id: number) {
    return this.mutate<void>(`/api/v1/items/${id}`, {
      method: 'DELETE',
    }, ['/items']);
  }

  async bulkDeleteItems(listId: number, itemIds: number[]) {
    return this.mutate<void>(`/api/v1/lists/${listId}/items/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify(itemIds),
    }, [`/api/v1/lists/${listId}/items`]);
  }

  async autoCategorizeItems(listId: number) {
    return this.mutate<AutoCategorizeResult>(`/api/v1/lists/${listId}/items/auto-categorize`, {
      method: 'POST',
    }, [`/api/v1/lists/${listId}/items`]);
  }

  // Recipes
  async getRecipes(sortBy?: RecipeSortBy) {
    const params = sortBy ? `?sort_by=${sortBy}` : '';
    return this.request<RecipeListItem[]>(`/api/v1/recipes${params}`);
  }

  async getRecipeLabelColors() {
    return this.request<{ colors: string[] }>('/api/v1/recipes/colors');
  }

  async getRecipe(id: number) {
    return this.request<Recipe>(`/api/v1/recipes/${id}`);
  }

  async computeRecipeNutrition(recipeId: number) {
    return this.mutate<{ message: string; recipe_id: number }>(
      `/api/v1/recipes/${recipeId}/compute-nutrition`,
      { method: 'POST' },
      [`/api/v1/recipes/${recipeId}`, '/api/v1/recipes']
    );
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
    return this.mutate<Recipe>('/api/v1/recipes', {
      method: 'POST',
      body: JSON.stringify(data),
    }, ['/api/v1/recipes']);
  }

  async updateRecipe(id: number, data: { name?: string; description?: string; servings?: number; label_color?: string; instructions?: string; last_cooked_at?: string | null }) {
    return this.mutate<Recipe>(`/api/v1/recipes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, [`/api/v1/recipes/${id}`, '/api/v1/recipes']);
  }

  async deleteRecipe(id: number) {
    return this.mutate<void>(`/api/v1/recipes/${id}`, {
      method: 'DELETE',
    }, ['/api/v1/recipes']);
  }

  async uploadRecipeImage(recipeId: number, file: File): Promise<Recipe> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {};
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.getBaseUrl()}/api/v1/recipes/${recipeId}/image`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    // Invalidate recipe caches
    requestCache.invalidate(`/api/v1/recipes/${recipeId}`);
    requestCache.invalidate('/api/v1/recipes');

    return response.json();
  }

  async deleteRecipeImage(recipeId: number): Promise<void> {
    return this.mutate<void>(`/api/v1/recipes/${recipeId}/image`, {
      method: 'DELETE',
    }, [`/api/v1/recipes/${recipeId}`, '/api/v1/recipes']);
  }

  async addIngredient(
    recipeId: number,
    data: { name: string; quantity?: string; description?: string; store_preference?: string }
  ) {
    return this.mutate<RecipeIngredient>(`/api/v1/recipes/${recipeId}/ingredients`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, [`/api/v1/recipes/${recipeId}`]);
  }

  async updateIngredient(
    id: number,
    data: { name?: string; quantity?: string; description?: string; store_preference?: string }
  ) {
    return this.mutate<RecipeIngredient>(`/api/v1/recipes/ingredients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, ['/recipes/']);
  }

  async deleteIngredient(id: number) {
    return this.mutate<void>(`/api/v1/recipes/ingredients/${id}`, {
      method: 'DELETE',
    }, ['/recipes/']);
  }

  async addRecipesToList(recipeIds: number[]) {
    return this.mutate<AddToListResult>('/api/v1/recipes/add-to-list', {
      method: 'POST',
      body: JSON.stringify({ recipe_ids: recipeIds }),
    }, ['/items', '/api/v1/lists']);
  }

  async undoAddToList(eventId: number) {
    return this.mutate<{ status: string }>(`/api/v1/recipes/add-events/${eventId}/undo`, {
      method: 'POST',
    }, ['/items', '/api/v1/lists']);
  }

  async getStoreDefaults() {
    return this.request<IngredientStoreDefault[]>('/api/v1/recipes/store-defaults');
  }

  async setStoreDefault(ingredientName: string, storePreference: string) {
    return this.mutate<IngredientStoreDefault>('/api/v1/recipes/store-defaults', {
      method: 'POST',
      body: JSON.stringify({ ingredient_name: ingredientName, store_preference: storePreference }),
    }, ['/api/v1/recipes/store-defaults']);
  }

  // Pantry
  async getPantryItems() {
    return this.request<PantryItem[]>('/api/v1/pantry');
  }

  async getPantryItemsWithRecipes() {
    return this.request<PantryItemWithRecipes[]>('/api/v1/pantry/with-recipes');
  }

  async createPantryItem(data: { name: string; status?: string; category?: string; preferred_store?: string }) {
    return this.mutate<PantryItem>('/api/v1/pantry', {
      method: 'POST',
      body: JSON.stringify(data),
    }, ['/api/v1/pantry', '/pantry-status']);
  }

  async updatePantryItem(id: number, data: { name?: string; status?: string; category?: string; preferred_store?: string }) {
    return this.mutate<PantryItem>(`/api/v1/pantry/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, ['/api/v1/pantry', '/pantry-status']);
  }

  async deletePantryItem(id: number) {
    return this.mutate<void>(`/api/v1/pantry/${id}`, {
      method: 'DELETE',
    }, ['/api/v1/pantry', '/pantry-status']);
  }

  async bulkAddPantryItems(items: { name: string; status?: string; category?: string }[]) {
    return this.mutate<PantryBulkAddResult>('/api/v1/pantry/bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }, ['/api/v1/pantry', '/pantry-status']);
  }

  // Receipt Scanning
  async scanReceipt(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {};
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.getBaseUrl()}/api/v1/pantry/scan-receipt`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json() as Promise<ReceiptScanCreateResponse>;
  }

  async getReceiptScan(scanId: number) {
    return this.request<ReceiptScanResponse>(`/api/v1/pantry/scan-receipt/${scanId}`);
  }

  async getReceiptScans(limit = 10) {
    return this.request<ReceiptScanResponse[]>(`/api/v1/pantry/scan-receipts?limit=${limit}`);
  }

  // Recipe Pantry Check
  async checkRecipePantry(recipeId: number) {
    return this.request<CheckPantryResponse>(`/api/v1/recipes/${recipeId}/check-pantry`, {
      method: 'POST',
    });
  }

  async getRecipesPantryStatus() {
    return this.request<BulkPantryCheckResponse>('/api/v1/recipes/pantry-status');
  }

  async addRecipesToListWithOverrides(
    recipeIds: number[],
    ingredientOverrides?: { name: string; add_to_list: boolean }[]
  ) {
    return this.mutate<AddToListResult>('/api/v1/recipes/add-to-list', {
      method: 'POST',
      body: JSON.stringify({
        recipe_ids: recipeIds,
        ingredient_overrides: ingredientOverrides,
      }),
    }, ['/items', '/api/v1/lists']);
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
    return this.mutate(`/api/v1/recipes/import/${importId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(edits || {}),
    }, ['/api/v1/recipes']);
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

  // Notifications
  async getVapidPublicKey(): Promise<{ public_key: string | null }> {
    return this.request('/api/v1/notifications/vapid-public-key');
  }

  async subscribePush(subscription: {
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
  }): Promise<PushSubscription> {
    return this.request('/api/v1/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  }

  async unsubscribePush(endpoint: string): Promise<void> {
    return this.request(`/api/v1/notifications/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
    });
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    return this.request('/api/v1/notifications/settings');
  }

  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    return this.request('/api/v1/notifications/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async respondToReminder(itemId: number, response: string): Promise<ReminderResponseResult> {
    return this.request('/api/v1/notifications/respond', {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, response }),
    });
  }

  // Voice Input Confirmations
  async getPendingConfirmations(): Promise<VoiceQueueResponse> {
    // Use cache-busting param since this is polled frequently
    return this.request(`/api/v1/voice/pending/list?_=${Date.now()}`);
  }

  async confirmPendingConfirmation(
    id: number,
    edits?: { list_id?: number; items?: { name: string; category_id?: number | null }[] }
  ): Promise<PendingConfirmation> {
    return this.mutate(`/api/v1/voice/pending/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm', edits }),
    }, ['/api/v1/voice/pending', '/items', '/api/v1/lists']);
  }

  async rejectPendingConfirmation(id: number): Promise<PendingConfirmation> {
    return this.mutate(`/api/v1/voice/pending/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reject' }),
    }, ['/api/v1/voice/pending']);
  }

  async deleteVoiceInput(id: number): Promise<void> {
    return this.mutate(`/api/v1/voice/${id}`, {
      method: 'DELETE',
    }, ['/api/v1/voice/pending']);
  }

  async retryVoiceInput(id: number, rawText: string): Promise<void> {
    return this.mutate(`/api/v1/voice/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ raw_text: rawText }),
    }, ['/api/v1/voice/pending']);
  }
}

// Types
export interface User {
  id: number;
  email: string;
  name: string | null;
}

export type ListType = 'grocery' | 'task';

export interface List {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  owner_id: number;
  list_type: ListType;
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

export type RecurrencePattern = 'daily' | 'weekly' | 'monthly';

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
  // Task-specific fields (null for grocery items)
  due_date: string | null;
  reminder_at: string | null;
  reminder_offset: string | null;
  recurrence_pattern: RecurrencePattern | null;
  recurrence_parent_id: number | null;
  completed_at: string | null;
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
  // Nutrition data (null if not yet computed)
  calories_per_serving: number | null;
  protein_grams: number | null;
  carbs_grams: number | null;
  fat_grams: number | null;
  nutrition_computed_at: string | null;
  last_cooked_at: string | null;
  // Image URLs (null if no image uploaded)
  image_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export type RecipeSortBy =
  | 'name_asc'
  | 'name_desc'
  | 'ingredients_asc'
  | 'ingredients_desc'
  | 'last_cooked_asc'
  | 'last_cooked_desc'
  | 'calories_asc'
  | 'calories_desc'
  | 'protein_asc'
  | 'protein_desc'
  | 'created_at_desc'
  | 'updated_at_desc';

export interface RecipeListItem {
  id: number;
  name: string;
  description: string | null;
  servings: number | null;
  label_color: string | null;
  ingredient_count: number;
  // Nutrition data (null if not yet computed)
  calories_per_serving: number | null;
  protein_grams: number | null;
  carbs_grams: number | null;
  fat_grams: number | null;
  last_cooked_at: string | null;
  // Image thumbnail URL (null if no image uploaded)
  thumbnail_url: string | null;
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
  preferred_store: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeRef {
  id: number;
  name: string;
  label_color: string | null;
}

export interface PantryItemWithRecipes extends PantryItem {
  recipe_count: number;
  recipes: RecipeRef[];
}

export interface PantryBulkAddResult {
  added: number;
  updated: number;
  items: PantryItem[];
}

export interface ParsedReceiptItem {
  name: string;
  quantity: string | null;
  matched_pantry_id: number | null;
  action: 'added' | 'updated' | null;
}

export interface ReceiptScanCreateResponse {
  id: number;
  status: string;
  message: string;
}

export interface ReceiptScanResponse {
  id: number;
  user_id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  parsed_items: ParsedReceiptItem[] | null;
  items_added: number | null;
  items_updated: number | null;
  processed_at: string | null;
  created_at: string;
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

export interface RecipePantryStatus {
  recipe_id: number;
  total_ingredients: number;
  ingredients_in_pantry: number;
  have_count: number;
  low_count: number;
  out_count: number;
  unmatched_count: number;
}

export interface BulkPantryCheckResponse {
  recipes: RecipePantryStatus[];
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

export interface ProposedItem {
  name: string;
  category_id: number | null;
  confidence: number;
  reasoning: string;
}

export interface ProposedChanges {
  action: string;
  list_id: number;
  list_name: string;
  items: ProposedItem[];
}

export interface PendingConfirmation {
  id: number;
  user_id: number;
  voice_input_id: number;
  proposed_changes: ProposedChanges;
  status: string;
  created_at: string;
}

export interface InProgressVoiceJob {
  id: number;
  raw_text: string;
  status: 'pending' | 'processing' | 'failed';
  error_message: string | null;
  created_at: string;
}

export interface VoiceQueueResponse {
  in_progress: InProgressVoiceJob[];
  pending_confirmations: PendingConfirmation[];
}

// Notification types
export interface PushSubscription {
  id: number;
  endpoint: string;
  created_at: string;
}

export interface NotificationSettings {
  id: number;
  phone_number: string | null;
  accountability_partner_phone: string | null;
  escape_safe_word: string;
  escalation_timing: {
    push_to_sms: number;
    sms_to_call: number;
    call_repeat: number;
  };
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string;
}

export interface ReminderResponseResult {
  action: 'complete' | 'reschedule' | 'pushback' | 'escape';
  new_reminder_at?: string;
  pushback_message?: string;
}

export const api = new ApiClient();
