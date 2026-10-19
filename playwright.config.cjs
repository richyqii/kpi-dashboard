const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.cjs',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'msedge', headless: true },
  webServer: [
    { command: 'node node_modules/wrangler/bin/wrangler.js dev --local --port 4173 --inspector-port 9230 --persist-to .wrangler/workflow-tests', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60000, env: { WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.tools/wrangler-tests.log' } },
    { command: 'node node_modules/wrangler/bin/wrangler.js dev --local --port 4174 --inspector-port 9231 --persist-to .wrangler/first-import-tests --var EMPTY_BASELINE:true', url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 60000, env: { WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.tools/wrangler-first-import.log' } }
  ]
});
