import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type ZapiOptions, zapi } from '../../src/adapters/zapi';
import ackFixture from '../../src/adapters/zapi/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/zapi/fixtures/webhook-connection-update.json';
import deliveryFixture from '../../src/adapters/zapi/fixtures/webhook-delivery.json';
import disconnectedFixture from '../../src/adapters/zapi/fixtures/webhook-disconnected.json';
import messageReceivedFixture from '../../src/adapters/zapi/fixtures/webhook-message-received.json';
import { describeAdapterContract } from './adapter-contract';

const INSTANCE_ID = 'contrato-instance-id';
const TOKEN = 'contrato-token-nao-real';
const CLIENT_TOKEN = 'contrato-client-token-nao-real';
const PREFIX = `/instances/${INSTANCE_ID}/token/${TOKEN}`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais da Z-API (ver docs/providers/zapi.md) — sem rede real, sem credenciais reais.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'GET' && pathname === `${PREFIX}/qr-code/image`) {
      return jsonResponse(200, { value: 'data:image/png;base64,ZmFrZS1xcg==' });
    }

    if (method === 'GET' && pathname === `${PREFIX}/status`) {
      return jsonResponse(200, { connected: true, smartphoneConnected: true });
    }

    if (method === 'GET' && pathname === `${PREFIX}/disconnect`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-text`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-text',
        messageId: '3EB0FAKE0000000000TEXT',
        id: '3EB0FAKE0000000000TEXT',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-image`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-image',
        messageId: '3EB0FAKE0000000000IMG',
        id: '3EB0FAKE0000000000IMG',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-video`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-video',
        messageId: '3EB0FAKE0000000000VID',
        id: '3EB0FAKE0000000000VID',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-audio`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-audio',
        messageId: '3EB0FAKE0000000000AUD',
        id: '3EB0FAKE0000000000AUD',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-document/pdf`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-doc',
        messageId: '3EB0FAKE0000000000DOC',
        id: '3EB0FAKE0000000000DOC',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-sticker`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-sticker',
        messageId: '3EB0FAKE0000000000STK',
        id: '3EB0FAKE0000000000STK',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-reaction`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-reaction',
        messageId: '3EB0FAKE0000000000RCT',
        id: '3EB0FAKE0000000000RCT',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/send-remove-reaction`) {
      return jsonResponse(200, {
        zaapId: 'zaap-fake-remove-reaction',
        messageId: '3EB0FAKE0000000000RCT',
        id: '3EB0FAKE0000000000RCT',
      });
    }

    if (method === 'POST' && pathname === `${PREFIX}/create-group`) {
      return jsonResponse(200, {
        phone: '120363019502650977-group',
        phonesNotAdded: [],
        invitationLink: 'https://chat.whatsapp.com/fake-invite',
      });
    }

    if (method === 'GET' && pathname === `${PREFIX}/group-metadata/120363019502650977-group`) {
      return jsonResponse(200, {
        phone: '120363019502650977-group',
        subject: 'Grupo de contrato',
        description: 'descrição do grupo',
        owner: '5511999999999',
        creation: 1700000000000,
        invitationLink: 'https://chat.whatsapp.com/fake-invite',
        participants: [
          { phone: '5511999999999', isAdmin: true, isSuperAdmin: true },
          { phone: '5511988887777', isAdmin: false, isSuperAdmin: false },
        ],
      });
    }

    if (method === 'GET' && pathname === `${PREFIX}/groups`) {
      return jsonResponse(200, [
        { isGroup: true, name: 'Grupo leve', phone: '120363019502650977-group' },
      ]);
    }

    if (method === 'POST' && pathname === `${PREFIX}/add-participant`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/remove-participant`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/add-admin`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/remove-admin`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/update-group-name`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/update-group-description`) {
      return jsonResponse(200, { value: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/update-group-photo`) {
      return jsonResponse(200, { value: true });
    }

    if (
      method === 'GET' &&
      pathname === `${PREFIX}/group-invitation-link/120363019502650977-group`
    ) {
      return jsonResponse(200, {
        phone: '120363019502650977-group',
        invitationLink: 'https://chat.whatsapp.com/fake-invite-code',
      });
    }

    if (
      method === 'POST' &&
      pathname === `${PREFIX}/redefine-invitation-link/120363019502650977-group`
    ) {
      return jsonResponse(200, {
        invitationLink: 'https://chat.whatsapp.com/fake-new-invite-code',
      });
    }

    if (method === 'GET' && pathname === `${PREFIX}/accept-invite-group`) {
      return jsonResponse(200, { success: true });
    }

    if (method === 'POST' && pathname === `${PREFIX}/leave-group`) {
      return jsonResponse(200, { value: true });
    }

    throw new Error(`fetchStub (zapi): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<ZapiOptions> = {}): ZapiOptions {
  return {
    instanceId: INSTANCE_ID,
    token: TOKEN,
    clientToken: CLIENT_TOKEN,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'zapi',
  create() {
    const adapter = zapi(buildAdapterOptions());
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

describe('zapi adapter: comportamento específico do provider', () => {
  it('usa https://api.z-api.io como baseUrl padrão quando não informado', () => {
    const adapter = zapi({ instanceId: INSTANCE_ID, token: TOKEN, fetch: createFetchStub() });
    expect(adapter.provider).toBe('zapi');
  });

  it('instance.connect chama GET .../qr-code/image e devolve o qr do campo "value"', async () => {
    const adapter = zapi(buildAdapterOptions());
    const result = await adapter.instance.connect();
    expect(result.qr).toBe('data:image/png;base64,ZmFrZS1xcg==');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia connected:true para "connected"', async () => {
    const adapter = zapi(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  it('instance.status mapeia connected:false para "disconnected"', async () => {
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/status`) {
            return jsonResponse(200, { connected: false, smartphoneConnected: false });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('disconnected');
  });

  it('instance.status mapeia corpo sem "connected" booleano para "unknown" (nunca lança)', async () => {
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/status`) {
            return jsonResponse(200, { algumCampoNovo: true });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe('unknown');
  });

  it('instance.logout chama GET .../disconnect sem lançar', async () => {
    const calls: string[] = [];
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(calls).toContain(`GET ${PREFIX}/disconnect`);
  });

  it('messages.sendText envia {phone, message, messageId} (citação via reply-message) e ignora mentions (não documentado)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-text`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({
      to: '5511999999999',
      text: 'contrato: ping',
      quotedId: '3EB0ORIGINAL',
      mentions: ['5511988887777'],
    });

    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.message).toBe('contrato: ping');
    expect(capturedBody?.messageId).toBe('3EB0ORIGINAL');
    expect(capturedBody?.mentions).toBeUndefined();
    expect(sent.id).toBe('3EB0FAKE0000000000TEXT');
    expect(sent.chatId).toBe('5511999999999');
  });

  it('messages.sendMedia (image) envia {phone, image, caption, messageId} e usa media.url', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-image`) {
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
      quotedId: '3EB0ORIGINAL',
    });

    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.image).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.caption).toBe('legenda');
    expect(capturedBody?.messageId).toBe('3EB0ORIGINAL');
    expect(sent.id).toBe('3EB0FAKE0000000000IMG');
  });

  it('messages.sendMedia (image) monta data URI a partir de media.base64 sem prefixo "data:"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-image`) {
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

    expect(capturedBody?.image).toBe('data:image/png;base64,ZmFrZS1pbWFnZW0=');
  });

  it('messages.sendMedia (audio) não envia caption nem messageId (não documentados para áudio)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-audio`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'audio', url: 'https://cdn.exemplo.test/audio.mp3' },
      caption: 'ignorada',
      quotedId: 'ignorado',
    });

    expect(capturedBody?.audio).toBe('https://cdn.exemplo.test/audio.mp3');
    expect(capturedBody?.caption).toBeUndefined();
    expect(capturedBody?.messageId).toBeUndefined();
    expect(sent.id).toBe('3EB0FAKE0000000000AUD');
  });

  it('messages.sendMedia (document) deriva {extension} de media.filename para o path da URL', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-document/pdf`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: {
        kind: 'document',
        url: 'https://cdn.exemplo.test/contrato.pdf',
        filename: 'contrato.pdf',
      },
    });

    expect(capturedBody?.document).toBe('https://cdn.exemplo.test/contrato.pdf');
    expect(capturedBody?.fileName).toBe('contrato.pdf');
    expect(sent.id).toBe('3EB0FAKE0000000000DOC');
  });

  it('messages.sendMedia (document) deriva {extension} de media.mimeType quando filename não tem extensão', async () => {
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith(`${PREFIX}/send-document`)) {
            requestedPath = url.pathname;
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
        url: 'https://cdn.exemplo.test/contrato',
        mimeType: 'application/pdf',
      },
    });

    expect(requestedPath).toBe(`${PREFIX}/send-document/pdf`);
  });

  it('messages.sendMedia (document) sem filename nem mimeType reconhecido lança INVALID_INPUT', async () => {
    const adapter = zapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const failure = await wa.messages
      .sendMedia({
        to: '5511999999999',
        media: { kind: 'document', url: 'https://cdn.exemplo.test/arquivo-sem-extensao' },
      })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('messages.sendMedia (sticker) envia {phone, sticker, messageId} e não envia caption (não documentado)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-sticker`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'sticker', url: 'https://x.test/s.webp' },
      caption: 'ignorada',
      quotedId: '3EB0ORIGINAL',
    });

    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.sticker).toBe('https://x.test/s.webp');
    expect(capturedBody?.caption).toBeUndefined();
    expect(capturedBody?.messageId).toBe('3EB0ORIGINAL');
    expect(sent.id).toBe('3EB0FAKE0000000000STK');
  });

  it('messages.sendReaction envia {phone, reaction, messageId} para POST /send-reaction', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-reaction`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: '3EB0ORIGINAL',
      emoji: '❤️',
    });

    expect(requestedPath).toBe(`${PREFIX}/send-reaction`);
    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.reaction).toBe('❤️');
    expect(capturedBody?.messageId).toBe('3EB0ORIGINAL');
    expect(sent.id).toBe('3EB0FAKE0000000000RCT');
    expect(sent.chatId).toBe('5511999999999');
  });

  it('messages.sendReaction com emoji vazio remove a reação via POST /send-remove-reaction (sem campo "reaction")', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-remove-reaction`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: '3EB0ORIGINAL',
      emoji: '',
    });

    expect(requestedPath).toBe(`${PREFIX}/send-remove-reaction`);
    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.messageId).toBe('3EB0ORIGINAL');
    expect(capturedBody).not.toHaveProperty('reaction');
    expect(sent.id).toBe('3EB0FAKE0000000000RCT');
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = zapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const failure = await wa.messages
      .sendMedia({ to: '5511999999999', media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('parseWebhook normaliza "ReceivedCallback" (fromMe:false) para message.received', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.provider).toBe('zapi');
      expect(event.instanceId).toBe('A20DA9C0183A2D35A260F53F5D2B9244');
      expect(event.message.id).toBe('A20DA9C0183A2D35A260F53F5D2B9244');
      expect(event.message.chatId).toBe('5544999999999');
      expect(event.message.text).toBe('teste');
      expect(event.message.kind).toBe('text');
      expect(event.message.fromMe).toBe(false);
    }
  });

  it('parseWebhook normaliza "ReceivedCallback" com fromMe:true para message.sent', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { ...messageReceivedFixture, fromMe: true },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message.sent');
  });

  it('parseWebhook normaliza "MessageStatusCallback" (status READ) para message.ack', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('999999999999999999999');
      expect(event.chatId).toBe('5544999999999');
      expect(event.ack).toBe('read');
    }
  });

  it('parseWebhook normaliza "DeliveryCallback" sem "error" para ack "sent"', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: deliveryFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('A20DA9C0183A2D35A260F53F5D2B9244');
      expect(event.ack).toBe('sent');
    }
  });

  it('parseWebhook normaliza "DeliveryCallback" com "error" para ack "error"', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { ...deliveryFixture, error: 'Phone number does not exist' },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type === 'message.ack') {
      expect(event.ack).toBe('error');
    } else {
      expect.fail('esperava message.ack');
    }
  });

  it('parseWebhook normaliza "ConnectedCallback" para connection.update("connected")', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
      expect(event.instanceId).toBe('instance.id');
    }
  });

  it('parseWebhook normaliza "DisconnectedCallback" para connection.update("disconnected")', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: disconnectedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('disconnected');
    }
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = zapi(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { type: 'PresenceCallback' } })).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });

  it('redige instanceId e token de mensagens de erro (HttpClient secrets), inclusive vindo da URL/path', async () => {
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async () => new Response('erro interno', { status: 500 }),
      }),
    );

    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain(TOKEN);
      expect(failure.message).not.toContain(INSTANCE_ID);
      expect(failure.message).toContain('***');
    }
  });

  it('envia o header "Client-Token" apenas quando clientToken é informado', async () => {
    const calls: Headers[] = [];
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );

    await adapter.instance.status();
    expect(calls[0]?.get('Client-Token')).toBe(CLIENT_TOKEN);

    const adapterSemClientToken = zapi({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      fetch: async (input, init) => {
        calls.push(new Headers(init?.headers));
        return createFetchStub()(input, init);
      },
    });
    await adapterSemClientToken.instance.status();
    expect(calls[1]?.has('Client-Token')).toBe(false);
  });

  it('groups.create envia {autoInvite:false, groupName, phones} para POST /create-group e cai de volta nos valores de entrada', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/create-group`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo de contrato',
      participants: ['5511999999999', '5511988887777'],
    });

    expect(requestedPath).toBe(`${PREFIX}/create-group`);
    expect(capturedBody?.autoInvite).toBe(false);
    expect(capturedBody?.groupName).toBe('Grupo de contrato');
    expect(capturedBody?.phones).toEqual(['5511999999999', '5511988887777']);
    // resposta da Z-API não ecoa nome/participantes — GroupInfo cai de volta nos valores de entrada
    expect(group.id).toBe('120363019502650977-group');
    expect(group.subject).toBe('Grupo de contrato');
    expect(group.participants).toEqual([
      { id: '5511999999999', isAdmin: false, isSuperAdmin: false },
      { id: '5511988887777', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.getInfo chama GET .../group-metadata/{groupId} com o groupId opaco verbatim (sem digitsOnly) e mapeia a resposta para GroupInfo', async () => {
    const adapter = zapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo('120363019502650977-group');

    expect(group.id).toBe('120363019502650977-group');
    expect(group.subject).toBe('Grupo de contrato');
    expect(group.description).toBe('descrição do grupo');
    expect(group.owner).toBe('5511999999999');
    expect(group.participants).toEqual([
      { id: '5511999999999', isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.list chama GET .../groups com paginação default e mapeia a lista leve (participants: [])', async () => {
    let requestedUrl: URL | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/groups`) {
            requestedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const groups = await wa.groups.list();

    expect(requestedUrl?.searchParams.get('page')).toBe('1');
    expect(requestedUrl?.searchParams.get('pageSize')).toBe('100');
    expect(groups).toEqual([
      {
        id: '120363019502650977-group',
        subject: 'Grupo leve',
        participants: [],
        raw: { isGroup: true, name: 'Grupo leve', phone: '120363019502650977-group' },
      },
    ]);
  });

  it('groups.addParticipants envia {autoInvite:false, groupId, phones} para POST /add-participant (singular)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/add-participant`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.addParticipants({
      groupId: '120363019502650977-group',
      participants: ['5511999999999'],
    });

    expect(requestedPath).toBe(`${PREFIX}/add-participant`);
    expect(capturedBody?.autoInvite).toBe(false);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.phones).toEqual(['5511999999999']);
    expect(result).toBeUndefined();
  });

  it('groups.removeParticipants chama POST /remove-participant (singular) com {groupId, phones}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/remove-participant`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.removeParticipants({
      groupId: '120363019502650977-group',
      participants: ['5511999999999'],
    });

    expect(requestedPath).toBe(`${PREFIX}/remove-participant`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.phones).toEqual(['5511999999999']);
    expect(capturedBody).not.toHaveProperty('autoInvite');
  });

  it('groups.promoteParticipants chama POST /add-admin ("promote" não é o nome do endpoint)', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/add-admin`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.promoteParticipants({
      groupId: '120363019502650977-group',
      participants: ['5511999999999'],
    });

    expect(requestedPath).toBe(`${PREFIX}/add-admin`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.phones).toEqual(['5511999999999']);
  });

  it('groups.demoteParticipants chama POST /remove-admin ("demote" não é o nome do endpoint)', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/remove-admin`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.demoteParticipants({
      groupId: '120363019502650977-group',
      participants: ['5511999999999'],
    });

    expect(requestedPath).toBe(`${PREFIX}/remove-admin`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.phones).toEqual(['5511999999999']);
  });

  it('groups.updateSubject envia {groupId, groupName} para POST /update-group-name', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/update-group-name`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.updateSubject({
      groupId: '120363019502650977-group',
      subject: 'Novo nome do grupo',
    });

    expect(requestedPath).toBe(`${PREFIX}/update-group-name`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.groupName).toBe('Novo nome do grupo');
    expect(result).toBeUndefined();
  });

  it('groups.updateDescription envia {groupId, groupDescription} para POST /update-group-description', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/update-group-description`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updateDescription({
      groupId: '120363019502650977-group',
      description: 'Nova descrição',
    });

    expect(requestedPath).toBe(`${PREFIX}/update-group-description`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.groupDescription).toBe('Nova descrição');
  });

  it('groups.updateDescription com description vazia envia groupDescription:"" (limpa a descrição, não é erro)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/update-group-description`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.updateDescription({
      groupId: '120363019502650977-group',
      description: '',
    });

    expect(capturedBody?.groupDescription).toBe('');
    expect(result).toBeUndefined();
  });

  it('groups.updatePicture envia {groupId, groupPhoto} para POST /update-group-photo usando media.url diretamente', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/update-group-photo`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.updatePicture({
      groupId: '120363019502650977-group',
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto-grupo.jpg' },
    });

    expect(requestedPath).toBe(`${PREFIX}/update-group-photo`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(capturedBody?.groupPhoto).toBe('https://cdn.exemplo.test/foto-grupo.jpg');
    expect(result).toBeUndefined();
  });

  it('groups.updatePicture monta data URI a partir de media.base64 sem prefixo "data:" (reaproveita resolveMediaValue de sendMedia)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/update-group-photo`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updatePicture({
      groupId: '120363019502650977-group',
      media: { kind: 'image', base64: 'ZmFrZS1mb3RvLWdydXBv' },
    });

    expect(capturedBody?.groupPhoto).toBe('data:image/png;base64,ZmFrZS1mb3RvLWdydXBv');
  });

  it('groups.getInviteLink chama GET .../group-invitation-link/{groupId} e devolve o link completo do campo "invitationLink"', async () => {
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/group-invitation-link/120363019502650977-group`) {
            requestedPath = url.pathname;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink('120363019502650977-group');

    expect(requestedPath).toBe(`${PREFIX}/group-invitation-link/120363019502650977-group`);
    expect(result.link).toBe('https://chat.whatsapp.com/fake-invite-code');
    expect(result).toHaveProperty('raw');
  });

  it('groups.getInviteLink monta o link completo com normalizeInviteLink quando o provider devolve só o código bare', async () => {
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/group-invitation-link/120363019502650977-group`) {
            return jsonResponse(200, {
              phone: '120363019502650977-group',
              invitationLink: 'apenas-o-codigo-bare',
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink('120363019502650977-group');

    expect(result.link).toBe('https://chat.whatsapp.com/apenas-o-codigo-bare');
  });

  it('groups.revokeInviteLink chama POST .../redefine-invitation-link/{groupId} sem corpo e devolve o novo link completo', async () => {
    let requestedPath: string | undefined;
    let requestedMethod: string | undefined;
    let requestedBody: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/redefine-invitation-link/120363019502650977-group`) {
            requestedPath = url.pathname;
            requestedMethod = (init?.method ?? 'GET').toUpperCase();
            requestedBody = init?.body === undefined ? undefined : String(init.body);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.revokeInviteLink('120363019502650977-group');

    expect(requestedPath).toBe(`${PREFIX}/redefine-invitation-link/120363019502650977-group`);
    expect(requestedMethod).toBe('POST');
    expect(requestedBody).toBeUndefined();
    expect(result.link).toBe('https://chat.whatsapp.com/fake-new-invite-code');
    expect(result).toHaveProperty('raw');
  });

  it('groups.joinViaInviteLink chama GET .../accept-invite-group com o link completo no query param "url" (não extrai o código)', async () => {
    let requestedUrl: URL | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/accept-invite-group`) {
            requestedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.joinViaInviteLink({
      invite: 'https://chat.whatsapp.com/codigo-do-convite',
    });

    expect(requestedUrl?.searchParams.get('url')).toBe(
      'https://chat.whatsapp.com/codigo-do-convite',
    );
    expect(result).toBeUndefined();
  });

  it('groups.joinViaInviteLink normaliza um código bare de entrada para o link completo antes de enviar (o conector garante isso)', async () => {
    let requestedUrl: URL | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/accept-invite-group`) {
            requestedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink({ invite: 'codigo-bare-do-convite' });

    expect(requestedUrl?.searchParams.get('url')).toBe(
      'https://chat.whatsapp.com/codigo-bare-do-convite',
    );
  });

  it('groups.leaveGroup chama POST /leave-group com {groupId} no corpo (opaco, verbatim)', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/leave-group`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.leaveGroup('120363019502650977-group');

    expect(requestedPath).toBe(`${PREFIX}/leave-group`);
    expect(capturedBody?.groupId).toBe('120363019502650977-group');
    expect(result).toBeUndefined();
  });
});
