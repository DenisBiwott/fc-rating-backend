// @ts-check
import { defineConfig } from 'eslint/config'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

// The domain-import boundary is the one architectural rule this codebase leans on instead of
// a layered framework (see fc-rating-backend/docs/ARCHITECTURE.md#layers). src/domain must stay
// pure: no framework, no driver, no Node built-ins, no reaching into sibling layers. Weakening
// this rule is a design decision, not a lint annoyance — don't disable it inline to unblock a PR.
const domainBoundaryRule = {
  files: ['src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'fastify', message: 'src/domain must not depend on Fastify.' },
          { name: 'drizzle-orm', message: 'src/domain must not depend on Drizzle.' },
          { name: 'postgres', message: 'src/domain must not depend on a DB driver.' },
          { name: 'pino', message: 'src/domain must not depend on a logger.' },
        ],
        patterns: [
          {
            group: ['node:*'],
            message: 'src/domain must not depend on Node built-ins (includes Date/timers).',
          },
          {
            group: [
              '**/infra/**',
              '**/http/**',
              '**/app/**',
              '**/../infra/**',
              '**/../http/**',
              '**/../app/**',
            ],
            message:
              'src/domain must not import from infra, http, or app. Dependencies point the other way.',
          },
        ],
      },
    ],
  },
}

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'vitest.config.ts', 'drizzle.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  domainBoundaryRule,
  prettier,
)
