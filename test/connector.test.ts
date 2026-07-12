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

    const updateSubjectFailure = await reject(
      wa.groups.updateSubject({ groupId: 'grupo-1', subject: 'Novo nome' }),
    );
    expect(updateSubjectFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const updateDescriptionFailure = await reject(
      wa.groups.updateDescription({ groupId: 'grupo-1', description: 'nova descrição' }),
    );
    expect(updateDescriptionFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const updatePictureFailure = await reject(
      wa.groups.updatePicture({
        groupId: 'grupo-1',
        media: { kind: 'image', url: 'http://x/y.png' },
      }),
    );
    expect(updatePictureFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const getInviteLinkFailure = await reject(wa.groups.getInviteLink('grupo-1'));
    expect(getInviteLinkFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const revokeInviteLinkFailure = await reject(wa.groups.revokeInviteLink('grupo-1'));
    expect(revokeInviteLinkFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const joinFailure = await reject(wa.groups.joinViaInviteLink({ invite: 'codigo-123' }));
    expect(joinFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const leaveFailure = await reject(wa.groups.leaveGroup('grupo-1'));
    expect(leaveFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const listContactsFailure = await reject(wa.contacts.list());
    expect(listContactsFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const getContactFailure = await reject(wa.contacts.get('5585999999999'));
    expect(getContactFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const checkExistsFailure = await reject(wa.contacts.checkExists('5585999999999'));
    expect(checkExistsFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const getProfilePictureFailure = await reject(wa.contacts.getProfilePicture('5585999999999'));
    expect(getProfilePictureFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const getAboutFailure = await reject(wa.contacts.getAbout('5585999999999'));
    expect(getAboutFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const blockFailure = await reject(wa.contacts.block('5585999999999'));
    expect(blockFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const unblockFailure = await reject(wa.contacts.unblock('5585999999999'));
    expect(unblockFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const listBlockedFailure = await reject(wa.contacts.listBlocked());
    expect(listBlockedFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const editFailure = await reject(
      wa.messages.edit({ to: '5585999999999', messageId: 'm1', text: 'novo texto' }),
    );
    expect(editFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const deleteFailure = await reject(
      wa.messages.delete({ to: '5585999999999', messageId: 'm1' }),
    );
    expect(deleteFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const archiveFailure = await reject(wa.chats.archive('5585999999999'));
    expect(archiveFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const unarchiveFailure = await reject(wa.chats.unarchive('5585999999999'));
    expect(unarchiveFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const muteFailure = await reject(wa.chats.mute('5585999999999'));
    expect(muteFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const unmuteFailure = await reject(wa.chats.unmute('5585999999999'));
    expect(unmuteFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const pinFailure = await reject(wa.chats.pin('5585999999999'));
    expect(pinFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const unpinFailure = await reject(wa.chats.unpin('5585999999999'));
    expect(unpinFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const markReadFailure = await reject(wa.chats.markRead('5585999999999'));
    expect(markReadFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const markUnreadFailure = await reject(wa.chats.markUnread('5585999999999'));
    expect(markUnreadFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const forwardFailure = await reject(
      wa.messages.forward({ to: '5585999999999', messageId: 'm1' }),
    );
    expect(forwardFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const starFailure = await reject(wa.messages.star({ to: '5585999999999', messageId: 'm1' }));
    expect(starFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const unstarFailure = await reject(
      wa.messages.unstar({ to: '5585999999999', messageId: 'm1' }),
    );
    expect(unstarFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const pinMsgFailure = await reject(wa.messages.pin({ to: '5585999999999', messageId: 'm1' }));
    expect(pinMsgFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const unpinMsgFailure = await reject(
      wa.messages.unpin({ to: '5585999999999', messageId: 'm1' }),
    );
    expect(unpinMsgFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const markReadMsgFailure = await reject(
      wa.messages.markRead({ to: '5585999999999', messageId: 'm1' }),
    );
    expect(markReadMsgFailure).toBeInstanceOf(UnsupportedCapabilityError);

    const sendLocationFailure = await reject(
      wa.messages.sendLocation({ to: '5585999999999', latitude: -3.7, longitude: -38.5 }),
    );
    expect(sendLocationFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const sendContactCardFailure = await reject(
      wa.messages.sendContactCard({
        to: '5585999999999',
        contactName: 'Fulano',
        contactPhone: '5585988888888',
      }),
    );
    expect(sendContactCardFailure).toBeInstanceOf(UnsupportedCapabilityError);
    const sendPollFailure = await reject(
      wa.messages.sendPoll({
        to: '5585999999999',
        question: 'Pergunta?',
        options: ['Sim', 'Não'],
      }),
    );
    expect(sendPollFailure).toBeInstanceOf(UnsupportedCapabilityError);
  });

  it('adapter que declara messages.forward sem implementar o método falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter({ capabilities: ['messages.forward', 'webhooks.parse'] });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (capability declarada sem método) para testar o guard-rail do conector.
    (adapter.messages as any).forward = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(wa.messages.forward({ to: '5585999999999', messageId: 'm1' }));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('adapter que declara messages.sendPoll sem implementar o método falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter({ capabilities: ['messages.sendPoll', 'webhooks.parse'] });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (capability declarada sem método) para testar o guard-rail do conector.
    (adapter.messages as any).sendPoll = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.messages.sendPoll({ to: '5585999999999', question: 'Pergunta?', options: ['Sim', 'Não'] }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('adapter que declara messages.edit sem implementar o método falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter({ capabilities: ['messages.edit', 'webhooks.parse'] });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (capability declarada sem método) para testar o guard-rail do conector.
    (adapter.messages as any).edit = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.messages.edit({ to: '5585999999999', messageId: 'm1', text: 'novo texto' }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('adapter que declara chats.archive mas não implementa o namespace chats inteiro falha com PROVIDER_ERROR (nunca TypeError)', async () => {
    const adapter = new MockAdapter({ capabilities: ['chats.archive', 'webhooks.parse'] });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (chats inteiro ausente, mesmo com a capability declarada) para testar o guard-rail do conector.
    (adapter as any).chats = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(wa.chats.archive('5585999999999'));
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
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

  it('adapter que declara contacts.get sem implementar o método falha com PROVIDER_ERROR', async () => {
    const adapter = new MockAdapter({ capabilities: ['contacts.get', 'webhooks.parse'] });
    // biome-ignore lint/suspicious/noExplicitAny: força um adapter inconsistente (capability declarada sem método) para testar o guard-rail do conector.
    (adapter.contacts as any).get = undefined;
    const wa = createConnector(adapter);

    const failure = await reject(wa.contacts.get('5585999999999'));
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

  it('rejeita subject vazio em groups.updateSubject com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });
    const failure = await reject(wa.groups.updateSubject({ groupId: group.id, subject: '' }));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('aceita description vazia em groups.updateDescription (limpa a descrição do grupo)', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });
    await wa.groups.updateDescription({ groupId: group.id, description: '' });
    const info = await wa.groups.getInfo(group.id);
    expect(info.description).toBe('');
  });

  it('rejeita media.kind diferente de "image" em groups.updatePicture com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });
    const failure = await reject(
      wa.groups.updatePicture({
        groupId: group.id,
        media: { kind: 'video', url: 'http://x/y.mp4' },
      }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita groupId vazio em groups.getInfo com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.groups.getInfo(''));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita groupId vazio em getInviteLink/revokeInviteLink/leaveGroup com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const getInviteFailure = await reject(wa.groups.getInviteLink(''));
    expect(isWaConnectorError(getInviteFailure) && getInviteFailure.code === 'INVALID_INPUT').toBe(
      true,
    );
    const revokeFailure = await reject(wa.groups.revokeInviteLink(''));
    expect(isWaConnectorError(revokeFailure) && revokeFailure.code === 'INVALID_INPUT').toBe(true);
    const leaveFailure = await reject(wa.groups.leaveGroup(''));
    expect(isWaConnectorError(leaveFailure) && leaveFailure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita invite vazio em groups.joinViaInviteLink com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.groups.joinViaInviteLink({ invite: '' }));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('normaliza invite (código bare ou link completo) para o link completo antes de entregar ao adapter', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const group = await wa.groups.create({ subject: 'Time', participants: ['5585999999999'] });
    const { link } = await wa.groups.getInviteLink(group.id);
    const bareCode = link.replace('https://chat.whatsapp.com/', '');

    // Aceita tanto o código bare quanto o link completo — ambos resolvem ao mesmo convite.
    await expect(wa.groups.joinViaInviteLink({ invite: bareCode })).resolves.toBeUndefined();
    await expect(wa.groups.joinViaInviteLink({ invite: link })).resolves.toBeUndefined();
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

describe('validação e normalização de contacts.*', () => {
  it('rejeita chatId vazio em contacts.get/getProfilePicture/getAbout com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const getFailure = await reject(wa.contacts.get(''));
    expect(isWaConnectorError(getFailure) && getFailure.code === 'INVALID_INPUT').toBe(true);
    const pictureFailure = await reject(wa.contacts.getProfilePicture(''));
    expect(isWaConnectorError(pictureFailure) && pictureFailure.code === 'INVALID_INPUT').toBe(
      true,
    );
    const aboutFailure = await reject(wa.contacts.getAbout(''));
    expect(isWaConnectorError(aboutFailure) && aboutFailure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita phone inválido em contacts.checkExists com INVALID_RECIPIENT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const failure = await reject(wa.contacts.checkExists('abc'));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_RECIPIENT').toBe(true);
  });

  it('normaliza chatId (telefone vira só-dígitos, JID passa intacto) antes de entregar ao adapter — diferente do groupId opaco', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    adapter.simulateContact({
      id: '5585999999999',
      name: 'Fulano',
      about: 'Ocupado',
      profilePictureUrl: 'http://x/foto.png',
      raw: { mock: true },
    });
    const wa = createConnector(adapter);

    const contact = await wa.contacts.get('+55 (85) 99999-9999');
    expect(contact.id).toBe('5585999999999');
    expect(contact.name).toBe('Fulano');

    const picture = await wa.contacts.getProfilePicture('+55 (85) 99999-9999');
    expect(picture.url).toBe('http://x/foto.png');

    const about = await wa.contacts.getAbout('+55 (85) 99999-9999');
    expect(about.about).toBe('Ocupado');

    const check = await wa.contacts.checkExists('+55 (85) 99999-9999');
    expect(check.exists).toBe(true);
    expect(check.chatId).toBe('5585999999999');
  });

  it('list retorna os contatos conhecidos pelo MockAdapter', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    adapter.simulateContact({ id: '5585999999999', name: 'Fulano', raw: { mock: true } });
    adapter.simulateContact({ id: '5585988888888', name: 'Beltrano', raw: { mock: true } });
    const wa = createConnector(adapter);

    const contacts = await wa.contacts.list();
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => c.id).sort()).toEqual(['5585988888888', '5585999999999']);
  });

  it('get de um contato não conhecido devolve um Contact mínimo em vez de lançar', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5585999999999');
    expect(contact.id).toBe('5585999999999');
    expect(contact.name).toBeUndefined();
  });

  it('block/unblock/listBlocked gerenciam a lista de bloqueados, normalizando o chatId', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await wa.contacts.block('+55 (85) 99999-9999');
    expect(await wa.contacts.listBlocked()).toEqual(['5585999999999']);

    await wa.contacts.unblock('+55 (85) 99999-9999');
    expect(await wa.contacts.listBlocked()).toEqual([]);
  });
});

describe('validação e normalização de messages.edit/delete', () => {
  it('rejeita messageId vazio em messages.edit/delete com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const editFailure = await reject(
      wa.messages.edit({ to: '5585999999999', messageId: '', text: 'novo texto' }),
    );
    expect(isWaConnectorError(editFailure) && editFailure.code === 'INVALID_INPUT').toBe(true);

    const deleteFailure = await reject(wa.messages.delete({ to: '5585999999999', messageId: '' }));
    expect(isWaConnectorError(deleteFailure) && deleteFailure.code === 'INVALID_INPUT').toBe(true);
  });

  it('rejeita text vazio em messages.edit com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const failure = await reject(
      wa.messages.edit({ to: '5585999999999', messageId: 'm1', text: '' }),
    );
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('normaliza o destinatário antes de entregar ao adapter, em messages.edit e messages.delete', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const edited = await wa.messages.edit({
      to: '+55 (85) 99999-9999',
      messageId: 'm1',
      text: 'novo texto',
    });
    expect(edited.chatId).toBe('5585999999999');
    expect(edited.id).toBe('m1');

    await expect(
      wa.messages.delete({ to: '+55 (85) 99999-9999', messageId: 'm1' }),
    ).resolves.toBeUndefined();
  });
});

describe('validação e normalização de messages.forward/star/pin/markRead', () => {
  it('rejeita messageId vazio em forward/star/unstar/pin/unpin/markRead com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    for (const call of [
      () => wa.messages.forward({ to: '5585999999999', messageId: '' }),
      () => wa.messages.star({ to: '5585999999999', messageId: '' }),
      () => wa.messages.unstar({ to: '5585999999999', messageId: '' }),
      () => wa.messages.pin({ to: '5585999999999', messageId: '' }),
      () => wa.messages.unpin({ to: '5585999999999', messageId: '' }),
      () => wa.messages.markRead({ to: '5585999999999', messageId: '' }),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
    }
  });

  it('normaliza "to" e "fromChatId" antes de entregar ao adapter, em messages.forward', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const forwarded = await wa.messages.forward({
      to: '+55 (85) 99999-9999',
      messageId: 'm1',
      fromChatId: '+55 (85) 98888-8888',
    });
    expect(forwarded.chatId).toBe('5585999999999');
  });

  it('normaliza "to" antes de entregar ao adapter, em star/unstar/pin/unpin/markRead', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await wa.messages.star({ to: '+55 (85) 99999-9999', messageId: 'm1' });
    expect(adapter.isMessageStarred('m1')).toBe(true);
    await wa.messages.unstar({ to: '+55 (85) 99999-9999', messageId: 'm1' });
    expect(adapter.isMessageStarred('m1')).toBe(false);

    await wa.messages.pin({ to: '+55 (85) 99999-9999', messageId: 'm1' });
    expect(adapter.isMessagePinned('m1')).toBe(true);
    await wa.messages.unpin({ to: '+55 (85) 99999-9999', messageId: 'm1' });
    expect(adapter.isMessagePinned('m1')).toBe(false);

    await wa.messages.markRead({ to: '+55 (85) 99999-9999', messageId: 'm1' });
    expect(adapter.isMessageRead('m1')).toBe(true);
  });
});

describe('validação e normalização de messages.sendLocation/sendContactCard/sendPoll', () => {
  it('rejeita latitude/longitude não numéricas em sendLocation com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    // biome-ignore lint/suspicious/noExplicitAny: testa validação de entrada inválida em tempo de execução.
    const badLatitude = { to: '5585999999999', latitude: 'x', longitude: -38.5 } as any;
    // biome-ignore lint/suspicious/noExplicitAny: testa validação de entrada inválida em tempo de execução.
    const badLongitude = { to: '5585999999999', latitude: -3.7, longitude: 'y' } as any;

    for (const call of [
      () => wa.messages.sendLocation(badLatitude),
      () => wa.messages.sendLocation(badLongitude),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
    }
  });

  it('rejeita contactName/contactPhone vazios em sendContactCard com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    for (const call of [
      () =>
        wa.messages.sendContactCard({
          to: '5585999999999',
          contactName: '',
          contactPhone: '5585988888888',
        }),
      () =>
        wa.messages.sendContactCard({
          to: '5585999999999',
          contactName: 'Fulano',
          contactPhone: '',
        }),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
    }
  });

  it('rejeita question vazia ou menos de 2 options em sendPoll com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    for (const call of [
      () => wa.messages.sendPoll({ to: '5585999999999', question: '', options: ['Sim', 'Não'] }),
      () => wa.messages.sendPoll({ to: '5585999999999', question: 'Pergunta?', options: ['Sim'] }),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
    }
  });

  it('normaliza "to" antes de entregar ao adapter, em sendLocation/sendContactCard/sendPoll', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    const location = await wa.messages.sendLocation({
      to: '+55 (85) 99999-9999',
      latitude: -3.7,
      longitude: -38.5,
    });
    expect(location.chatId).toBe('5585999999999');

    const contactCard = await wa.messages.sendContactCard({
      to: '+55 (85) 99999-9999',
      contactName: 'Fulano',
      contactPhone: '5585988888888',
    });
    expect(contactCard.chatId).toBe('5585999999999');

    const poll = await wa.messages.sendPoll({
      to: '+55 (85) 99999-9999',
      question: 'Pergunta?',
      options: ['Sim', 'Não'],
    });
    expect(poll.chatId).toBe('5585999999999');
  });
});

describe('validação e normalização de chats.*', () => {
  it('rejeita chatId vazio nos 8 métodos de chats.* com INVALID_INPUT', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    for (const call of [
      () => wa.chats.archive(''),
      () => wa.chats.unarchive(''),
      () => wa.chats.mute(''),
      () => wa.chats.unmute(''),
      () => wa.chats.pin(''),
      () => wa.chats.unpin(''),
      () => wa.chats.markRead(''),
      () => wa.chats.markUnread(''),
    ]) {
      const failure = await reject(call());
      expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
    }
  });

  it('normaliza chatId (telefone vira só-dígitos) antes de entregar ao adapter — mesmo tratamento de contacts.*', async () => {
    const adapter = new MockAdapter();
    adapter.simulateConnected();
    const wa = createConnector(adapter);

    await wa.chats.archive('+55 (85) 99999-9999');
    expect(adapter.isChatArchived('5585999999999')).toBe(true);

    await wa.chats.unarchive('+55 (85) 99999-9999');
    expect(adapter.isChatArchived('5585999999999')).toBe(false);
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
