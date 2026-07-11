import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type WuzapiOptions, wuzapi } from '../../src/adapters/wuzapi';
import ackFixture from '../../src/adapters/wuzapi/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/wuzapi/fixtures/webhook-connection-update.json';
import messageReceivedFixture from '../../src/adapters/wuzapi/fixtures/webhook-message-received.json';
import qrFixture from '../../src/adapters/wuzapi/fixtures/webhook-qr.json';
import { describeAdapterContract } from './adapter-contract';

const BASE_URL = 'https://contrato.wuzapi.test';
const TOKEN = 'user-token-de-teste-nao-real';
const ADMIN_TOKEN = 'admin-token-de-teste-nao-real';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais do Wuzapi (envelope `{code, success, data}` — ver docs/providers/wuzapi.md) — sem rede
 * real, sem credenciais reais.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'POST' && pathname === '/session/connect') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Connected' },
      });
    }

    if (method === 'GET' && pathname === '/session/qr') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { QRCode: 'data:image/png;base64,ZmFrZS1xcg==' },
      });
    }

    if (method === 'GET' && pathname === '/session/status') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          id: 'contrato-wuzapi',
          name: 'contrato-wuzapi',
          connected: true,
          loggedIn: true,
          jid: '5511999999999.0:0@s.whatsapp.net',
        },
      });
    }

    if (method === 'POST' && pathname === '/session/logout') {
      return jsonResponse(200, { code: 200, success: true, data: { Details: 'Logged out' } });
    }

    if (method === 'POST' && pathname === '/chat/send/text') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Sent', Timestamp: 1751000000, Id: '3EB0FAKE0000000000TEXT' },
      });
    }

    if (
      method === 'POST' &&
      (pathname === '/chat/send/image' ||
        pathname === '/chat/send/video' ||
        pathname === '/chat/send/audio' ||
        pathname === '/chat/send/document' ||
        pathname === '/chat/send/sticker')
    ) {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Sent', Timestamp: 1751000001, Id: '3EB0FAKE0000000000MEDIA' },
      });
    }

    if (method === 'POST' && pathname === '/chat/react') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Sent', Timestamp: 1751000002, Id: 'contrato-msg-1' },
      });
    }

    throw new Error(`fetchStub (wuzapi): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<WuzapiOptions> = {}): WuzapiOptions {
  return {
    baseUrl: BASE_URL,
    token: TOKEN,
    adminToken: ADMIN_TOKEN,
    instance: 'contrato-wuzapi',
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'wuzapi',
  create() {
    const adapter = wuzapi(buildAdapterOptions());
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

describe('wuzapi adapter: comportamento específico do provider', () => {
  it('instance.connect chama POST /session/connect e busca o QR em GET /session/qr', async () => {
    const calls: string[] = [];
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.connect();
    expect(calls).toContain('POST /session/connect');
    expect(calls).toContain('GET /session/qr');
    expect(result.qr).toBe('data:image/png;base64,ZmFrZS1xcg==');
    expect(result).toHaveProperty('raw');
  });

  it('instance.connect envia Immediate:true por padrão e Subscribe quando configurado', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        subscribe: ['Message', 'ReadReceipt'],
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/connect') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    await adapter.instance.connect();
    expect(capturedBody?.Immediate).toBe(true);
    expect(capturedBody?.Subscribe).toEqual(['Message', 'ReadReceipt']);
  });

  it('instance.connect não lança quando GET /session/qr falha (best-effort)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/qr') {
            return jsonResponse(400, { code: 400, success: false, error: 'already logged in' });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.connect();
    expect(result.qr).toBeUndefined();
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia connected+loggedIn para "connected"', async () => {
    const adapter = wuzapi(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  it('instance.status mapeia connected sem loggedIn para "qr"', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/status') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: { connected: true, loggedIn: false },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('qr');
  });

  it('instance.status mapeia !connected && !loggedIn para "disconnected"', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/status') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: { connected: false, loggedIn: false },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('disconnected');
  });

  it('instance.status mapeia !connected && loggedIn para "connecting"', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/status') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: { connected: false, loggedIn: true },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('connecting');
  });

  it('instance.status aceita fallback capitalizado Connected/LoggedIn (divergência documentada)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/status') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: { Connected: true, LoggedIn: true },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
  });

  it('instance.status mapeia valor ausente/inesperado para "unknown" (nunca lança)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/session/status') {
            return jsonResponse(200, { code: 200, success: true, data: {} });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('unknown');
  });

  it('instance.logout chama POST /session/logout (hard) sem lançar', async () => {
    const calls: string[] = [];
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(calls).toContain('POST /session/logout');
  });

  it('messages.sendText envia Phone/Body e mapeia Id/Timestamp (segundos -> ms)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/text') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({ to: '5511999999999', text: 'contrato: ping' });

    expect(capturedBody?.Phone).toBe('5511999999999');
    expect(capturedBody?.Body).toBe('contrato: ping');
    expect(sent.id).toBe('3EB0FAKE0000000000TEXT');
    expect(sent.chatId).toBe('5511999999999');
    expect(sent.timestamp).toBe(1751000000 * 1000);
  });

  it('messages.sendText inclui ContextInfo (StanzaID+Participant) quando quotedId é informado', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/text') {
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

    expect(capturedBody?.ContextInfo).toEqual({
      StanzaID: '3EB0ORIGINAL',
      Participant: '5511999999999',
    });
  });

  it('messages.sendMedia envia Image/Caption/MimeType a partir de media.url', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/image') {
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

    expect(capturedBody?.Phone).toBe('5511999999999');
    expect(capturedBody?.Image).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.Caption).toBe('legenda');
    expect(capturedBody?.MimeType).toBe('image/jpeg');
    expect(sent.id).toBe('3EB0FAKE0000000000MEDIA');
  });

  it('messages.sendMedia monta data URI a partir de media.base64 cru (sem prefixo "data:")', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/image') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', base64: 'ZmFrZS1pbWFnZW0=', mimeType: 'image/png' },
    });

    expect(capturedBody?.Image).toBe('data:image/png;base64,ZmFrZS1pbWFnZW0=');
  });

  it('messages.sendMedia repassa data URI intacta quando media.base64 já tem o prefixo', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/image') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', base64: 'data:image/png;base64,ZmFrZQ==' },
    });

    expect(capturedBody?.Image).toBe('data:image/png;base64,ZmFrZQ==');
  });

  it('messages.sendMedia exige "media.filename" para "document" (FileName obrigatório)', async () => {
    const adapter = wuzapi(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.messages
      .sendMedia({
        to: '5511999999999',
        media: { kind: 'document', url: 'https://cdn.exemplo.test/contrato.pdf' },
      })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('messages.sendMedia envia FileName quando kind é "document" e filename está presente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/document') {
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

    expect(capturedBody?.Document).toBe('https://cdn.exemplo.test/contrato.pdf');
    expect(capturedBody?.FileName).toBe('contrato.pdf');
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = wuzapi(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.messages
      .sendMedia({ to: '5511999999999', media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('messages.sendReaction envia Phone/Body/Id em POST /chat/react', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/react') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: 'contrato-msg-1',
      emoji: '👍',
    });

    expect(capturedBody?.Phone).toBe('5511999999999');
    expect(capturedBody?.Body).toBe('👍');
    expect(capturedBody?.Id).toBe('contrato-msg-1');
    expect(sent.id).toBe('contrato-msg-1');
    expect(sent.chatId).toBe('5511999999999');
    expect(sent.timestamp).toBe(1751000002 * 1000);
  });

  it('messages.sendReaction traduz emoji vazio para o literal "remove" (Wuzapi rejeita Body vazio)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/react') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: 'contrato-msg-1',
      emoji: '',
    });

    expect(capturedBody?.Body).toBe('remove');
  });

  it('parseWebhook normaliza evento "Message" (modo json) para message.received', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.provider).toBe('wuzapi');
      expect(event.instanceId).toBe('minha-sessao');
      expect(event.message.id).toBe('3EB0FAKE00000000WUZ01');
      expect(event.message.chatId).toBe('5511999999999@s.whatsapp.net');
      expect(event.message.text).toBe('Ola, tudo bem?');
      expect(event.message.kind).toBe('text');
      expect(event.message.fromMe).toBe(false);
    }
  });

  it('parseWebhook aceita o modo "form" (jsonData como string) com o mesmo resultado do modo "json"', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        jsonData: JSON.stringify(messageReceivedFixture),
        userID: '1',
        instanceName: 'minha-sessao',
      },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.text).toBe('Ola, tudo bem?');
    }
  });

  it('parseWebhook normaliza evento "ReadReceipt" para message.ack', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('3EB0FAKE00000000WUZ01');
      expect(event.chatId).toBe('5511999999999@s.whatsapp.net');
      expect(event.ack).toBe('read');
    }
  });

  it('parseWebhook normaliza evento "Connected" para connection.update', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
      expect(event.instanceId).toBe('minha-sessao');
    }
  });

  it('parseWebhook normaliza "QR" com qr = qrCodeBase64 do NÍVEL RAIZ (evento real: "event" é a string "code", não um objeto)', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: qrFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('qr');
      expect(event.qr).toBe('data:image/png;base64,QQ==');
      expect(event.instanceId).toBe('minha-sessao');
    }
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = wuzapi(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { type: 'CallOffer', event: {} } })).not.toThrow();
    expect(() =>
      adapter.parseWebhook({ body: { jsonData: 'não-é-json', userID: '1' } }),
    ).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });

  it('redige o token de mensagens de erro (HttpClient secrets)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        token: 'super-secret-token',
        fetch: async () =>
          jsonResponse(401, { code: 401, success: false, error: 'bad token super-secret-token' }),
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
    const adapter = wuzapi(
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
