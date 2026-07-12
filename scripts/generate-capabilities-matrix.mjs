/**
 * Gera docs/capabilities.md: matriz provider × capability a partir do CÓDIGO real (não escrita
 * manualmente). Lê CAPABILITIES do core (ordem/agrupamento canônico, ver ADR-0005) e, para cada
 * adapter, chama a fábrica com opções fake mínimas (mesma técnica do scripts/smoke.mjs — sem
 * rede real) e lê `.capabilities`. Roda depois de `npm run build` (depende de dist/).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER_SUBPATHS } from './adapter-subpaths.mjs';

const { CAPABILITIES } = await import('../dist/index.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'capabilities.md');

const capabilitiesByProvider = new Map();
for (const { name, factory, options } of ADAPTER_SUBPATHS) {
  const mod = await import(`../dist/adapters/${name}/index.js`);
  const adapter = mod[factory](options);
  capabilitiesByProvider.set(name, new Set(adapter.capabilities));
}

// Agrupa preservando a ordem declarada em src/core/capabilities.ts (já é o agrupamento canônico).
const groups = new Map();
for (const capability of CAPABILITIES) {
  const namespace = capability.split('.')[0];
  if (!groups.has(namespace)) groups.set(namespace, []);
  groups.get(namespace).push(capability);
}

const providerNames = ADAPTER_SUBPATHS.map((a) => a.name);

function renderTable(capabilities) {
  const header = `| Capability | ${providerNames.join(' | ')} |`;
  const divider = `| --- | ${providerNames.map(() => '---').join(' | ')} |`;
  const rows = capabilities.map((capability) => {
    const cells = providerNames.map((name) =>
      capabilitiesByProvider.get(name).has(capability) ? '✅' : '—',
    );
    return `| \`${capability}\` | ${cells.join(' | ')} |`;
  });
  return [header, divider, ...rows].join('\n');
}

const sections = [...groups.entries()]
  .map(([namespace, caps]) => `### \`${namespace}.*\`\n\n${renderTable(caps)}`)
  .join('\n\n');

const totalByProvider = providerNames
  .map((name) => `- **${name}**: ${capabilitiesByProvider.get(name).size}/${CAPABILITIES.length}`)
  .join('\n');

const content = `<!--
  GERADO AUTOMATICAMENTE por \`npm run docs:capabilities\` (scripts/generate-capabilities-matrix.mjs).
  NÃO EDITE ESTE ARQUIVO À MÃO — suas mudanças serão sobrescritas na próxima geração.
  Fonte da verdade: CAPABILITIES (src/core/capabilities.ts) + \`.capabilities\` de cada fábrica de
  adapter (src/adapters/<provider>/index.ts). Ver ADR-0005.
-->

# Matriz de capabilities

Gerada a partir do código: ✅ significa que \`adapter.capabilities\` do provider inclui aquela
capability (fábrica chamada com opções fake, sem rede real — mesma técnica do smoke test).
Nenhuma linha aqui é escrita à mão.

## Resumo por provider

${totalByProvider}

## Detalhe por namespace

${sections}
`;

await writeFile(OUTPUT_PATH, content, 'utf8');
console.log(
  `docs/capabilities.md gerado (${CAPABILITIES.length} capabilities × ${providerNames.length} providers).`,
);
