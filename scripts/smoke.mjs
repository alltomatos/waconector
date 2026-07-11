/**
 * Smoke test do pacote EMPACOTADO (dist/): valida o mapa de exports em ESM e
 * CJS — incluindo os subpath exports de adapter (`./waha`, `./evolution`,
 * `./uazapi`) — e exercita o fluxo completo com o MockAdapter. Roda após
 * `npm run build`. Ao adicionar um adapter novo, estenda ADAPTER_SUBPATHS
 * abaixo em vez de duplicar o bloco de asserções.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createConnector, isWaConnectorError } = await import('../dist/index.js');
const { MockAdapter } = await import('../dist/testing/index.js');

const ADAPTER_SUBPATHS = [
  { name: 'waha', factory: 'waha', options: { baseUrl: 'http://localhost:1', apiKey: 'x' } },
  {
    name: 'evolution',
    factory: 'evolution',
    options: { baseUrl: 'http://localhost:1', apiKey: 'x' },
  },
  { name: 'uazapi', factory: 'uazapi', options: { baseUrl: 'http://localhost:1', token: 'x' } },
];

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

console.log(
  `smoke ok: exports ESM + CJS (raiz, ./testing, ${ADAPTER_SUBPATHS.map((a) => `./${a.name}`).join(', ')}) e fluxo completo do MockAdapter`,
);
