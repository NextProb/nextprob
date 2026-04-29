const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  workers: 1, // Electron tests must run sequentially (shared prefs file)
});
