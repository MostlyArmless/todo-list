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

// Helper to login via UI
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

// Capture recipe detail page with sample data
test('capture recipe detail', async ({ page, request }, testInfo) => {
  // Ensure user exists and login
  await request.post(`${API_URL}/api/v1/auth/register`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
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
    data: { name: 'Chicken breast', quantity: '2', notes: 'boneless' },
  });
  await request.post(`${API_URL}/api/v1/recipes/${recipe.id}/ingredients`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: 'Mixed greens', quantity: '4 cups' },
  });
  await request.post(`${API_URL}/api/v1/recipes/${recipe.id}/ingredients`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: 'Cherry tomatoes', quantity: '1 cup' },
  });

  // Login via UI
  await loginViaUI(page);

  await page.goto(`/recipes/${recipe.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const project = testInfo.project.name;
  await page.screenshot({
    path: `screenshots/recipe-detail-${project}.png`,
    fullPage: true,
  });
});
