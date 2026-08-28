import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Most tests are pure; the few that touch DB/config use mocks. We
    // intentionally don't run server-integration tests here — they go
    // in a separate suite once the project has live infrastructure.
    environment: 'node',
    globals: false,
    pool: 'forks',
    // HARD COST GUARD: forces NODE_ENV=test, strips every live-pull override and
    // installs a fetch sentinel, so the suite can NEVER spend an ImportYeti /
    // Hunter credit. Runs in every worker before any test module is imported.
    setupFiles: ['./src/test/setupNoExternalSpend.ts'],
  },
});
