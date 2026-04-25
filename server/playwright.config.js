const path = require('path');
const { defineConfig } = require('@playwright/test');

const port = process.env.PLAYWRIGHT_PORT || '3100';
const dbPath = path.join(__dirname, 'test', '.tmp', 'e2e.db');

module.exports = defineConfig({
  testDir: path.join(__dirname, 'test', 'e2e'),
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run start:test',
    cwd: __dirname,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: port,
      HACCP_DB_PATH: dbPath,
      HACCP_UPLOAD_DIR: path.join(__dirname, 'test', '.tmp', 'uploads'),
      SESSION_SECRET: 'haccp-test-secret',
      ENABLE_TEST_ROUTES: '1',
    },
  },
});
