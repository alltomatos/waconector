/**
 * Smoke test do pacote EMPACOTADO (dist/): valida o mapa de exports em ESM e
 * CJS — incluindo os subpath exports de adapter (`./waha`, `./evolution`,
 * `./uazapi`, `./zapi`, `./wuzapi`, `./whapi`, `./quepasa`, `./wppconnect`) — e exercita o fluxo completo com o
 * MockAdapter. Roda após `npm run build`. Ao adicionar um adapter novo,
 * estenda ADAPTER_SUBPATHS em scripts/adapter-subpaths.mjs em vez de duplicar o bloco de asserções.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ADAPTER_SUBPATHS } from './adapter-subpaths.mjs';

const { createConnector, isWaConnectorError } = await import('../dist/index.js');
const { MockAdapter } = await import('../dist/testing/index.js');

const require = createRequire(import.meta.url);
const cjsRoot = require('../dist/index.cjs');
const cjsTesting = require('../dist/testing/index.cjs');
assert.equal(typeof cjsRoot.createConnector, 'function', 'CJS: createConnector ausente');
assert.equal(typeof cjsTesting.MockAdapter, 'function', 'CJS: MockAdapter ausente');

// Subpath exports de adapter (ESM + CJS): a fábrica deve funcionar com opções mínimas fake (sem
// rede real) e produzir um WaAdapter com o contrato esperado (parseWebhook, provider, capabilities).
for (const { name, factory, options } of ADAPTER_SUBPATHS) {
  const esm = await import(`../dist/adapters/${name}/index.js`);
  const cjs = require(`../dist/adapters/${name}/index.cjs`);
  assert.equal(typeof cjs[factory], 'function', `${name}: CJS ${factory} ausente`);

  const adapter = esm[factory](options);
  assert.equal(typeof adapter.parseWebhook, 'function', `${name}: parseWebhook ausente`);
  assert.equal(adapter.provider, name, `${name}: provider incorreto`);
  assert.ok(
    Array.isArray(adapter.capabilities) && adapter.capabilities.length > 0,
    `${name}: capabilities vazio ou ausente`,
  );
}

const adapter = new MockAdapter();
const wa = createConnector(adapter);

const { qr } = await wa.instance.connect();
assert.ok(qr, 'connect() deveria retornar QR');
adapter.simulateConnected();

const sent = await wa.messages.sendText({ to: '+55 (85) 99999-9999', text: 'smoke' });
assert.ok(sent.id, 'sendText deveria retornar id');
assert.equal(sent.chatId, '5585999999999', 'chatId deveria estar normalizado');

let receivedText = '';
wa.on('message.received', (event) => {
  receivedText = event.message.text ?? '';
});
await wa.webhooks.dispatch(adapter.buildIncomingText('5585988887777', 'oi'));
assert.equal(receivedText, 'oi', 'evento message.received não chegou ao listener');

const failure = await wa.messages.sendText({ to: '', text: 'x' }).catch((error) => error);
assert.ok(
  isWaConnectorError(failure) && failure.code === 'INVALID_INPUT',
  'erro tipado INVALID_INPUT esperado',
);

const unknownEvents = wa.webhooks.parse({ body: 'payload qualquer' });
assert.equal(unknownEvents[0]?.type, 'unknown', 'payload lixo deveria virar evento unknown');

// CLI (bin "waconector"): checagem de ponta a ponta via subprocess real — confirma que o
// shebang/banner do tsup e o parsing de argv realmente funcionam no dist/ empacotado, algo que os
// testes unitários de src/cli/doctor.ts sozinhos não cobrem (ver vitest.config.ts:
// coverage.exclude de src/cli/index.ts).
const cliPath = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));

const helpOutput = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
assert.match(helpOutput, /waconector — CLI de diagnóstico/, 'CLI --help com saída inesperada');

let unknownProviderExitCode = 0;
try {
  execFileSync(process.execPath, [cliPath, 'doctor', '--provider', 'bogus'], { encoding: 'utf8' });
} catch (error) {
  unknownProviderExitCode = error.status;
}
assert.equal(
  unknownProviderExitCode,
  1,
  'CLI deveria sair com código 1 para provider desconhecido',
);

console.log(
  `smoke ok: exports ESM + CJS (raiz, ./testing, ${ADAPTER_SUBPATHS.map((a) => `./${a.name}`).join(', ')}) e fluxo completo do MockAdapter`,
);
