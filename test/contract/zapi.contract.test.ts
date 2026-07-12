import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type ZapiOptions, zapi } from '../../src/adapters/zapi';
import ackFixture from '../../src/adapters/zapi/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/zapi/fixtures/webhook-connection-update.json';
import deliveryFixture from '../../src/adapters/zapi/fixtures/webhook-delivery.json';
import disconnectedFixture from '../../src/adapters/zapi/fixtures/webhook-disconnected.json';
import groupParticipantAddFixture from '../../src/adapters/zapi/fixtures/webhook-group-participant-add.json';
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

    if (method === 'GET' && pathname === `${PREFIX}/contacts`) {
      return jsonResponse(200, [
        {
          name: 'Fulano',
          notify: 'Notify Fulano',
          short: 'Curto Fulano',
          vname: 'Biz Fulano',
          phone: '5511999999999',
        },
        { notify: 'Só Notify', short: 'Só Curto', phone: '5511988887777' },
      ]);
    }

    if (method === 'GET' && pathname === `${PREFIX}/contacts/5511999999999`) {
      return jsonResponse(200, {
        name: 'Fulano da Silva',
        phone: '5511999999999',
        notify: 'Fulano',
        short: 'Fulano',
        imgUrl: 'https://pic.exemplo.test/foto.jpg',
        about: 'Ocupado no momento',
      });
    }

    if (method === 'GET' && pathname === `${PREFIX}/contacts/5511988887777`) {
      return jsonResponse(200, {
        phone: '5511988887777',
        notify: 'Só Notify (sem name)',
      });
    }

    if (method === 'GET' && pathname === `${PREFIX}/phone-exists/5511999999999`) {
      return jsonResponse(200, [{ exists: true, phone: '5511999999999', lid: null }]);
    }

    if (method === 'GET' && pathname === `${PREFIX}/phone-exists/5511977776666`) {
      return jsonResponse(200, [{ exists: false, phone: null, lid: null }]);
    }

    if (method === 'GET' && pathname === `${PREFIX}/phone-exists/5511966665555`) {
      return jsonResponse(200, [{ exists: true, phone: '5511966665555', lid: '123456789@lid' }]);
    }

    if (method === 'GET' && pathname === `${PREFIX}/profile-picture`) {
      return jsonResponse(200, { link: 'https://pic.exemplo.test/link-perfil.jpg' });
    }

    if (method === 'POST' && pathname === `${PREFIX}/contacts/modify-blocked`) {
      return jsonResponse(200, { value: true });
    }

    // messages.edit (retrofit ADR-0012) reaproveita o MESMO endpoint/stub de sendText acima
    // (`POST /send-text`, com `editMessageId` extra no corpo) — sem rota nova aqui.

    // messages.delete (retrofit ADR-0012): único DELETE da API, params em query string, 204 vazio.
    if (method === 'DELETE' && pathname === `${PREFIX}/messages`) {
      return new Response(null, { status: 204 });
    }

    // chats.* (retrofit ADR-0012): as 8 ações dividem o mesmo endpoint POST /modify-chat.
    if (method === 'POST' && pathname === `${PREFIX}/modify-chat`) {
      return jsonResponse(200, { value: true });
    }

    // messages.forward (ADR-0013): POST /forward-message. Resposta: só {zaapId}, sem messageId/id.
    if (method === 'POST' && pathname === `${PREFIX}/forward-message`) {
      return jsonResponse(200, { zaapId: 'MOCKFORWARDZAAP001' });
    }

    // messages.pin/unpin (ADR-0013): POST /pin-message.
    if (method === 'POST' && pathname === `${PREFIX}/pin-message`) {
      return jsonResponse(200, {
        zaapId: 'MOCKPINZAAP001',
        messageId: 'MOCKPIN001',
        id: 'MOCKPIN001',
      });
    }

    // messages.markRead (ADR-0013, nível de MENSAGEM): POST /read-message, 204 vazio — distinto
    // de chats.markRead (nível de conversa, /modify-chat, ADR-0012).
    if (method === 'POST' && pathname === `${PREFIX}/read-message`) {
      return new Response(null, { status: 204 });
    }

    // messages.sendLocation (ADR-0014): POST /send-location.
    if (method === 'POST' && pathname === `${PREFIX}/send-location`) {
      return jsonResponse(200, {
        zaapId: 'MOCKLOCATIONZAAP001',
        messageId: 'MOCKLOCATION001',
        id: 'MOCKLOCATION001',
      });
    }

    // messages.sendContactCard (ADR-0014): POST /send-contact.
    if (method === 'POST' && pathname === `${PREFIX}/send-contact`) {
      return jsonResponse(200, {
        zaapId: 'MOCKCONTACTZAAP001',
        messageId: 'MOCKCONTACT001',
        id: 'MOCKCONTACT001',
      });
    }

    // messages.sendPoll (ADR-0014): POST /send-poll.
    if (method === 'POST' && pathname === `${PREFIX}/send-poll`) {
      return jsonResponse(200, {
        zaapId: 'MOCKPOLLZAAP001',
        messageId: 'MOCKPOLL001',
        id: 'MOCKPOLL001',
      });
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

  it('parseWebhook normaliza notificação "GROUP_PARTICIPANT_ADD" (dentro de "ReceivedCallback") para group.update', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupParticipantAddFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.provider).toBe('zapi');
      expect(event.instanceId).toBe('A20DA9C0183A2D35A260F53F5D2B9244');
      expect(event.groupId).toBe('5544999999999-group');
      expect(event.action).toBe('participants.add');
      expect(event.participants).toEqual(['5511999999999', '5511988887777']);
    }
  });

  it('parseWebhook normaliza notificação "GROUP_PARTICIPANT_REMOVE" para group.update com action "participants.remove"', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        ...groupParticipantAddFixture,
        notification: 'GROUP_PARTICIPANT_REMOVE',
        notificationParameters: ['5511999999999'],
      },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.action).toBe('participants.remove');
      expect(event.participants).toEqual(['5511999999999']);
    }
  });

  it('parseWebhook normaliza notificação "GROUP_PARTICIPANT_LEAVE" para group.update com a MESMA action de REMOVE ("participants.remove")', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        ...groupParticipantAddFixture,
        notification: 'GROUP_PARTICIPANT_LEAVE',
        notificationParameters: ['5511999999999'],
      },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.action).toBe('participants.remove');
    }
  });

  it('parseWebhook normaliza notificação "GROUP_PARTICIPANT_PROMOTE" para group.update com action "participants.promote"', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { ...groupParticipantAddFixture, notification: 'GROUP_PARTICIPANT_PROMOTE' },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type === 'group.update') {
      expect(event.action).toBe('participants.promote');
      expect(event.participants).toEqual(['5511999999999', '5511988887777']);
    } else {
      expect.fail('esperava group.update');
    }
  });

  it('parseWebhook normaliza notificação "GROUP_PARTICIPANT_DEMOTE" para group.update com action "participants.demote"', () => {
    const adapter = zapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { ...groupParticipantAddFixture, notification: 'GROUP_PARTICIPANT_DEMOTE' },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type === 'group.update') {
      expect(event.action).toBe('participants.demote');
      expect(event.participants).toEqual(['5511999999999', '5511988887777']);
    } else {
      expect.fail('esperava group.update');
    }
  });

  it('parseWebhook NÃO reconhece notificações sem exemplo de payload confirmado (GROUP_CREATE, GROUP_CHANGE_SUBJECT, GROUP_CHANGE_DESCRIPTION, GROUP_CHANGE_ICON, GROUP_PARTICIPANT_INVITE) como group.update — seguem para o dispatch de mensagem comum', () => {
    const adapter = zapi(buildAdapterOptions());
    const naoImplementados = [
      'GROUP_CREATE',
      'GROUP_CHANGE_SUBJECT',
      'GROUP_CHANGE_DESCRIPTION',
      'GROUP_CHANGE_ICON',
      'GROUP_PARTICIPANT_INVITE',
    ];

    for (const notification of naoImplementados) {
      const events = adapter.parseWebhook({
        body: { ...groupParticipantAddFixture, notification },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.type).not.toBe('group.update');
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

  it('contacts.list chama GET .../contacts com paginação default e mapeia name com fallback notify/short (sem about/profilePictureUrl/hasWhatsApp)', async () => {
    let requestedUrl: URL | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/contacts`) {
            requestedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contacts = await wa.contacts.list();

    expect(requestedUrl?.searchParams.get('page')).toBe('1');
    expect(requestedUrl?.searchParams.get('pageSize')).toBe('100');
    expect(contacts).toHaveLength(2);
    expect(contacts[0]?.id).toBe('5511999999999');
    expect(contacts[0]?.name).toBe('Fulano');
    expect(contacts[0]?.about).toBeUndefined();
    expect(contacts[0]?.profilePictureUrl).toBeUndefined();
    expect(contacts[0]?.hasWhatsApp).toBeUndefined();
    // segundo item não tem "name" -> cai no fallback "notify"
    expect(contacts[1]?.id).toBe('5511988887777');
    expect(contacts[1]?.name).toBe('Só Notify');
    expect(contacts[0]).toHaveProperty('raw');
  });

  it('contacts.get chama GET .../contacts/{phone} e mapeia name/imgUrl/about (sem hasWhatsApp explícito)', async () => {
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/contacts/5511999999999`) {
            requestedPath = url.pathname;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5511999999999');

    expect(requestedPath).toBe(`${PREFIX}/contacts/5511999999999`);
    expect(contact.id).toBe('5511999999999');
    expect(contact.name).toBe('Fulano da Silva');
    expect(contact.about).toBe('Ocupado no momento');
    expect(contact.profilePictureUrl).toBe('https://pic.exemplo.test/foto.jpg');
    expect(contact.hasWhatsApp).toBeUndefined();
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.get cai no fallback "notify" quando a resposta não traz "name"', async () => {
    const adapter = zapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5511988887777');

    expect(contact.name).toBe('Só Notify (sem name)');
  });

  it('contacts.checkExists chama GET .../phone-exists/{phone} (path, apesar do rótulo "Query Parameters" da doc) e mapeia exists/chatId a partir de "phone"', async () => {
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/phone-exists/5511999999999`) {
            requestedPath = url.pathname;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511999999999');

    expect(requestedPath).toBe(`${PREFIX}/phone-exists/5511999999999`);
    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('5511999999999');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.checkExists mapeia exists:false sem "phone"/"lid" para chatId undefined (nunca lança)', async () => {
    const adapter = zapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511977776666');

    expect(result.exists).toBe(false);
    expect(result.chatId).toBeUndefined();
  });

  it('contacts.checkExists prefere "lid" sobre "phone" para chatId quando o contato tem privacidade ativada', async () => {
    const adapter = zapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511966665555');

    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('123456789@lid');
  });

  it('contacts.getProfilePicture chama GET .../profile-picture com "phone" em query e mapeia "link" -> url', async () => {
    let requestedUrl: URL | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/profile-picture`) {
            requestedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(requestedUrl?.searchParams.get('phone')).toBe('5511999999999');
    expect(picture.url).toBe('https://pic.exemplo.test/link-perfil.jpg');
    expect(picture).toHaveProperty('raw');
  });

  it('contacts.getAbout reaproveita o MESMO endpoint de contacts.get (GET /contacts/{phone}) e mapeia o campo "about" já embutido, com uma única chamada HTTP', async () => {
    const calls: string[] = [];
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/contacts/5511999999999`) {
            calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout('5511999999999');

    expect(about.about).toBe('Ocupado no momento');
    expect(about).toHaveProperty('raw');
    // uma única chamada HTTP para esta operação (ADR-0010: nunca compor múltiplas chamadas)
    expect(calls).toHaveLength(1);
  });

  it('contacts.block chama POST .../contacts/modify-blocked com {phone, action:"block"}', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/contacts/modify-blocked`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.block('5511999999999');

    expect(requestedPath).toBe(`${PREFIX}/contacts/modify-blocked`);
    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.action).toBe('block');
    expect(result).toBeUndefined();
  });

  it('contacts.unblock chama o MESMO endpoint .../contacts/modify-blocked com {phone, action:"unblock"}', async () => {
    let requestedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/contacts/modify-blocked`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.unblock('5511999999999');

    expect(requestedPath).toBe(`${PREFIX}/contacts/modify-blocked`);
    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.action).toBe('unblock');
    expect(result).toBeUndefined();
  });

  it('messages.edit reaproveita POST /send-text com {phone, message, editMessageId} e mapeia a resposta como SentMessage', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-text`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const edited = await wa.messages.edit({
      to: '5511999999999',
      messageId: '3EB0ORIGINAL',
      text: 'texto editado',
    });

    expect(requestedPath).toBe(`${PREFIX}/send-text`);
    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.message).toBe('texto editado');
    expect(capturedBody?.editMessageId).toBe('3EB0ORIGINAL');
    expect(edited.id).toBe('3EB0FAKE0000000000TEXT');
    expect(edited.chatId).toBe('5511999999999');
  });

  it('messages.delete chama DELETE .../messages com {messageId, phone, owner:true} em query string (sem corpo)', async () => {
    let requestedUrl: URL | undefined;
    let requestedMethod: string | undefined;
    let requestedBody: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/messages`) {
            requestedUrl = url;
            requestedMethod = (init?.method ?? 'GET').toUpperCase();
            requestedBody = init?.body === undefined ? undefined : String(init.body);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.messages.delete({
      to: '5511999999999',
      messageId: '3EB0ORIGINAL',
    });

    expect(requestedMethod).toBe('DELETE');
    expect(requestedUrl?.searchParams.get('messageId')).toBe('3EB0ORIGINAL');
    expect(requestedUrl?.searchParams.get('phone')).toBe('5511999999999');
    expect(requestedUrl?.searchParams.get('owner')).toBe('true');
    expect(requestedBody).toBeUndefined();
    expect(result).toBeUndefined();
  });

  it('messages.forward chama POST /forward-message com {phone, messageId, messagePhone}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/forward-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const forwarded = await wa.messages.forward({
      to: '5511999999999',
      messageId: '3EB0ORIGINAL',
      fromChatId: '5511988887777',
    });

    expect(capturedBody).toEqual({
      phone: '5511999999999',
      messageId: '3EB0ORIGINAL',
      messagePhone: '5511988887777',
    });
    expect(forwarded.chatId).toBe('5511999999999');
  });

  it('messages.forward usa "to" como messagePhone quando fromChatId está ausente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/forward-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.forward({ to: '5511999999999', messageId: '3EB0ORIGINAL' });

    expect(capturedBody).toEqual({
      phone: '5511999999999',
      messageId: '3EB0ORIGINAL',
      messagePhone: '5511999999999',
    });
  });

  it('messages.pin/unpin chamam POST /pin-message com {phone, messageId, messageAction, pinMessageDuration:"24_hours"}', async () => {
    const hits: unknown[] = [];
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/pin-message`) {
            hits.push(JSON.parse(String(init?.body)));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.pin({ to: '5511999999999', messageId: '3EB0ORIGINAL' }),
    ).resolves.toBeUndefined();
    await expect(
      wa.messages.unpin({ to: '5511999999999', messageId: '3EB0ORIGINAL' }),
    ).resolves.toBeUndefined();

    expect(hits).toEqual([
      {
        phone: '5511999999999',
        messageId: '3EB0ORIGINAL',
        messageAction: 'pin',
        pinMessageDuration: '24_hours',
      },
      {
        phone: '5511999999999',
        messageId: '3EB0ORIGINAL',
        messageAction: 'unpin',
        pinMessageDuration: '24_hours',
      },
    ]);
  });

  it('messages.markRead chama POST /read-message com {phone, messageId} e resolve void', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/read-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.markRead({ to: '5511999999999', messageId: '3EB0ORIGINAL' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ phone: '5511999999999', messageId: '3EB0ORIGINAL' });
  });

  it('messages.sendLocation envia {phone, title, address, latitude, longitude} para POST /send-location', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-location`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendLocation({
      to: '5511999999999',
      latitude: -3.7,
      longitude: -38.5,
      name: 'Escritório',
      address: 'Av. Principal, 100',
    });

    expect(sent.chatId).toBe('5511999999999');
    expect(capturedBody).toEqual({
      phone: '5511999999999',
      latitude: -3.7,
      longitude: -38.5,
      title: 'Escritório',
      address: 'Av. Principal, 100',
    });
  });

  it('messages.sendContactCard envia {phone, contactName, contactPhone} (sem vCard) para POST /send-contact', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-contact`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendContactCard({
      to: '5511999999999',
      contactName: 'Fulano',
      contactPhone: '5511988888888',
    });

    expect(sent.chatId).toBe('5511999999999');
    expect(capturedBody).toEqual({
      phone: '5511999999999',
      contactName: 'Fulano',
      contactPhone: '5511988888888',
    });
  });

  it('messages.sendPoll envia {phone, message, poll: [{name}], pollMaxOptions} para POST /send-poll', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/send-poll`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const sent = await wa.messages.sendPoll({
      to: '5511999999999',
      question: 'Qual sua cor favorita?',
      options: ['Azul', 'Verde'],
      allowMultipleAnswers: true,
    });

    expect(sent.chatId).toBe('5511999999999');
    expect(capturedBody).toEqual({
      phone: '5511999999999',
      message: 'Qual sua cor favorita?',
      poll: [{ name: 'Azul' }, { name: 'Verde' }],
      pollMaxOptions: 2,
    });
  });

  it.each([
    ['archive', 'archive'],
    ['unarchive', 'unarchive'],
    ['mute', 'mute'],
    ['unmute', 'unmute'],
    ['pin', 'pin'],
    ['unpin', 'unpin'],
    ['markRead', 'read'],
    ['markUnread', 'unread'],
  ] as const)('chats.%s chama POST /modify-chat com {phone, action:"%s"}', async (method, action) => {
    let capturedBody: Record<string, unknown> | undefined;
    let requestedPath: string | undefined;
    const adapter = zapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${PREFIX}/modify-chat`) {
            requestedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.chats[method]('5511999999999');

    expect(requestedPath).toBe(`${PREFIX}/modify-chat`);
    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.action).toBe(action);
    expect(result).toBeUndefined();
  });

  it('não declara "contacts.listBlocked" (Z-API não expõe endpoint de listagem de bloqueados) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = zapi(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('contacts.listBlocked');
    expect(adapter.contacts.listBlocked).toBeUndefined();

    const wa = createConnector(adapter);
    const failure = await wa.contacts.listBlocked().catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
    }
  });
});
