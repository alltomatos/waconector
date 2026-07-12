import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // src/cli/index.ts é só encanamento de processo (argv/stdout/stderr/exit) — nunca
      // exercitado por unit test (ver scripts/smoke.mjs para a checagem real de ponta a ponta,
      // via subprocess, depois do build). A lógica de fato (src/cli/doctor.ts) continua coberta.
      exclude: ['src/cli/index.ts'],
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
