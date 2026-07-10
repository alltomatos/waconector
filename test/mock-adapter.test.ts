import { describe, expect, it } from 'vitest';
import { createConnector } from '../src';
import { MockAdapter } from '../src/testing';

describe('MockAdapter: ciclo de vida da instância', () => {
  it('transita disconnected → qr → connected → disconnected', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    expect((await wa.instance.status()).state).toBe('disconnected');

    const result = await wa.instance.connect();
    expect(result.qr).toBe('mock-qr-code');
    expect((await wa.instance.status()).state).toBe('qr');

    adapter.simulateConnected();
    expect((await wa.instance.status()).state).toBe('connected');

    await wa.instance.logout();
    expect((await wa.instance.status()).state).toBe('disconnected');
  });
});

describe('MockAdapter: outbox', () => {
  it('registra envios com id sequencial e chatId normalizado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const first = await wa.messages.sendText({ to: '5585999999999', text: 'um' });
    const second = await wa.messages.sendText({ to: '5585999999999', text: 'dois' });

    expect(first.id).not.toBe(second.id);
    expect(adapter.outbox).toHaveLength(2);
    expect(adapter.outbox[1]?.message.chatId).toBe('5585999999999');
  });
});

describe('MockAdapter: webhooks sintéticos', () => {
  it('buildAck vira message.ack canônico', () => {
    const adapter = new MockAdapter();
    const events = adapter.parseWebhook(adapter.buildAck('mock-1', 'read'));
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('mock-1');
      expect(event.ack).toBe('read');
    }
  });

  it('buildConnectionUpdate vira connection.update canônico', () => {
    const adapter = new MockAdapter();
    const events = adapter.parseWebhook(adapter.buildConnectionUpdate('qr', 'novo-qr'));
    const event = events[0];
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('qr');
      expect(event.qr).toBe('novo-qr');
    }
  });

  it('mensagem com fromMe vira message.sent (eco)', () => {
    const adapter = new MockAdapter();
    const events = adapter.parseWebhook({
      body: { event: 'message', from: '5585999999999', text: 'eco', fromMe: true },
    });
    expect(events[0]?.type).toBe('message.sent');
  });

  it('valores fora do domínio caem em padrões seguros', () => {
    const adapter = new MockAdapter();
    const events = adapter.parseWebhook({
      body: { event: 'connection', state: 'estado-inexistente' },
    });
    const event = events[0];
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('unknown');
    }
  });
});
