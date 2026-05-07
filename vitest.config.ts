import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Most tests are pure; the few that touch DB/config use mocks. We
    // intentionally don't run server-integration tests here — they go
    // in a separate suite once the project has live infrastructure.
    environment: 'node',
    globals: false,
    pool: 'forks',
  },
});
