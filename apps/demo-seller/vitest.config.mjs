import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.test.mjs'],
    fileParallelism: false, // one server at a time: the port is fixed
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
