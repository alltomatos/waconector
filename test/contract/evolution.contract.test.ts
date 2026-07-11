import { describe, expect, it } from 'vitest';
import { createConnector } from '../../src';
import { evolution } from '../../src/adapters/evolution';
import ackFixture from '../../src/adapters/evolution/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/evolution/fixtures/webhook-connection-update.json';
import documentMessageFixture from '../../src/adapters/evolution/fixtures/webhook-message-document.json';
import imageMessageFixture from '../../src/adapters/evolution/fixtures/webhook-message-image.json';
import messageReceivedFixture from '../../src/adapters/evolution/fixtures/webhook-message-received.json';
import { describeAdapterContract } from './adapter-contract';

const FAKE_BASE_URL = 'https://evolution.exemplo.test';
const FAKE_INSTANCE_TOKEN = 'instance-token-de-teste-nao-real';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais do Evolution GO (ver docs/providers/evolution.md) — sem rede real, sem credenciais reais.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && url.pathname === '/instance/connect') {
      return jsonResponse(200, {
        message: 'success',
        data: { jid: '', webhookUrl: '', eventString: 'MESSAGE,SEND_MESSAGE,READ_RECEIPT' },
      });
    }
    if (method === 'GET' && url.pathname === '/instance/qr') {
      return jsonResponse(200, {
        message: 'success',
        data: { qrcode: 'data:image/png;base64,ZmFrZS1xcg==', code: '2@AbCdEfGhIjKl' },
      });
    }
    if (method === 'GET' && url.pathname === '/instance/status') {
      return jsonResponse(200, {
        message: 'success',
        data: { Connected: true, LoggedIn: true, Name: 'contrato-evolution' },
      });
    }
    if (method === 'POST' && url.pathname === '/send/text') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          Info: {
            ID: '3EB0FAKE0000000000TEXT',
            ServerID: 1,
            Timestamp: '2026-07-10T12:00:00-03:00',
            Type: 'ExtendedTextMessage',
          },
        },
      });
    }
    if (method === 'POST' && url.pathname === '/send/media') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          Info: {
            ID: '3EB0FAKE0000000000MEDIA',
            ServerID: 2,
            Timestamp: '2026-07-10T12:00:01-03:00',
            Type: 'ImageMessage',
          },
        },
      });
    }
    if (method === 'POST' && url.pathname === '/message/react') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          Info: {
            ID: '3EB0FAKE0000000000REACT',
            ServerID: 3,
            Timestamp: '2026-07-10T12:00:02-03:00',
            Type: 'ReactionMessage',
          },
        },
      });
    }
    if (method === 'DELETE' && url.pathname === '/instance/logout') {
      return jsonResponse(200, { message: 'success' });
    }

    throw new Error(`fetchStub (evolution): rota não configurada ${method} ${url.pathname}`);
  };
}

describeAdapterContract({
  name: 'Evolution GO',
  create() {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      instance: 'contrato-evolution',
      fetch: createFetchStub(),
    });

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

describe('Evolution GO: comportamentos específicos do adapter', () => {
  it('instance.connect encadeia POST /instance/connect + GET /instance/qr e devolve o qr', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });

    const result = await adapter.instance.connect();
    expect(result.qr).toBe('data:image/png;base64,ZmFrZS1xcg==');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia Connected/LoggedIn para o InstanceState canônico', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });

    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });
    const wa = createConnector(adapter);

    const failure = await wa.messages
      .sendMedia({ to: '5511999999999', media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error & { code?: string }).code).toBe('INVALID_INPUT');
  });

  it('sendMedia com media.base64 (sem media.url) envia o base64 no campo "url" (JSON overload confirmado no source do Evolution GO)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/send/media') {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', base64: 'ZmFrZS1pbWFnZW0=' },
    });

    expect(sent.id).toBe('3EB0FAKE0000000000MEDIA');
    expect(capturedBody?.url).toBe('ZmFrZS1pbWFnZW0=');
  });

  it('sendMedia com media.url envia POST /send/media e normaliza SentMessage', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto.jpg' },
      caption: 'legenda',
    });

    expect(sent.id).toBe('3EB0FAKE0000000000MEDIA');
    expect(sent.chatId).toBe('5511999999999');
    expect(sent).toHaveProperty('raw');
  });

  it('sendText com mentions constrói JIDs completos em "mentionedJid" (dígitos crus ganham sufixo; JIDs passam intactos)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/send/text') {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    await wa.messages.sendText({
      to: '5511999999999',
      text: 'Oi @5511988887777 e @5511977776666!',
      mentions: ['5511988887777', '5511977776666@s.whatsapp.net'],
    });

    expect(capturedBody?.mentionedJid).toEqual([
      '5511988887777@s.whatsapp.net',
      '5511977776666@s.whatsapp.net',
    ]);
  });

  it('sendReaction envia POST /message/react com {number, reaction, id, fromMe} e normaliza SentMessage', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/message/react') {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: '3EB0FAKE0000000000TEXT',
      emoji: '👍',
    });

    expect(capturedBody).toEqual({
      number: '5511999999999',
      reaction: '👍',
      id: '3EB0FAKE0000000000TEXT',
      fromMe: false,
    });
    expect(sent.id).toBe('3EB0FAKE0000000000REACT');
    expect(sent.chatId).toBe('5511999999999');
    expect(sent).toHaveProperty('raw');
  });

  it('sendReaction com emoji vazio envia o sentinel "remove" (o provider rejeita reaction:"" com 400)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/message/react') {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: '3EB0FAKE0000000000TEXT',
      emoji: '',
    });

    expect(capturedBody?.reaction).toBe('remove');
  });

  it('parseWebhook normaliza evento "Message" de imagem e popula media.url a partir da chave "URL" (maiúscula)', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: imageMessageFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.kind).toBe('image');
      expect(event.message.media?.url).toBe(
        'https://mmg.whatsapp.net/v/t62.7118-24/10000000_123456789_n.enc',
      );
      expect(event.message.media?.mimeType).toBe('image/jpeg');
      expect(event.message.text).toBe('Olha essa foto');
    }
  });

  it('parseWebhook normaliza evento "Message" de documento e popula media.filename', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: documentMessageFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.kind).toBe('document');
      expect(event.message.media?.url).toBe(
        'https://mmg.whatsapp.net/v/t62.7119-24/10000001_987654321_n.enc',
      );
      expect(event.message.media?.mimeType).toBe('application/pdf');
      expect(event.message.media?.filename).toBe('contrato.pdf');
    }
  });

  it('parseWebhook normaliza evento "Receipt" (ack) para message.ack', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: ackFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('3EB0C05FF2D3A0068B2A2D');
      expect(event.ack).toBe('read');
      expect(event.chatId).toBe('557499879409@s.whatsapp.net');
    }
  });

  it('parseWebhook normaliza evento "Connected" para connection.update', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: connectionUpdateFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook nunca lança em payload propositalmente quebrado', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { event: 'Receipt', data: {} } })).not.toThrow();

    const events = adapter.parseWebhook({ body: null });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });
});
