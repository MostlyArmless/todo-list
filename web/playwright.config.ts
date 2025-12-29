import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    // Use localhost directly; nginx proxy at todolist.lan requires hosts entry
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3002',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Mobile viewport (primary - it's a PWA)
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
      },
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
