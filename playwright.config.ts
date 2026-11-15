import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:3000', storageState: process.env.E2E_STORAGE_STATE },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
