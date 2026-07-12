import { createConnector } from 'waconector';
import { MockAdapter } from 'waconector/testing';

// Singleton em memória por processo — suficiente para dev/demo. Ver README.md para um provider real.
const adapter = new MockAdapter();
const wa = createConnector(adapter);
adapter.simulateConnected();

wa.on('message.received', (event) => {
  console.log(`[waconector] recebido de ${event.message.chatId}: ${event.message.text}`);
});

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const events = await wa.webhooks.dispatch({
    headers: Object.fromEntries(request.headers),
    body,
  });
  return Response.json({ events: events.length });
}
