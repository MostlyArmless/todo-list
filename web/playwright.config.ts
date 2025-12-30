import { defineConfig, devices } from '@playwright/test';

// Custom device definitions for actual user devices
// The only users are on Pixel 6 Pro and Pixel 6
const pixel6Pro = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: 3.5,
  isMobile: true,
  hasTouch: true,
};

const pixel6 = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    // Use Next.js dev server directly (API calls intercepted in tests)
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3002',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Primary mobile device - Pixel 6 Pro (412x892 viewport)
    {
      name: 'mobile',
      use: pixel6Pro,
    },
    // Secondary mobile device - Pixel 6 (412x915 viewport)
    {
      name: 'pixel6',
      use: pixel6,
    },
    // Desktop for comparison
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
