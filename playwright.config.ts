import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ...(process.env.THREADPACK_BROWSER_CHANNEL ? { channel: process.env.THREADPACK_BROWSER_CHANNEL } : {}),
    ...(process.env.THREADPACK_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.THREADPACK_BROWSER_EXECUTABLE } } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:web && npm run preview',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
