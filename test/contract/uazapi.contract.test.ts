import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type UazapiOptions, uazapi } from '../../src/adapters/uazapi';
import ackFixture from '../../src/adapters/uazapi/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/uazapi/fixtures/webhook-connection-update.json';
import messageReceivedFixture from '../../src/adapters/uazapi/fixtures/webhook-message-received.json';
import { describeAdapterContract } from './adapter-contract';

const BASE_URL = 'https://contrato.uazapi.com';
const TOKEN = 'instance-token-de-teste-nao-real';
const ADMIN_TOKEN = 'admin-token-de-teste-nao-real';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais do uazapi (ver docs/providers/uazapi.md) — sem rede real, sem credenciais reais.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'POST' && pathname === '/instance/connect') {
      return jsonResponse(200, {
        instance: {
          id: 'contrato-uazapi',
          name: 'contrato-uazapi',
          status: 'connecting',
          qrcode: 'data:image/png;base64,ZmFrZS1xcg==',
        },
        status: { connected: false, loggedIn: false },
      });
    }

    if (method === 'GET' && pathname === '/instance/status') {
      return jsonResponse(200, {
        instance: {
          id: 'contrato-uazapi',
          name: 'contrato-uazapi',
          status: 'connected',
          profileName: 'Bot de teste',
        },
        status: {
          connected: true,
          loggedIn: true,
          jid: { user: '5511999999999', agent: 0, device: 0, server: 's.whatsapp.net' },
        },
      });
    }

    if (method === 'POST' && pathname === '/instance/disconnect') {
      return jsonResponse(200, { instance: { status: 'disconnected' } });
    }

    if (method === 'POST' && pathname === '/send/text') {
      return jsonResponse(200, {
        id: 'r-fake-text',
        messageid: '3EB0FAKE0000000000TEXT',
        chatid: '5511999999999@s.whatsapp.net',
        status: 'Sent',
        messageTimestamp: 1751000000000,
      });
    }

    if (method === 'POST' && pathname === '/send/media') {
      return jsonResponse(200, {
        id: 'r-fake-media',
        messageid: '3EB0FAKE0000000000MEDIA',
        chatid: '5511999999999@s.whatsapp.net',
        status: 'Sent',
        messageTimestamp: 1751000001000,
      });
    }

    throw new Error(`fetchStub (uazapi): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<UazapiOptions> = {}): UazapiOptions {
  return {
    baseUrl: BASE_URL,
    token: TOKEN,
    adminToken: ADMIN_TOKEN,
    instance: 'contrato-uazapi',
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'uazapi',
  create() {
    const adapter = uazapi(buildAdapterOptions());
    return {
      adapter,
      ready: async () => {
        await adapter.instance.connect();
      },
      webhooks: {
        messageReceived: { body: messageReceivedFixture },
      },
      recipient: '5511999999999',
    };
  },
});

describe('uazapi adapter: comportamento específico do provider', () => {
  it('instance.connect chama POST /instance/connect e devolve o qr de instance.qrcode', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const result = await adapter.instance.connect();
    expect(result.qr).toBe('data:image/png;base64,ZmFrZS1xcg==');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia "connected" para o InstanceState canônico', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  it('instance.status mapeia "connecting" com qrcode presente para "qr"', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/instance/status') {
            return jsonResponse(200, {
              instance: { status: 'connecting', qrcode: 'data:image/png;base64,ZmFrZQ==' },
              status: { connected: false, loggedIn: false },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('qr');
  });

  it('instance.status mapeia "connecting" sem qrcode para "connecting"', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/instance/status') {
            return jsonResponse(200, {
              instance: { status: 'connecting' },
              status: { connected: false, loggedIn: false },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('connecting');
  });

  it('instance.status mapeia "hibernated" para "disconnected" (decisão documentada do adapter)', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/instance/status') {
            return jsonResponse(200, {
              instance: { status: 'hibernated' },
              status: { connected: false, loggedIn: false },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('disconnected');
  });

  it('instance.status mapeia valor desconhecido para "unknown" (nunca lança)', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/instance/status') {
            return jsonResponse(200, {
              instance: { status: 'algo-novo-nao-documentado' },
              status: { connected: false, loggedIn: false },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('unknown');
  });

  it('instance.logout chama POST /instance/disconnect (soft) sem lançar', async () => {
    const calls: string[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(calls).toContain('POST /instance/disconnect');
  });

  it('messages.sendText repassa o chatId canônico sem transformação em "number"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({ to: '5511999999999', text: 'contrato: ping' });

    expect(capturedBody?.number).toBe('5511999999999');
    expect(capturedBody?.text).toBe('contrato: ping');
    expect(sent.id).toBe('3EB0FAKE0000000000TEXT');
    expect(sent.chatId).toBe('5511999999999@s.whatsapp.net');
    expect(sent.timestamp).toBe(1751000000000);
  });

  it('messages.sendText converte "mentions" para string de dígitos separados por vírgula (JIDs perdem o sufixo, "all" passa intacto)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendText({
      to: '5511999999999',
      text: 'Oi a todos',
      mentions: ['5511988887777', '5511977776666@s.whatsapp.net', 'all'],
    });

    expect(capturedBody?.mentions).toBe('5511988887777,5511977776666,all');
  });

  it('messages.sendText inclui "replyid" quando quotedId é informado', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendText({
      to: '5511999999999',
      text: 'resposta',
      quotedId: '3EB0ORIGINAL',
    });

    expect(capturedBody?.replyid).toBe('3EB0ORIGINAL');
  });

  it('messages.sendMedia envia "type" derivado de MediaKind e "file" a partir de media.url', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/media') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto.jpg', mimeType: 'image/jpeg' },
      caption: 'legenda',
    });

    expect(capturedBody?.number).toBe('5511999999999');
    expect(capturedBody?.type).toBe('image');
    expect(capturedBody?.file).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.text).toBe('legenda');
    expect(capturedBody?.mimetype).toBe('image/jpeg');
    expect(capturedBody?.docName).toBeUndefined();
    expect(sent.id).toBe('3EB0FAKE0000000000MEDIA');
  });

  it('messages.sendMedia envia "docName" apenas quando kind é "document"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/media') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: '5511999999999',
      media: {
        kind: 'document',
        url: 'https://cdn.exemplo.test/contrato.pdf',
        filename: 'contrato.pdf',
      },
    });

    expect(capturedBody?.type).toBe('document');
    expect(capturedBody?.docName).toBe('contrato.pdf');
  });

  it('messages.sendMedia usa media.base64 no campo "file" quando media.url está ausente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/media') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', base64: 'ZmFrZS1pbWFnZW0=' },
    });

    expect(capturedBody?.file).toBe('ZmFrZS1pbWFnZW0=');
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.messages
      .sendMedia({ to: '5511999999999', media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('parseWebhook normaliza evento "message" para message.received', () => {
    const adapter = uazapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.provider).toBe('uazapi');
      expect(event.instanceId).toBe('minha-instancia');
      expect(event.message.id).toBe('3EB0538DA65A59F6D8A251');
      expect(event.message.chatId).toBe('5511999999999@s.whatsapp.net');
      expect(event.message.text).toBe('Ola, tudo bem?');
      expect(event.message.kind).toBe('text');
      expect(event.message.fromMe).toBe(false);
    }
  });

  it('parseWebhook normaliza evento "messages_update" (ack) para message.ack', () => {
    const adapter = uazapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('3EB0538DA65A59F6D8A251');
      expect(event.chatId).toBe('5511999999999@s.whatsapp.net');
      expect(event.ack).toBe('read');
    }
  });

  it('parseWebhook normaliza evento "connection" para connection.update', () => {
    const adapter = uazapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
      expect(event.instanceId).toBe('minha-instancia');
    }
  });

  it('parseWebhook reconhece a grafia alternativa "messages" (config) além de "message" (envelope)', () => {
    const adapter = uazapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'messages',
        instance: 'x',
        data: (messageReceivedFixture as { data: unknown }).data,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message.received');
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = uazapi(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { event: 'presence', data: {} } })).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });

  it('redige o token de mensagens de erro (HttpClient secrets)', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        token: 'super-secret-token',
        fetch: async () => jsonResponse(401, { error: 'bad token super-secret-token' }),
      }),
    );

    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain('super-secret-token');
      expect(failure.message).toContain('***');
    }
  });

  it('envia o header "token" configurado em toda chamada', async () => {
    const calls: Headers[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );

    await adapter.instance.status();
    expect(calls[0]?.get('token')).toBe(TOKEN);
  });
});
