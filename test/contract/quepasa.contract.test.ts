import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type QuepasaOptions, quepasa } from '../../src/adapters/quepasa';
import ackDeliveredFixture from '../../src/adapters/quepasa/fixtures/webhook-ack-delivered.json';
import ackReadFixture from '../../src/adapters/quepasa/fixtures/webhook-ack-read.json';
import connectionConnectedFixture from '../../src/adapters/quepasa/fixtures/webhook-connection-connected.json';
import connectionDisconnectedFixture from '../../src/adapters/quepasa/fixtures/webhook-connection-disconnected.json';
import connectionQrFixture from '../../src/adapters/quepasa/fixtures/webhook-connection-qr-reconstructed.json';
import groupJoinedFixture from '../../src/adapters/quepasa/fixtures/webhook-group-joined-reconstructed.json';
import messageDocumentFixture from '../../src/adapters/quepasa/fixtures/webhook-message-document.json';
import messageReceivedFixture from '../../src/adapters/quepasa/fixtures/webhook-message-received.json';
import messageSentFixture from '../../src/adapters/quepasa/fixtures/webhook-message-sent.json';
import { describeAdapterContract } from './adapter-contract';

const TOKEN = 'contrato-token-quepasa-nao-real';
const RECIPIENT = '5511999999999';
const RECIPIENT_JID = `${RECIPIENT}@s.whatsapp.net`;
/** `encodeURIComponent(RECIPIENT_JID)` — usado para casar o pathname exato batido pelo adapter (o "@" vira "%40"), mesmo padrão do adapter WAHA para groupId. */
const RECIPIENT_JID_ENCODED = `${RECIPIENT}%40s.whatsapp.net`;
const GROUP_ID = '123456789-987654321@g.us';
const GROUP_ID_ENCODED = '123456789-987654321%40g.us';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais do QuePasa (ver docs/providers/quepasa.md) — sem rede real, sem credenciais reais. O token
 * é embutido no path das rotas `/v3/bot/{token}/...`, então o stub casa pela URL completa esperada.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/scan') {
      // Resposta REAL do QuePasa é a imagem PNG crua (Content-Type: image/png), não JSON — ver
      // docs/providers/quepasa.md#instanceconnect. Simulado aqui com bytes arbitrários (não um PNG
      // válido de verdade) só para exercitar o caminho "resposta não-JSON" do HttpClient.
      return new Response('\x89PNG\r\n\x1a\n-fake-qr-bytes-', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }

    if (
      method === 'GET' &&
      pathname === '/command' &&
      url.searchParams.get('action') === 'status'
    ) {
      return jsonResponse(200, { success: true, status: 'Ready' });
    }

    if (method === 'GET' && pathname === '/command' && url.searchParams.get('action') === 'stop') {
      return jsonResponse(200, { success: true, status: 'Stopped' });
    }

    if (method === 'POST' && pathname === `/v3/bot/${TOKEN}/sendtext`) {
      return jsonResponse(200, {
        success: true,
        status: 'sended with success',
        message: {
          id: 'quepasa-fake-text',
          wid: '5511888888888',
          chatId: RECIPIENT_JID,
          trackId: '',
        },
      });
    }

    if (method === 'POST' && pathname === `/v3/bot/${TOKEN}/sendurl`) {
      return jsonResponse(200, {
        success: true,
        status: 'sended with success',
        message: {
          id: 'quepasa-fake-url',
          wid: '5511888888888',
          chatId: RECIPIENT_JID,
          trackId: '',
        },
      });
    }

    if (method === 'POST' && pathname === `/v3/bot/${TOKEN}/sendencoded`) {
      return jsonResponse(200, {
        success: true,
        status: 'sended with success',
        message: {
          id: 'quepasa-fake-encoded',
          wid: '5511888888888',
          chatId: RECIPIENT_JID,
          trackId: '',
        },
      });
    }

    if (method === 'GET' && pathname === `/v3/bot/${TOKEN}/invite/${GROUP_ID_ENCODED}`) {
      return jsonResponse(200, { success: true, url: 'https://chat.whatsapp.com/ABC123fake' });
    }

    if (method === 'GET' && pathname === `/v3/bot/${TOKEN}/picinfo/${RECIPIENT_JID_ENCODED}`) {
      // Envelope real (`QpPictureResponse`): `url` vem ANINHADO sob `info`, não solto na raiz — ver
      // docs/providers/quepasa.md#contatos e o comentário de `getContactProfilePicture`.
      return jsonResponse(200, {
        success: true,
        status: 'success',
        info: {
          id: 'pic-fake-1',
          type: 'image/jpeg',
          url: 'https://cdn.exemplo.test/foto-perfil.jpg',
          chatid: RECIPIENT_JID,
          wid: '5511888888888',
        },
      });
    }

    if (method === 'PUT' && pathname === '/edit') {
      // Resposta REAL confirmada (`QpResponse` padrão) NÃO traz um "message" aninhado com id/chatId
      // — ver docs/providers/quepasa.md#messagesedit---put-edit.
      return jsonResponse(200, { success: true, status: 'message edited successfully' });
    }

    if (method === 'DELETE' && pathname.startsWith('/message/')) {
      return jsonResponse(200, { success: true, status: 'revoked with success' });
    }

    if (method === 'POST' && pathname === '/chat/archive') {
      return jsonResponse(200, {
        success: true,
        status: `chat ${RECIPIENT_JID} archived successfully`,
      });
    }

    if (method === 'POST' && (pathname === '/chat/markread' || pathname === '/chat/markunread')) {
      return jsonResponse(200, { success: true, message: `chat ${RECIPIENT_JID} marked as read` });
    }

    // messages.markRead (ADR-0013, nível de MENSAGEM, rota legacy): POST /read — distinto de
    // chats.markRead (/chat/markread, nível de conversa, ADR-0012).
    if (method === 'POST' && pathname === '/read') {
      return jsonResponse(200, { success: true });
    }

    // messages.sendLocation/sendContactCard/sendPoll (ADR-0014) e o gap-fix de sticker em
    // sendMedia: todos via POST /v3/bot/{token}/send (handler SendAny, mesma família de
    // sendtext/sendurl/sendencoded acima).
    if (method === 'POST' && pathname === `/v3/bot/${TOKEN}/send`) {
      return jsonResponse(200, {
        success: true,
        status: 'sended with success',
        message: {
          id: 'quepasa-fake-send',
          wid: '5511888888888',
          chatId: RECIPIENT_JID,
          trackId: '',
        },
      });
    }

    // presence.setTyping (ADR-0015, rota legacy): POST /chat/presence.
    if (method === 'POST' && pathname === '/chat/presence') {
      return jsonResponse(200, { success: true });
    }

    throw new Error(`fetchStub (quepasa): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<QuepasaOptions> = {}): QuepasaOptions {
  return {
    baseUrl: 'http://localhost:31000',
    token: TOKEN,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'quepasa',
  create() {
    const adapter = quepasa(buildAdapterOptions());
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

describe('quepasa adapter: comportamento específico do provider', () => {
  it('envia o header X-QUEPASA-TOKEN em toda requisição', async () => {
    const calls: Headers[] = [];
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.provider).toBe('quepasa');
    await adapter.instance.status();
    expect(calls[0]?.get('X-QUEPASA-TOKEN')).toBe(TOKEN);
  });

  it('instance.connect chama GET /scan e nunca expõe um "qr" utilizável (resposta é PNG binário, não JSON)', async () => {
    let requestedUrl: URL | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/scan') requestedUrl = url;
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.connect();

    expect(requestedUrl?.pathname).toBe('/scan');
    expect(result.qr).toBeUndefined();
    expect(result).toHaveProperty('raw');
  });

  it('instance.connect NÃO é uma capability declarada (limitação documentada de resposta binária)', async () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('instance.connect');
    expect(adapter.capabilities).not.toContain('instance.pairingCode');

    const wa = createConnector(adapter);
    const failure = await wa.instance.connect().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
    }
  });

  it('instance.status chama GET /command?action=status e mapeia "Ready" para "connected"', async () => {
    const adapter = quepasa(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  const stateCases: Array<[string, string]> = [
    ['Ready', 'connected'],
    ['Disconnected', 'disconnected'],
    ['Stopped', 'disconnected'],
    ['UnVerified', 'disconnected'],
    ['UnPrepared', 'disconnected'],
    ['Connected', 'connecting'],
    ['Connecting', 'connecting'],
    ['Starting', 'connecting'],
    ['Stopping', 'connecting'],
    ['Restarting', 'connecting'],
    ['Reconnecting', 'connecting'],
    ['Fetching', 'connecting'],
    ['Halting', 'connecting'],
    ['Failed', 'unknown'],
    ['Unknown', 'unknown'],
    ['ALGO_NOVO_NAO_MAPEADO', 'unknown'],
  ];

  for (const [providerStatus, expectedState] of stateCases) {
    it(`instance.status mapeia status "${providerStatus}" para "${expectedState}"`, async () => {
      const adapter = quepasa(
        buildAdapterOptions({
          fetch: async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname === '/command' && url.searchParams.get('action') === 'status') {
              return jsonResponse(200, { success: true, status: providerStatus });
            }
            return createFetchStub()(input, init);
          },
        }),
      );
      const status = await adapter.instance.status();
      expect(status.state).toBe(expectedState);
    });
  }

  it('instance.status mapeia corpo sem "status" para "unknown" (nunca lança)', async () => {
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/command') return jsonResponse(200, { success: true });
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('unknown');
  });

  it('instance.logout (soft-stop) chama GET /command?action=stop e é declarada como capability', async () => {
    let requestedUrl: URL | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/command' && url.searchParams.get('action') === 'stop') {
            requestedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.capabilities).toContain('instance.logout');
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(requestedUrl?.searchParams.get('action')).toBe('stop');
  });

  it('messages.sendText envia {chatId, text} para POST /v3/bot/{token}/sendtext', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/sendtext`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({ to: RECIPIENT, text: 'contrato: ping' });

    expect(capturedBody?.chatId).toBe(RECIPIENT);
    expect(capturedBody?.text).toBe('contrato: ping');
    expect(sent.id).toBe('quepasa-fake-text');
    expect(sent.chatId).toBe(RECIPIENT_JID);
    expect(sent.timestamp).toBeUndefined();
  });

  it('messages.sendText ignora silenciosamente quotedId/mentions (não suportados pelo QuePasa)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/sendtext`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendText({
      to: RECIPIENT,
      text: 'oi',
      quotedId: 'MSG_ORIGINAL',
      mentions: ['5511988887777'],
    });

    expect(capturedBody).toEqual({ chatId: RECIPIENT, text: 'oi' });
  });

  it('messages.sendMedia com media.url usa POST /v3/bot/{token}/sendurl', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/sendurl`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto.jpg' },
      caption: 'legenda',
    });

    expect(capturedBody?.chatId).toBe(RECIPIENT);
    expect(capturedBody?.url).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.text).toBe('legenda');
    expect(sent.id).toBe('quepasa-fake-url');
  });

  it('messages.sendMedia com media.base64 usa POST /v3/bot/{token}/sendencoded e remove prefixo data URI', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/sendencoded`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: RECIPIENT,
      media: {
        kind: 'document',
        base64: 'data:application/pdf;base64,ZmFrZS1wZGY=',
        filename: 'contrato.pdf',
      },
    });

    expect(capturedBody?.content).toBe('ZmFrZS1wZGY=');
    expect(capturedBody?.fileName).toBe('contrato.pdf');
  });

  it('messages.sendMedia com kind "sticker" e media.url envia {chatId, sticker: {url}} para POST /v3/bot/{token}/send (gap-fix ADR-0014)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/send`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'sticker', url: 'https://cdn.exemplo.test/f.webp' },
    });

    expect(sent.chatId).toBe(RECIPIENT_JID);
    expect(capturedBody).toEqual({
      chatId: RECIPIENT,
      sticker: { url: 'https://cdn.exemplo.test/f.webp' },
    });
  });

  it('messages.sendMedia com kind "sticker" e media.base64 envia {chatId, sticker: {content}} sem remover prefixo de data URI', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/send`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.messages.sendMedia({
      to: RECIPIENT,
      media: { kind: 'sticker', base64: 'data:image/png;base64,ZmFrZS1zdGlja2Vy' },
    });

    expect(capturedBody).toEqual({
      chatId: RECIPIENT,
      sticker: { content: 'data:image/png;base64,ZmFrZS1zdGlja2Vy' },
    });
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = quepasa(buildAdapterOptions());
    const wa = createConnector(adapter);
    const failure = await wa.messages
      .sendMedia({ to: RECIPIENT, media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('groups.getInviteLink chama GET /v3/bot/{token}/invite/{groupId} e devolve o link completo', async () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).toContain('groups.getInviteLink');
    const wa = createConnector(adapter);
    const invite = await wa.groups.getInviteLink(GROUP_ID);
    expect(invite.link).toBe('https://chat.whatsapp.com/ABC123fake');
    expect(invite).toHaveProperty('raw');
  });

  it('groups.* além de getInviteLink não é declarada nem implementada', () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('groups.create');
    expect(adapter.capabilities).not.toContain('groups.list');
    expect(adapter.groups.create).toBeUndefined();
    expect(adapter.groups.list).toBeUndefined();
  });

  it('contacts.getProfilePicture chama GET /v3/bot/{token}/picinfo/{chatId}', async () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).toContain('contacts.getProfilePicture');
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture(RECIPIENT_JID);
    expect(picture.url).toBe('https://cdn.exemplo.test/foto-perfil.jpg');
  });

  it('contacts.* além de getProfilePicture não é declarada nem implementada', () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('contacts.list');
    expect(adapter.capabilities).not.toContain('contacts.checkExists');
    expect(adapter.contacts.list).toBeUndefined();
  });

  it('não declara messages.sendReaction nesta fase', () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.sendReaction');
    expect(adapter.messages.sendReaction).toBeUndefined();
  });

  it('messages.edit envia {messageId, content} para PUT /edit (rota legacy, não /v3/bot/{token}/...) e mapeia a resposta sem "message" aninhado (fallback no messageId/chatId requisitados)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedUrl: URL | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/edit') {
            requestedUrl = url;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const edited = await wa.messages.edit({
      to: RECIPIENT,
      messageId: 'quepasa-msg-original',
      text: 'texto editado',
    });

    expect(requestedUrl?.pathname).toBe('/edit');
    expect(capturedBody).toEqual({ messageId: 'quepasa-msg-original', content: 'texto editado' });
    // Resposta real (`QpResponse` padrão) não traz um "message" aninhado — fallback no messageId/
    // chatId requisitados, não um id sintético (ver docs/providers/quepasa.md).
    expect(edited.id).toBe('quepasa-msg-original');
    expect(edited.chatId).toBe(RECIPIENT);
    expect(edited.timestamp).toBeUndefined();
    expect(edited).toHaveProperty('raw');
  });

  it('messages.delete envia DELETE /message/{messageid} (rota legacy) e ignora a resposta (sempre revoke/"apagar para todos")', async () => {
    let requestedUrl: URL | undefined;
    let requestedMethod: string | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith('/message/')) {
            requestedUrl = url;
            requestedMethod = init?.method;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.messages.delete({ to: RECIPIENT, messageId: 'quepasa-msg-apagada' });

    expect(requestedMethod).toBe('DELETE');
    expect(requestedUrl?.pathname).toBe('/message/quepasa-msg-apagada');
    expect(result).toBeUndefined();
  });

  it('messages.markRead envia [messageId] (array de strings) para POST /read (rota legacy, nível de MENSAGEM)', async () => {
    let requestedBody: unknown;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/read') {
            requestedBody = JSON.parse(String(init?.body));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.markRead({ to: RECIPIENT, messageId: 'quepasa-msg-lida' }),
    ).resolves.toBeUndefined();

    expect(requestedBody).toEqual(['quepasa-msg-lida']);
  });

  it('não declara messages.forward/star/unstar/pin/unpin (rotas legacy não têm esses endpoints)', () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.forward');
    expect(adapter.capabilities).not.toContain('messages.pin');
    expect(adapter.messages.forward).toBeUndefined();
  });

  it('messages.sendLocation envia {chatId, location: {latitude, longitude, name, address}} para POST /v3/bot/{token}/send', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/send`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendLocation({
      to: RECIPIENT,
      latitude: -3.7,
      longitude: -38.5,
      name: 'Escritório',
      address: 'Av. Principal, 100',
    });

    expect(sent.chatId).toBe(RECIPIENT_JID);
    expect(capturedBody).toEqual({
      chatId: RECIPIENT,
      location: {
        latitude: -3.7,
        longitude: -38.5,
        name: 'Escritório',
        address: 'Av. Principal, 100',
      },
    });
  });

  it('messages.sendContactCard envia {chatId, contact: {phone, name}} (sem vcard, auto-gerado pelo servidor) para POST /v3/bot/{token}/send', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/send`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendContactCard({
      to: RECIPIENT,
      contactName: 'Fulano',
      contactPhone: '5511988888888',
    });

    expect(sent.chatId).toBe(RECIPIENT_JID);
    expect(capturedBody).toEqual({
      chatId: RECIPIENT,
      contact: { phone: '5511988888888', name: 'Fulano' },
    });
  });

  it('messages.sendPoll envia {chatId, poll: {question, options, selections}} para POST /v3/bot/{token}/send', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/v3/bot/${TOKEN}/send`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendPoll({
      to: RECIPIENT,
      question: 'Qual sua cor favorita?',
      options: ['Azul', 'Verde'],
      allowMultipleAnswers: true,
    });

    expect(sent.chatId).toBe(RECIPIENT_JID);
    expect(capturedBody).toEqual({
      chatId: RECIPIENT,
      poll: { question: 'Qual sua cor favorita?', options: ['Azul', 'Verde'], selections: 2 },
    });
  });

  it('chats.archive envia {chatid, archive: true} (tag minúscula, distinta de "chatId" de sendtext) para POST /chat/archive (rota legacy)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/archive') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.capabilities).toContain('chats.archive');
    const wa = createConnector(adapter);

    await expect(wa.chats?.archive?.(RECIPIENT)).resolves.toBeUndefined();
    expect(capturedBody).toEqual({ chatid: RECIPIENT, archive: true });
  });

  it('chats.unarchive usa o MESMO endpoint POST /chat/archive com archive: false', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/archive') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.capabilities).toContain('chats.unarchive');
    const wa = createConnector(adapter);

    await expect(wa.chats?.unarchive?.(RECIPIENT_JID)).resolves.toBeUndefined();
    expect(capturedBody).toEqual({ chatid: RECIPIENT_JID, archive: false });
  });

  it('chats.markRead envia {chatid} para POST /chat/markread (rota legacy, nível de CHAT, não de mensagem)', async () => {
    let requestedUrl: URL | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/markread') {
            requestedUrl = url;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.capabilities).toContain('chats.markRead');
    const wa = createConnector(adapter);

    await expect(wa.chats?.markRead?.(RECIPIENT)).resolves.toBeUndefined();
    expect(requestedUrl?.pathname).toBe('/chat/markread');
    expect(capturedBody).toEqual({ chatid: RECIPIENT });
  });

  it('chats.markUnread envia {chatid} para POST /chat/markunread (endpoint irmão de markRead)', async () => {
    let requestedUrl: URL | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/markunread') {
            requestedUrl = url;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    expect(adapter.capabilities).toContain('chats.markUnread');
    const wa = createConnector(adapter);

    await expect(wa.chats?.markUnread?.(RECIPIENT)).resolves.toBeUndefined();
    expect(requestedUrl?.pathname).toBe('/chat/markunread');
    expect(capturedBody).toEqual({ chatid: RECIPIENT });
  });

  it('não declara chats.mute/unmute/pin/unpin (sem endpoint equivalente confirmado no código-fonte)', () => {
    const adapter = quepasa(buildAdapterOptions());

    expect(adapter.capabilities).not.toContain('chats.mute');
    expect(adapter.capabilities).not.toContain('chats.unmute');
    expect(adapter.capabilities).not.toContain('chats.pin');
    expect(adapter.capabilities).not.toContain('chats.unpin');
    expect(adapter.chats?.mute).toBeUndefined();
    expect(adapter.chats?.pin).toBeUndefined();
  });

  it('presence.setTyping envia {chatid, type} para POST /chat/presence (rota legacy) — composing->"text", recording->"audio"', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = quepasa(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/presence') {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.presence.setTyping({ to: RECIPIENT, state: 'composing' });
    await wa.presence.setTyping({ to: RECIPIENT, state: 'recording' });
    await wa.presence.setTyping({ to: RECIPIENT, state: 'paused' });

    expect(capturedBodies).toEqual([
      { chatid: RECIPIENT, type: 'text' },
      { chatid: RECIPIENT, type: 'audio' },
      { chatid: RECIPIENT, type: 'paused' },
    ]);
  });

  it('não declara presence.set/presence.subscribe (sem endpoint equivalente confirmado na pesquisa)', () => {
    const adapter = quepasa(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('presence.set');
    expect(adapter.capabilities).not.toContain('presence.subscribe');
    expect(adapter.presence?.set).toBeUndefined();
  });

  it('parseWebhook normaliza mensagem de texto recebida (fromme:false) para message.received', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.provider).toBe('quepasa');
      expect(event.instanceId).toBe('5511888888888');
      expect(event.message.id).toBe('3EB0quepasa-received-0001');
      expect(event.message.chatId).toBe('5511999999999@s.whatsapp.net');
      expect(event.message.text).toBe('Hello world');
      expect(event.message.kind).toBe('text');
      expect(event.message.fromMe).toBe(false);
      expect(event.message.timestamp).toBe(Date.parse('2026-07-11T21:14:24Z'));
    }
  });

  it('parseWebhook normaliza o eco (fromme:true) para message.sent', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageSentFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.sent');
    if (event?.type === 'message.sent') {
      expect(event.message.text).toBe('Hey bro');
      expect(event.message.fromMe).toBe(true);
    }
  });

  it('parseWebhook normaliza mensagem de documento com "kind" e "media" (attachment confirmado)', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageDocumentFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.kind).toBe('document');
      expect(event.message.text).toBe('segue o contrato');
      expect(event.message.media).toEqual({
        kind: 'document',
        url: 'https://cdn.exemplo.test/contrato.pdf',
        mimeType: 'application/pdf',
        filename: 'contrato.pdf',
      });
    }
  });

  it('parseWebhook deixa "media" undefined quando não há "attachment" no payload', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type === 'message.received') {
      expect(event.message.kind).toBe('text');
      expect(event.message.media).toBeUndefined();
    }
  });

  it('parseWebhook normaliza recibo "deliveryreceipt" (achado atípico: id sintético, id real em "text") para message.ack', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackDeliveredFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('3EB0quepasa-sent-0002');
      expect(event.ack).toBe('delivered');
    }
  });

  it('parseWebhook normaliza recibo "readreceipt" para message.ack com ack "read"', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackReadFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.ack).toBe('read');
    }
  });

  it('parseWebhook normaliza evento "system" (info.event:"connected") para connection.update("connected")', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionConnectedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook normaliza evento "system" (info.event:"disconnected") para connection.update("disconnected")', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionDisconnectedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('disconnected');
    }
  });

  it('parseWebhook normaliza evento "system" (info.event:"qr_scan", fixture reconstruída) para connection.update("qr")', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionQrFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('qr');
    }
  });

  it('parseWebhook normaliza evento "group" (entrada no grupo, fixture reconstruída) para group.update', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupJoinedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe(GROUP_ID);
      expect(event.action).toBeUndefined();
    }
  });

  it('parseWebhook normaliza evento "call" como unknown (sem CanonicalEvent equivalente)', () => {
    const adapter = quepasa(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { type: 'call', id: 'call-1', chat: { id: '5511999999999@s.whatsapp.net' } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = quepasa(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { type: 'unhandled' } })).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });

  it('redige o token de mensagens de erro (HttpClient secrets), mesmo quando o provider o ecoa no corpo do erro', async () => {
    const adapter = quepasa(
      buildAdapterOptions({
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
