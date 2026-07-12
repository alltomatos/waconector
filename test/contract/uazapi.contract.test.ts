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

    if (method === 'POST' && pathname === '/message/react') {
      return jsonResponse(200, {
        id: 'r-fake-reaction',
        messageid: '3EB0FAKE0000000000REACT',
        messageTimestamp: 1751000002000,
        messageType: 'reaction',
        status: 'Pending',
      });
    }

    if (method === 'POST' && pathname === '/message/edit') {
      return jsonResponse(200, {
        id: '5511999999999:3EB0FAKE0000000000EDIT',
        messageid: '3EB0FAKE0000000000EDIT',
        content: 'texto editado',
        messageTimestamp: 1751000004000,
        messageType: 'text',
        status: 'Pending',
        owner: '5511999999999',
      });
    }

    if (method === 'POST' && pathname === '/message/delete') {
      return jsonResponse(200, {
        timestamp: '2026-07-12T10:00:00.000Z',
        id: '3EB0FAKE0000000000ORIGINAL',
      });
    }

    // messages.pin/unpin (ADR-0013): POST /message/pin.
    if (method === 'POST' && pathname === '/message/pin') {
      return jsonResponse(200, {
        chatid: '5511999999999@s.whatsapp.net',
        messageType: 'PinInChatMessage',
        targetMessageID: '3EB0FAKE0000000000PIN',
        pinned: true,
      });
    }

    // messages.markRead (ADR-0013, nível de MENSAGEM): POST /message/markread — distinto de
    // chats.markRead (/chat/read, nível de conversa, ADR-0012).
    if (method === 'POST' && pathname === '/message/markread') {
      return jsonResponse(200, {
        results: [{ message_id: '3EB0FAKE0000000000READ', status: 'success' }],
      });
    }

    // messages.sendLocation (ADR-0014): POST /send/location.
    if (method === 'POST' && pathname === '/send/location') {
      return jsonResponse(200, {
        id: '3EB0FAKE0000000000LOCATION',
        messageid: '3EB0FAKE0000000000LOCATION',
        messageTimestamp: 1735689600,
      });
    }

    // messages.sendContactCard (ADR-0014): POST /send/contact.
    if (method === 'POST' && pathname === '/send/contact') {
      return jsonResponse(200, {
        id: '3EB0FAKE0000000000CONTACT',
        messageid: '3EB0FAKE0000000000CONTACT',
        messageTimestamp: 1735689601,
      });
    }

    // messages.sendPoll (ADR-0014): POST /send/menu com type "poll".
    if (method === 'POST' && pathname === '/send/menu') {
      return jsonResponse(200, {
        id: '3EB0FAKE0000000000POLL',
        messageid: '3EB0FAKE0000000000POLL',
        messageTimestamp: 1735689602,
      });
    }

    if (method === 'POST' && pathname === '/chat/archive') {
      return jsonResponse(200, { response: 'Chat updated successfully' });
    }

    if (method === 'POST' && pathname === '/chat/mute') {
      return jsonResponse(200, { response: 'Chat mute settings updated successfully' });
    }

    if (method === 'POST' && pathname === '/chat/pin') {
      return jsonResponse(200, { response: 'Chat pinned' });
    }

    if (method === 'POST' && pathname === '/chat/read') {
      return jsonResponse(200, { response: 'Chat updated successfully' });
    }

    // presence.setTyping (ADR-0015): POST /message/presence.
    if (method === 'POST' && pathname === '/message/presence') {
      return jsonResponse(200, { response: 'Chat presence sent successfully' });
    }

    // presence.set (ADR-0015): POST /instance/presence.
    if (method === 'POST' && pathname === '/instance/presence') {
      return jsonResponse(200, { response: 'Presence set successfuly' });
    }

    // labels.list (ADR-0016): GET /labels.
    if (method === 'GET' && pathname === '/labels') {
      return jsonResponse(200, [
        { id: 'uuid-1', labelid: '1', name: 'Cliente', color: 2, colorHex: '#fed428' },
      ]);
    }

    // labels.create/update/delete (ADR-0016): POST /label/edit.
    if (method === 'POST' && pathname === '/label/edit') {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return jsonResponse(200, {
        response: body.labelid === 'new' ? 'Label created' : 'Label edited',
      });
    }

    // labels.addToChat/removeFromChat (ADR-0016): POST /chat/labels.
    if (method === 'POST' && pathname === '/chat/labels') {
      return jsonResponse(200, { response: 'Labels atualizadas com sucesso' });
    }

    // channels.list (ADR-0017): GET /newsletter/list.
    if (method === 'GET' && pathname === '/newsletter/list') {
      return jsonResponse(200, {
        response: [
          {
            id: '111111111111111111@newsletter',
            thread_metadata: {
              name: { text: 'Canal Contrato' },
              description: { text: 'Descrição' },
              subscribers_count: '10',
            },
          },
        ],
      });
    }

    // channels.create (ADR-0017): POST /newsletter/create.
    if (method === 'POST' && pathname === '/newsletter/create') {
      return jsonResponse(200, {
        response: {
          id: '222222222222222222@newsletter',
          thread_metadata: {
            name: { text: 'Contrato: Canal Novo' },
            description: { text: '' },
            subscribers_count: '0',
          },
        },
      });
    }

    // channels.getInfo (ADR-0017): POST /newsletter/info.
    if (method === 'POST' && pathname === '/newsletter/info') {
      return jsonResponse(200, {
        response: {
          id: '111111111111111111@newsletter',
          thread_metadata: {
            name: { text: 'Canal Contrato' },
            description: { text: 'Descrição' },
            subscribers_count: '10',
          },
        },
      });
    }

    // channels.delete (ADR-0017): POST /newsletter/delete.
    if (method === 'POST' && pathname === '/newsletter/delete') {
      return jsonResponse(200, { response: 'success' });
    }

    // channels.follow/unfollow (ADR-0017): POST /newsletter/follow, POST /newsletter/unfollow.
    if (
      method === 'POST' &&
      (pathname === '/newsletter/follow' || pathname === '/newsletter/unfollow')
    ) {
      return jsonResponse(200, { response: 'success' });
    }

    // business.getProfile (ADR-0018): POST /business/get/profile.
    if (method === 'POST' && pathname === '/business/get/profile') {
      return jsonResponse(200, {
        response: {
          description: 'Loja de contrato',
          address: 'Rua Contrato, 1',
          email: 'contrato@exemplo.com',
          websites: ['https://exemplo.com'],
          categories: [{ id: '1', localized_display_name: 'Comércio' }],
        },
      });
    }

    // business.updateProfile (ADR-0018): POST /business/update/profile.
    if (method === 'POST' && pathname === '/business/update/profile') {
      const parsed = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (parsed.description === 'força-207') {
        return jsonResponse(207, {
          response: { description: { status: 'error', error: 'algo falhou' } },
        });
      }
      return jsonResponse(200, { response: 'success' });
    }

    if (method === 'POST' && pathname === '/group/create') {
      return jsonResponse(200, {
        JID: '120363000000000000@g.us',
        Name: 'Grupo de teste',
        Topic: '',
        OwnerJID: '5511999999999@s.whatsapp.net',
        GroupCreated: 1751000003,
        Participants: [
          { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
          { JID: '5511988887777@s.whatsapp.net', IsAdmin: false, IsSuperAdmin: false },
        ],
      });
    }

    if (method === 'POST' && pathname === '/group/info') {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (body.getInviteLink === true) {
        return jsonResponse(200, {
          JID: '120363000000000000@g.us',
          Name: 'Grupo de teste',
          Topic: 'Descrição do grupo',
          OwnerJID: '5511999999999@s.whatsapp.net',
          GroupCreated: 1751000003,
          invite_link: 'https://chat.whatsapp.com/ABC123FAKE',
          Participants: [
            { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
          ],
        });
      }
      return jsonResponse(200, {
        JID: '120363000000000000@g.us',
        Name: 'Grupo de teste',
        Topic: 'Descrição do grupo',
        OwnerJID: '5511999999999@s.whatsapp.net',
        GroupCreated: 1751000003,
        Participants: [
          { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
          { JID: '5511988887777@s.whatsapp.net', IsAdmin: false, IsSuperAdmin: false },
        ],
      });
    }

    if (method === 'GET' && pathname === '/group/list') {
      return jsonResponse(200, {
        groups: [
          {
            JID: '120363000000000000@g.us',
            Name: 'Grupo de teste',
            Participants: [
              { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
            ],
          },
        ],
      });
    }

    if (method === 'POST' && pathname === '/group/updateParticipants') {
      return jsonResponse(200, {
        groupUpdated: [{ JID: '5511988887777@s.whatsapp.net', Error: 0 }],
        group: { JID: '120363000000000000@g.us', Name: 'Grupo de teste', Participants: [] },
        needs_refresh: false,
      });
    }

    if (method === 'POST' && pathname === '/group/updateName') {
      return jsonResponse(200, {
        response: 'Group name updated successfully',
        group: { JID: '120363000000000000@g.us', Name: 'Novo nome' },
        needs_refresh: false,
      });
    }

    if (method === 'POST' && pathname === '/group/updateDescription') {
      return jsonResponse(200, {
        response: 'Group description updated successfully',
        group: { JID: '120363000000000000@g.us', Topic: 'Nova descrição' },
        needs_refresh: false,
      });
    }

    if (method === 'POST' && pathname === '/group/updateImage') {
      return jsonResponse(200, {
        response: 'Group image updated successfully',
        group: { JID: '120363000000000000@g.us' },
        needs_refresh: false,
      });
    }

    if (method === 'POST' && pathname === '/group/resetInviteCode') {
      return jsonResponse(200, {
        InviteLink: 'https://chat.whatsapp.com/NEWCODE456',
        group: { JID: '120363000000000000@g.us' },
        needs_refresh: false,
      });
    }

    if (method === 'POST' && pathname === '/group/join') {
      return jsonResponse(200, {
        response: 'Group join successful',
        group: { JID: '120363000000000000@g.us', Name: 'Grupo de teste' },
        needs_refresh: false,
      });
    }

    if (method === 'POST' && pathname === '/group/leave') {
      return jsonResponse(200, { response: 'Group leave successful' });
    }

    if (method === 'GET' && pathname === '/contacts') {
      return jsonResponse(200, [
        {
          jid: '5511999999999@s.whatsapp.net',
          contact_name: 'Fulano da Silva',
          contact_FirstName: 'Fulano',
        },
        {
          jid: '5511988887777@s.whatsapp.net',
          contact_FirstName: 'Beltrano',
        },
      ]);
    }

    if (method === 'POST' && pathname === '/chat/details') {
      return jsonResponse(200, {
        name: 'Nome de perfil',
        phone: '5511999999999',
        wa_chatid: '5511999999999@s.whatsapp.net',
        wa_name: 'Nome do WhatsApp',
        wa_contactName: 'Nome na agenda',
        wa_isBlocked: false,
        image: 'https://cdn.uazapi-fake.test/foto.jpg',
        imagePreview: 'https://cdn.uazapi-fake.test/foto-preview.jpg',
      });
    }

    if (method === 'POST' && pathname === '/chat/check') {
      return jsonResponse(200, [
        {
          query: '5511999999999',
          jid: '5511999999999@s.whatsapp.net',
          lid: '123456789@lid',
          isInWhatsapp: true,
          verifiedName: 'Empresa Exemplo',
        },
      ]);
    }

    if (method === 'POST' && pathname === '/chat/block') {
      return jsonResponse(200, {
        response: 'success',
        blockList: ['5511999999999@s.whatsapp.net'],
      });
    }

    if (method === 'GET' && pathname === '/chat/blocklist') {
      return jsonResponse(200, {
        blockList: ['5511999999999@s.whatsapp.net', '5511988887777@s.whatsapp.net'],
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

  it('messages.sendReaction envia "number", "text" (emoji) e "id" (messageId) para POST /message/react', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/react') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: '3EB0538DA65A59F6D8A251',
      emoji: '👍',
    });

    expect(capturedBody?.number).toBe('5511999999999');
    expect(capturedBody?.text).toBe('👍');
    expect(capturedBody?.id).toBe('3EB0538DA65A59F6D8A251');
    expect(sent.id).toBe('3EB0FAKE0000000000REACT');
    expect(sent.chatId).toBe('5511999999999');
    expect(sent.timestamp).toBe(1751000002000);
  });

  it('messages.sendReaction envia "text" vazio para remover uma reação já enviada', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/react') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendReaction({
      to: '5511999999999',
      messageId: '3EB0538DA65A59F6D8A251',
      emoji: '',
    });

    expect(capturedBody?.text).toBe('');
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

  it('parseWebhook evento "group" (enum do envelope) cai em "unknown" — grupo webhooks não implementados nesta fase (ver docs/providers/uazapi.md#webhooks-de-grupo--não-implementado-nesta-fase)', () => {
    const adapter = uazapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event: 'group',
        instance: 'minha-instancia',
        data: {
          id: '120363000000000000@g.us',
          action: 'add',
          participants: ['5511988887777@s.whatsapp.net'],
        },
      },
    });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('unknown');
    if (event?.type === 'unknown') {
      expect(event.reason).toContain('não mapeado nesta fase');
      expect(event.instanceId).toBe('minha-instancia');
    }
  });

  it('parseWebhook evento "groups" (nome de configuração) cai em "unknown" pela mesma razão', () => {
    const adapter = uazapi(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { event: 'groups', instance: 'minha-instancia', data: {} },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
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

  it('groups.create envia { name, participants } (dígitos crus) para POST /group/create e mapeia a resposta', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/create') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo de teste',
      participants: ['5511988887777', '5511977776666@s.whatsapp.net'],
    });

    expect(capturedBody?.name).toBe('Grupo de teste');
    // participants em /group/create são dígitos crus: o JID perde o sufixo "@..."
    expect(capturedBody?.participants).toEqual(['5511988887777', '5511977776666']);

    expect(group.id).toBe('120363000000000000@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.owner).toBe('5511999999999@s.whatsapp.net');
    expect(group.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.create cai de volta para "subject"/"participants" de entrada quando a resposta não traz os campos correspondentes', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/create') {
            return jsonResponse(200, {});
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo sem resposta completa',
      participants: ['5511988887777'],
    });

    expect(group.id).toBe('');
    expect(group.subject).toBe('Grupo sem resposta completa');
    expect(group.participants).toEqual([
      { id: '5511988887777', isAdmin: false, isSuperAdmin: false },
    ]);
  });

  it('groups.getInfo envia { groupjid } para POST /group/info e mapeia o schema Group para GroupInfo', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/info') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo('120363000000000000@g.us');

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(group.id).toBe('120363000000000000@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.description).toBe('Descrição do grupo');
    expect(group.owner).toBe('5511999999999@s.whatsapp.net');
    expect(group.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
  });

  it('groups.list chama GET /group/list e mapeia cada item de "groups" para GroupInfo', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.groups.list();

    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('120363000000000000@g.us');
    expect(list[0]?.subject).toBe('Grupo de teste');
    expect(list[0]?.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
    ]);
  });

  it('groups.addParticipants envia { groupjid, action: "add", participants } (telefone OU JID) para POST /group/updateParticipants', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateParticipants') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.addParticipants({
        groupId: '120363000000000000@g.us',
        participants: ['5511988887777', '5511977776666@s.whatsapp.net'],
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(capturedBody?.action).toBe('add');
    // diferente de /group/create, aqui o participante em formato JID NÃO perde o sufixo.
    expect(capturedBody?.participants).toEqual(['5511988887777', '5511977776666@s.whatsapp.net']);
  });

  it('groups.removeParticipants/promoteParticipants/demoteParticipants usam o mesmo endpoint com o "action" correto', async () => {
    const capturedActions: string[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateParticipants') {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            capturedActions.push(String(body.action));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.removeParticipants({
      groupId: '120363000000000000@g.us',
      participants: ['5511988887777'],
    });
    await wa.groups.promoteParticipants({
      groupId: '120363000000000000@g.us',
      participants: ['5511988887777'],
    });
    await wa.groups.demoteParticipants({
      groupId: '120363000000000000@g.us',
      participants: ['5511988887777'],
    });

    expect(capturedActions).toEqual(['remove', 'promote', 'demote']);
  });

  it('groups.updateSubject envia { groupjid, name } para POST /group/updateName', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateName') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateSubject({
        groupId: '120363000000000000@g.us',
        subject: 'Novo nome',
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(capturedBody?.name).toBe('Novo nome');
  });

  it('groups.updateDescription envia { groupjid, description } para POST /group/updateDescription', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateDescription') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({
        groupId: '120363000000000000@g.us',
        description: 'Nova descrição',
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(capturedBody?.description).toBe('Nova descrição');
  });

  it('groups.updateDescription envia "description" vazia (limpa a descrição do grupo) sem lançar', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateDescription') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({
        groupId: '120363000000000000@g.us',
        description: '',
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody?.description).toBe('');
  });

  it('groups.updatePicture envia { groupjid, image } com media.url repassada diretamente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateImage') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updatePicture({
        groupId: '120363000000000000@g.us',
        media: { kind: 'image', url: 'https://cdn.exemplo.test/foto-grupo.jpg' },
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(capturedBody?.image).toBe('https://cdn.exemplo.test/foto-grupo.jpg');
  });

  it('groups.updatePicture monta uma data-URI a partir de media.base64 quando media.url está ausente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateImage') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updatePicture({
      groupId: '120363000000000000@g.us',
      media: { kind: 'image', base64: 'ZmFrZS1mb3RvLWdydXBv', mimeType: 'image/png' },
    });

    expect(capturedBody?.image).toBe('data:image/png;base64,ZmFrZS1mb3RvLWdydXBv');
  });

  it('groups.updatePicture usa o default "image/jpeg" quando media.mimeType está ausente (só base64)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateImage') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updatePicture({
      groupId: '120363000000000000@g.us',
      media: { kind: 'image', base64: 'ZmFrZS1mb3RvLWdydXBv' },
    });

    expect(capturedBody?.image).toBe('data:image/jpeg;base64,ZmFrZS1mb3RvLWdydXBv');
  });

  it('groups.getInviteLink envia { groupjid, getInviteLink: true } para POST /group/info e devolve o link completo de "invite_link"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/info') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink('120363000000000000@g.us');

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(capturedBody?.getInviteLink).toBe(true);
    expect(result.link).toBe('https://chat.whatsapp.com/ABC123FAKE');
    expect(result).toHaveProperty('raw');
  });

  it('groups.getInviteLink normaliza para link completo mesmo quando o provider devolve só o código bare', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/info') {
            const body = init?.body
              ? (JSON.parse(String(init.body)) as Record<string, unknown>)
              : {};
            if (body.getInviteLink === true) {
              return jsonResponse(200, {
                JID: '120363000000000000@g.us',
                Name: 'Grupo de teste',
                invite_link: 'CODIGOBARE789',
              });
            }
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink('120363000000000000@g.us');

    expect(result.link).toBe('https://chat.whatsapp.com/CODIGOBARE789');
  });

  it('groups.revokeInviteLink envia { groupjid } para POST /group/resetInviteCode e devolve o novo link de "InviteLink" (PascalCase)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/resetInviteCode') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.revokeInviteLink('120363000000000000@g.us');

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
    expect(result.link).toBe('https://chat.whatsapp.com/NEWCODE456');
    expect(result).toHaveProperty('raw');
  });

  it('groups.joinViaInviteLink envia o link completo (já normalizado pelo conector) em "invitecode" para POST /group/join', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/join') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    // O conector normaliza um código bare para o link completo ANTES de chegar ao adapter — o
    // adapter uazapi repassa esse valor diretamente em "invitecode" (o endpoint aceita ambos).
    await expect(wa.groups.joinViaInviteLink({ invite: 'CODIGOBARE123' })).resolves.toBeUndefined();
    expect(capturedBody?.invitecode).toBe('https://chat.whatsapp.com/CODIGOBARE123');
  });

  it('groups.joinViaInviteLink repassa um link já completo sem alterações em "invitecode"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/join') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink({ invite: 'https://chat.whatsapp.com/JALINKCOMPLETO' });

    expect(capturedBody?.invitecode).toBe('https://chat.whatsapp.com/JALINKCOMPLETO');
  });

  it('groups.leaveGroup envia { groupjid } para POST /group/leave sem lançar', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/leave') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.groups.leaveGroup('120363000000000000@g.us')).resolves.toBeUndefined();

    expect(capturedBody?.groupjid).toBe('120363000000000000@g.us');
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

  it('contacts.list chama GET /contacts com contactScope=all e mapeia jid->id, contact_name (fallback contact_FirstName)->name', async () => {
    let capturedUrl: URL | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/contacts') {
            capturedUrl = url;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contacts = await wa.contacts.list();

    expect(capturedUrl?.searchParams.get('contactScope')).toBe('all');
    expect(contacts).toEqual([
      { id: '5511999999999@s.whatsapp.net', name: 'Fulano da Silva', raw: expect.anything() },
      { id: '5511988887777@s.whatsapp.net', name: 'Beltrano', raw: expect.anything() },
    ]);
  });

  it('contacts.get envia { number, preview: false } para POST /chat/details e mapeia o schema Chat para Contact (sem "about")', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/details') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5511999999999');

    expect(capturedBody?.number).toBe('5511999999999');
    expect(capturedBody?.preview).toBe(false);
    expect(contact.id).toBe('5511999999999@s.whatsapp.net');
    expect(contact.name).toBe('Nome na agenda');
    expect(contact.isBlocked).toBe(false);
    expect(contact.profilePictureUrl).toBe('https://cdn.uazapi-fake.test/foto.jpg');
    expect(contact.about).toBeUndefined();
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.get cai para wa_name e, na ausência dele, para "name" quando wa_contactName está ausente', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/details') {
            return jsonResponse(200, { name: 'Só nome de perfil' });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5511999999999');

    expect(contact.name).toBe('Só nome de perfil');
    // "wa_chatid" ausente na resposta: id cai de volta para o chatId requisitado (canônico).
    expect(contact.id).toBe('5511999999999');
    expect(contact.profilePictureUrl).toBeUndefined();
    expect(contact.isBlocked).toBeUndefined();
  });

  it('contacts.getProfilePicture reaproveita POST /chat/details (mesma chamada de contacts.get) e devolve "image" em "url"', async () => {
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
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(picture.url).toBe('https://cdn.uazapi-fake.test/foto.jpg');
    expect(picture).toHaveProperty('raw');
    expect(calls.filter((call) => call === 'POST /chat/details')).toHaveLength(1);
  });

  it('contacts.getProfilePicture devolve url undefined quando o provider não inclui "image"', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/details') {
            return jsonResponse(200, { name: 'Sem foto' });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(picture.url).toBeUndefined();
  });

  it('contacts.checkExists envia { numbers: [phone] } para POST /chat/check e mapeia isInWhatsapp->exists, jid->chatId (primeiro item)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/check') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511999999999');

    expect(capturedBody?.numbers).toEqual(['5511999999999']);
    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('5511999999999@s.whatsapp.net');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.checkExists mapeia isInWhatsapp: false para exists: false, sem chatId, sem lançar', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/check') {
            return jsonResponse(200, [
              { query: '5511000000000', isInWhatsapp: false, error: 'not_found' },
            ]);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511000000000');

    expect(result.exists).toBe(false);
    expect(result.chatId).toBeUndefined();
  });

  it('contacts.checkExists devolve exists: false quando a resposta vem vazia (nunca lança)', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/check') {
            return jsonResponse(200, []);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511000000000');

    expect(result.exists).toBe(false);
    expect(result.chatId).toBeUndefined();
  });

  it('não declara "contacts.getAbout" (uazapi não suporta) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = uazapi(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('contacts.getAbout');
    expect(adapter.contacts.getAbout).toBeUndefined();

    const wa = createConnector(adapter);
    const failure = await wa.contacts.getAbout('5511999999999').catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
    }
  });

  it('contacts.block envia { number, block: true } para POST /chat/block', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedMethod: string | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/block') {
            capturedMethod = init?.method;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.block('5511999999999')).resolves.toBeUndefined();

    expect(capturedMethod).toBe('POST');
    expect(capturedBody?.number).toBe('5511999999999');
    expect(capturedBody?.block).toBe(true);
  });

  it('contacts.unblock envia { number, block: false } para o MESMO endpoint POST /chat/block', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedMethod: string | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/block') {
            capturedMethod = init?.method;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.unblock('5511999999999')).resolves.toBeUndefined();

    expect(capturedMethod).toBe('POST');
    expect(capturedBody?.number).toBe('5511999999999');
    expect(capturedBody?.block).toBe(false);
  });

  it('contacts.listBlocked chama GET /chat/blocklist e mapeia "blockList" para a lista de chatIds', async () => {
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
    const wa = createConnector(adapter);
    const blocked = await wa.contacts.listBlocked();

    expect(calls).toContain('GET /chat/blocklist');
    expect(blocked).toEqual(['5511999999999@s.whatsapp.net', '5511988887777@s.whatsapp.net']);
  });

  it('contacts.listBlocked devolve lista vazia quando "blockList" está ausente (nunca lança)', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/blocklist') {
            return jsonResponse(200, {});
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const blocked = await wa.contacts.listBlocked();

    expect(blocked).toEqual([]);
  });

  it('declara contacts.block/contacts.unblock/contacts.listBlocked em capabilities', () => {
    const adapter = uazapi(buildAdapterOptions());
    expect(adapter.capabilities).toContain('contacts.block');
    expect(adapter.capabilities).toContain('contacts.unblock');
    expect(adapter.capabilities).toContain('contacts.listBlocked');
  });

  it('messages.edit envia { id, text } (sem "number"/"to") para POST /message/edit e mapeia a resposta', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/edit') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.edit({
      to: '5511999999999',
      messageId: '3EB0FAKE0000000000ORIGINAL',
      text: 'texto editado',
    });

    expect(capturedBody).toEqual({ id: '3EB0FAKE0000000000ORIGINAL', text: 'texto editado' });
    expect(capturedBody?.number).toBeUndefined();
    expect(sent.id).toBe('3EB0FAKE0000000000EDIT');
    expect(sent).toHaveProperty('raw');
  });

  it('messages.edit cai para o "to" requisitado quando a resposta não traz "chatid"', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const sent = await wa.messages.edit({
      to: '5511999999999',
      messageId: '3EB0FAKE0000000000ORIGINAL',
      text: 'texto editado',
    });

    expect(sent.chatId).toBe('5511999999999');
  });

  it('messages.delete envia { id } (só o messageId) para POST /message/delete', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/delete') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(
      wa.messages.delete({ to: '5511999999999', messageId: '3EB0FAKE0000000000ORIGINAL' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ id: '3EB0FAKE0000000000ORIGINAL' });
  });

  it('messages.pin/unpin enviam { id, pin: boolean } para POST /message/pin (sem "duration", usa o default 30 do provider)', async () => {
    const hits: unknown[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/pin') {
            hits.push(JSON.parse(String(init?.body)));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.pin({ to: '5511999999999', messageId: '3EB0FAKE0000000000PIN' }),
    ).resolves.toBeUndefined();
    await expect(
      wa.messages.unpin({ to: '5511999999999', messageId: '3EB0FAKE0000000000PIN' }),
    ).resolves.toBeUndefined();

    expect(hits).toEqual([
      { id: '3EB0FAKE0000000000PIN', pin: true },
      { id: '3EB0FAKE0000000000PIN', pin: false },
    ]);
  });

  it('messages.markRead envia { id: [messageId] } (array) para POST /message/markread', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/markread') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.markRead({ to: '5511999999999', messageId: '3EB0FAKE0000000000READ' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ id: ['3EB0FAKE0000000000READ'] });
  });

  it('messages.sendLocation envia {number, latitude, longitude, name, address} para POST /send/location', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/location') {
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
      number: '5511999999999',
      latitude: -3.7,
      longitude: -38.5,
      name: 'Escritório',
      address: 'Av. Principal, 100',
    });
  });

  it('messages.sendContactCard envia {number, fullName, phoneNumber} para POST /send/contact', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/contact') {
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
      number: '5511999999999',
      fullName: 'Fulano',
      phoneNumber: '5511988888888',
    });
  });

  it('messages.sendPoll envia {number, type: "poll", text, choices, selectableCount} para POST /send/menu', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/send/menu') {
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
      number: '5511999999999',
      type: 'poll',
      text: 'Qual sua cor favorita?',
      choices: ['Azul', 'Verde'],
      selectableCount: 2,
    });
  });

  it('não declara messages.forward/star/unstar (busca exaustiva não encontrou endpoint)', () => {
    const adapter = uazapi(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.forward');
    expect(adapter.capabilities).not.toContain('messages.star');
    expect(adapter.capabilities).not.toContain('messages.unstar');
    expect(adapter.messages.forward).toBeUndefined();
  });

  it('declara messages.edit/messages.delete em capabilities', () => {
    const adapter = uazapi(buildAdapterOptions());
    expect(adapter.capabilities).toContain('messages.edit');
    expect(adapter.capabilities).toContain('messages.delete');
  });

  it('chats.archive/chats.unarchive enviam { number, archive } para POST /chat/archive', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/archive') {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.chats.archive('5511999999999')).resolves.toBeUndefined();
    await expect(wa.chats.unarchive('5511999999999')).resolves.toBeUndefined();

    expect(capturedBodies).toEqual([
      { number: '5511999999999', archive: true },
      { number: '5511999999999', archive: false },
    ]);
  });

  it('chats.mute envia muteEndTime: -1 (permanente) e chats.unmute envia muteEndTime: 0 para POST /chat/mute', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/mute') {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.chats.mute('5511999999999')).resolves.toBeUndefined();
    await expect(wa.chats.unmute('5511999999999')).resolves.toBeUndefined();

    expect(capturedBodies).toEqual([
      { number: '5511999999999', muteEndTime: -1 },
      { number: '5511999999999', muteEndTime: 0 },
    ]);
  });

  it('chats.pin/chats.unpin enviam { number, pin } para POST /chat/pin', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/pin') {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.chats.pin('5511999999999')).resolves.toBeUndefined();
    await expect(wa.chats.unpin('5511999999999')).resolves.toBeUndefined();

    expect(capturedBodies).toEqual([
      { number: '5511999999999', pin: true },
      { number: '5511999999999', pin: false },
    ]);
  });

  it('chats.markRead/chats.markUnread enviam { number, read } para POST /chat/read', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/read') {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.chats.markRead('5511999999999')).resolves.toBeUndefined();
    await expect(wa.chats.markUnread('5511999999999')).resolves.toBeUndefined();

    expect(capturedBodies).toEqual([
      { number: '5511999999999', read: true },
      { number: '5511999999999', read: false },
    ]);
  });

  it('presence.setTyping envia {number, presence} para POST /message/presence', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/message/presence') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(
      wa.presence.setTyping({ to: '5511999999999', state: 'recording' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ number: '5511999999999', presence: 'recording' });
  });

  it('presence.set envia {presence} para POST /instance/presence (online -> "available", offline -> "unavailable")', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/instance/presence') {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.presence.set('online')).resolves.toBeUndefined();
    await expect(wa.presence.set('offline')).resolves.toBeUndefined();

    expect(capturedBodies).toEqual([{ presence: 'available' }, { presence: 'unavailable' }]);
  });

  it('não declara presence.subscribe (sem endpoint equivalente confirmado na pesquisa)', () => {
    const adapter = uazapi(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('presence.subscribe');
    expect(adapter.presence?.subscribe).toBeUndefined();
  });

  it('labels.list chama GET /labels e mapeia labelid/name/color (preferindo labelid a id)', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const labels = await wa.labels.list();

    expect(labels).toEqual([{ id: '1', name: 'Cliente', color: '2', raw: expect.anything() }]);
  });

  it('labels.create envia labelid:"new" em POST /label/edit e descobre o labelid criado por diff em GET /labels (antes/depois)', async () => {
    let listCalls = 0;
    const editCalls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/labels' && (init?.method ?? 'GET').toUpperCase() === 'GET') {
            listCalls += 1;
            const body =
              listCalls === 1
                ? [{ id: 'uuid-1', labelid: '1', name: 'Cliente', color: 2 }]
                : [
                    { id: 'uuid-1', labelid: '1', name: 'Cliente', color: 2 },
                    { id: 'uuid-2', labelid: '2', name: 'Cliente VIP', color: 3 },
                  ];
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (url.pathname === '/label/edit') {
            editCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const label = await wa.labels.create({ name: 'Cliente VIP', color: '3' });

    expect(listCalls).toBe(2);
    expect(editCalls).toEqual([{ labelid: 'new', name: 'Cliente VIP', color: 3, delete: false }]);
    expect(label).toEqual({
      id: '2',
      name: 'Cliente VIP',
      color: '3',
      raw: expect.anything(),
    });
  });

  it('labels.create falha com PROVIDER_ERROR quando GET /labels não traz nenhum labelid novo após o create', async () => {
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/labels') {
            return new Response(
              JSON.stringify([{ id: 'uuid-1', labelid: '1', name: 'Cliente', color: 2 }]),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const failure = await wa.labels
      .create({ name: 'Cliente VIP' })
      .catch((error: unknown) => error);
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('labels.update envia o labelId real (não "new") para POST /label/edit', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/label/edit') {
            calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(
      wa.labels.update({ labelId: '1', name: 'Cliente Ouro', color: '5' }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([{ labelid: '1', name: 'Cliente Ouro', color: 5, delete: false }]);
  });

  it('labels.delete envia {labelid, delete: true} para POST /label/edit sem precisar buscar name/color atuais (sem round-trip, diferente do Evolution GO)', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = uazapi(
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

    await expect(wa.labels.delete('1')).resolves.toBeUndefined();

    expect(calls).toEqual([{ path: '/label/edit', body: { labelid: '1', delete: true } }]);
  });

  it('labels.addToChat/removeFromChat chamam POST /chat/labels com {number, add_labelid} / {number, remove_labelid}', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/labels') {
            calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.labels.addToChat({ chatId: '5511999999999', labelId: '1' });
    await wa.labels.removeFromChat({ chatId: '5511999999999', labelId: '1' });

    expect(calls).toEqual([
      { number: '5511999999999', add_labelid: '1' },
      { number: '5511999999999', remove_labelid: '1' },
    ]);
  });

  it('channels.list chama GET /newsletter/list e mapeia thread_metadata.{name,description}.text + subscribers_count', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const channels = await wa.channels.list();

    expect(channels).toEqual([
      {
        id: '111111111111111111@newsletter',
        name: 'Canal Contrato',
        description: 'Descrição',
        subscribersCount: 10,
        raw: expect.anything(),
      },
    ]);
  });

  it('channels.create chama POST /newsletter/create com {name, description}', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/newsletter/create') {
            calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const channel = await wa.channels.create({ name: 'Canal Novo', description: 'Descrição' });

    expect(calls).toEqual([{ name: 'Canal Novo', description: 'Descrição' }]);
    expect(channel.id).toBe('222222222222222222@newsletter');
    expect(channel.name).toBe('Contrato: Canal Novo');
  });

  it('channels.getInfo chama POST /newsletter/info com {jid}', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/newsletter/info') {
            calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const channel = await wa.channels.getInfo('111111111111111111@newsletter');

    expect(calls).toEqual([{ jid: '111111111111111111@newsletter' }]);
    expect(channel.name).toBe('Canal Contrato');
  });

  it('channels.delete chama POST /newsletter/delete com {jid} e resolve void', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/newsletter/delete') {
            calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.channels.delete('111111111111111111@newsletter')).resolves.toBeUndefined();

    expect(calls).toEqual([{ jid: '111111111111111111@newsletter' }]);
  });

  it('channels.follow/unfollow chamam POST /newsletter/follow e POST /newsletter/unfollow com {jid}', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/newsletter/follow' || url.pathname === '/newsletter/unfollow') {
            calls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.channels.follow('111111111111111111@newsletter');
    await wa.channels.unfollow('111111111111111111@newsletter');

    expect(calls).toEqual([
      { path: '/newsletter/follow', body: { jid: '111111111111111111@newsletter' } },
      { path: '/newsletter/unfollow', body: { jid: '111111111111111111@newsletter' } },
    ]);
  });

  it('business.getProfile chama POST /business/get/profile e normaliza categories/websites', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);

    const profile = await wa.business.getProfile();

    expect(profile).toEqual({
      description: 'Loja de contrato',
      address: 'Rua Contrato, 1',
      email: 'contrato@exemplo.com',
      websites: ['https://exemplo.com'],
      categories: ['Comércio'],
      raw: expect.anything(),
    });
  });

  it('business.updateProfile chama POST /business/update/profile com o patch e resolve void', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = uazapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/business/update/profile') {
            calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(
      wa.business.updateProfile({ description: 'Nova descrição' }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      { description: 'Nova descrição', address: undefined, email: undefined },
    ]);
  });

  it('business.updateProfile lança PROVIDER_ERROR quando o 207 Multi-Status indica falha parcial', async () => {
    const adapter = uazapi(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.business.updateProfile({ description: 'força-207' }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('declara todas as 8 operações de chats.* em capabilities', () => {
    const adapter = uazapi(buildAdapterOptions());
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining([
        'chats.archive',
        'chats.unarchive',
        'chats.mute',
        'chats.unmute',
        'chats.pin',
        'chats.unpin',
        'chats.markRead',
        'chats.markUnread',
      ]),
    );
  });
});
