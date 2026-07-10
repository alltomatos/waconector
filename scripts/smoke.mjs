/**
 * Smoke test do pacote EMPACOTADO (dist/): valida o mapa de exports em ESM e
 * CJS e exercita o fluxo completo com o MockAdapter. Roda após `npm run build`.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createConnector, isWaConnectorError } = await import('../dist/index.js');
const { MockAdapter } = await import('../dist/testing/index.js');

const require = createRequire(import.meta.url);
const cjsRoot = require('../dist/index.cjs');
const cjsTesting = require('../dist/testing/index.cjs');
assert.equal(typeof cjsRoot.createConnector, 'function', 'CJS: createConnector ausente');
assert.equal(typeof cjsTesting.MockAdapter, 'function', 'CJS: MockAdapter ausente');

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

console.log('smoke ok: exports ESM + CJS e fluxo completo do MockAdapter');
