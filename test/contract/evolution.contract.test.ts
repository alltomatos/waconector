import { describe, expect, it } from 'vitest';
import { createConnector } from '../../src';
import { evolution } from '../../src/adapters/evolution';
import ackFixture from '../../src/adapters/evolution/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/evolution/fixtures/webhook-connection-update.json';
import groupJoinedFixture from '../../src/adapters/evolution/fixtures/webhook-group-joined.json';
import groupMultipleChangesFixture from '../../src/adapters/evolution/fixtures/webhook-group-multiple-changes.json';
import groupParticipantsAddFixture from '../../src/adapters/evolution/fixtures/webhook-group-participants-add.json';
import groupSubjectUpdateFixture from '../../src/adapters/evolution/fixtures/webhook-group-subject-update.json';
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
    if (method === 'POST' && url.pathname === '/group/create') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          jid: '123456789-987654321@g.us',
          name: 'Grupo de teste',
          owner: '5511999999999@s.whatsapp.net',
          added: ['5511988887777@s.whatsapp.net', '5511977776666@s.whatsapp.net'],
          failed: [],
        },
      });
    }
    if (method === 'POST' && url.pathname === '/group/info') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          JID: '123456789-987654321@g.us',
          OwnerJID: '5511999999999@s.whatsapp.net',
          Name: 'Grupo de teste',
          Topic: 'Descrição do grupo de teste',
          IsLocked: false,
          GroupCreated: '2026-07-10T12:00:00-03:00',
          Participants: [
            {
              JID: '5511999999999@s.whatsapp.net',
              PhoneNumber: '5511999999999',
              IsAdmin: true,
              IsSuperAdmin: true,
            },
            {
              JID: '5511988887777@s.whatsapp.net',
              PhoneNumber: '5511988887777',
              IsAdmin: false,
              IsSuperAdmin: false,
            },
          ],
        },
      });
    }
    if (method === 'GET' && url.pathname === '/group/list') {
      return jsonResponse(200, {
        message: 'success',
        data: [
          {
            JID: '123456789-987654321@g.us',
            OwnerJID: '5511999999999@s.whatsapp.net',
            Name: 'Grupo de teste',
            Topic: 'Descrição do grupo de teste',
            Participants: [
              { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
            ],
          },
        ],
      });
    }
    if (method === 'POST' && url.pathname === '/group/participant') {
      return jsonResponse(200, { message: 'success' });
    }
    if (method === 'POST' && url.pathname === '/group/name') {
      return jsonResponse(200, { message: 'success' });
    }
    if (method === 'POST' && url.pathname === '/group/description') {
      return jsonResponse(200, { message: 'success' });
    }
    if (method === 'POST' && url.pathname === '/group/photo') {
      return jsonResponse(200, { message: 'success', data: 'fake-picture-id' });
    }
    if (method === 'POST' && url.pathname === '/group/invitelink') {
      return jsonResponse(200, {
        message: 'success',
        data: 'https://chat.whatsapp.com/FAKEcodigoDeConvite123',
      });
    }
    if (method === 'POST' && url.pathname === '/group/join') {
      return jsonResponse(200, { message: 'success' });
    }
    if (method === 'POST' && url.pathname === '/group/leave') {
      return jsonResponse(200, { message: 'success' });
    }
    if (method === 'GET' && url.pathname === '/user/contacts') {
      return jsonResponse(200, {
        message: 'success',
        data: [
          {
            Jid: '5511999999999@s.whatsapp.net',
            Found: true,
            FirstName: 'Fulano',
            FullName: 'Fulano de Tal',
            PushName: 'Fulano PN',
            BusinessName: '',
          },
          {
            Jid: '5511988887777@s.whatsapp.net',
            Found: true,
            FirstName: '',
            FullName: '',
            PushName: 'Só PushName',
            BusinessName: '',
          },
        ],
      });
    }
    if (method === 'POST' && url.pathname === '/user/info') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          Users: {
            '5511999999999@s.whatsapp.net': {
              VerifiedName: '',
              Status: 'Disponível para conversar',
              PictureID: 'abc123hash',
              Devices: [0],
              LID: '123456.0:1@lid',
            },
          },
        },
      });
    }
    if (method === 'POST' && url.pathname === '/user/check') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          Users: [
            {
              Query: '5511999999999',
              IsInWhatsapp: true,
              JID: '5511999999999@s.whatsapp.net',
              RemoteJID: '5511999999999@s.whatsapp.net',
              LID: '123456.0:1@lid',
              VerifiedName: '',
            },
          ],
        },
      });
    }
    if (method === 'POST' && url.pathname === '/user/avatar') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          ID: 'abc123hash',
          URL: 'https://pps.whatsapp.net/v/t61.24694-24/fake-avatar.jpg',
          Type: 'image',
          DirectPath: '/v/t61.24694-24/fake-avatar.jpg',
          Hash: 'fakehash==',
        },
      });
    }
    if (method === 'POST' && url.pathname === '/user/block') {
      return jsonResponse(200, {
        message: 'success',
        data: { DHash: 'fakehash==', JIDs: ['5511999999999@s.whatsapp.net'] },
      });
    }
    if (method === 'POST' && url.pathname === '/user/unblock') {
      return jsonResponse(200, {
        message: 'success',
        data: { DHash: 'fakehash==', JIDs: [] },
      });
    }
    if (method === 'GET' && url.pathname === '/user/blocklist') {
      return jsonResponse(200, {
        message: 'success',
        data: {
          DHash: 'fakehash==',
          JIDs: ['5511999999999@s.whatsapp.net', '5511988887777@s.whatsapp.net'],
        },
      });
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

  it('groups.create envia POST /group/create com {groupName, participants} e mapeia GroupInfo a partir de "added"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/create') {
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

    const group = await wa.groups.create({
      subject: 'Grupo de teste',
      participants: ['5511988887777', '5511977776666@s.whatsapp.net'],
    });

    // campo é "groupName", não "name" — desvio de nomenclatura confirmado na pesquisa.
    expect(capturedBody).toEqual({
      groupName: 'Grupo de teste',
      participants: ['5511988887777', '5511977776666@s.whatsapp.net'],
    });

    expect(group.id).toBe('123456789-987654321@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.owner).toBe('5511999999999@s.whatsapp.net');
    expect(group.participants).toEqual([
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
      { id: '5511977776666@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.getInfo envia POST /group/info com {groupJid} e mapeia o GroupInfo whatsmeow (JID/Name/Topic/OwnerJID/Participants)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/info') {
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

    const group = await wa.groups.getInfo('123456789-987654321@g.us');

    expect(capturedBody).toEqual({ groupJid: '123456789-987654321@g.us' });
    expect(group.id).toBe('123456789-987654321@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.description).toBe('Descrição do grupo de teste');
    expect(group.owner).toBe('5511999999999@s.whatsapp.net');
    expect(group.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.list envia GET /group/list e mapeia cada item do array para GroupInfo', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });
    const wa = createConnector(adapter);

    const groupList = await wa.groups.list();

    expect(groupList).toHaveLength(1);
    expect(groupList[0]?.id).toBe('123456789-987654321@g.us');
    expect(groupList[0]?.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
    ]);
  });

  it('groups.addParticipants envia POST /group/participant com {groupJid, participants, action:"add"}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/participant') {
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

    const result = await wa.groups.addParticipants({
      groupId: '123456789-987654321@g.us',
      participants: ['5511988887777', '5511977776666@s.whatsapp.net'],
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      participants: ['5511988887777', '5511977776666@s.whatsapp.net'],
      action: 'add',
    });
    expect(result).toBeUndefined();
  });

  it('groups.removeParticipants/promoteParticipants/demoteParticipants reaproveitam POST /group/participant só trocando "action"', async () => {
    const capturedActions: unknown[] = [];
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/participant') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        capturedActions.push(body.action);
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    const groupId = '123456789-987654321@g.us';
    const participants = ['5511988887777'];
    await wa.groups.removeParticipants({ groupId, participants });
    await wa.groups.promoteParticipants({ groupId, participants });
    await wa.groups.demoteParticipants({ groupId, participants });

    expect(capturedActions).toEqual(['remove', 'promote', 'demote']);
  });

  it('groups.updateSubject envia POST /group/name com {groupJid, name}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/name') {
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

    const result = await wa.groups.updateSubject({
      groupId: '123456789-987654321@g.us',
      subject: 'Novo nome do grupo',
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      name: 'Novo nome do grupo',
    });
    expect(result).toBeUndefined();
  });

  it('groups.updateDescription envia POST /group/description com {groupJid, description}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/description') {
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

    const result = await wa.groups.updateDescription({
      groupId: '123456789-987654321@g.us',
      description: 'Nova descrição do grupo',
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      description: 'Nova descrição do grupo',
    });
    expect(result).toBeUndefined();
  });

  it('groups.updateDescription com description vazia limpa a descrição (o handler permite string vazia)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/description') {
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

    await wa.groups.updateDescription({
      groupId: '123456789-987654321@g.us',
      description: '',
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      description: '',
    });
  });

  it('groups.updatePicture com media.url envia POST /group/photo repassando a URL diretamente no campo "image"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/photo') {
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

    const result = await wa.groups.updatePicture({
      groupId: '123456789-987654321@g.us',
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto-grupo.jpg' },
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      image: 'https://cdn.exemplo.test/foto-grupo.jpg',
    });
    expect(result).toBeUndefined();
  });

  it('groups.updatePicture com media.base64 monta uma data-URI com prefixo "data:image/jpeg;base64," por padrão', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/photo') {
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

    await wa.groups.updatePicture({
      groupId: '123456789-987654321@g.us',
      media: { kind: 'image', base64: 'ZmFrZS1mb3RvLWdydXBv' },
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      image: 'data:image/jpeg;base64,ZmFrZS1mb3RvLWdydXBv',
    });
  });

  it('groups.updatePicture com media.base64 e mimeType "image/png" monta a data-URI com o prefixo correspondente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/photo') {
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

    await wa.groups.updatePicture({
      groupId: '123456789-987654321@g.us',
      media: { kind: 'image', base64: 'ZmFrZS1mb3RvLXBuZw==', mimeType: 'image/png' },
    });

    expect(capturedBody).toEqual({
      groupJid: '123456789-987654321@g.us',
      image: 'data:image/png;base64,ZmFrZS1mb3RvLXBuZw==',
    });
  });

  it('groups.getInviteLink envia POST /group/invitelink com {groupJid, reset:false} e repassa o link completo', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/invitelink') {
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

    const inviteLink = await wa.groups.getInviteLink('123456789-987654321@g.us');

    expect(capturedBody).toEqual({ groupJid: '123456789-987654321@g.us', reset: false });
    expect(inviteLink.link).toBe('https://chat.whatsapp.com/FAKEcodigoDeConvite123');
    expect(inviteLink).toHaveProperty('raw');
  });

  it('groups.getInviteLink normaliza para link completo mesmo se o provider devolver só o código bare', async () => {
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/invitelink') {
        return jsonResponse(200, { message: 'success', data: 'CodigoBareSemPrefixo123' });
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    const inviteLink = await wa.groups.getInviteLink('123456789-987654321@g.us');

    expect(inviteLink.link).toBe('https://chat.whatsapp.com/CodigoBareSemPrefixo123');
  });

  it('groups.revokeInviteLink reaproveita POST /group/invitelink com {reset:true} e devolve o novo link', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/invitelink') {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse(200, {
          message: 'success',
          data: 'https://chat.whatsapp.com/NOVOcodigoRevogado456',
        });
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    const inviteLink = await wa.groups.revokeInviteLink('123456789-987654321@g.us');

    expect(capturedBody).toEqual({ groupJid: '123456789-987654321@g.us', reset: true });
    expect(inviteLink.link).toBe('https://chat.whatsapp.com/NOVOcodigoRevogado456');
  });

  it('groups.joinViaInviteLink envia POST /group/join com {code} recebendo o link completo (já normalizado pelo conector)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/join') {
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

    // O conector normaliza "invite" para o link completo antes de chamar o adapter (ver
    // WaConnector.prepareJoinViaInviteLink) — mesmo passando só o código bare aqui, o adapter deve
    // receber e repassar o link completo, não o código isolado.
    const result = await wa.groups.joinViaInviteLink({ invite: 'codigoDeConviteBare789' });

    expect(capturedBody).toEqual({ code: 'https://chat.whatsapp.com/codigoDeConviteBare789' });
    expect(result).toBeUndefined();
  });

  it('groups.joinViaInviteLink repassa um link completo de entrada sem alteração', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/join') {
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

    await wa.groups.joinViaInviteLink({
      invite: 'https://chat.whatsapp.com/jaLinkCompleto000',
    });

    expect(capturedBody).toEqual({ code: 'https://chat.whatsapp.com/jaLinkCompleto000' });
  });

  it('groups.leaveGroup envia POST /group/leave com {groupJid}', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/group/leave') {
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

    const result = await wa.groups.leaveGroup('123456789-987654321@g.us');

    expect(capturedBody).toEqual({ groupJid: '123456789-987654321@g.us' });
    expect(result).toBeUndefined();
  });

  it('contacts.list envia GET /user/contacts e mapeia Jid->id, com nome pela ordem FullName > FirstName > PushName', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });
    const wa = createConnector(adapter);

    const contactList = await wa.contacts.list();

    expect(contactList).toHaveLength(2);
    expect(contactList[0]?.id).toBe('5511999999999@s.whatsapp.net');
    // FullName presente vence sobre FirstName/PushName.
    expect(contactList[0]?.name).toBe('Fulano de Tal');
    expect(contactList[0]?.about).toBeUndefined();
    expect(contactList[0]?.profilePictureUrl).toBeUndefined();
    expect(contactList[0]?.hasWhatsApp).toBeUndefined();
    // segundo item: FullName/FirstName vêm "" (zero value Go, ausência real) — deve cair no
    // fallback para PushName (ver mapContactInfo/asNonEmptyString).
    expect(contactList[1]?.id).toBe('5511988887777@s.whatsapp.net');
    expect(contactList[1]?.name).toBe('Só PushName');
    expect(contactList[1]).toHaveProperty('raw');
  });

  it('contacts.get envia POST /user/info com {number:[chatId], formatJid:true} e mapeia Status->about, sem name/profilePictureUrl', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/info') {
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

    const contact = await wa.contacts.get('5511999999999@s.whatsapp.net');

    expect(capturedBody).toEqual({
      number: ['5511999999999@s.whatsapp.net'],
      formatJid: true,
    });
    expect(contact.id).toBe('5511999999999@s.whatsapp.net');
    expect(contact.about).toBe('Disponível para conversar');
    // Limitações documentadas (docs/providers/evolution.md, seção "Contatos"): a resposta de
    // /user/info não traz nome de exibição nem uma URL de foto utilizável (PictureID é só um
    // id/hash interno) — ambos devem ficar undefined, nunca inventados.
    expect(contact.name).toBeUndefined();
    expect(contact.profilePictureUrl).toBeUndefined();
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.getAbout reaproveita POST /user/info (mesmo endpoint de contacts.get) e mapeia Status->about', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });
    const wa = createConnector(adapter);

    const about = await wa.contacts.getAbout('5511999999999@s.whatsapp.net');

    expect(about.about).toBe('Disponível para conversar');
    expect(about).toHaveProperty('raw');
  });

  it('contacts.checkExists envia POST /user/check com {number:[phone], formatJid:true} e mapeia IsInWhatsapp/JID', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/check') {
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

    const result = await wa.contacts.checkExists('5511999999999');

    expect(capturedBody).toEqual({ number: ['5511999999999'], formatJid: true });
    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('5511999999999@s.whatsapp.net');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.getProfilePicture envia POST /user/avatar com {number, preview:false} (number é string única, não array) e mapeia URL->url', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/avatar') {
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

    const picture = await wa.contacts.getProfilePicture('5511999999999@s.whatsapp.net');

    expect(capturedBody).toEqual({ number: '5511999999999@s.whatsapp.net', preview: false });
    expect(picture.url).toBe('https://pps.whatsapp.net/v/t61.24694-24/fake-avatar.jpg');
    expect(picture).toHaveProperty('raw');
  });

  it('contacts.getProfilePicture propaga o erro HTTP quando o contato não tem foto (sem capturar/mascarar)', async () => {
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/avatar') {
        return jsonResponse(404, { error: 'no avatar found for this jid' });
      }
      return createFetchStub()(input, init);
    };

    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: fetchStub,
    });
    const wa = createConnector(adapter);

    const failure = await wa.contacts
      .getProfilePicture('5511999999999@s.whatsapp.net')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error & { code?: string }).code).toBe('PROVIDER_ERROR');
  });

  it('contacts.block envia POST /user/block com {number} e ignora o retorno data.JIDs (Promise<void>)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/block') {
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

    const result = await wa.contacts.block('5511999999999@s.whatsapp.net');

    expect(capturedBody).toEqual({ number: '5511999999999@s.whatsapp.net' });
    expect(result).toBeUndefined();
  });

  it('contacts.unblock envia POST /user/unblock com {number} e ignora o retorno data.JIDs (Promise<void>)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/user/unblock') {
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

    const result = await wa.contacts.unblock('5511999999999@s.whatsapp.net');

    expect(capturedBody).toEqual({ number: '5511999999999@s.whatsapp.net' });
    expect(result).toBeUndefined();
  });

  it('contacts.listBlocked envia GET /user/blocklist e mapeia data.JIDs para string[]', async () => {
    const adapter = evolution({
      baseUrl: FAKE_BASE_URL,
      apiKey: FAKE_INSTANCE_TOKEN,
      fetch: createFetchStub(),
    });
    const wa = createConnector(adapter);

    const blocked = await wa.contacts.listBlocked();

    expect(blocked).toEqual(['5511999999999@s.whatsapp.net', '5511988887777@s.whatsapp.net']);
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

  it('parseWebhook normaliza evento "GroupInfo" (Join) para group.update com action "participants.add"', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: groupParticipantsAddFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe('123456789-987654321@g.us');
      expect(event.action).toBe('participants.add');
      expect(event.participants).toEqual([
        '5511988887777@s.whatsapp.net',
        '5511977776666@s.whatsapp.net',
      ]);
    }
  });

  it('parseWebhook normaliza evento "GroupInfo" com MÚLTIPLAS mudanças simultâneas (Join + Promote) em UM GroupUpdateEvent por mudança', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: groupMultipleChangesFixture });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.type === 'group.update')).toBe(true);

    const add = events.find(
      (event) => event.type === 'group.update' && event.action === 'participants.add',
    );
    const promote = events.find(
      (event) => event.type === 'group.update' && event.action === 'participants.promote',
    );

    expect(add && add.type === 'group.update' ? add.participants : undefined).toEqual([
      '5511988887777@s.whatsapp.net',
    ]);
    expect(promote && promote.type === 'group.update' ? promote.participants : undefined).toEqual([
      '5511977776666@s.whatsapp.net',
    ]);
    for (const event of events) {
      if (event.type === 'group.update') {
        expect(event.groupId).toBe('123456789-987654321@g.us');
      }
    }
  });

  it('parseWebhook normaliza evento "GroupInfo" (Name populado) para group.update com action "subject", sem popular participants', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: groupSubjectUpdateFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe('123456789-987654321@g.us');
      expect(event.action).toBe('subject');
      expect(event.participants).toBeUndefined();
    }
  });

  it('parseWebhook normaliza evento "GroupInfo" sem nenhuma mudança reconhecida (ex.: só Locked) para unknown, sem inventar action', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({
      body: {
        event: 'GroupInfo',
        data: {
          JID: '123456789-987654321@g.us',
          Locked: { IsLocked: true },
        },
        instanceId: '249aad2e-68f9-464f-bc84-aca560c38f0e',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook normaliza evento "JoinedGroup" (a própria sessão entrou no grupo) para group.update com action "participants.add"', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });
    const events = adapter.parseWebhook({ body: groupJoinedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe('123456789-987654321@g.us');
      expect(event.action).toBe('participants.add');
      expect(event.participants).toBeUndefined();
    }
  });

  it('parseWebhook cai em unknown quando "GroupInfo"/"JoinedGroup" vêm sem "data.JID"', () => {
    const adapter = evolution({ baseUrl: FAKE_BASE_URL, apiKey: FAKE_INSTANCE_TOKEN });

    const groupInfoEvents = adapter.parseWebhook({
      body: { event: 'GroupInfo', data: { Join: ['5511988887777@s.whatsapp.net'] } },
    });
    expect(groupInfoEvents).toHaveLength(1);
    expect(groupInfoEvents[0]?.type).toBe('unknown');

    const joinedGroupEvents = adapter.parseWebhook({
      body: { event: 'JoinedGroup', data: { Reason: 'invite' } },
    });
    expect(joinedGroupEvents).toHaveLength(1);
    expect(joinedGroupEvents[0]?.type).toBe('unknown');
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
