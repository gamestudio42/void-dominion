import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    /**
     * Many tests play a whole match. Alone they take 2–5 s, and on a loaded machine
     * or CI runner they passed Vitest's 5 s default and failed main. A test that is
     * a timing gate states its own limit, such as the seed arena's 20 s ceiling.
     */
    testTimeout: 30_000,
  },
});
