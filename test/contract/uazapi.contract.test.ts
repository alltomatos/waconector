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
