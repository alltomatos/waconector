import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type WhapiOptions, whapi } from '../../src/adapters/whapi';
import ackFixture from '../../src/adapters/whapi/fixtures/webhook-ack.json';
import connectionUpdateAuthFixture from '../../src/adapters/whapi/fixtures/webhook-connection-update-auth.json';
import connectionUpdateQrFixture from '../../src/adapters/whapi/fixtures/webhook-connection-update-qr.json';
import messageDocumentFixture from '../../src/adapters/whapi/fixtures/webhook-message-document.json';
import messageReceivedFixture from '../../src/adapters/whapi/fixtures/webhook-message-received.json';
import messageSentFixture from '../../src/adapters/whapi/fixtures/webhook-message-sent.json';
import userConnectedFixture from '../../src/adapters/whapi/fixtures/webhook-user-connected.json';
import userDisconnectedFixture from '../../src/adapters/whapi/fixtures/webhook-user-disconnected.json';
import { describeAdapterContract } from './adapter-contract';

const TOKEN = 'contrato-token-whapi-nao-real';
const RECIPIENT = '5511999999999';
const GROUP_ID = '120363000000000000@g.us';
/** `@` vira `%40` em `url.pathname` (via `encodeURIComponent`, feito pelo adapter) — usado para
 * comparar o path recebido pelo stub; `GROUP_ID` (com `@` cru) é usado para chamar o adapter e para
 * conferir valores de campo (`group.id`), nunca para comparar `pathname`. */
const GROUP_ID_PATH = encodeURIComponent(GROUP_ID);
/** `ChatID` (diferente de `ContactID`) exige o sufixo `@domínio` — ver docs/providers/whapi.md
 * "Conversas (`chats.*`)". Mesmo tratamento de `GROUP_ID`/`GROUP_ID_PATH` acima. */
const CHAT_ID = `${RECIPIENT}@s.whatsapp.net`;
const CHAT_ID_PATH = encodeURIComponent(CHAT_ID);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais do Whapi.Cloud (ver docs/providers/whapi.md) — sem rede real, sem credenciais reais.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/users/login') {
      return jsonResponse(200, {
        status: 'WAITING',
        type: 'qr',
        base64: 'ZmFrZS1xcg==',
        rowdata: 'raw-qr-data',
        request_id: 'req-fake-1',
        expire: 1999999999,
      });
    }

    if (method === 'GET' && pathname === '/health') {
      return jsonResponse(200, {
        channel_id: 'MANTIS-M72HC',
        start_at: 1713774883,
        uptime: 900,
        version: '1.8.3-74-gf7df472',
        status: { code: 200, text: 'AUTH' },
      });
    }

    if (method === 'POST' && pathname === '/users/logout') {
      return jsonResponse(200, { success: true });
    }

    if (method === 'POST' && pathname === '/messages/text') {
      return jsonResponse(200, {
        sent: true,
        message: {
          id: 'whapi-fake-text',
          chat_id: `${RECIPIENT}@s.whatsapp.net`,
          timestamp: 1712995245,
        },
      });
    }

    if (method === 'POST' && pathname === '/messages/image') {
      return jsonResponse(200, {
        sent: true,
        message: {
          id: 'whapi-fake-image',
          chat_id: `${RECIPIENT}@s.whatsapp.net`,
          timestamp: 1712995300,
        },
      });
    }

    if (method === 'POST' && pathname === '/messages/video') {
      return jsonResponse(200, {
        sent: true,
        message: {
          id: 'whapi-fake-video',
          chat_id: `${RECIPIENT}@s.whatsapp.net`,
          timestamp: 1712995310,
        },
      });
    }

    if (method === 'POST' && pathname === '/messages/audio') {
      return jsonResponse(200, {
        sent: true,
        message: {
          id: 'whapi-fake-audio',
          chat_id: `${RECIPIENT}@s.whatsapp.net`,
          timestamp: 1712995320,
        },
      });
    }

    if (method === 'POST' && pathname === '/messages/document') {
      return jsonResponse(200, {
        sent: true,
        message: {
          id: 'whapi-fake-doc',
          chat_id: `${RECIPIENT}@s.whatsapp.net`,
          timestamp: 1712995330,
        },
      });
    }

    if (method === 'POST' && pathname === '/messages/sticker') {
      return jsonResponse(200, {
        sent: true,
        message: {
          id: 'whapi-fake-sticker',
          chat_id: `${RECIPIENT}@s.whatsapp.net`,
          timestamp: 1712995340,
        },
      });
    }

    const reactionMatch = pathname.match(/^\/messages\/(.+)\/reaction$/);
    if ((method === 'PUT' || method === 'DELETE') && reactionMatch) {
      return jsonResponse(200, { success: true });
    }

    const messageIdMatch = pathname.match(/^\/messages\/([^/]+)$/);
    if (method === 'DELETE' && messageIdMatch) {
      return jsonResponse(200, { success: true });
    }

    if ((method === 'POST' || method === 'PATCH') && pathname === `/chats/${CHAT_ID_PATH}`) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'POST' && pathname === '/groups') {
      return jsonResponse(200, {
        id: `${GROUP_ID}`,
        name: 'Grupo de teste',
        type: 'group',
        participants: [
          { id: `${RECIPIENT}@s.whatsapp.net`, rank: 'creator' },
          { id: '5511988887777@s.whatsapp.net', rank: 'member' },
        ],
        created_by: `${RECIPIENT}@s.whatsapp.net`,
      });
    }

    if (method === 'PUT' && pathname === '/groups') {
      return jsonResponse(200, { group_id: GROUP_ID });
    }

    if (method === 'GET' && pathname === '/groups') {
      return jsonResponse(200, {
        groups: [
          {
            id: GROUP_ID,
            name: 'Grupo de teste',
            description: 'Descrição do grupo',
            participants: [{ id: `${RECIPIENT}@s.whatsapp.net`, rank: 'admin' }],
            created_by: `${RECIPIENT}@s.whatsapp.net`,
          },
        ],
        count: 1,
        total: 1,
        offset: 0,
      });
    }

    if (method === 'GET' && pathname === `/groups/${GROUP_ID_PATH}`) {
      return jsonResponse(200, {
        id: GROUP_ID,
        name: 'Grupo de teste',
        description: 'Descrição do grupo',
        participants: [
          { id: `${RECIPIENT}@s.whatsapp.net`, rank: 'creator' },
          { id: '5511988887777@s.whatsapp.net', rank: 'admin' },
          { id: '5511977776666@s.whatsapp.net', rank: 'member' },
        ],
        created_by: `${RECIPIENT}@s.whatsapp.net`,
      });
    }

    if (method === 'PUT' && pathname === `/groups/${GROUP_ID_PATH}`) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'DELETE' && pathname === `/groups/${GROUP_ID_PATH}`) {
      return jsonResponse(200, { success: true });
    }

    if (
      (method === 'POST' || method === 'DELETE') &&
      pathname === `/groups/${GROUP_ID_PATH}/participants`
    ) {
      return jsonResponse(200, { success: true, failed: [], processed: [] });
    }

    if (
      (method === 'PATCH' || method === 'DELETE') &&
      pathname === `/groups/${GROUP_ID_PATH}/admins`
    ) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'PUT' && pathname === `/groups/${GROUP_ID_PATH}/icon`) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'GET' && pathname === `/groups/${GROUP_ID_PATH}/invite`) {
      return jsonResponse(200, { invite_code: 'CONTRATOCODIGO' });
    }

    if (method === 'DELETE' && pathname === `/groups/${GROUP_ID_PATH}/invite`) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'GET' && pathname === '/contacts') {
      return jsonResponse(200, {
        contacts: [
          {
            id: `${RECIPIENT}@s.whatsapp.net`,
            phone: RECIPIENT,
            name: 'Contato de teste',
            pushname: 'Pushname de teste',
            profile_pic: 'https://cdn.exemplo.test/thumb.jpg',
            profile_pic_full: 'https://cdn.exemplo.test/full.jpg',
          },
        ],
        count: 1,
        total: 1,
        offset: 0,
      });
    }

    if (method === 'GET' && pathname === `/contacts/${RECIPIENT}`) {
      return jsonResponse(200, {
        id: `${RECIPIENT}@s.whatsapp.net`,
        phone: RECIPIENT,
        name: 'Contato de teste',
        pushname: 'Pushname de teste',
        profile_pic_full: 'https://cdn.exemplo.test/full.jpg',
      });
    }

    if (method === 'HEAD' && pathname === `/contacts/${RECIPIENT}`) {
      return jsonResponse(200, undefined);
    }

    if (method === 'HEAD' && pathname === '/contacts/5511900000000') {
      return jsonResponse(404, { error: 'Specified contact not registered' });
    }

    if (method === 'GET' && pathname === `/contacts/${RECIPIENT}/profile`) {
      return jsonResponse(200, {
        name: 'Contato de teste',
        push_name: 'Pushname de teste',
        about: 'Hey there! I am using WhatsApp.',
        icon: 'https://cdn.exemplo.test/icon.jpg',
        icon_full: 'https://cdn.exemplo.test/icon-full.jpg',
      });
    }

    if (method === 'GET' && pathname === `/contacts/${RECIPIENT}/about`) {
      return jsonResponse(200, { about: 'Hey there! I am using WhatsApp.' });
    }

    if ((method === 'PUT' || method === 'DELETE') && pathname === `/blacklist/${RECIPIENT}`) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'GET' && pathname === '/blacklist') {
      return jsonResponse(200, ['5511988887777', '5511977776666@lid']);
    }

    throw new Error(`fetchStub (whapi): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<WhapiOptions> = {}): WhapiOptions {
  return {
    token: TOKEN,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'whapi',
  create() {
    const adapter = whapi(buildAdapterOptions());
    return {
      adapter,
      ready: async () => {
        await adapter.instance.connect();
      },
      webhooks: {
        messageReceived: { body: messageReceivedFixture },
      },
      recipient: RECIPIENT,
    };
  },
});

describe('whapi adapter: comportamento específico do provider', () => {
  it('usa https://gate.whapi.cloud como baseUrl padrão e envia Authorization: Bearer <token>', async () => {
    const calls: Headers[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.provider).toBe('whapi');
    await adapter.instance.status();
    expect(calls[0]?.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('instance.connect chama GET /users/login?wakeup=true e devolve o qr do campo "base64"', async () => {
    let requestedUrl: URL | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/users/login') requestedUrl = url;
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.connect();

    expect(requestedUrl?.searchParams.get('wakeup')).toBe('true');
    expect(result.qr).toBe('ZmFrZS1xcg==');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status chama GET /health?wakeup=false e mapeia status.text "AUTH" para "connected"', async () => {
    let requestedUrl: URL | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/health') requestedUrl = url;
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();

    expect(requestedUrl?.searchParams.get('wakeup')).toBe('false');
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  const stateCases: Array<[string, string]> = [
    ['NOT_INIT', 'disconnected'],
    ['INIT', 'connecting'],
    ['LAUNCH', 'connecting'],
    ['QR', 'qr'],
    ['AUTH', 'connected'],
    ['ERROR', 'unknown'],
    ['SYNC_ERROR', 'unknown'],
    ['ALGO_NOVO_NAO_MAPEADO', 'unknown'],
  ];

  for (const [statusText, expectedState] of stateCases) {
    it(`instance.status mapeia status.text "${statusText}" para "${expectedState}"`, async () => {
      const adapter = whapi(
        buildAdapterOptions({
          fetch: async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname === '/health') {
              return jsonResponse(200, { status: { code: 0, text: statusText } });
            }
            return createFetchStub()(input, init);
          },
        }),
      );
      const status = await adapter.instance.status();
      expect(status.state).toBe(expectedState);
    });
  }

  it('instance.status mapeia corpo sem "status.text" para "unknown" (nunca lança)', async () => {
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/health') return jsonResponse(200, { algumCampoNovo: true });
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('unknown');
  });

  it('instance.logout chama POST /users/logout sem corpo', async () => {
    let requestedMethod: string | undefined;
    let requestedBody: string | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/users/logout') {
            requestedMethod = (init?.method ?? 'GET').toUpperCase();
            requestedBody = init?.body === undefined ? undefined : String(init.body);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(requestedMethod).toBe('POST');
    expect(requestedBody).toBeUndefined();
  });

  it('messages.sendText envia {to, body, quoted, mentions} para POST /messages/text', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({
      to: RECIPIENT,
      text: 'contrato: ping',
      quotedId: 'MSG_ORIGINAL',
      mentions: ['5511988887777'],
    });

    expect(capturedBody?.to).toBe(RECIPIENT);
    expect(capturedBody?.body).toBe('contrato: ping');
    expect(capturedBody?.quoted).toBe('MSG_ORIGINAL');
    expect(capturedBody?.mentions).toEqual(['5511988887777']);
    expect(sent.id).toBe('whapi-fake-text');
    expect(sent.chatId).toBe(`${RECIPIENT}@s.whatsapp.net`);
    expect(sent.timestamp).toBe(1712995245000);
  });

  it('messages.sendText aceita JID explícito em "to" sem transformação', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendText({ to: `${RECIPIENT}@s.whatsapp.net`, text: 'oi' });

    expect(capturedBody?.to).toBe(`${RECIPIENT}@s.whatsapp.net`);
  });

  it('messages.sendMedia (image) envia {to, media, caption} usando media.url diretamente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/image') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto.jpg', mimeType: 'image/jpeg' },
      caption: 'legenda',
    });

    expect(capturedBody?.to).toBe(RECIPIENT);
    expect(capturedBody?.media).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.caption).toBe('legenda');
    expect(sent.id).toBe('whapi-fake-image');
  });

  it('messages.sendMedia (image) monta data URI a partir de media.base64 sem prefixo "data:"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/image') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'image', base64: 'ZmFrZS1pbWFnZW0=' },
    });

    expect(capturedBody?.media).toBe('data:image/png;base64,ZmFrZS1pbWFnZW0=');
  });

  it('messages.sendMedia (audio) não envia "caption" (não suportado para áudio)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/audio') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'audio', url: 'https://cdn.exemplo.test/audio.ogg' },
      caption: 'ignorada',
    });

    expect(capturedBody?.media).toBe('https://cdn.exemplo.test/audio.ogg');
    expect(capturedBody?.caption).toBeUndefined();
    expect(sent.id).toBe('whapi-fake-audio');
  });

  it('messages.sendMedia (document) envia "filename" além de "caption"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/document') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: RECIPIENT,
      media: {
        kind: 'document',
        url: 'https://cdn.exemplo.test/contrato.pdf',
        filename: 'contrato.pdf',
      },
      caption: 'segue o contrato',
    });

    expect(capturedBody?.media).toBe('https://cdn.exemplo.test/contrato.pdf');
    expect(capturedBody?.filename).toBe('contrato.pdf');
    expect(capturedBody?.caption).toBe('segue o contrato');
    expect(sent.id).toBe('whapi-fake-doc');
  });

  it('messages.sendMedia (sticker) não envia "caption" (não suportado para figurinha)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/sticker') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'sticker', url: 'https://cdn.exemplo.test/figurinha.webp' },
      caption: 'ignorada',
    });

    expect(capturedBody?.caption).toBeUndefined();
    expect(sent.id).toBe('whapi-fake-sticker');
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const failure = await wa.messages
      .sendMedia({ to: RECIPIENT, media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('messages.sendReaction envia PUT {emoji} e ecoa messageId/to no SentMessage (resposta é fixa, sem id próprio)', async () => {
    let capturedMethod: string | undefined;
    let capturedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/reaction')) {
            capturedMethod = (init?.method ?? 'GET').toUpperCase();
            capturedPath = url.pathname;
            capturedBody = init?.body === undefined ? undefined : JSON.parse(String(init.body));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendReaction({
      to: RECIPIENT,
      messageId: 'CONTRATO_MSG_1',
      emoji: '👍',
    });

    expect(capturedMethod).toBe('PUT');
    expect(capturedPath).toBe('/messages/CONTRATO_MSG_1/reaction');
    expect(capturedBody).toEqual({ emoji: '👍' });
    expect(sent.id).toBe('CONTRATO_MSG_1');
    expect(sent.chatId).toBe(RECIPIENT);
    expect(sent.timestamp).toBeUndefined();
  });

  it('messages.sendReaction com emoji vazio chama DELETE /messages/{id}/reaction (endpoint dedicado de remoção)', async () => {
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/reaction')) {
            capturedMethod = (init?.method ?? 'GET').toUpperCase();
            capturedBody = init?.body === undefined ? undefined : String(init.body);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendReaction({ to: RECIPIENT, messageId: 'CONTRATO_MSG_1', emoji: '' });

    expect(capturedMethod).toBe('DELETE');
    expect(capturedBody).toBeUndefined();
  });

  it('groups.create envia {subject, participants} para POST /groups e mapeia participants por "rank"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/groups' && (init?.method ?? 'GET').toUpperCase() === 'POST') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo de teste',
      participants: [RECIPIENT, '5511988887777'],
    });

    expect(capturedBody?.subject).toBe('Grupo de teste');
    expect(capturedBody?.participants).toEqual([RECIPIENT, '5511988887777']);
    expect(group.id).toBe(GROUP_ID);
    expect(group.subject).toBe('Grupo de teste');
    expect(group.participants).toEqual([
      { id: `${RECIPIENT}@s.whatsapp.net`, isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.getInfo chama GET /groups/{GroupID} e mapeia rank "admin"/"creator"/"member" para isAdmin/isSuperAdmin', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo(GROUP_ID);

    expect(group.id).toBe(GROUP_ID);
    expect(group.subject).toBe('Grupo de teste');
    expect(group.description).toBe('Descrição do grupo');
    expect(group.owner).toBe(`${RECIPIENT}@s.whatsapp.net`);
    expect(group.participants).toEqual([
      { id: `${RECIPIENT}@s.whatsapp.net`, isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: true, isSuperAdmin: false },
      { id: '5511977776666@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
  });

  it('groups.list chama GET /groups e mapeia "groups" da resposta paginada', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const groups = await wa.groups.list();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe(GROUP_ID);
    expect(groups[0]?.subject).toBe('Grupo de teste');
  });

  it('groups.addParticipants/removeParticipants enviam POST/DELETE em /groups/{GroupID}/participants com {participants} em lote', async () => {
    const hits: Array<{ method: string; body: unknown }> = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/groups/${GROUP_ID_PATH}/participants`) {
            hits.push({
              method: (init?.method ?? 'GET').toUpperCase(),
              body: JSON.parse(String(init?.body)),
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.addParticipants({ groupId: GROUP_ID, participants: [RECIPIENT] });
    await wa.groups.removeParticipants({ groupId: GROUP_ID, participants: [RECIPIENT] });

    expect(hits).toEqual([
      { method: 'POST', body: { participants: [RECIPIENT] } },
      { method: 'DELETE', body: { participants: [RECIPIENT] } },
    ]);
  });

  it('groups.promoteParticipants/demoteParticipants enviam PATCH/DELETE em /groups/{GroupID}/admins', async () => {
    const hits: string[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/groups/${GROUP_ID_PATH}/admins`) {
            hits.push((init?.method ?? 'GET').toUpperCase());
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.promoteParticipants({ groupId: GROUP_ID, participants: [RECIPIENT] });
    await wa.groups.demoteParticipants({ groupId: GROUP_ID, participants: [RECIPIENT] });

    expect(hits).toEqual(['PATCH', 'DELETE']);
  });

  it('groups.updateSubject envia só {subject} para PUT /groups/{GroupID} (sem sobrescrever description)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === `/groups/${GROUP_ID_PATH}` &&
            (init?.method ?? '').toUpperCase() === 'PUT'
          ) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updateSubject({ groupId: GROUP_ID, subject: 'Novo nome' });

    expect(capturedBody).toEqual({ subject: 'Novo nome' });
  });

  it('groups.updateDescription envia só {description} para o MESMO PUT /groups/{GroupID}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === `/groups/${GROUP_ID_PATH}` &&
            (init?.method ?? '').toUpperCase() === 'PUT'
          ) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updateDescription({ groupId: GROUP_ID, description: 'Nova descrição' });

    expect(capturedBody).toEqual({ description: 'Nova descrição' });
  });

  it('groups.updatePicture envia {media} para PUT /groups/{GroupID}/icon', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/groups/${GROUP_ID_PATH}/icon`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updatePicture({
      groupId: GROUP_ID,
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto-grupo.jpg' },
    });

    expect(capturedBody).toEqual({ media: 'https://cdn.exemplo.test/foto-grupo.jpg' });
  });

  it('groups.getInviteLink normaliza "invite_code" (só o código) para o link completo', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink(GROUP_ID);

    expect(result.link).toBe('https://chat.whatsapp.com/CONTRATOCODIGO');
    expect(result).toHaveProperty('raw');
  });

  it('groups.revokeInviteLink encadeia DELETE (revoga) + GET (busca o código atualizado) e devolve o link completo', async () => {
    const hits: string[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/groups/${GROUP_ID_PATH}/invite`) {
            hits.push((init?.method ?? 'GET').toUpperCase());
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.revokeInviteLink(GROUP_ID);

    expect(hits).toEqual(['DELETE', 'GET']);
    expect(result.link).toBe('https://chat.whatsapp.com/CONTRATOCODIGO');
  });

  it('groups.joinViaInviteLink extrai o código do link completo e envia {invite_code} para PUT /groups', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/groups' && (init?.method ?? '').toUpperCase() === 'PUT') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink({ invite: 'CONTRATO_CODIGO_CONVITE' });

    expect(capturedBody).toEqual({ invite_code: 'CONTRATO_CODIGO_CONVITE' });
  });

  it('groups.leaveGroup chama DELETE /groups/{GroupID}', async () => {
    const hits: string[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/groups/${GROUP_ID_PATH}`) {
            hits.push((init?.method ?? 'GET').toUpperCase());
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.groups.leaveGroup(GROUP_ID)).resolves.toBeUndefined();

    expect(hits).toEqual(['DELETE']);
  });

  it('contacts.list chama GET /contacts e mapeia "contacts" da resposta paginada', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const contacts = await wa.contacts.list();

    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.id).toBe(`${RECIPIENT}@s.whatsapp.net`);
    expect(contacts[0]?.name).toBe('Contato de teste');
    expect(contacts[0]?.profilePictureUrl).toBe('https://cdn.exemplo.test/full.jpg');
  });

  it('contacts.get mapeia name/pushname/profile_pic_full a partir de GET /contacts/{ContactID}', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get(RECIPIENT);

    expect(contact.id).toBe(`${RECIPIENT}@s.whatsapp.net`);
    expect(contact.name).toBe('Contato de teste');
    expect(contact.profilePictureUrl).toBe('https://cdn.exemplo.test/full.jpg');
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.checkExists usa HEAD /contacts/{ContactID}: 200 -> exists:true', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists(RECIPIENT);

    expect(result.exists).toBe(true);
    expect(result.chatId).toBe(RECIPIENT);
  });

  it('contacts.checkExists: HEAD 404 ("not registered") vira exists:false, não lança', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511900000000');

    expect(result.exists).toBe(false);
    expect(result).toHaveProperty('raw');
  });

  it('contacts.checkExists: qualquer status não-404 continua propagando como erro real', async () => {
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/contacts/5511911111111') {
            return new Response('erro interno', { status: 500 });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const failure = await wa.contacts.checkExists('5511911111111').catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('PROVIDER_ERROR');
    }
  });

  it('contacts.getProfilePicture prioriza "icon_full" sobre "icon"', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.getProfilePicture(RECIPIENT);

    expect(result.url).toBe('https://cdn.exemplo.test/icon-full.jpg');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.getAbout mapeia "about" de GET /contacts/{ContactID}/about', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.getAbout(RECIPIENT);

    expect(result.about).toBe('Hey there! I am using WhatsApp.');
  });

  it('contacts.block/unblock chamam PUT/DELETE em /blacklist/{ContactIdOrLid}, removendo o sufixo @s.whatsapp.net', async () => {
    const hits: string[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/blacklist/${RECIPIENT}`) {
            hits.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.block(`${RECIPIENT}@s.whatsapp.net`)).resolves.toBeUndefined();
    await expect(wa.contacts.unblock(`${RECIPIENT}@s.whatsapp.net`)).resolves.toBeUndefined();

    expect(hits).toEqual([`PUT /blacklist/${RECIPIENT}`, `DELETE /blacklist/${RECIPIENT}`]);
  });

  it('contacts.listBlocked chama GET /blacklist e devolve os IDs canônicos direto (dígitos ou @lid)', async () => {
    const adapter = whapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const blocked = await wa.contacts.listBlocked();

    expect(blocked).toEqual(['5511988887777', '5511977776666@lid']);
  });

  it('messages.edit reenvia POST /messages/text com {to, body, edit: messageId} (mesmo endpoint de sendText)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const edited = await wa.messages.edit({
      to: RECIPIENT,
      messageId: 'CONTRATO_MSG_ORIGINAL',
      text: 'texto editado',
    });

    expect(capturedBody).toEqual({
      to: RECIPIENT,
      body: 'texto editado',
      edit: 'CONTRATO_MSG_ORIGINAL',
    });
    expect(edited.id).toBe('whapi-fake-text');
    expect(edited.chatId).toBe(`${RECIPIENT}@s.whatsapp.net`);
  });

  it('messages.delete chama DELETE /messages/{MessageID} sem corpo', async () => {
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/messages/CONTRATO_MSG_1') {
            capturedMethod = (init?.method ?? 'GET').toUpperCase();
            capturedBody = init?.body === undefined ? undefined : String(init.body);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.delete({ to: RECIPIENT, messageId: 'CONTRATO_MSG_1' }),
    ).resolves.toBeUndefined();

    expect(capturedMethod).toBe('DELETE');
    expect(capturedBody).toBeUndefined();
  });

  it('chats.archive/unarchive enviam POST /chats/{ChatID} com {archive: boolean}', async () => {
    const hits: Array<{ method: string; body: unknown }> = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/chats/${CHAT_ID_PATH}` && (init?.method ?? '') === 'POST') {
            hits.push({ method: 'POST', body: JSON.parse(String(init?.body)) });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.archive(CHAT_ID)).resolves.toBeUndefined();
    await expect(wa.chats.unarchive(CHAT_ID)).resolves.toBeUndefined();

    expect(hits).toEqual([
      { method: 'POST', body: { archive: true } },
      { method: 'POST', body: { archive: false } },
    ]);
  });

  it('chats.pin/unpin enviam PATCH /chats/{ChatID} com {pin: boolean}', async () => {
    const hits: unknown[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/chats/${CHAT_ID_PATH}` && (init?.method ?? '') === 'PATCH') {
            hits.push(JSON.parse(String(init?.body)));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.pin(CHAT_ID)).resolves.toBeUndefined();
    await expect(wa.chats.unpin(CHAT_ID)).resolves.toBeUndefined();

    expect(hits).toEqual([{ pin: true }, { pin: false }]);
  });

  it('chats.markRead/markUnread enviam PATCH /chats/{ChatID} com {mark_unread: boolean} invertido', async () => {
    const hits: unknown[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/chats/${CHAT_ID_PATH}` && (init?.method ?? '') === 'PATCH') {
            hits.push(JSON.parse(String(init?.body)));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.markRead(CHAT_ID)).resolves.toBeUndefined();
    await expect(wa.chats.markUnread(CHAT_ID)).resolves.toBeUndefined();

    expect(hits).toEqual([{ mark_unread: false }, { mark_unread: true }]);
  });

  it('chats.mute/unmute enviam PATCH /chats/{ChatID} com {mute_until: <timestamp futuro>|0}', async () => {
    const hits: unknown[] = [];
    const adapter = whapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/chats/${CHAT_ID_PATH}` && (init?.method ?? '') === 'PATCH') {
            hits.push(JSON.parse(String(init?.body)));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.mute(CHAT_ID)).resolves.toBeUndefined();
    await expect(wa.chats.unmute(CHAT_ID)).resolves.toBeUndefined();

    expect(hits).toEqual([{ mute_until: Date.UTC(2099, 0, 1) }, { mute_until: 0 }]);
  });

  it('declara messages.edit/messages.delete e as 8 operações de chats.* (10 capabilities novas, ADR-0012)', () => {
    const adapter = whapi(buildAdapterOptions());
    expect(adapter.capabilities).toContain('messages.edit');
    expect(adapter.capabilities).toContain('messages.delete');
    for (const capability of [
      'chats.archive',
      'chats.unarchive',
      'chats.mute',
      'chats.unmute',
      'chats.pin',
      'chats.unpin',
      'chats.markRead',
      'chats.markUnread',
    ] as const) {
      expect(adapter.capabilities).toContain(capability);
    }
    expect(adapter.chats).toBeDefined();
  });

  it('parseWebhook normaliza mensagem de texto recebida (from_me:false) para message.received', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.provider).toBe('whapi');
      expect(event.instanceId).toBe('MANTIS-M72HC');
      expect(event.message.id).toBe('p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw');
      expect(event.message.chatId).toBe('919984351847@s.whatsapp.net');
      expect(event.message.text).toBe('Hello world');
      expect(event.message.kind).toBe('text');
      expect(event.message.fromMe).toBe(false);
      expect(event.message.timestamp).toBe(1712995245000);
    }
  });

  it('parseWebhook normaliza o eco (from_me:true) para message.sent', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageSentFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.sent');
    if (event?.type === 'message.sent') {
      expect(event.message.text).toBe('Hey bro');
      expect(event.message.fromMe).toBe(true);
    }
  });

  it('parseWebhook normaliza mensagem de documento com legenda (document.caption -> text, document.link -> media)', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageDocumentFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.id).toBe('tGZmYoiXecvbKahzwpwKmg-gEcTwl0rVw');
      expect(event.message.kind).toBe('document');
      expect(event.message.text).toBe('This is text with file');
      expect(event.message.media).toBeDefined();
      expect(event.message.media?.url).toBe(
        'https://s3.eu-central-1.wasabisys.com/in-files/61371989950/pdf-b487668896662779cbdb29a3c29c0a9a-804713c25d2b57.pdf',
      );
      expect(event.message.media?.mimeType).toBe('application/pdf');
      expect(event.message.media?.filename).toBe('File_example.pdf');
    }
  });

  it('parseWebhook normaliza "statuses" (status delivered) para message.ack', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('YhNqCveDWW90_t8lzrW25w-wO4Twl0rVw');
      expect(event.chatId).toBe('919984351847@s.whatsapp.net');
      expect(event.ack).toBe('delivered');
    }
  });

  it('parseWebhook normaliza status "deleted" (sem equivalente em MessageAck) como unknown', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        statuses: [
          {
            id: 'msg-1',
            status: 'deleted',
            recipient_id: '919984351847@s.whatsapp.net',
            timestamp: '1712995378',
          },
        ],
        event: { type: 'statuses', event: 'post' },
        channel_id: 'MANTIS-M72HC',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook normaliza evento "channel" (status.text QR) para connection.update("qr")', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateQrFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('qr');
      expect(event.instanceId).toBe('MANTIS-M72HC');
    }
  });

  it('parseWebhook normaliza evento "channel" (status.text AUTH, fixture reconstruída) para connection.update("connected")', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateAuthFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook normaliza evento "users" (event:"post") para connection.update("connected")', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: userConnectedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook normaliza evento "users" (event:"delete") para connection.update("disconnected")', () => {
    const adapter = whapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: userDisconnectedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('disconnected');
    }
  });

  it('declara messages.sendReaction/groups.*/contacts.* (23 capabilities novas)', () => {
    const adapter = whapi(buildAdapterOptions());
    expect(adapter.capabilities).toContain('messages.sendReaction');
    expect(adapter.capabilities).toContain('groups.create');
    expect(adapter.capabilities).toContain('groups.leaveGroup');
    expect(adapter.capabilities).toContain('contacts.list');
    expect(adapter.capabilities).toContain('contacts.listBlocked');
    expect(adapter.capabilities).not.toContain('instance.pairingCode');
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = whapi(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { event: { type: 'chats' } } })).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });

  it('redige o token de mensagens de erro (HttpClient secrets), mesmo quando o provider o ecoa no corpo do erro', async () => {
    const adapter = whapi(
      buildAdapterOptions({
        // Simula um provider que (por bug ou log verboso) ecoa o Bearer token recebido de volta no
        // corpo do erro — cenário que `HttpClient.secrets` existe justamente para blindar.
        fetch: async () => new Response(`erro interno, token=${TOKEN}`, { status: 500 }),
      }),
    );

    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain(TOKEN);
      expect(failure.message).toContain('***');
    }
  });
});
