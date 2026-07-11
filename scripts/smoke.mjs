/**
 * Smoke test do pacote EMPACOTADO (dist/): valida o mapa de exports em ESM e
 * CJS — incluindo os subpath exports de adapter (`./waha`, `./evolution`) — e
 * exercita o fluxo completo com o MockAdapter. Roda após `npm run build`.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createConnector, isWaConnectorError } = await import('../dist/index.js');
const { MockAdapter } = await import('../dist/testing/index.js');
const { waha } = await import('../dist/adapters/waha/index.js');
const { evolution } = await import('../dist/adapters/evolution/index.js');

const require = createRequire(import.meta.url);
const cjsRoot = require('../dist/index.cjs');
const cjsTesting = require('../dist/testing/index.cjs');
const cjsWaha = require('../dist/adapters/waha/index.cjs');
const cjsEvolution = require('../dist/adapters/evolution/index.cjs');
assert.equal(typeof cjsRoot.createConnector, 'function', 'CJS: createConnector ausente');
assert.equal(typeof cjsTesting.MockAdapter, 'function', 'CJS: MockAdapter ausente');
assert.equal(typeof cjsWaha.waha, 'function', 'CJS: waha ausente');
assert.equal(typeof cjsEvolution.evolution, 'function', 'CJS: evolution ausente');

// Subpath exports de adapter (ESM): a fábrica deve funcionar com opções mínimas fake (sem rede
// real) e produzir um WaAdapter com o contrato esperado (parseWebhook, provider, capabilities).
const wahaAdapter = waha({ baseUrl: 'http://localhost:1', apiKey: 'x' });
assert.equal(typeof wahaAdapter.parseWebhook, 'function', 'waha: parseWebhook ausente');
assert.equal(wahaAdapter.provider, 'waha', 'waha: provider incorreto');
assert.ok(
  Array.isArray(wahaAdapter.capabilities) && wahaAdapter.capabilities.length > 0,
  'waha: capabilities vazio ou ausente',
);

const evolutionAdapter = evolution({ baseUrl: 'http://localhost:1', apiKey: 'x' });
assert.equal(typeof evolutionAdapter.parseWebhook, 'function', 'evolution: parseWebhook ausente');
assert.equal(evolutionAdapter.provider, 'evolution', 'evolution: provider incorreto');
assert.ok(
  Array.isArray(evolutionAdapter.capabilities) && evolutionAdapter.capabilities.length > 0,
  'evolution: capabilities vazio ou ausente',
);

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
  'smoke ok: exports ESM + CJS (raiz, ./testing, ./waha, ./evolution) e fluxo completo do MockAdapter',
);
