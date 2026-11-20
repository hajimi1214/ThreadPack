import { defineConfig } from '@playwright/test';

const selectedBrowser = process.env.THREADPACK_BROWSER as 'chromium' | 'firefox' | 'webkit' | undefined;

const testPort = Number(process.env.THREADPACK_TEST_PORT ?? 4318);
const testBaseURL = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  projects: selectedBrowser ? [{ name: selectedBrowser, use: { browserName: selectedBrowser } }] : undefined,
  use: {
    baseURL: testBaseURL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ...(process.env.THREADPACK_BROWSER_CHANNEL ? { channel: process.env.THREADPACK_BROWSER_CHANNEL } : {}),
    ...(process.env.THREADPACK_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.THREADPACK_BROWSER_EXECUTABLE } } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build:web && npm run preview -- --port ${testPort}`,
    url: testBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
