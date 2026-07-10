import { describe, expect, it } from 'vitest';
import {
  type CanonicalEvent,
  createConnector,
  isWaConnectorError,
  UnsupportedCapabilityError,
  type WebhookInput,
} from '../src';
import { MockAdapter } from '../src/testing';

async function reject(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('capabilities no conector', () => {
  it('bloqueia chamadas fora do conjunto declarado com UnsupportedCapabilityError', async () => {
    const adapter = new MockAdapter({ capabilities: ['messages.sendText', 'webhooks.parse'] });
    const wa = createConnector(adapter);

    expect(wa.supports('messages.sendText')).toBe(true);
    expect(wa.supports('instance.connect')).toBe(false);

    const failure = await reject(wa.instance.connect());
    expect(failure).toBeInstanceOf(UnsupportedCapabilityError);
    const mediaFailure = await reject(
      wa.messages.sendMedia({
        to: '5585999999999',
        media: { kind: 'image', url: 'http://x/y.png' },
      }),
    );
    expect(mediaFailure).toBeInstanceOf(UnsupportedCapabilityError);
  });
});

describe('validação e normalização de envio', () => {
  it('rejeita text vazio com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.messages.sendText({ to: '5585999999999', text: '' }));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita telefone inválido com INVALID_RECIPIENT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.messages.sendText({ to: 'abc', text: 'oi' }));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_RECIPIENT').toBe(true);
  });

  it('normaliza o destinatário antes de entregar ao adapter', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    await wa.messages.sendText({ to: '+55 (85) 99999-9999', text: 'oi' });
    expect(adapter.outbox[0]?.input.to).toBe('5585999999999');
  });

  it('rejeita media sem url e sem base64 com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(
      wa.messages.sendMedia({ to: '5585999999999', media: { kind: 'image' } }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('propaga INSTANCE_DISCONNECTED do adapter quando não conectado', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);
    const failure = await reject(wa.messages.sendText({ to: '5585999999999', text: 'oi' }));
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('eventos e webhooks', () => {
  it('entrega eventos canônicos aos listeners registrados', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);
    const texts: string[] = [];
    const all: CanonicalEvent[] = [];

    wa.on('message.received', (event) => {
      texts.push(event.message.text ?? '');
    });
    wa.on('*', (event) => {
      all.push(event);
    });

    const events = await wa.webhooks.dispatch(adapter.buildIncomingText('5585988887777', 'oi'));
    expect(events).toHaveLength(1);
    expect(texts).toEqual(['oi']);
    expect(all).toHaveLength(1);
  });

  it('unsubscribe interrompe a entrega', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);
    let calls = 0;
    const off = wa.on('message.received', () => {
      calls++;
    });
    await wa.webhooks.dispatch(adapter.buildIncomingText('5585988887777', 'a'));
    off();
    await wa.webhooks.dispatch(adapter.buildIncomingText('5585988887777', 'b'));
    expect(calls).toBe(1);
  });

  it('parse nunca lança: payload lixo vira evento unknown', () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);
    const events = wa.webhooks.parse({ body: 'lixo' });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parse nunca lança: exceção do adapter vira evento unknown com reason', () => {
    class ThrowingAdapter extends MockAdapter {
      override parseWebhook(_input: WebhookInput): CanonicalEvent[] {
        throw new Error('falha interna do adapter');
      }
    }
    const wa = createConnector(new ThrowingAdapter());
    const events = wa.webhooks.parse({ body: {} });
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('unknown');
    if (event?.type === 'unknown') {
      expect(event.reason).toContain('falha interna do adapter');
    }
  });
});
