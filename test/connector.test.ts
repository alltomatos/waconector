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

    const reactionFailure = await reject(
      wa.messages.sendReaction({ to: '5585999999999', messageId: 'm1', emoji: '👍' }),
    );
    expect(reactionFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const createFailure = await reject(
      wa.groups.create({ subject: 'Grupo', participants: ['5585999999999'] }),
    );
    expect(createFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const getInfoFailure = await reject(wa.groups.getInfo('grupo-1'));
    expect(getInfoFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const listFailure = await reject(wa.groups.list());
    expect(listFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const addFailure = await reject(
      wa.groups.addParticipants({ groupId: 'grupo-1', participants: ['5585999999999'] }),
    );
    expect(addFailure).toBeInstanceOf(UnsupportedCapabilityError);
  });

  it('adapter que declara messages.sendReaction sem implementar o método falha com PROVIDER_ERROR (bug do adapter, não entrada inválida)', async () => {
    const adapter = new MockAdapter({
      capabilities: ['messages.sendReaction', 'webhooks.parse'],
    });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (capability declarada sem método) para testar o guard-rail do conector.
    (adapter.messages as any).sendReaction = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.messages.sendReaction({ to: '5585999999999', messageId: 'm1', emoji: '👍' }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('adapter que declara groups.create sem implementar o método falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter({ capabilities: ['groups.create', 'webhooks.parse'] });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (capability declarada sem método) para testar o guard-rail do conector.
    (adapter.groups as any).create = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.groups.create({ subject: 'Grupo', participants: ['5585999999999'] }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });
});

describe('validação e normalização de groups.*', () => {
  it('rejeita subject vazio em groups.create com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(
      wa.groups.create({ subject: '', participants: ['5585999999999'] }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita participants vazio em groups.create com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.groups.create({ subject: 'Grupo', participants: [] }));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita groupId vazio em groups.getInfo com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.groups.getInfo(''));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('normaliza participantes (telefone vira só-dígitos) antes de entregar ao adapter, mas preserva o groupId opaco intacto', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo',
      participants: ['+55 (85) 99999-9999'],
    });
    expect(group.participants[0]?.id).toBe('5585999999999');

    // groupId é opaco (ver ADR-0009): mesmo um ID no formato sintético da Z-API
    // ("<id>-group", sem "@") deve ir e voltar intacto, sem passar por normalizeChatId.
    await wa.groups.addParticipants({
      groupId: group.id,
      participants: ['+55 (85) 98888-8888'],
    });
    const info = await wa.groups.getInfo(group.id);
    expect(info.id).toBe(group.id);
    expect(info.participants.some((p) => p.id === '5585988888888')).toBe(true);
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
