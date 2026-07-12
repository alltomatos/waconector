// Sanity check para CI: exercita o pacote publicado (subpath exports reais, sem servidor HTTP) —
// não faz parte do exemplo em si.
import assert from 'node:assert/strict';
import { createConnector } from 'waconector';
import { MockAdapter } from 'waconector/testing';

const adapter = new MockAdapter();
const wa = createConnector(adapter);
adapter.simulateConnected();

const sent = await wa.messages.sendText({ to: '5585999999999', text: 'ci selftest' });
assert.ok(sent.id, 'sendText deveria retornar id');
console.log('examples/express selftest ok');
