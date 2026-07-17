import { defineConfig } from 'tsup';

export default defineConfig([
  {
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
      'adapters/wppconnect/index': 'src/adapters/wppconnect/index.ts',
      'adapters/izapia/index': 'src/adapters/izapia/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'node20',
    sourcemap: true,
    clean: true,
    treeshake: true,
  },
  {
    // CLI: só é EXECUTADO como script (node dist/cli/index.js via "bin"), nunca importado por um
    // consumer — por isso ESM-only (sem CJS) e sem .d.ts (não existe subpath "waconector/cli" no
    // mapa de exports). O shebang vira o primeiro byte do arquivo compilado via `banner`.
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    target: 'node20',
    sourcemap: true,
    // NÃO usar clean:true aqui — os dois configs desta lista compartilham outDir (dist/) e rodam
    // em sequência numa única invocação do tsup; um segundo clean:true apagaria o output do
    // primeiro bloco (a biblioteca inteira) antes de gerar só a CLI.
    clean: false,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
