import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../src';
import { MockAdapter } from '../src/testing';

async function reject(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

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

  it('simulateState força um estado arbitrário (ex.: qr) sem passar pelo fluxo connect()', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    adapter.simulateState('qr');
    expect((await wa.instance.status()).state).toBe('qr');
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

  it('sendMedia entrega e registra no outbox quando a instância está conectada', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendMedia({
      to: '5585999999999',
      media: { kind: 'image', url: 'http://example.com/foto.png' },
      caption: 'legenda',
    });

    expect(sent.chatId).toBe('5585999999999');
    expect(sent.id).toBeTruthy();
    expect(adapter.outbox).toHaveLength(1);
    expect(adapter.outbox[0]?.message).toBe(sent);
    expect(adapter.outbox[0]?.input.to).toBe('5585999999999');
  });

  it('sendReaction entrega e registra no outbox quando a instância está conectada', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendReaction({
      to: '5585999999999',
      messageId: 'msg-1',
      emoji: '👍',
    });

    expect(sent.chatId).toBe('5585999999999');
    expect(sent.id).toBeTruthy();
    expect(adapter.outbox).toHaveLength(1);
    expect(adapter.outbox[0]?.input).toEqual({
      to: '5585999999999',
      messageId: 'msg-1',
      emoji: '👍',
    });
  });
});

describe('MockAdapter: groups', () => {
  it('cria um grupo e permite consultá-lo via getInfo/list', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const group = await wa.groups.create({
      subject: 'Time',
      participants: ['5585999999999', '5585988888888'],
    });
    expect(group.id).toBeTruthy();
    expect(group.subject).toBe('Time');
    expect(group.participants).toHaveLength(2);
    expect(group.participants.every((p) => p.isAdmin === false)).toBe(true);

    const info = await wa.groups.getInfo(group.id);
    expect(info).toEqual(group);

    const list = await wa.groups.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(group.id);
  });

  it('getInfo de um grupo inexistente falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.groups.getInfo('nao-existe'));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('groups.create exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);
    const failure = await reject(
      wa.groups.create({ subject: 'Time', participants: ['5585999999999'] }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });

  it('addParticipants/removeParticipants adicionam e removem participantes do grupo', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });

    await wa.groups.addParticipants({ groupId: group.id, participants: ['5585988888888'] });
    let info = await wa.groups.getInfo(group.id);
    expect(info.participants.map((p) => p.id).sort()).toEqual(
      ['5585988888888', '5585999999999'].sort(),
    );

    await wa.groups.removeParticipants({ groupId: group.id, participants: ['5585999999999'] });
    info = await wa.groups.getInfo(group.id);
    expect(info.participants.map((p) => p.id)).toEqual(['5585988888888']);
  });

  it('promoteParticipants/demoteParticipants alternam a flag isAdmin', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });

    await wa.groups.promoteParticipants({ groupId: group.id, participants: ['5585999999999'] });
    let info = await wa.groups.getInfo(group.id);
    expect(info.participants[0]?.isAdmin).toBe(true);

    await wa.groups.demoteParticipants({ groupId: group.id, participants: ['5585999999999'] });
    info = await wa.groups.getInfo(group.id);
    expect(info.participants[0]?.isAdmin).toBe(false);
  });

  it('updateSubject/updateDescription atualizam os campos do grupo', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });

    await wa.groups.updateSubject({ groupId: group.id, subject: 'Time Renomeado' });
    let info = await wa.groups.getInfo(group.id);
    expect(info.subject).toBe('Time Renomeado');

    await wa.groups.updateDescription({ groupId: group.id, description: 'Nova descrição' });
    info = await wa.groups.getInfo(group.id);
    expect(info.description).toBe('Nova descrição');
  });

  it('updatePicture exige instância conectada e grupo existente, mas não altera GroupInfo (MockAdapter não modela foto)', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });

    await expect(
      wa.groups.updatePicture({
        groupId: group.id,
        media: { kind: 'image', url: 'http://x/y.png' },
      }),
    ).resolves.toBeUndefined();

    const failure = await reject(
      wa.groups.updatePicture({
        groupId: 'nao-existe',
        media: { kind: 'image', url: 'http://x/y.png' },
      }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
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

  it('buildReaction vira message.received com kind "reaction" e ReactionInfo', () => {
    const adapter = new MockAdapter();
    const events = adapter.parseWebhook(adapter.buildReaction('5585999999999', 'msg-1', '❤️'));
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.kind).toBe('reaction');
      expect(event.message.reaction).toEqual({ emoji: '❤️', targetMessageId: 'msg-1' });
    }
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
