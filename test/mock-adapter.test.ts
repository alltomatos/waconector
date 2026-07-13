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

  it('messages.edit devolve um SentMessage ecoando o messageId original quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const edited = await wa.messages.edit({
      to: '5585999999999',
      messageId: 'msg-1',
      text: 'texto editado',
    });

    expect(edited.id).toBe('msg-1');
    expect(edited.chatId).toBe('5585999999999');
  });

  it('messages.delete resolve sem erro quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await expect(
      wa.messages.delete({ to: '5585999999999', messageId: 'msg-1' }),
    ).resolves.toBeUndefined();
  });

  it('messages.edit/delete exigem instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const editFailure = await reject(
      wa.messages.edit({ to: '5585999999999', messageId: 'msg-1', text: 'x' }),
    );
    expect(isWaConnectorError(editFailure) && editFailure.code === 'INSTANCE_DISCONNECTED').toBe(
      true,
    );

    const deleteFailure = await reject(
      wa.messages.delete({ to: '5585999999999', messageId: 'msg-1' }),
    );
    expect(
      isWaConnectorError(deleteFailure) && deleteFailure.code === 'INSTANCE_DISCONNECTED',
    ).toBe(true);
  });

  it('messages.forward devolve um novo SentMessage quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const forwarded = await wa.messages.forward({ to: '5585999999999', messageId: 'msg-1' });
    expect(forwarded.chatId).toBe('5585999999999');
    expect(forwarded.id).toBeTruthy();
  });

  it('star/unstar alternam o estado consultável via isMessageStarred', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.isMessageStarred('msg-1')).toBe(false);
    await wa.messages.star({ to: '5585999999999', messageId: 'msg-1' });
    expect(adapter.isMessageStarred('msg-1')).toBe(true);
    await wa.messages.unstar({ to: '5585999999999', messageId: 'msg-1' });
    expect(adapter.isMessageStarred('msg-1')).toBe(false);
  });

  it('pin/unpin alternam o estado consultável via isMessagePinned', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await wa.messages.pin({ to: '5585999999999', messageId: 'msg-1' });
    expect(adapter.isMessagePinned('msg-1')).toBe(true);
    await wa.messages.unpin({ to: '5585999999999', messageId: 'msg-1' });
    expect(adapter.isMessagePinned('msg-1')).toBe(false);
  });

  it('markRead marca o estado consultável via isMessageRead', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.isMessageRead('msg-1')).toBe(false);
    await wa.messages.markRead({ to: '5585999999999', messageId: 'msg-1' });
    expect(adapter.isMessageRead('msg-1')).toBe(true);
  });

  it('forward/star/pin/markRead exigem instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(wa.messages.forward({ to: '5585999999999', messageId: 'msg-1' }));
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });

  it('sendLocation devolve um novo SentMessage quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendLocation({
      to: '5585999999999',
      latitude: -3.7,
      longitude: -38.5,
      name: 'Escritório',
    });
    expect(sent.chatId).toBe('5585999999999');
    expect(sent.id).toBeTruthy();
  });

  it('sendContactCard devolve um novo SentMessage quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendContactCard({
      to: '5585999999999',
      contactName: 'Fulano',
      contactPhone: '5585988888888',
    });
    expect(sent.chatId).toBe('5585999999999');
    expect(sent.id).toBeTruthy();
  });

  it('sendPoll devolve um novo SentMessage quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendPoll({
      to: '5585999999999',
      question: 'Pergunta?',
      options: ['Sim', 'Não'],
    });
    expect(sent.chatId).toBe('5585999999999');
    expect(sent.id).toBeTruthy();
  });

  it('sendLocation/sendContactCard/sendPoll exigem instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.messages.sendLocation({ to: '5585999999999', latitude: -3.7, longitude: -38.5 }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('MockAdapter: chats', () => {
  it('archive/unarchive alternam o estado consultável via isChatArchived', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.isChatArchived('5585999999999')).toBe(false);
    await wa.chats.archive('5585999999999');
    expect(adapter.isChatArchived('5585999999999')).toBe(true);
    await wa.chats.unarchive('5585999999999');
    expect(adapter.isChatArchived('5585999999999')).toBe(false);
  });

  it('mute/unmute alternam o estado consultável via isChatMuted', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await wa.chats.mute('5585999999999');
    expect(adapter.isChatMuted('5585999999999')).toBe(true);
    await wa.chats.unmute('5585999999999');
    expect(adapter.isChatMuted('5585999999999')).toBe(false);
  });

  it('pin/unpin alternam o estado consultável via isChatPinned', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await wa.chats.pin('5585999999999');
    expect(adapter.isChatPinned('5585999999999')).toBe(true);
    await wa.chats.unpin('5585999999999');
    expect(adapter.isChatPinned('5585999999999')).toBe(false);
  });

  it('markUnread/markRead alternam o estado consultável via isChatUnread', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.isChatUnread('5585999999999')).toBe(false);
    await wa.chats.markUnread('5585999999999');
    expect(adapter.isChatUnread('5585999999999')).toBe(true);
    await wa.chats.markRead('5585999999999');
    expect(adapter.isChatUnread('5585999999999')).toBe(false);
  });

  it('todo método de chats.* exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(wa.chats.archive('5585999999999'));
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('MockAdapter: presence', () => {
  it('setTyping registra o estado consultável via getTypingState', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.getTypingState('5585999999999')).toBeUndefined();
    await wa.presence.setTyping({ to: '5585999999999', state: 'composing' });
    expect(adapter.getTypingState('5585999999999')).toBe('composing');
    await wa.presence.setTyping({ to: '5585999999999', state: 'paused' });
    expect(adapter.getTypingState('5585999999999')).toBe('paused');
  });

  it('set registra a presença global consultável via getGlobalPresence', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.getGlobalPresence()).toBeUndefined();
    await wa.presence.set('online');
    expect(adapter.getGlobalPresence()).toBe('online');
  });

  it('subscribe registra o chatId consultável via isSubscribedToPresence', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(adapter.isSubscribedToPresence('5585999999999')).toBe(false);
    await wa.presence.subscribe('5585999999999');
    expect(adapter.isSubscribedToPresence('5585999999999')).toBe(true);
  });

  it('todo método de presence.* exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.presence.setTyping({ to: '5585999999999', state: 'composing' }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('MockAdapter: labels', () => {
  it('create gera um id novo e list reflete o label criado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(await wa.labels.list()).toEqual([]);
    const label = await wa.labels.create({ name: 'Cliente', color: '1' });
    expect(label.id).toBeTruthy();
    expect(await wa.labels.list()).toEqual([label]);
  });

  it('update substitui name/color do label existente', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const label = await wa.labels.create({ name: 'Cliente' });
    await wa.labels.update({ labelId: label.id, name: 'Cliente VIP', color: 'salmon' });
    const [updated] = await wa.labels.list();
    expect(updated).toMatchObject({ id: label.id, name: 'Cliente VIP', color: 'salmon' });
  });

  it('delete remove o label e desassocia de todos os chats via getChatLabelIds', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const label = await wa.labels.create({ name: 'Cliente' });
    await wa.labels.addToChat({ chatId: '5585999999999', labelId: label.id });
    expect(adapter.getChatLabelIds('5585999999999')).toEqual([label.id]);

    await wa.labels.delete(label.id);
    expect(await wa.labels.list()).toEqual([]);
    expect(adapter.getChatLabelIds('5585999999999')).toEqual([]);
  });

  it('addToChat/removeFromChat registram e removem a associação consultável via getChatLabelIds', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const label = await wa.labels.create({ name: 'Cliente' });
    expect(adapter.getChatLabelIds('5585999999999')).toEqual([]);

    await wa.labels.addToChat({ chatId: '5585999999999', labelId: label.id });
    expect(adapter.getChatLabelIds('5585999999999')).toEqual([label.id]);

    await wa.labels.removeFromChat({ chatId: '5585999999999', labelId: label.id });
    expect(adapter.getChatLabelIds('5585999999999')).toEqual([]);
  });

  it('operações sobre um labelId inexistente falham com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    for (const call of [
      () => wa.labels.update({ labelId: 'inexistente', name: 'X' }),
      () => wa.labels.delete('inexistente'),
      () => wa.labels.addToChat({ chatId: '5585999999999', labelId: 'inexistente' }),
      () => wa.labels.removeFromChat({ chatId: '5585999999999', labelId: 'inexistente' }),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
    }
  });

  it('todo método de labels.* exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(wa.labels.create({ name: 'Cliente' }));
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('MockAdapter: channels', () => {
  it('create gera um id novo (JID @newsletter) e list reflete o canal criado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    expect(await wa.channels.list()).toEqual([]);
    const channel = await wa.channels.create({ name: 'Meu Canal', description: 'Descrição' });
    expect(channel.id).toContain('@newsletter');
    expect(await wa.channels.list()).toEqual([channel]);
  });

  it('getInfo devolve o canal existente e falha com PROVIDER_ERROR para um channelId inexistente', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const channel = await wa.channels.create({ name: 'Meu Canal' });
    expect(await wa.channels.getInfo(channel.id)).toEqual(channel);

    const failure = await reject(wa.channels.getInfo('inexistente'));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('delete remove o canal e limpa o estado de follow consultável via isFollowingChannel', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const channel = await wa.channels.create({ name: 'Meu Canal' });
    await wa.channels.follow(channel.id);
    expect(adapter.isFollowingChannel(channel.id)).toBe(true);

    await wa.channels.delete(channel.id);
    expect(await wa.channels.list()).toEqual([]);
    expect(adapter.isFollowingChannel(channel.id)).toBe(false);
  });

  it('follow/unfollow alternam o estado consultável via isFollowingChannel', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const channel = await wa.channels.create({ name: 'Meu Canal' });

    expect(adapter.isFollowingChannel(channel.id)).toBe(false);
    await wa.channels.follow(channel.id);
    expect(adapter.isFollowingChannel(channel.id)).toBe(true);
    await wa.channels.unfollow(channel.id);
    expect(adapter.isFollowingChannel(channel.id)).toBe(false);
  });

  it('operações sobre um channelId inexistente falham com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    for (const call of [
      () => wa.channels.delete('inexistente'),
      () => wa.channels.follow('inexistente'),
      () => wa.channels.unfollow('inexistente'),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
    }
  });

  it('todo método de channels.* exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(wa.channels.create({ name: 'Meu Canal' }));
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('MockAdapter: business', () => {
  it('getProfile começa vazio e updateProfile aplica um patch parcial preservado entre chamadas', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const initial = await wa.business.getProfile();
    expect(initial.description).toBeUndefined();
    expect(initial.address).toBeUndefined();
    expect(initial.email).toBeUndefined();

    await wa.business.updateProfile({ description: 'Loja de exemplo' });
    expect(await wa.business.getProfile()).toMatchObject({ description: 'Loja de exemplo' });

    await wa.business.updateProfile({ address: 'Rua Exemplo, 123' });
    const profile = await wa.business.getProfile();
    expect(profile.description).toBe('Loja de exemplo');
    expect(profile.address).toBe('Rua Exemplo, 123');
  });

  it('todo método de business.* exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const failure = await reject(wa.business.getProfile());
    expect(isWaConnectorError(failure) && failure.code === 'INSTANCE_DISCONNECTED').toBe(true);
  });
});

describe('MockAdapter: calls', () => {
  it('make/reject resolvem quando conectado', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await expect(wa.calls.make({ to: '5585999999999' })).resolves.toBeUndefined();
    await expect(wa.calls.reject({})).resolves.toBeUndefined();
    await expect(
      wa.calls.reject({ callId: 'call-1', callerId: '5585999999999' }),
    ).resolves.toBeUndefined();
  });

  it('todo método de calls.* exige instância conectada (INSTANCE_DISCONNECTED)', async () => {
    const adapter = new MockAdapter();
    const wa = createConnector(adapter);

    const makeFailure = await reject(wa.calls.make({ to: '5585999999999' }));
    expect(isWaConnectorError(makeFailure) && makeFailure.code === 'INSTANCE_DISCONNECTED').toBe(
      true,
    );
    const rejectFailure = await reject(wa.calls.reject({}));
    expect(
      isWaConnectorError(rejectFailure) && rejectFailure.code === 'INSTANCE_DISCONNECTED',
    ).toBe(true);
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

  it('getInviteLink/revokeInviteLink emitem links completos, e revoke invalida o código anterior', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });

    const first = await wa.groups.getInviteLink(group.id);
    expect(first.link.startsWith('https://chat.whatsapp.com/')).toBe(true);
    await expect(wa.groups.joinViaInviteLink({ invite: first.link })).resolves.toBeUndefined();

    const revoked = await wa.groups.revokeInviteLink(group.id);
    expect(revoked.link).not.toBe(first.link);

    // O código antigo não é mais válido após o revoke.
    const failure = await reject(wa.groups.joinViaInviteLink({ invite: first.link }));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
    // O novo código funciona.
    await expect(wa.groups.joinViaInviteLink({ invite: revoked.link })).resolves.toBeUndefined();
  });

  it('joinViaInviteLink com código inválido falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.groups.joinViaInviteLink({ invite: 'codigo-invalido' }));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('leaveGroup remove o grupo (não aparece mais em getInfo/list)', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });

    await wa.groups.leaveGroup(group.id);

    const failure = await reject(wa.groups.getInfo(group.id));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
    expect(await wa.groups.list()).toHaveLength(0);
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
