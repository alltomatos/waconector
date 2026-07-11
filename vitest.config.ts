import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Piso calibrado contra o baseline real (ver docs/CONTEXT.md#qa): não é uma meta
      // aspiracional, é o "não regredir". Subir estes números (sobretudo branches dos
      // adapters — caminhos de fallback/erro pouco exercitados) é uma boa contribuição F2+.
      thresholds: {
        statements: 77,
        branches: 60,
        functions: 90,
        lines: 80,
      },
    },
  },
});
