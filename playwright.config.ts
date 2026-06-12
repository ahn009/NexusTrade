// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3020',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'npm run dev -w @nexus/frontend',
    url: 'http://127.0.0.1:3020',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3020/api/v3'
    }
  }
});
