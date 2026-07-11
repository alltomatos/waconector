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

  it('não declara groups.*/contacts.*/messages.sendReaction nesta fase', () => {
    const adapter = whapi(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.sendReaction');
    expect(adapter.capabilities).not.toContain('groups.create');
    expect(adapter.capabilities).not.toContain('contacts.list');
    expect(adapter.messages.sendReaction).toBeUndefined();
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
