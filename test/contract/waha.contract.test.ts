import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError, type SentMessage } from '../../src';
import { type WahaOptions, waha } from '../../src/adapters/waha';
import ackFixture from '../../src/adapters/waha/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/waha/fixtures/webhook-connection-update.json';
import groupV2JoinFixture from '../../src/adapters/waha/fixtures/webhook-group-v2-join.json';
import groupV2LeaveFixture from '../../src/adapters/waha/fixtures/webhook-group-v2-leave.json';
import groupParticipantsJoinFixture from '../../src/adapters/waha/fixtures/webhook-group-v2-participants-join.json';
import groupUpdateSubjectFixture from '../../src/adapters/waha/fixtures/webhook-group-v2-update-subject.json';
import hmacValidFixture from '../../src/adapters/waha/fixtures/webhook-hmac-valid.json';
import messageReceivedFixture from '../../src/adapters/waha/fixtures/webhook-message-received.json';
import { describeAdapterContract } from './adapter-contract';

const BASE_URL = 'https://waha.example.com';
const API_KEY = 'test-api-key-should-be-redacted';
const SESSION = 'default';
/** JID de grupo usado nos testes de `groups.*` — mesmo formato `<dígitos>@g.us` da doc oficial. */
const GROUP_ID = '120363043140393908@g.us';
/** `encodeURIComponent(GROUP_ID)` — usado para casar o pathname exato batido pelo adapter. */
const GROUP_ID_ENCODED = '120363043140393908%40g.us';
/**
 * `encodeURIComponent('5585999999999@c.us')` — chatId codificado usado nos testes de
 * `messages.edit`/`messages.delete` e `chats.*` (retrofit ADR-0012).
 */
const CHAT_ID_ENCODED = '5585999999999%40c.us';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` sem rede real: responde com payloads fixos equivalentes aos reais (baseados no
 * dossiê docs/providers/waha.md) para os endpoints usados por esta fase do adapter.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'POST' && pathname === `/api/sessions/${SESSION}/start`) {
      return jsonResponse(201, { name: SESSION, status: 'STARTING' });
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/auth/qr`) {
      expect(url.searchParams.get('format')).toBe('raw');
      return jsonResponse(200, { value: 'mock-qr-code-raw-string' });
    }

    if (method === 'GET' && pathname === `/api/sessions/${SESSION}`) {
      return jsonResponse(200, {
        name: SESSION,
        status: 'WORKING',
        me: { id: '71111111111@c.us', pushName: 'Bot' },
      });
    }

    if (method === 'POST' && pathname === `/api/sessions/${SESSION}/logout`) {
      return new Response(null, { status: 204 });
    }

    if (method === 'POST' && pathname === '/api/sendText') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKSENDTEXT000000000000001',
        timestamp: 1700000010,
        from: '71111111111@c.us',
        to: '5585999999999@c.us',
        fromMe: true,
        body: 'contrato: ping',
        ack: 0,
      });
    }

    if (method === 'POST' && pathname === '/api/sendImage') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKSENDIMAGE00000000000001',
        timestamp: 1700000020,
        from: '71111111111@c.us',
        to: '5585999999999@c.us',
        fromMe: true,
        hasMedia: true,
        ack: 0,
      });
    }

    if (method === 'PUT' && pathname === '/api/reaction') {
      // Resposta real documentada como `object` genérico/vazio no openapi.json — sem campos.
      return jsonResponse(200, {});
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/groups`) {
      // Resposta 201 SEM schema declarado na doc oficial (gap do próprio WAHA) — devolve só
      // "id"/"subject", sem "participants", para exercitar o fallback de mapGroupInfo.
      return jsonResponse(201, {
        id: GROUP_ID,
        subject: 'Contrato: Grupo Teste',
      });
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}`) {
      // Schema inferido por cross-reference com o webhook group.v2.join (ver docs/providers/waha.md).
      return jsonResponse(200, {
        id: GROUP_ID,
        subject: 'Contrato: Grupo Teste',
        description: 'Descrição do grupo de teste',
        invite: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
        membersCanAddNewMember: false,
        membersCanSendMessages: true,
        newMembersApprovalRequired: false,
        participants: [
          { id: '5585999999999@c.us', role: 'admin' },
          // Participante devolvido como @lid (privacidade), com o formato real @c.us em "pn".
          { id: 'ANONYMIZEDLIDPLACEHOLDER@lid', pn: '5585888888888@c.us', role: 'participant' },
        ],
      });
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/groups`) {
      return jsonResponse(200, [
        {
          id: GROUP_ID,
          subject: 'Contrato: Grupo Teste',
          participants: [{ id: '5585999999999@c.us', role: 'superadmin' }],
        },
      ]);
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code`) {
      // Resposta real (openapi.json): STRING PURA (schema type: string), o código bare.
      return jsonResponse(200, 'ABCDEFGHIJKLMNOPQRSTUV');
    }

    // Checado ANTES do catch-all genérico de POST abaixo (que também bate em
    // `/api/{session}/groups/{id}/...`) — senão invite-code/revoke e leave nunca seriam alcançados.
    if (
      method === 'POST' &&
      pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code/revoke`
    ) {
      // Mesmo shape de resposta de invite-code: string pura, o novo código bare.
      return jsonResponse(200, 'ZYXWVUTSRQPONMLKJIHGFE');
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/groups/join`) {
      // Resposta confirmada: { id } (id do grupo ingressado) — ignorada, contrato retorna void.
      return jsonResponse(200, { id: GROUP_ID });
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/leave`) {
      return new Response(null, { status: 204 });
    }

    if (method === 'GET' && pathname === '/api/contacts/all') {
      // Schema WWebJSContact (openapi.json). Um contato com "name" preenchido e outro só com
      // "pushname" (exercita o fallback de mapContact).
      return jsonResponse(200, [
        {
          id: '5585999999999@c.us',
          number: '5585999999999',
          name: 'Contrato Contato',
          pushname: 'ContratoPush',
          shortName: 'Contrato',
          isMe: false,
          isGroup: false,
          isWAContact: true,
          isMyContact: true,
          isBlocked: false,
        },
        {
          id: '5585888888888@c.us',
          number: '5585888888888',
          pushname: 'SoPushname',
          isMe: false,
          isGroup: false,
          isWAContact: false,
          isMyContact: false,
          isBlocked: true,
        },
      ]);
    }

    if (method === 'GET' && pathname === '/api/contacts') {
      // Mesmo shape de /api/contacts/all, um objeto só. "contactId" na query decide qual devolver.
      if (url.searchParams.get('contactId') === '5585888888888@c.us') {
        return jsonResponse(200, {
          id: '5585888888888@c.us',
          number: '5585888888888',
          pushname: 'SoPushname',
          isMe: false,
          isGroup: false,
          isWAContact: false,
          isMyContact: false,
          isBlocked: true,
        });
      }
      return jsonResponse(200, {
        id: '5585999999999@c.us',
        number: '5585999999999',
        name: 'Contrato Contato',
        pushname: 'ContratoPush',
        isMe: false,
        isGroup: false,
        isWAContact: true,
        isMyContact: true,
        isBlocked: false,
      });
    }

    if (method === 'GET' && pathname === '/api/contacts/check-exists') {
      // Schema WANumberExistResult. "phone" decide exists/not-exists.
      if (url.searchParams.get('phone') === '5585000000000') {
        return jsonResponse(200, { numberExists: false });
      }
      return jsonResponse(200, { numberExists: true, chatId: '5585999999999@c.us' });
    }

    if (method === 'GET' && pathname === '/api/contacts/profile-picture') {
      // "profilePictureURL" pode vir null (privacidade não permite).
      if (url.searchParams.get('contactId') === '5585888888888@c.us') {
        return jsonResponse(200, { profilePictureURL: null });
      }
      return jsonResponse(200, { profilePictureURL: 'https://waha.example.com/picture.jpg' });
    }

    if (method === 'GET' && pathname === '/api/contacts/about') {
      // "about" pode vir null (privacidade não permite).
      if (url.searchParams.get('contactId') === '5585888888888@c.us') {
        return jsonResponse(200, { about: null });
      }
      return jsonResponse(200, { about: 'Disponível' });
    }

    if (
      method === 'POST' &&
      (pathname === '/api/contacts/block' || pathname === '/api/contacts/unblock')
    ) {
      // Resposta: 201, sem schema de conteúdo declarado — contrato retorna void, stub genérico
      // basta (mesmo padrão de updateSubject/leaveGroup).
      return jsonResponse(201, {});
    }

    if (method === 'POST' && pathname.startsWith(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/`)) {
      // addParticipants/removeParticipants/promoteParticipants/demoteParticipants: contrato
      // devolve Promise<void>, resposta stub genérica basta.
      return jsonResponse(201, {});
    }

    if (
      method === 'PUT' &&
      (pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/subject` ||
        pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/description` ||
        pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/picture`)
    ) {
      // updateSubject/updateDescription/updatePicture: contrato devolve Promise<void>; a doc não
      // declara schema para subject/description, e picture devolve Result { success } (ignorado).
      return jsonResponse(200, { success: true });
    }

    // messages.edit (retrofit ADR-0012): PUT /api/{session}/chats/{chatId}/messages/{messageId}.
    // Resposta 200 sem schema de conteúdo declarado — stub genérico basta.
    if (
      method === 'PUT' &&
      pathname.startsWith(`/api/${SESSION}/chats/`) &&
      pathname.includes('/messages/')
    ) {
      return jsonResponse(200, {});
    }

    // messages.delete (retrofit ADR-0012): DELETE /api/{session}/chats/{chatId}/messages/{messageId}.
    // Sem schema de resposta relevante — contrato retorna void.
    if (
      method === 'DELETE' &&
      pathname.startsWith(`/api/${SESSION}/chats/`) &&
      pathname.includes('/messages/')
    ) {
      return new Response(null, { status: 200 });
    }

    // chats.markRead (retrofit ADR-0012): POST /api/{session}/chats/{chatId}/messages/read.
    // Checado ANTES do catch-all de archive/unarchive/unread abaixo (mesmo path base).
    if (
      method === 'POST' &&
      pathname === `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/messages/read`
    ) {
      return jsonResponse(201, { ids: ['false_5585999999999@c.us_MOCKREAD00000000000001'] });
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/archive`) {
      // chats.archive: resposta 201 com objeto genérico — ignorada, contrato retorna void.
      return jsonResponse(201, { archived: true });
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/unarchive`) {
      return jsonResponse(201, { archived: false });
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/unread`) {
      // chats.markUnread: sem schema de resposta declarado — contrato retorna void.
      return new Response(null, { status: 200 });
    }

    // messages.forward (ADR-0013): POST /api/forwardMessage. Resposta 201: WAMessage completo.
    if (method === 'POST' && pathname === '/api/forwardMessage') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKFORWARD0000000001',
        timestamp: 1735689600,
        from: '5585999999999@c.us',
        fromMe: true,
        to: '5585999999999@c.us',
        body: 'texto original',
        hasMedia: false,
      });
    }

    // messages.star/unstar (ADR-0013): PUT /api/star. Resposta 200 sem schema.
    if (method === 'PUT' && pathname === '/api/star') {
      return jsonResponse(200, {});
    }

    // messages.pin/unpin (ADR-0013): POST .../messages/{messageId}/pin|unpin — checado ANTES do
    // catch-all PUT/DELETE de edit/delete acima (método POST não colide).
    if (
      method === 'POST' &&
      pathname.startsWith(`/api/${SESSION}/chats/`) &&
      (pathname.endsWith('/pin') || pathname.endsWith('/unpin'))
    ) {
      return jsonResponse(200, { success: true });
    }

    // messages.markRead (ADR-0013, nível de MENSAGEM): POST /api/sendSeen — distinto de
    // chats.markRead (nível de conversa, /chats/{chatId}/messages/read, ADR-0012).
    if (method === 'POST' && pathname === '/api/sendSeen') {
      return new Response(null, { status: 201 });
    }

    // messages.sendLocation (ADR-0014): POST /api/sendLocation. Resposta 201: WAMessage completo.
    if (method === 'POST' && pathname === '/api/sendLocation') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKLOCATION0000001',
        timestamp: 1735689600,
        from: '5585999999999@c.us',
        fromMe: true,
        to: '5585999999999@c.us',
        hasMedia: false,
      });
    }

    // messages.sendContactCard (ADR-0014): POST /api/sendContactVcard.
    if (method === 'POST' && pathname === '/api/sendContactVcard') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKCONTACT00000001',
        timestamp: 1735689600,
        from: '5585999999999@c.us',
        fromMe: true,
        to: '5585999999999@c.us',
        hasMedia: false,
      });
    }

    // messages.sendPoll (ADR-0014): POST /api/sendPoll.
    if (method === 'POST' && pathname === '/api/sendPoll') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKPOLL000000001',
        timestamp: 1735689600,
        from: '5585999999999@c.us',
        fromMe: true,
        to: '5585999999999@c.us',
        hasMedia: false,
      });
    }

    // presence.setTyping/set (ADR-0015): POST /api/{session}/presence.
    if (method === 'POST' && pathname === `/api/${SESSION}/presence`) {
      return new Response(null, { status: 201 });
    }

    // presence.subscribe (ADR-0015): POST /api/{session}/presence/{chatId}/subscribe.
    if (
      method === 'POST' &&
      pathname.startsWith(`/api/${SESSION}/presence/`) &&
      pathname.endsWith('/subscribe')
    ) {
      return new Response(null, { status: 201 });
    }

    // labels.list (ADR-0016): GET /api/{session}/labels.
    if (method === 'GET' && pathname === `/api/${SESSION}/labels`) {
      return jsonResponse(200, [{ id: '1', name: 'Cliente', color: 0, colorHex: '#FF0000' }]);
    }

    // labels.create (ADR-0016): POST /api/{session}/labels.
    if (method === 'POST' && pathname === `/api/${SESSION}/labels`) {
      return jsonResponse(201, { id: '42', name: 'Contrato: Cliente VIP', color: '1' });
    }

    // labels.update (ADR-0016): PUT /api/{session}/labels/{labelId}.
    if (method === 'PUT' && pathname.startsWith(`/api/${SESSION}/labels/`)) {
      return new Response(null, { status: 200 });
    }

    // labels.delete (ADR-0016): DELETE /api/{session}/labels/{labelId}.
    if (method === 'DELETE' && pathname.startsWith(`/api/${SESSION}/labels/`)) {
      return new Response(null, { status: 200 });
    }

    throw new Error(`fetchStub: rota não configurada — ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<WahaOptions> = {}): WahaOptions {
  return {
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    session: SESSION,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'WAHA (waha.devlike.pro)',
  create() {
    const adapter = waha(buildAdapterOptions());
    return {
      adapter,
      // O adapter WAHA não guarda estado local de conexão: cada chamada bate direto no
      // provider, que é quem garante (ou nega) que a sessão está pronta para enviar.
      ready: async () => {},
      webhooks: {
        messageReceived: { body: messageReceivedFixture },
      },
      recipient: '5585999999999',
    };
  },
});

describe('WAHA adapter: comportamento específico do provider', () => {
  it('instance.connect inicia a sessão e devolve o QR cru em ConnectResult.qr', async () => {
    const adapter = waha(buildAdapterOptions());
    const result = await adapter.instance.connect();
    expect(result.qr).toBe('mock-qr-code-raw-string');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia "WORKING" para InstanceState "connected"', async () => {
    const adapter = waha(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  it('instance.logout chama POST /api/sessions/{session}/logout sem lançar', async () => {
    const adapter = waha(buildAdapterOptions());
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
  });

  it('messages.sendText converte telefone canônico para chatId "@c.us"', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent: SentMessage = await wa.messages.sendText({
      to: '5585999999999',
      text: 'contrato: ping',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.path).toBe('/api/sendText');
    expect((call?.body as Record<string, unknown> | undefined)?.chatId).toBe('5585999999999@c.us');
    expect(sent.id).toContain('MOCKSENDTEXT');
    expect(sent.timestamp).toBe(1700000010 * 1000);
  });

  it('messages.sendMedia usa o endpoint por tipo de mídia (image -> /api/sendImage)', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5585999999999',
      media: { kind: 'image', url: 'https://picsum.photos/200', mimeType: 'image/jpeg' },
      caption: 'foto de teste',
    });

    expect(sent.id).toContain('MOCKSENDIMAGE');
    expect(sent.chatId).toBe('5585999999999@c.us');
  });

  it('messages.sendReaction chama PUT /api/reaction com { session, messageId, reaction }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent: SentMessage = await wa.messages.sendReaction({
      to: '5585999999999',
      messageId: 'false_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA',
      emoji: '👍',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe('/api/reaction');
    expect(call?.body).toEqual({
      session: SESSION,
      messageId: 'false_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA',
      reaction: '👍',
    });
    // Resposta stub não ecoa id/chatId (objeto genérico/vazio) -> mapSentMessage cai no fallback.
    expect(sent.id).toContain('waha-');
    expect(sent.chatId).toBe('5585999999999@c.us');
  });

  it('messages.sendReaction com emoji vazio envia "reaction": "" (remove reação, ADR-0008)', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendReaction({
      to: '5585999999999',
      messageId: 'false_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA',
      emoji: '',
    });

    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as Record<string, unknown> | undefined)?.reaction).toBe('');
  });

  it('groups.create converte participantes para {id} e envia { name, participants } para POST /api/{session}/groups', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Contrato: Grupo Teste',
      participants: ['5585999999999', '5585888888888'],
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.path).toBe(`/api/${SESSION}/groups`);
    expect(call?.body).toEqual({
      name: 'Contrato: Grupo Teste',
      participants: [{ id: '5585999999999@c.us' }, { id: '5585888888888@c.us' }],
    });

    // Resposta stub não ecoa "participants" (gap real da doc do WAHA para este endpoint) ->
    // mapGroupInfo cai de volta para os participantes de entrada.
    expect(group.id).toBe(GROUP_ID);
    expect(group.subject).toBe('Contrato: Grupo Teste');
    expect(group.participants).toEqual([
      { id: '5585999999999', isAdmin: false, isSuperAdmin: false },
      { id: '5585888888888', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.getInfo converte groupId para "@g.us" no path e mapeia o schema WAHA (id/pn/role) para GroupInfo', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo(GROUP_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}`);

    expect(group.id).toBe(GROUP_ID);
    expect(group.subject).toBe('Contrato: Grupo Teste');
    expect(group.description).toBe('Descrição do grupo de teste');
    // WAHA não expõe um campo de "dono" explícito neste schema (ver docs/providers/waha.md).
    expect(group.owner).toBeUndefined();
    expect(group.participants).toEqual([
      { id: '5585999999999@c.us', isAdmin: true, isSuperAdmin: false },
      // Veio como @lid na resposta (privacidade) -> "pn" (sempre @c.us) tem preferência sobre "id".
      { id: '5585888888888@c.us', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.list chama GET /api/{session}/groups e mapeia cada item para GroupInfo', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.groups.list();

    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(GROUP_ID);
    expect(list[0]?.participants).toEqual([
      { id: '5585999999999@c.us', isAdmin: true, isSuperAdmin: true },
    ]);
  });

  it('groups.addParticipants envia { participants: [{id}] } para POST .../groups/{id}/participants/add', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.addParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/participants/add`);
    expect(call?.body).toEqual({ participants: [{ id: '5585999999999@c.us' }] });
  });

  it('groups.removeParticipants/promoteParticipants/demoteParticipants usam os endpoints dedicados (participants/remove, admin/promote, admin/demote)', async () => {
    const calls: string[] = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new URL(String(input)).pathname);
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.groups.removeParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] });
    await wa.groups.promoteParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] });
    await wa.groups.demoteParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] });

    expect(calls).toEqual([
      `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/participants/remove`,
      `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/admin/promote`,
      `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/admin/demote`,
    ]);
  });

  it('groups.updateSubject envia PUT .../groups/{id}/subject com { subject }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateSubject({ groupId: GROUP_ID, subject: 'Novo assunto' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/subject`);
    expect(call?.body).toEqual({ subject: 'Novo assunto' });
  });

  it('groups.updateDescription envia PUT .../groups/{id}/description com { description }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({ groupId: GROUP_ID, description: 'Nova descrição' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/description`);
    expect(call?.body).toEqual({ description: 'Nova descrição' });
  });

  it('groups.updateDescription com description vazia é um caso válido (limpa a descrição), não erro', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({ groupId: GROUP_ID, description: '' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as Record<string, unknown> | undefined)?.description).toBe('');
  });

  it('groups.updatePicture com media.url monta ProfilePictureRequest RemoteFile {mimetype, filename, url}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updatePicture({
        groupId: GROUP_ID,
        media: {
          kind: 'image',
          url: 'https://picsum.photos/200',
          mimeType: 'image/png',
          filename: 'foto.png',
        },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/picture`);
    expect(call?.body).toEqual({
      file: { mimetype: 'image/png', filename: 'foto.png', url: 'https://picsum.photos/200' },
    });
  });

  it('groups.updatePicture com media.base64 (sem url) monta ProfilePictureRequest BinaryFile {mimetype, filename, data} e usa "image/jpeg" como mimetype-padrão', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updatePicture({
        groupId: GROUP_ID,
        media: { kind: 'image', base64: 'ZmFrZS1pbWFnZS1ieXRlcw==' },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      file: { mimetype: 'image/jpeg', filename: undefined, data: 'ZmFrZS1pbWFnZS1ieXRlcw==' },
    });
  });

  it('groups.getInviteLink chama GET .../invite-code e monta o link completo a partir do código bare devolvido', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const invite = await wa.groups.getInviteLink(GROUP_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code`);

    // O provider devolve só o código bare ("ABCDEFGHIJKLMNOPQRSTUV") -> o adapter monta o link
    // completo (GroupInviteLink.link é sempre https://chat.whatsapp.com/<código>, ver ADR-0009).
    expect(invite.link).toBe('https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV');
    expect(invite).toHaveProperty('raw');
  });

  it('groups.revokeInviteLink chama POST .../invite-code/revoke e monta o link completo a partir do novo código bare', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const invite = await wa.groups.revokeInviteLink(GROUP_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code/revoke`);
    expect(invite.link).toBe('https://chat.whatsapp.com/ZYXWVUTSRQPONMLKJIHGFE');
    expect(invite).toHaveProperty('raw');
  });

  it('groups.joinViaInviteLink envia { code } para POST /api/{session}/groups/join com o LINK COMPLETO (conector já normaliza "invite")', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    // Entrada como CÓDIGO BARE — o conector normaliza para o link completo antes de o adapter
    // receber (WaConnector.prepareJoinViaInviteLink), e o adapter WAHA repassa o valor recebido
    // direto em "code" (a doc aceita ambos os formatos, então não usa extractInviteCode aqui).
    await expect(
      wa.groups.joinViaInviteLink({ invite: 'ABCDEFGHIJKLMNOPQRSTUV' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe(`/api/${SESSION}/groups/join`);
    expect(call?.body).toEqual({
      code: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
    });
  });

  it('groups.joinViaInviteLink com o link completo como entrada repassa o mesmo link (idempotente)', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink({
      invite: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
    });

    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as Record<string, unknown> | undefined)?.code).toBe(
      'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
    );
  });

  it('groups.leaveGroup chama POST /api/{session}/groups/{id}/leave sem lançar', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.groups.leaveGroup(GROUP_ID)).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/leave`);
  });

  it('contacts.list chama GET /api/contacts/all com { session } e mapeia name/pushname/isWAContact/isBlocked', async () => {
    const calls: Array<{ method: string; path: string; query: URLSearchParams }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            query: url.searchParams,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contacts = await wa.contacts.list();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe('/api/contacts/all');
    expect(calls[0]?.query.get('session')).toBe(SESSION);

    expect(contacts).toHaveLength(2);
    // Primeiro contato: "name" presente -> usado diretamente.
    expect(contacts[0]).toMatchObject({
      id: '5585999999999@c.us',
      name: 'Contrato Contato',
      hasWhatsApp: true,
      isBlocked: false,
    });
    expect(contacts[0]).toHaveProperty('raw');
    // Não há endpoint próprio de about/foto de perfil em /api/contacts/all — ficam undefined
    // por limitação do provider (ver docs/providers/waha.md#contatos), não por bug.
    expect(contacts[0]?.about).toBeUndefined();
    expect(contacts[0]?.profilePictureUrl).toBeUndefined();
    // Segundo contato: sem "name" -> cai para "pushname".
    expect(contacts[1]).toMatchObject({
      id: '5585888888888@c.us',
      name: 'SoPushname',
      hasWhatsApp: false,
      isBlocked: true,
    });
  });

  it('contacts.get converte o chatId canônico para "@c.us" na query "contactId" e mapeia o mesmo schema de list', async () => {
    const calls: Array<{ path: string; query: URLSearchParams }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ path: url.pathname, query: url.searchParams });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5585999999999');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/contacts');
    expect(calls[0]?.query.get('contactId')).toBe('5585999999999@c.us');
    expect(calls[0]?.query.get('session')).toBe(SESSION);

    expect(contact.id).toBe('5585999999999@c.us');
    expect(contact.name).toBe('Contrato Contato');
    expect(contact.hasWhatsApp).toBe(true);
    expect(contact.isBlocked).toBe(false);
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.get usa "pushname" quando "name" está ausente na resposta', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5585888888888');

    expect(contact.id).toBe('5585888888888@c.us');
    expect(contact.name).toBe('SoPushname');
    expect(contact.hasWhatsApp).toBe(false);
    expect(contact.isBlocked).toBe(true);
  });

  it('contacts.checkExists converte o telefone canônico para DÍGITOS na query "phone" (não "@c.us") e mapeia numberExists/chatId', async () => {
    const calls: Array<{ query: URLSearchParams }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ query: url.searchParams });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5585999999999');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query.get('phone')).toBe('5585999999999');
    expect(calls[0]?.query.get('session')).toBe(SESSION);

    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('5585999999999@c.us');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.checkExists mapeia numberExists:false sem "chatId" (ausente quando o número não existe)', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5585000000000');

    expect(result.exists).toBe(false);
    expect(result.chatId).toBeUndefined();
  });

  it('contacts.getProfilePicture chama GET /api/contacts/profile-picture com contactId "@c.us" e mapeia profilePictureURL -> url', async () => {
    const calls: Array<{ path: string; query: URLSearchParams }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ path: url.pathname, query: url.searchParams });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5585999999999');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/contacts/profile-picture');
    expect(calls[0]?.query.get('contactId')).toBe('5585999999999@c.us');
    expect(picture.url).toBe('https://waha.example.com/picture.jpg');
    expect(picture).toHaveProperty('raw');
  });

  it('contacts.getProfilePicture trata profilePictureURL:null como url ausente (privacidade), não como erro', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5585888888888');

    expect(picture.url).toBeUndefined();
  });

  it('contacts.getAbout chama GET /api/contacts/about com contactId "@c.us" e mapeia about', async () => {
    const calls: Array<{ path: string; query: URLSearchParams }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ path: url.pathname, query: url.searchParams });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout('5585999999999');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/contacts/about');
    expect(calls[0]?.query.get('contactId')).toBe('5585999999999@c.us');
    expect(about.about).toBe('Disponível');
    expect(about).toHaveProperty('raw');
  });

  it('contacts.getAbout trata about:null como ausente (privacidade), não como erro', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout('5585888888888');

    expect(about.about).toBeUndefined();
  });

  it('contacts.block chama POST /api/contacts/block com { contactId, session } e resolve void', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.block('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/contacts/block');
    expect(calls[0]?.body).toEqual({ contactId: '5585999999999@c.us', session: SESSION });
  });

  it('contacts.unblock chama POST /api/contacts/unblock com { contactId, session } e resolve void', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.unblock('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/contacts/unblock');
    expect(calls[0]?.body).toEqual({ contactId: '5585999999999@c.us', session: SESSION });
  });

  it('não declara "contacts.listBlocked" (WAHA não tem endpoint nativo de listagem de bloqueados) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = waha(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('contacts.listBlocked');
    expect(adapter.contacts.listBlocked).toBeUndefined();

    const wa = createConnector(adapter);
    const failure = await wa.contacts.listBlocked().catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
    }
  });

  it('messages.edit chama PUT /api/{session}/chats/{chatId}/messages/{messageId} com { text }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.edit({
      to: '5585999999999',
      messageId: 'true_5585999999999@c.us_MOCKEDIT000000000000001',
      text: 'texto editado',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(
      `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/messages/true_5585999999999%40c.us_MOCKEDIT000000000000001`,
    );
    expect(call?.body).toEqual({ text: 'texto editado' });
    // Resposta stub genérica (sem schema) -> mapSentMessage cai no fallback (chatId de input.to).
    expect(sent.chatId).toBe('5585999999999@c.us');
    expect(sent).toHaveProperty('raw');
  });

  it('messages.delete chama DELETE /api/{session}/chats/{chatId}/messages/{messageId} e resolve void', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.delete({
        to: '5585999999999',
        messageId: 'true_5585999999999@c.us_MOCKDELETE00000000000001',
      }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.path).toBe(
      `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/messages/true_5585999999999%40c.us_MOCKDELETE00000000000001`,
    );
  });

  it('messages.forward chama POST /api/forwardMessage com {chatId, messageId, session}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.forward({
      to: '5585999999999',
      messageId: 'true_5585988888888@c.us_MOCKORIGINAL00000001',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/forwardMessage');
    expect(calls[0]?.body).toEqual({
      chatId: '5585999999999@c.us',
      messageId: 'true_5585988888888@c.us_MOCKORIGINAL00000001',
      session: SESSION,
    });
    expect(sent.chatId).toBe('5585999999999@c.us');
    expect(sent).toHaveProperty('raw');
  });

  it('messages.star/unstar chamam PUT /api/star com {messageId, chatId, star, session}', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/api/star') {
            calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.messages.star({ to: '5585999999999', messageId: 'MOCKSTAR001' });
    await wa.messages.unstar({ to: '5585999999999', messageId: 'MOCKSTAR001' });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toEqual({
      messageId: 'MOCKSTAR001',
      chatId: '5585999999999@c.us',
      star: true,
      session: SESSION,
    });
    expect(calls[1]?.body).toEqual({
      messageId: 'MOCKSTAR001',
      chatId: '5585999999999@c.us',
      star: false,
      session: SESSION,
    });
  });

  it('messages.pin envia duration em segundos (86400, decisão do adapter); messages.unpin sem body', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/pin') || url.pathname.endsWith('/unpin')) {
            calls.push({
              path: url.pathname,
              body: init?.body ? JSON.parse(String(init.body)) : undefined,
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.messages.pin({ to: '5585999999999', messageId: 'MOCKPIN001' });
    await wa.messages.unpin({ to: '5585999999999', messageId: 'MOCKPIN001' });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.path).toBe(`/api/${SESSION}/chats/${CHAT_ID_ENCODED}/messages/MOCKPIN001/pin`);
    expect(calls[0]?.body).toEqual({ duration: 86400 });
    expect(calls[1]?.path).toBe(
      `/api/${SESSION}/chats/${CHAT_ID_ENCODED}/messages/MOCKPIN001/unpin`,
    );
    expect(calls[1]?.body).toBeUndefined();
  });

  it('messages.markRead chama POST /api/sendSeen com {chatId, messageIds:[messageId], session} e resolve void', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.markRead({ to: '5585999999999', messageId: 'MOCKREAD001' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/sendSeen');
    expect(calls[0]?.body).toEqual({
      chatId: '5585999999999@c.us',
      messageIds: ['MOCKREAD001'],
      session: SESSION,
    });
  });

  it('messages.sendLocation chama POST /api/sendLocation com {chatId, latitude, longitude, title, session}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendLocation({
      to: '5585999999999',
      latitude: -3.7,
      longitude: -38.5,
      name: 'Escritório',
    });

    expect(sent.chatId).toBe('5585999999999@c.us');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/sendLocation');
    expect(calls[0]?.body).toEqual({
      chatId: '5585999999999@c.us',
      latitude: -3.7,
      longitude: -38.5,
      title: 'Escritório',
      session: SESSION,
    });
  });

  it('messages.sendContactCard chama POST /api/sendContactVcard com {session, chatId, contacts: [{fullName, phoneNumber}]}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendContactCard({
      to: '5585999999999',
      contactName: 'Fulano',
      contactPhone: '5585988888888',
    });

    expect(sent.chatId).toBe('5585999999999@c.us');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/sendContactVcard');
    expect(calls[0]?.body).toEqual({
      session: SESSION,
      chatId: '5585999999999@c.us',
      contacts: [{ fullName: 'Fulano', phoneNumber: '5585988888888' }],
    });
  });

  it('messages.sendPoll chama POST /api/sendPoll com {session, chatId, poll: {name, options, multipleAnswers}}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendPoll({
      to: '5585999999999',
      question: 'Qual sua cor favorita?',
      options: ['Azul', 'Verde'],
      allowMultipleAnswers: true,
    });

    expect(sent.chatId).toBe('5585999999999@c.us');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/api/sendPoll');
    expect(calls[0]?.body).toEqual({
      session: SESSION,
      chatId: '5585999999999@c.us',
      poll: { name: 'Qual sua cor favorita?', options: ['Azul', 'Verde'], multipleAnswers: true },
    });
  });

  it('chats.archive chama POST /api/{session}/chats/{chatId}/archive e resolve void', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.archive('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/chats/${CHAT_ID_ENCODED}/archive`);
  });

  it('chats.unarchive chama POST /api/{session}/chats/{chatId}/unarchive e resolve void', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.unarchive('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/chats/${CHAT_ID_ENCODED}/unarchive`);
  });

  it('chats.markRead chama POST /api/{session}/chats/{chatId}/messages/read (sem query params, usa os defaults do provider) e resolve void', async () => {
    const calls: Array<{ method: string; path: string; query: URLSearchParams }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            query: url.searchParams,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.markRead('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/chats/${CHAT_ID_ENCODED}/messages/read`);
    // Contrato canônico (ChatsApi.markRead) não expõe "count"/"days" -> nenhuma query enviada,
    // o provider aplica os próprios defaults documentados (7 dias, 30 DM / 100 grupo).
    expect([...(calls[0]?.query.keys() ?? [])]).toHaveLength(0);
  });

  it('chats.markUnread chama POST /api/{session}/chats/{chatId}/unread e resolve void', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.markUnread('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/chats/${CHAT_ID_ENCODED}/unread`);
  });

  it('não declara "chats.mute"/"chats.unmute"/"chats.pin"/"chats.unpin" (sem endpoint de conversa confirmado na pesquisa) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = waha(buildAdapterOptions());
    for (const capability of ['chats.mute', 'chats.unmute', 'chats.pin', 'chats.unpin'] as const) {
      expect(adapter.capabilities).not.toContain(capability);
    }
    expect(adapter.chats?.mute).toBeUndefined();
    expect(adapter.chats?.unmute).toBeUndefined();
    expect(adapter.chats?.pin).toBeUndefined();
    expect(adapter.chats?.unpin).toBeUndefined();

    const wa = createConnector(adapter);
    const calls = [
      () => wa.chats.mute('5585999999999'),
      () => wa.chats.unmute('5585999999999'),
      () => wa.chats.pin('5585999999999'),
      () => wa.chats.unpin('5585999999999'),
    ];
    for (const call of calls) {
      const failure = await call().catch((error: unknown) => error);
      expect(isWaConnectorError(failure)).toBe(true);
      if (isWaConnectorError(failure)) {
        expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
      }
    }
  });

  it('presence.setTyping chama POST /api/{session}/presence com {chatId, presence} (composing -> "typing")', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.presence.setTyping({ to: '5585999999999', state: 'composing' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/presence`);
    expect(calls[0]?.body).toEqual({ chatId: '5585999999999@c.us', presence: 'typing' });
  });

  it('presence.set chama POST /api/{session}/presence com {presence} (sem chatId, presença global)', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/${SESSION}/presence`) {
            calls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.presence.set('online')).resolves.toBeUndefined();

    expect(calls).toEqual([{ path: `/api/${SESSION}/presence`, body: { presence: 'online' } }]);
  });

  it('presence.subscribe chama POST /api/{session}/presence/{chatId}/subscribe sem corpo', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.presence.subscribe('5585999999999')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/presence/${CHAT_ID_ENCODED}/subscribe`);
    expect(calls[0]?.body).toBeUndefined();
  });

  it('labels.list chama GET /api/{session}/labels e mapeia {id, name, color}', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const labels = await wa.labels.list();

    expect(labels).toEqual([{ id: '1', name: 'Cliente', color: '0', raw: expect.anything() }]);
  });

  it('labels.create chama POST /api/{session}/labels com {name, color}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const label = await wa.labels.create({ name: 'Contrato: Cliente VIP', color: '1' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/labels`);
    expect(calls[0]?.body).toEqual({ name: 'Contrato: Cliente VIP', color: '1' });
    expect(label).toEqual({
      id: '42',
      name: 'Contrato: Cliente VIP',
      color: '1',
      raw: expect.anything(),
    });
  });

  it('labels.update chama PUT /api/{session}/labels/{labelId} com {name, color}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.labels.update({ labelId: '42', name: 'Cliente VIP', color: '2' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/labels/42`);
    expect(calls[0]?.body).toEqual({ name: 'Cliente VIP', color: '2' });
  });

  it('labels.delete chama DELETE /api/{session}/labels/{labelId} e resolve void', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.labels.delete('42')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/labels/42`);
  });

  it('não declara "labels.addToChat"/"labels.removeFromChat" (endpoint nativo é bulk-replace, não add/remove) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = waha(buildAdapterOptions());
    for (const capability of ['labels.addToChat', 'labels.removeFromChat'] as const) {
      expect(adapter.capabilities).not.toContain(capability);
    }
    expect(adapter.labels?.addToChat).toBeUndefined();
    expect(adapter.labels?.removeFromChat).toBeUndefined();

    const wa = createConnector(adapter);
    const calls = [
      () => wa.labels.addToChat({ chatId: '5585999999999', labelId: '1' }),
      () => wa.labels.removeFromChat({ chatId: '5585999999999', labelId: '1' }),
    ];
    for (const call of calls) {
      const failure = await call().catch((error: unknown) => error);
      expect(isWaConnectorError(failure)).toBe(true);
      if (isWaConnectorError(failure)) {
        expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
      }
    }
  });

  it('parseWebhook normaliza "message.ack" do dossiê para MessageAckEvent', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.ack).toBe('read');
      expect(event.messageId).toBe('true_11111111111@c.us_4CC5EDD64BC22EBA6D639F2AF571346C');
    }
  });

  it('parseWebhook normaliza "session.status" do dossiê para ConnectionUpdateEvent', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook nunca lança para payload desconhecido (vira "unknown")', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: { event: 'group.join', payload: {} } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');

    const eventsNonObject = adapter.parseWebhook({ body: 'não é json' });
    expect(eventsNonObject).toHaveLength(1);
    expect(eventsNonObject[0]?.type).toBe('unknown');
  });

  it('redige a apiKey de mensagens de erro (HttpClient secrets)', async () => {
    const adapter = waha(
      buildAdapterOptions({
        apiKey: 'super-secret-key',
        fetch: async () => jsonResponse(401, { error: 'bad key super-secret-key' }),
      }),
    );

    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain('super-secret-key');
      expect(failure.message).toContain('***');
    }
  });

  it('envia o header X-Api-Key configurado em toda chamada', async () => {
    const calls: Headers[] = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );

    await adapter.instance.status();
    expect(calls[0]?.get('X-Api-Key')).toBe(API_KEY);
  });
});

describe('WAHA adapter: webhooks de grupo (group.v2.*, retrofit ADR-0009)', () => {
  it('parseWebhook normaliza "group.v2.participants" (type: "join") para GroupUpdateEvent com action "participants.add"', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupParticipantsJoinFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe(GROUP_ID);
      expect(event.action).toBe('participants.add');
      // Segunda entrada da fixture vem como @lid (privacidade) com "pn" @c.us -> "pn" tem
      // preferência sobre "id", mesma convenção já usada por mapGroupParticipant (groups.getInfo).
      expect(event.participants).toEqual(['5585999999999@c.us', '5585888888888@c.us']);
      expect(event).toHaveProperty('raw');
    }
  });

  it('parseWebhook normaliza "group.v2.participants" (type: "leave"/"promote"/"demote") para a action correspondente', () => {
    const adapter = waha(buildAdapterOptions());

    const buildBody = (type: string) => ({
      event: 'group.v2.participants',
      session: SESSION,
      payload: {
        type,
        timestamp: 1700000101000,
        group: { id: GROUP_ID },
        participants: [{ id: '5585999999999@c.us' }],
        _data: {},
      },
    });

    const leaveEvents = adapter.parseWebhook({ body: buildBody('leave') });
    expect(leaveEvents).toHaveLength(1);
    expect(leaveEvents[0]?.type).toBe('group.update');
    if (leaveEvents[0]?.type === 'group.update') {
      expect(leaveEvents[0].action).toBe('participants.remove');
    }

    const promoteEvents = adapter.parseWebhook({ body: buildBody('promote') });
    expect(promoteEvents[0]?.type).toBe('group.update');
    if (promoteEvents[0]?.type === 'group.update') {
      expect(promoteEvents[0].action).toBe('participants.promote');
    }

    const demoteEvents = adapter.parseWebhook({ body: buildBody('demote') });
    expect(demoteEvents[0]?.type).toBe('group.update');
    if (demoteEvents[0]?.type === 'group.update') {
      expect(demoteEvents[0].action).toBe('participants.demote');
    }
  });

  it('parseWebhook nunca lança para "group.v2.participants" com "type" não reconhecido (vira "unknown")', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'group.v2.participants',
        session: SESSION,
        payload: {
          type: 'modify_tag', // valor hipotético não documentado
          group: { id: GROUP_ID },
          participants: [],
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook normaliza "group.v2.update" com só "subject" presente para UM GroupUpdateEvent (action "subject")', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupUpdateSubjectFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe(GROUP_ID);
      expect(event.action).toBe('subject');
      expect(event.participants).toBeUndefined();
    }
  });

  it('parseWebhook normaliza "group.v2.update" com só "description" presente para UM GroupUpdateEvent (action "description")', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'group.v2.update',
        session: SESSION,
        payload: {
          timestamp: 1700000201000,
          group: { id: GROUP_ID, description: 'Nova descrição do grupo' },
          _data: {},
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('group.update');
    if (events[0]?.type === 'group.update') {
      expect(events[0].action).toBe('description');
    }
  });

  it('parseWebhook normaliza "group.v2.update" com "description" vazia (limpa a descrição) como caso válido, não erro', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'group.v2.update',
        session: SESSION,
        payload: { group: { id: GROUP_ID, description: '' } },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('group.update');
    if (events[0]?.type === 'group.update') {
      expect(events[0].action).toBe('description');
    }
  });

  it('parseWebhook normaliza "group.v2.update" com "subject" E "description" simultâneos para DOIS GroupUpdateEvent (uma mudança por entrada)', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'group.v2.update',
        session: SESSION,
        payload: {
          timestamp: 1700000202000,
          group: { id: GROUP_ID, subject: 'Assunto novo', description: 'Descrição nova' },
          _data: {},
        },
      },
    });
    expect(events).toHaveLength(2);
    expect(
      events.map((event) => (event.type === 'group.update' ? event.action : undefined)),
    ).toEqual(['subject', 'description']);
    for (const event of events) {
      expect(event.type).toBe('group.update');
      if (event.type === 'group.update') {
        expect(event.groupId).toBe(GROUP_ID);
      }
    }
  });

  it('parseWebhook nunca lança para "group.v2.update" sem "subject"/"description" reconhecíveis (vira "unknown")', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'group.v2.update',
        session: SESSION,
        payload: { group: { id: GROUP_ID }, _data: {} },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook normaliza "group.v2.join" (a própria sessão entrou no grupo) para GroupUpdateEvent com action "participants.add", sem "participants"', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupV2JoinFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe(GROUP_ID);
      expect(event.action).toBe('participants.add');
      // O payload traz o GroupInfo completo, mas não isola qual participante é "a própria sessão"
      // vs a lista inteira -> o adapter não inventa esse dado (participants fica ausente).
      expect(event.participants).toBeUndefined();
    }
  });

  it('parseWebhook normaliza "group.v2.leave" (a própria sessão saiu/foi removida do grupo) para GroupUpdateEvent com action "participants.remove"', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupV2LeaveFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe(GROUP_ID);
      expect(event.action).toBe('participants.remove');
      expect(event.participants).toBeUndefined();
    }
  });

  it('parseWebhook nunca lança para os eventos legados "group.join"/"group.leave" (deprecated, sem parsing estruturado) — viram "unknown"', () => {
    const adapter = waha(buildAdapterOptions());

    const joinEvents = adapter.parseWebhook({
      body: { event: 'group.join', session: SESSION, payload: { id: GROUP_ID } },
    });
    expect(joinEvents).toHaveLength(1);
    expect(joinEvents[0]?.type).toBe('unknown');

    const leaveEvents = adapter.parseWebhook({
      body: { event: 'group.leave', session: SESSION, payload: { id: GROUP_ID } },
    });
    expect(leaveEvents).toHaveLength(1);
    expect(leaveEvents[0]?.type).toBe('unknown');
  });

  it('parseWebhook nunca lança para "group.v2.participants"/"group.v2.update"/"group.v2.join"/"group.v2.leave" sem "payload"', () => {
    const adapter = waha(buildAdapterOptions());

    for (const eventName of [
      'group.v2.participants',
      'group.v2.update',
      'group.v2.join',
      'group.v2.leave',
    ]) {
      const events = adapter.parseWebhook({ body: { event: eventName, session: SESSION } });
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('unknown');
    }
  });
});

describe('WAHA adapter: verificação HMAC de webhooks (opt-in, ADR-0006)', () => {
  const { hmacKey, rawBody, signature } = hmacValidFixture;
  const parsedBody: unknown = JSON.parse(rawBody);

  /** Assinatura com o mesmo tamanho da válida, mas com o último caractere trocado. */
  function tamperedSignature(): string {
    const last = signature.at(-1) ?? '0';
    return `${signature.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  }

  it('(a) sem webhookHmacKey configurado, processa normalmente (comportamento atual, sem regressão)', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: parsedBody });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message.received');
  });

  it('(b) com webhookHmacKey configurado e rawBody + assinatura válidos, processa normalmente', () => {
    const adapter = waha(buildAdapterOptions({ webhookHmacKey: hmacKey }));
    const events = adapter.parseWebhook({
      body: parsedBody,
      rawBody,
      headers: { 'x-webhook-hmac': signature },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message.received');
  });

  it('(c) com webhookHmacKey configurado e assinatura inválida (ou ausente), vira evento "unknown"', () => {
    const adapter = waha(buildAdapterOptions({ webhookHmacKey: hmacKey }));

    const eventsWrongSignature = adapter.parseWebhook({
      body: parsedBody,
      rawBody,
      headers: { 'x-webhook-hmac': tamperedSignature() },
    });
    expect(eventsWrongSignature).toHaveLength(1);
    expect(eventsWrongSignature[0]?.type).toBe('unknown');

    const eventsMissingSignature = adapter.parseWebhook({ body: parsedBody, rawBody });
    expect(eventsMissingSignature).toHaveLength(1);
    expect(eventsMissingSignature[0]?.type).toBe('unknown');
  });

  it('(d) com webhookHmacKey configurado mas rawBody ausente, vira evento "unknown" (falha fechada)', () => {
    const adapter = waha(buildAdapterOptions({ webhookHmacKey: hmacKey }));
    const events = adapter.parseWebhook({
      body: parsedBody,
      headers: { 'x-webhook-hmac': signature },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
    if (events[0]?.type === 'unknown') {
      expect(events[0].reason).toContain('rawBody');
    }
  });
});
