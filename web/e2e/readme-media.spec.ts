/**
 * README media generation - smart screenshots and scroll GIFs.
 *
 * For each page:
 * 1. Takes a full-page screenshot
 * 2. If page height > viewport height, records a scroll video
 *
 * Usage: npx playwright test e2e/readme-media.spec.ts --project=mobile
 * Then run: ../scripts/generate-readme-media.sh (handles ffmpeg conversion)
 */
import { test, Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://127.0.0.1:8000';
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demopass123';
const OUTPUT_DIR = path.join(__dirname, '../../docs/images');
const VIDEO_DIR = path.join(__dirname, '../../docs/videos-tmp');

// Viewport height for Pixel 6 Pro
const VIEWPORT_HEIGHT = 892;

interface PageConfig {
  name: string;
  path: string;
  dynamicId?: 'grocery' | 'task' | 'recipe';
}

const PAGES: PageConfig[] = [
  { name: 'lists', path: '/lists' },
  { name: 'grocery-list', path: '/list/', dynamicId: 'grocery' },
  { name: 'task-list', path: '/list/', dynamicId: 'task' },
  { name: 'recipes', path: '/recipes' },
  { name: 'recipe-detail', path: '/recipes/', dynamicId: 'recipe' },
  { name: 'pantry', path: '/pantry' },
];

// Helper to login and get token
async function getAuthToken(
  request: import('@playwright/test').APIRequestContext
): Promise<{ token: string; user: object }> {
  const response = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(
      'Demo login failed. Run: docker compose exec api python scripts/seed_demo_data.py'
    );
  }

  const { access_token, user } = await response.json();
  return { token: access_token, user };
}

// Helper to get dynamic IDs
async function getDynamicIds(
  request: import('@playwright/test').APIRequestContext,
  token: string
): Promise<{ groceryId: number; taskId: number; recipeId: number }> {
  const headers = { Authorization: `Bearer ${token}` };

  const [listsRes, recipesRes] = await Promise.all([
    request.get(`${API_URL}/api/v1/lists`, { headers }),
    request.get(`${API_URL}/api/v1/recipes`, { headers }),
  ]);

  const lists = await listsRes.json();
  const recipes = await recipesRes.json();

  const groceryList = lists.find((l: { list_type: string }) => l.list_type === 'grocery');
  const taskList = lists.find((l: { list_type: string }) => l.list_type === 'task');

  if (!groceryList || !taskList || !recipes.length) {
    throw new Error('Demo data incomplete. Run seed script first.');
  }

  return {
    groceryId: groceryList.id,
    taskId: taskList.id,
    recipeId: recipes[0].id,
  };
}

// Setup page with auth and API interception
async function setupPage(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  token: string,
  user: object
) {
  // Intercept API calls
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

  // Set auth in localStorage
  await page.goto('/');
  await page.evaluate(
    ({ t, u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('user', JSON.stringify(u));
    },
    { t: token, u: user }
  );
}

// Record scroll video for tall pages
async function recordScrollVideo(
  browser: Browser,
  request: import('@playwright/test').APIRequestContext,
  token: string,
  user: object,
  url: string,
  outputName: string,
  testInfo: import('@playwright/test').TestInfo
) {
  // Create context with video recording
  const context = await browser.newContext({
    ...testInfo.project.use,
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 412, height: 892 },
    },
  });

  const page = await context.newPage();
  await setupPage(page, request, token, user);

  await page.goto(url);
  await page.waitForLoadState('networkidle');

  // Wait for content to actually render (not just "Loading...")
  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return !body.includes('Loading...') && body.length > 100;
  }, { timeout: 10000 });
  await page.waitForTimeout(500);

  // Get page height
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);

  // Smooth scroll to bottom
  const scrollDistance = pageHeight - VIEWPORT_HEIGHT;
  const steps = 60; // ~2 seconds at 30fps
  const stepSize = scrollDistance / steps;

  // Pause at top so viewers can see the initial state
  await page.waitForTimeout(1200);

  // Smooth scroll to bottom (~2 seconds)
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), stepSize * (i + 1));
    await page.waitForTimeout(35);
  }

  // Pause at bottom so viewers can see the end
  await page.waitForTimeout(1200);

  // Scroll back to top
  for (let i = steps; i >= 0; i--) {
    await page.evaluate((y) => window.scrollTo(0, y), stepSize * i);
    await page.waitForTimeout(25);
  }

  // Pause at top again before loop restarts
  await page.waitForTimeout(800);

  // Close to save video
  await page.close();
  const video = page.video();
  if (video) {
    const videoPath = await video.path();
    if (videoPath) {
      // Copy to final location with correct name
      const finalPath = path.join(VIDEO_DIR, `${outputName}.webm`);
      fs.copyFileSync(videoPath, finalPath);
      fs.unlinkSync(videoPath);
    }
  }

  await context.close();
}

test.describe('README Media Generation', () => {
  let token: string;
  let user: object;
  let ids: { groceryId: number; taskId: number; recipeId: number };

  test.beforeAll(async ({ request }) => {
    // Ensure output directories exist
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(VIDEO_DIR, { recursive: true });

    // Get auth
    const auth = await getAuthToken(request);
    token = auth.token;
    user = auth.user;

    // Get dynamic IDs
    ids = await getDynamicIds(request, token);
  });

  for (const pageConfig of PAGES) {
    test(`capture ${pageConfig.name}`, async ({ page, request, browser }, testInfo) => {
      // Skip non-mobile projects
      if (testInfo.project.name !== 'mobile') {
        test.skip();
        return;
      }

      await setupPage(page, request, token, user);

      // Build URL
      let url = pageConfig.path;
      if (pageConfig.dynamicId === 'grocery') url += ids.groceryId;
      else if (pageConfig.dynamicId === 'task') url += ids.taskId;
      else if (pageConfig.dynamicId === 'recipe') url += ids.recipeId;

      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      // Take viewport-sized screenshot (412x892) for consistent dimensions
      const screenshotPath = path.join(OUTPUT_DIR, `${pageConfig.name}-mobile.jpg`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      // Check if page needs scroll video
      const pageHeight = await page.evaluate(() => document.body.scrollHeight);

      if (pageHeight > VIEWPORT_HEIGHT + 50) {
        // Record scroll video
        await recordScrollVideo(
          browser,
          request,
          token,
          user,
          url,
          `${pageConfig.name}-mobile`,
          testInfo
        );

        // Write marker file so shell script knows to convert
        fs.writeFileSync(
          path.join(VIDEO_DIR, `${pageConfig.name}-mobile.needs-gif`),
          `${pageHeight}`
        );
      }
    });
  }
});
