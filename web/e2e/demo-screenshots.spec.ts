/**
 * Demo screenshots for README documentation.
 *
 * Uses the persistent demo database (todo_list_demo) with pre-seeded data.
 * Run the seed script first: docker compose exec api python scripts/seed_demo_data.py
 *
 * Usage:
 *   npx playwright test e2e/demo-screenshots.spec.ts --project=mobile
 *
 * Screenshots saved to: docs/images/
 */
import { test, expect } from '@playwright/test';

// API base URL (FastAPI backend)
const API_URL = 'http://127.0.0.1:8000';

// Demo user credentials (must match seed script)
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demopass123';

// Helper to login and set up API interception
async function loginDemo(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext
) {
  // Get token from API
  const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  if (!loginResponse.ok()) {
    throw new Error(
      `Demo login failed. Make sure to run: docker compose exec api python scripts/seed_demo_data.py`
    );
  }

  const { access_token, user } = await loginResponse.json();

  // Intercept API calls and proxy to backend
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
  await page.evaluate(
    ({ token, userData }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(userData));
    },
    { token: access_token, userData: user }
  );

  return { access_token, user };
}

test.describe('README Demo Screenshots', () => {
  test.beforeAll(async ({ request }) => {
    // Verify demo user exists
    const response = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    if (!response.ok()) {
      throw new Error(
        'Demo user not found. Run: docker compose exec api python scripts/seed_demo_data.py'
      );
    }
  });

  test('capture lists page', async ({ page, request }, testInfo) => {
    await loginDemo(page, request);
    await page.goto('/lists');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `../docs/images/lists-${project}.png`,
      fullPage: true,
    });
  });

  test('capture grocery list detail', async ({ page, request }, testInfo) => {
    const { access_token } = await loginDemo(page, request);

    // Find the grocery list ID
    const listsResponse = await request.get(`${API_URL}/api/v1/lists`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const lists = await listsResponse.json();
    const groceryList = lists.find((l: { list_type: string }) => l.list_type === 'grocery');

    if (!groceryList) {
      throw new Error('Grocery list not found in demo data');
    }

    await page.goto(`/list/${groceryList.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `../docs/images/grocery-list-${project}.png`,
      fullPage: true,
    });
  });

  test('capture task list detail', async ({ page, request }, testInfo) => {
    const { access_token } = await loginDemo(page, request);

    // Find the task list ID
    const listsResponse = await request.get(`${API_URL}/api/v1/lists`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const lists = await listsResponse.json();
    const taskList = lists.find((l: { list_type: string }) => l.list_type === 'task');

    if (!taskList) {
      throw new Error('Task list not found in demo data');
    }

    await page.goto(`/list/${taskList.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `../docs/images/task-list-${project}.png`,
      fullPage: true,
    });
  });

  test('capture recipes page', async ({ page, request }, testInfo) => {
    await loginDemo(page, request);
    await page.goto('/recipes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `../docs/images/recipes-${project}.png`,
      fullPage: true,
    });
  });

  test('capture recipe detail', async ({ page, request }, testInfo) => {
    const { access_token } = await loginDemo(page, request);

    // Find a recipe ID
    const recipesResponse = await request.get(`${API_URL}/api/v1/recipes`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const recipes = await recipesResponse.json();

    if (!recipes.length) {
      throw new Error('No recipes found in demo data');
    }

    // Use the first recipe (Guacamole)
    await page.goto(`/recipes/${recipes[0].id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `../docs/images/recipe-detail-${project}.png`,
      fullPage: true,
    });
  });

  test('capture pantry page', async ({ page, request }, testInfo) => {
    await loginDemo(page, request);
    await page.goto('/pantry');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const project = testInfo.project.name;
    await page.screenshot({
      path: `../docs/images/pantry-${project}.png`,
      fullPage: true,
    });
  });
});
