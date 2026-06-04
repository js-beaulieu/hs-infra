import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/flows',
  timeout: 30000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: [['line']],
  globalSetup: require.resolve('./tests/flows/global-setup'),
  globalTeardown: require.resolve('./tests/flows/global-teardown'),
  use: {
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
