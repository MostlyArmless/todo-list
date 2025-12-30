/**
 * Screenshot utility for capturing UI state.
 *
 * Usage:
 *   npx playwright test e2e/screenshot.spec.ts --project=mobile
 *   npx playwright test e2e/screenshot.spec.ts --project=desktop
 *
 * Screenshots saved to: web/screenshots/
 */
import { test, expect } from '@playwright/test';

// API base URL (FastAPI backend)
const API_URL = 'http://127.0.0.1:8000';

// Test user credentials
const TEST_EMAIL = 'screenshot-test@example.com';
const TEST_PASSWORD = 'testpassword123';

// Helper to login by setting localStorage token directly (bypasses UI login)
// Also sets up API route interception to proxy /api/* to the backend
async function loginViaAPI(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  // Get token from API
  const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const { access_token, user } = await loginResponse.json();

  // Intercept API calls and proxy them to the FastAPI backend
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const backendUrl = `${API_URL}${url.pathname}${url.search}`;

    const response = await request.fetch(backendUrl, {
      method: route.request().method(),
      headers: route.request().headers(),
      data: route.request().postData() || undefined,
    });

    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    });
  });

  // Set token in localStorage before navigating
  await page.goto('/');
  await page.evaluate(({ token, userData }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
  }, { token: access_token, userData: user });
}

// Legacy UI login (kept for reference, but loginViaAPI is preferred)
async function loginViaUI(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for navigation away from login
  await page.waitForURL(/\/(lists|recipes|pantry|confirm)/, { timeout: 5000 });
  await page.waitForLoadState('networkidle');
}

// Pages that require authentication
const AUTH_PAGES = [
  { path: '/lists', name: 'lists' },
  { path: '/recipes', name: 'recipes' },
  { path: '/pantry', name: 'pantry' },
];

test.describe('UI Screenshots', () => {
  // Register test user once before all tests
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_URL}/api/v1/auth/register`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
  });

  // Capture login page (no auth needed)
  test('capture login', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `screenshots/login-${project}.png`,
      fullPage: true,
    });
  });

  // Capture authenticated pages
  for (const { path, name } of AUTH_PAGES) {
    test(`capture ${name}`, async ({ page }, testInfo) => {
      await loginViaUI(page);

      // Navigate to the page
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      const project = testInfo.project.name;
      await page.screenshot({
        path: `screenshots/${name}-${project}.png`,
        fullPage: true,
      });
    });
  }
});

// Capture list detail page with sample data
test('capture list detail', async ({ page, request }, testInfo) => {
  // Ensure user exists and login
  await request.post(`${API_URL}/api/v1/auth/register`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const { access_token } = await loginResponse.json();

  // Create a test list with items
  const listResponse = await request.post(`${API_URL}/api/v1/lists`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: 'Weekly Groceries' },
  });
  const list = await listResponse.json();

  // Add some items
  await request.post(`${API_URL}/api/v1/items`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { list_id: list.id, name: 'Milk', category: 'Dairy' },
  });
  await request.post(`${API_URL}/api/v1/items`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { list_id: list.id, name: 'Bread', category: 'Bakery' },
  });
  await request.post(`${API_URL}/api/v1/items`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { list_id: list.id, name: 'Apples', category: 'Produce' },
  });
  await request.post(`${API_URL}/api/v1/items`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { list_id: list.id, name: 'Chicken breast', category: 'Meat' },
  });

  // Login via UI
  await loginViaUI(page);

  await page.goto(`/list/${list.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const project = testInfo.project.name;
  await page.screenshot({
    path: `screenshots/list-detail-${project}.png`,
    fullPage: true,
  });
});

// Capture pantry page with sample data
test('capture pantry with data', async ({ page, request }, testInfo) => {
  // Ensure user exists
  await request.post(`${API_URL}/api/v1/auth/register`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const { access_token } = await loginResponse.json();
  const headers = { Authorization: `Bearer ${access_token}` };

  // Clear existing pantry items first
  const existingItemsRes = await request.get(`${API_URL}/api/v1/pantry`, { headers });
  const existingItems = await existingItemsRes.json();
  for (const item of existingItems) {
    await request.delete(`${API_URL}/api/v1/pantry/${item.id}`, { headers });
  }

  // Create pantry items with various statuses, categories, and stores
  const pantryItems = [
    { name: 'Olive Oil', status: 'have', category: 'Oils & Vinegars', preferred_store: 'Costco' },
    { name: 'Salt', status: 'have', category: 'Spices', preferred_store: 'Grocery' },
    { name: 'Black Pepper', status: 'low', category: 'Spices', preferred_store: 'Grocery' },
    { name: 'Garlic Powder', status: 'out', category: 'Spices' },
    { name: 'Onion Powder', status: 'have', category: 'Spices' },
    { name: 'Rice', status: 'low', category: 'Grains', preferred_store: 'Costco' },
    { name: 'Pasta', status: 'have', category: 'Grains' },
    { name: 'Chicken Broth', status: 'out', category: 'Canned Goods', preferred_store: 'Grocery' },
    { name: 'Diced Tomatoes', status: 'have', category: 'Canned Goods' },
    { name: 'Butter', status: 'low', category: 'Dairy', preferred_store: 'Costco' },
  ];

  for (const item of pantryItems) {
    await request.post(`${API_URL}/api/v1/pantry`, { headers, data: item });
  }

  // Login via API and set localStorage
  await loginViaAPI(page, request);

  await page.goto('/pantry');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const project = testInfo.project.name;
  await page.screenshot({
    path: `screenshots/pantry-data-${project}.png`,
    fullPage: true,
  });
});

// Capture recipes list page with sample data
test('capture recipes list', async ({ page, request }, testInfo) => {
  // Ensure user exists
  await request.post(`${API_URL}/api/v1/auth/register`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const { access_token } = await loginResponse.json();
  const headers = { Authorization: `Bearer ${access_token}` };

  // Clear existing recipes first
  const existingRecipesRes = await request.get(`${API_URL}/api/v1/recipes`, { headers });
  const existingRecipes = await existingRecipesRes.json();
  for (const recipe of existingRecipes) {
    await request.delete(`${API_URL}/api/v1/recipes/${recipe.id}`, { headers });
  }

  // Create sample recipes and then update with nutrition data
  const recipesData = [
    {
      name: 'Chicken Stir Fry',
      description: 'Quick and easy weeknight dinner',
      servings: 4,
      nutrition: { calories_per_serving: 385, protein_grams: 32, carbs_grams: 28, fat_grams: 16 },
    },
    {
      name: 'Spaghetti Carbonara',
      description: 'Classic Italian pasta with pancetta',
      servings: 2,
      nutrition: { calories_per_serving: 520, protein_grams: 24, carbs_grams: 58, fat_grams: 22 },
    },
    {
      name: 'Greek Salad',
      servings: 4,
      nutrition: { calories_per_serving: 180, protein_grams: 6, carbs_grams: 12, fat_grams: 14 },
    },
  ];

  for (const { nutrition, ...recipeData } of recipesData) {
    const res = await request.post(`${API_URL}/api/v1/recipes`, { headers, data: recipeData });
    const recipe = await res.json();
    // Update with nutrition data
    await request.put(`${API_URL}/api/v1/recipes/${recipe.id}`, {
      headers,
      data: nutrition,
    });
  }

  // Login via API and set localStorage
  await loginViaAPI(page, request);

  await page.goto('/recipes');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const project = testInfo.project.name;
  await page.screenshot({
    path: `screenshots/recipes-list-${project}.png`,
    fullPage: true,
  });
});

// Capture recipe detail page with sample data
test('capture recipe detail', async ({ page, request }, testInfo) => {
  // Ensure user exists
  await request.post(`${API_URL}/api/v1/auth/register`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });

  // Login via API (sets localStorage and intercepts API calls)
  await loginViaAPI(page, request);

  // Get token for creating test data
  const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const { access_token } = await loginResponse.json();

  // Create a test recipe
  const recipeResponse = await request.post(`${API_URL}/api/v1/recipes`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: {
      name: 'Grilled Chicken Salad',
      servings: 2,
      instructions: '1. Season chicken with salt and pepper\n2. Grill chicken until cooked through\n3. Slice and serve over mixed greens\n4. Add your favorite dressing',
    },
  });
  const recipe = await recipeResponse.json();

  // Add ingredients
  await request.post(`${API_URL}/api/v1/recipes/${recipe.id}/ingredients`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: 'Chicken breast', quantity: '2', description: 'boneless' },
  });
  await request.post(`${API_URL}/api/v1/recipes/${recipe.id}/ingredients`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: 'Mixed greens', quantity: '4 cups' },
  });
  await request.post(`${API_URL}/api/v1/recipes/${recipe.id}/ingredients`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: 'Cherry tomatoes', quantity: '1 cup' },
  });

  await page.goto(`/recipes/${recipe.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const project = testInfo.project.name;
  await page.screenshot({
    path: `screenshots/recipe-detail-${project}.png`,
    fullPage: true,
  });

  // Click "Add to Shopping List" to show the pantry check modal
  await page.click('button:has-text("Add to Shopping List")');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: `screenshots/recipe-add-to-list-modal-${project}.png`,
    fullPage: true,
  });
});
