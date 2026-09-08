import { defineConfig } from 'vitest/config'

// Separate from vitest.config.ts (unit) because these need a running Postgres — kept out of the
// fast `pnpm test` loop that domain work iterates against all day. See docs/DEVELOPMENT.md.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 15000,
  },
})
