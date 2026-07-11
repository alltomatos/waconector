import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
    'adapters/waha/index': 'src/adapters/waha/index.ts',
    'adapters/evolution/index': 'src/adapters/evolution/index.ts',
    'adapters/uazapi/index': 'src/adapters/uazapi/index.ts',
    'adapters/zapi/index': 'src/adapters/zapi/index.ts',
    'adapters/wuzapi/index': 'src/adapters/wuzapi/index.ts',
    'adapters/whapi/index': 'src/adapters/whapi/index.ts',
    'adapters/quepasa/index': 'src/adapters/quepasa/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  sourcemap: true,
  clean: true,
  treeshake: true,
});
