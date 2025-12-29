import { test, expect } from '@playwright/test';

test.describe('Lists', () => {
  test('can view lists page', async ({ page }) => {
    await page.goto('/lists');
    await expect(page).toHaveURL(/\/lists/);
  });

  // Add more tests as we build features
});

test.describe('Recipes', () => {
  test('can view recipes page', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page).toHaveURL(/\/recipes/);
  });
});
