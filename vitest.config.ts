import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest config — Node-only test environment.
 *
 * Why Node (not happy-dom): all our critical paths are pure server logic
 * (encryption, CSRF, pool dispatch, rate limiter). DOM tests would add
 * overhead without exercising what matters. If we add component tests
 * later, we can switch per-file via `// @vitest-environment happy-dom`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/lib/store/**', '**/*.d.ts'],
    },
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
