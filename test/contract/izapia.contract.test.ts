import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type IzapiaOptions, izapia } from '../../src/adapters/izapia';
import messageReceivedFixture from '../../src/adapters/izapia/fixtures/webhook-message-received.json';
import { describeAdapterContract } from './adapter-contract';

const BASE_URL = 'https://contrato.izapia.com';
const API_KEY = 'api-key-de-teste-nao-real';
const SID = '8f14e45f-ceea-467e-a5c9-5f0d3a4c1b2e';

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas equivalentes às reais do
 * izapia (envelope `{ok, data}` — ver docs/providers/izapia.md), sem rede real.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/pair`) {
      return envelope({ code: '2@fake-qr-code', qr_png_base64: 'ZmFrZS1xcg==' });
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}`) {
      return envelope({
        id: SID,
        name: 'contrato',
        jid: '5511999999999@s.whatsapp.net',
        status: 'connected',
      });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/logout`) {
      return envelope({ id: SID, status: 'logged_out' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/text`) {
      return envelope({ message_id: '3EB0FAKE0000000000TEXT' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/media`) {
      return envelope({ message_id: '3EB0FAKE0000000000MEDIA' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/react`) {
      return envelope({ message_id: '3EB0FAKE0000000000REACT' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/edit`) {
      return envelope({ message_id: '3EB0FAKE0000000000EDIT' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/delete`) {
      return envelope({ message_id: '3EB0FAKE0000000000ORIGINAL' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/star`) {
      return envelope({});
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/pin`) {
      return envelope({ message_id: '3EB0FAKE0000000000PIN' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/read`) {
      return envelope({});
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/location`) {
      return envelope({ message_id: '3EB0FAKE0000000000LOCATION' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/contact`) {
      return envelope({ message_id: '3EB0FAKE0000000000CONTACT' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/messages/poll`) {
      return envelope({ message_id: '3EB0FAKE0000000000POLL' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/groups`) {
      return envelope({
        group_id: '120363012345678901@g.us',
        subject: 'Grupo de teste',
        description: '',
        owner: '5511999999999@s.whatsapp.net',
        created: 1784289600,
        participants: [
          { jid: '5511999999999@s.whatsapp.net', is_admin: true, is_super_admin: true },
          { jid: '5511988887777@s.whatsapp.net', is_admin: false, is_super_admin: false },
        ],
      });
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us`) {
      return envelope({
        group_id: '120363012345678901@g.us',
        subject: 'Grupo de teste',
        description: 'Descrição do grupo',
        owner: '5511999999999@s.whatsapp.net',
        created: 1784289600,
        participants: [
          { jid: '5511999999999@s.whatsapp.net', is_admin: true, is_super_admin: true },
        ],
      });
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}/groups`) {
      return envelope([
        {
          group_id: '120363012345678901@g.us',
          subject: 'Grupo de teste',
          participants: [
            { jid: '5511999999999@s.whatsapp.net', is_admin: true, is_super_admin: true },
          ],
        },
      ]);
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/participants`
    ) {
      return envelope({
        participants: [
          { jid: '5511988887777@s.whatsapp.net', is_admin: false, is_super_admin: false },
        ],
      });
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/subject`
    ) {
      return envelope({});
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/description`
    ) {
      return envelope({});
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/picture`
    ) {
      return envelope({ ok: true, picture_id: 'pic-1' });
    }

    if (
      method === 'GET' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/invite`
    ) {
      return envelope({ invite_link: 'https://chat.whatsapp.com/ABC123FAKE' });
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/invite/revoke`
    ) {
      return envelope({ invite_link: 'https://chat.whatsapp.com/NEWCODE456' });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/groups/join`) {
      return envelope({ group_id: '120363012345678901@g.us' });
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/leave`
    ) {
      return envelope({});
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}/contacts`) {
      return envelope([
        {
          jid: '5511999999999@s.whatsapp.net',
          full_name: 'Fulano da Silva',
          push_name: 'Fulano',
          found: true,
        },
      ]);
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}/contacts/5511999999999`) {
      return envelope({
        jid: '5511999999999@s.whatsapp.net',
        full_name: 'Fulano da Silva',
        push_name: 'Fulano',
        found: true,
        about: 'Disponível',
        devices: ['5511999999999.0:1@s.whatsapp.net'],
      });
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/contacts/check`) {
      return envelope([
        { query: '5511999999999', jid: '5511999999999@s.whatsapp.net', is_in_whatsapp: true },
      ]);
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}/contacts/5511999999999/picture`) {
      return envelope({
        url: 'https://cdn.izapia-fake.test/foto.jpg',
        id: 'pic-1',
        type: 'image',
        direct_path: '/v/foto.jpg',
      });
    }

    if (
      method === 'POST' &&
      (pathname === `/api/v1/sessions/${SID}/contacts/5511999999999/block` ||
        pathname === `/api/v1/sessions/${SID}/contacts/5511999999999/unblock`)
    ) {
      return envelope({});
    }

    if (method === 'GET' && pathname === `/api/v1/sessions/${SID}/contacts/blocked`) {
      return envelope([{ jid: '5511988887777@s.whatsapp.net' }]);
    }

    if (
      method === 'POST' &&
      /^\/api\/v1\/sessions\/[^/]+\/chats\/[^/]+\/(archive|mute|pin|read)$/.test(pathname)
    ) {
      return envelope({});
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/presence/typing`) {
      return envelope({});
    }

    if (method === 'POST' && pathname === `/api/v1/sessions/${SID}/presence`) {
      return envelope({});
    }

    if (
      method === 'POST' &&
      pathname === `/api/v1/sessions/${SID}/presence/5511999999999/subscribe`
    ) {
      return envelope({});
    }

    throw new Error(`fetchStub (izapia): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<IzapiaOptions> = {}): IzapiaOptions {
  return {
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    sid: SID,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'izapia',
  create() {
    const adapter = izapia(buildAdapterOptions());
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

describe('izapia adapter: comportamento específico do provider', () => {
  it('instance.connect chama POST /pair e devolve o qr de qr_png_base64', async () => {
    const adapter = izapia(buildAdapterOptions());
    const result = await adapter.instance.connect();
    expect(result.qr).toBe('ZmFrZS1xcg==');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia "connected" para o InstanceState canônico', async () => {
    const adapter = izapia(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  it.each([
    ['created', 'disconnected'],
    ['pairing', 'qr'],
    ['connected', 'connected'],
    ['disconnected', 'connecting'],
    ['logged_out', 'disconnected'],
    ['algo-novo-nao-documentado', 'unknown'],
  ] as const)('instance.status mapeia status="%s" para "%s"', async (providerStatus, expected) => {
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}`) {
            return envelope({ id: SID, name: 'contrato', status: providerStatus });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const status = await adapter.instance.status();
    expect(status.state).toBe(expected);
  });

  it('instance.logout chama POST /logout sem lançar', async () => {
    const calls: string[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(calls).toContain(`POST /api/v1/sessions/${SID}/logout`);
  });

  it('messages.sendText envia { to, text } e mapeia message_id', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/text`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({ to: '5511999999999', text: 'contrato: ping' });

    expect(capturedBody?.to).toBe('5511999999999');
    expect(capturedBody?.text).toBe('contrato: ping');
    expect(sent.id).toBe('3EB0FAKE0000000000TEXT');
    expect(sent.chatId).toBe('5511999999999');
  });

  it('messages.sendMedia envia "url" quando presente, sem "base64"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/media`) {
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

    expect(capturedBody?.to).toBe('5511999999999');
    expect(capturedBody?.kind).toBe('image');
    expect(capturedBody?.url).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.base64).toBeUndefined();
    expect(capturedBody?.mimetype).toBe('image/jpeg');
    expect(capturedBody?.caption).toBe('legenda');
    expect(sent.id).toBe('3EB0FAKE0000000000MEDIA');
  });

  it('messages.sendMedia usa "base64" quando media.url está ausente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/media`) {
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

    expect(capturedBody?.base64).toBe('ZmFrZS1pbWFnZW0=');
    expect(capturedBody?.url).toBeUndefined();
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.messages
      .sendMedia({ to: '5511999999999', media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('envia o header Authorization: Bearer <apiKey> em toda chamada', async () => {
    const calls: Headers[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );
    await adapter.instance.status();
    expect(calls[0]?.get('authorization')).toBe(`Bearer ${API_KEY}`);
  });

  it('redige a API key de mensagens de erro (HttpClient secrets)', async () => {
    const adapter = izapia(
      buildAdapterOptions({
        apiKey: 'super-secret-key',
        fetch: async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'AUTH_FAILED', message: 'bad key super-secret-key' },
            }),
            {
              status: 401,
              headers: { 'content-type': 'application/json' },
            },
          ),
      }),
    );
    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain('super-secret-key');
      expect(failure.message).toContain('***');
      expect(failure.code).toBe('AUTH_FAILED');
    }
  });

  it('messages.sendReaction envia "reaction" (emoji) e mapeia message_id', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/react`) {
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

    expect(capturedBody?.message_id).toBe('3EB0538DA65A59F6D8A251');
    expect(capturedBody?.reaction).toBe('👍');
    expect(sent.id).toBe('3EB0FAKE0000000000REACT');
  });

  it('messages.sendReaction envia "reaction" vazia para remover uma reação já enviada', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/react`) {
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

    expect(capturedBody?.reaction).toBe('');
  });

  it('messages.edit envia { to, message_id, text } e mapeia o novo message_id', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const sent = await wa.messages.edit?.({
      to: '5511999999999',
      messageId: '3EB0ORIGINAL',
      text: 'texto editado',
    });
    expect(sent?.id).toBe('3EB0FAKE0000000000EDIT');
  });

  it('messages.delete envia { to, message_id }', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/delete`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.delete?.({ to: '5511999999999', messageId: '3EB0ORIGINAL' }),
    ).resolves.toBeUndefined();
    expect(capturedBody?.message_id).toBe('3EB0ORIGINAL');
  });

  it('messages.star/unstar enviam "starred" true/false para POST .../messages/star', async () => {
    const capturedStarred: unknown[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/star`) {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            capturedStarred.push(body.starred);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.star?.({ to: '5511999999999', messageId: '3EB0ORIGINAL' });
    await wa.messages.unstar?.({ to: '5511999999999', messageId: '3EB0ORIGINAL' });
    expect(capturedStarred).toEqual([true, false]);
  });

  it('messages.pin/unpin enviam "pinned" true/false para POST .../messages/pin', async () => {
    const capturedPinned: unknown[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/pin`) {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            capturedPinned.push(body.pinned);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.pin?.({ to: '5511999999999', messageId: '3EB0ORIGINAL' });
    await wa.messages.unpin?.({ to: '5511999999999', messageId: '3EB0ORIGINAL' });
    expect(capturedPinned).toEqual([true, false]);
  });

  it('messages.markRead envia { to, message_ids: [messageId] } (array de 1 elemento)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/read`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.markRead?.({ to: '5511999999999', messageId: '3EB0ORIGINAL' }),
    ).resolves.toBeUndefined();
    expect(capturedBody?.message_ids).toEqual(['3EB0ORIGINAL']);
  });

  it('messages.sendLocation envia latitude/longitude/name/address', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/location`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendLocation?.({
      to: '5511999999999',
      latitude: -3.7327,
      longitude: -38.527,
      name: 'Praia de Iracema',
      address: 'Fortaleza, CE',
    });
    expect(capturedBody).toEqual({
      to: '5511999999999',
      latitude: -3.7327,
      longitude: -38.527,
      name: 'Praia de Iracema',
      address: 'Fortaleza, CE',
    });
    expect(sent?.id).toBe('3EB0FAKE0000000000LOCATION');
  });

  it('messages.sendContactCard mapeia contactName/contactPhone para display_name/phone', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/contact`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendContactCard?.({
      to: '5511999999999',
      contactName: 'Fulano de Tal',
      contactPhone: '5511988887777',
    });
    expect(capturedBody?.display_name).toBe('Fulano de Tal');
    expect(capturedBody?.phone).toBe('5511988887777');
    expect(sent?.id).toBe('3EB0FAKE0000000000CONTACT');
  });

  it('messages.sendPoll omite "selectable_count" por padrão (escolha única)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/poll`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendPoll?.({
      to: '5511999999999',
      question: 'Qual sua cor favorita?',
      options: ['Azul', 'Verde'],
    });
    expect(capturedBody?.name).toBe('Qual sua cor favorita?');
    expect(capturedBody?.options).toEqual(['Azul', 'Verde']);
    expect(capturedBody?.selectable_count).toBeUndefined();
    expect(sent?.id).toBe('3EB0FAKE0000000000POLL');
  });

  it('messages.sendPoll envia "selectable_count" igual ao total de opções quando allowMultipleAnswers é true', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/messages/poll`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendPoll?.({
      to: '5511999999999',
      question: 'Escolha quantas quiser',
      options: ['A', 'B', 'C'],
      allowMultipleAnswers: true,
    });
    expect(capturedBody?.selectable_count).toBe(3);
  });

  it('messages.forward não é declarado (izapia não guarda histórico para resolver o texto original)', () => {
    const adapter = izapia(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.forward');
    expect(adapter.messages.forward).toBeUndefined();
  });

  it('groups.create envia { subject, participants } e mapeia a resposta para GroupInfo', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === `/api/v1/sessions/${SID}/groups` &&
            (init?.method ?? 'GET') === 'POST'
          ) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.create?.({
      subject: 'Grupo de teste',
      participants: ['5511988887777'],
    });

    expect(capturedBody?.subject).toBe('Grupo de teste');
    expect(capturedBody?.participants).toEqual(['5511988887777']);
    expect(group?.id).toBe('120363012345678901@g.us');
    expect(group?.subject).toBe('Grupo de teste');
    expect(group?.owner).toBe('5511999999999@s.whatsapp.net');
    expect(group?.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.getInfo consulta GET .../groups/{groupId} e mapeia GroupInfo', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo?.('120363012345678901@g.us');

    expect(group?.id).toBe('120363012345678901@g.us');
    expect(group?.description).toBe('Descrição do grupo');
    expect(group?.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
    ]);
  });

  it('groups.list mapeia o array direto de "data" (sem wrapper) para GroupInfo[]', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.groups.list?.();

    expect(list).toHaveLength(1);
    expect(list?.[0]?.id).toBe('120363012345678901@g.us');
  });

  it('groups.addParticipants/removeParticipants/promoteParticipants/demoteParticipants usam o mesmo endpoint com "action" correto', async () => {
    const capturedActions: string[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/participants`
          ) {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            capturedActions.push(String(body.action));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const input = { groupId: '120363012345678901@g.us', participants: ['5511988887777'] };
    await wa.groups.addParticipants?.(input);
    await wa.groups.removeParticipants?.(input);
    await wa.groups.promoteParticipants?.(input);
    await wa.groups.demoteParticipants?.(input);

    expect(capturedActions).toEqual(['add', 'remove', 'promote', 'demote']);
  });

  it('groups.updateSubject/updateDescription enviam os campos esperados', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateSubject?.({ groupId: '120363012345678901@g.us', subject: 'Novo nome' }),
    ).resolves.toBeUndefined();
    await expect(
      wa.groups.updateDescription?.({ groupId: '120363012345678901@g.us', description: '' }),
    ).resolves.toBeUndefined();
  });

  it('groups.updatePicture envia "url" ou "base64" conforme MediaRef', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/groups/120363012345678901@g.us/picture`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updatePicture?.({
      groupId: '120363012345678901@g.us',
      media: { kind: 'image', base64: 'ZmFrZQ==', mimeType: 'image/png' },
    });
    expect(capturedBody?.base64).toBe('ZmFrZQ==');
    expect(capturedBody?.mimetype).toBe('image/png');
    expect(capturedBody?.url).toBeUndefined();
  });

  it('groups.getInviteLink/revokeInviteLink devolvem o link completo de "invite_link"', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const link = await wa.groups.getInviteLink?.('120363012345678901@g.us');
    expect(link?.link).toBe('https://chat.whatsapp.com/ABC123FAKE');
    const revoked = await wa.groups.revokeInviteLink?.('120363012345678901@g.us');
    expect(revoked?.link).toBe('https://chat.whatsapp.com/NEWCODE456');
  });

  it('groups.joinViaInviteLink envia o link completo em "link"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/groups/join`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink?.({ invite: 'https://chat.whatsapp.com/ABC123FAKE' });
    expect(capturedBody?.link).toBe('https://chat.whatsapp.com/ABC123FAKE');
  });

  it('groups.leaveGroup chama POST .../leave sem lançar', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    await expect(wa.groups.leaveGroup?.('120363012345678901@g.us')).resolves.toBeUndefined();
  });

  it('contacts.list mapeia o array direto de "data" (sem wrapper) para Contact[]', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.contacts.list?.();

    expect(list).toEqual([
      {
        id: '5511999999999@s.whatsapp.net',
        name: 'Fulano da Silva',
        about: undefined,
        raw: expect.anything(),
      },
    ]);
  });

  it('contacts.get devolve name/about/id a partir de GET .../contacts/{jid} (about já embutido)', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get?.('5511999999999');

    expect(contact?.id).toBe('5511999999999@s.whatsapp.net');
    expect(contact?.name).toBe('Fulano da Silva');
    expect(contact?.about).toBe('Disponível');
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.getAbout reaproveita GET .../contacts/{jid} (mesma chamada de contacts.get)', async () => {
    const calls: string[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout?.('5511999999999');

    expect(about?.about).toBe('Disponível');
    expect(
      calls.filter((call) => call === `GET /api/v1/sessions/${SID}/contacts/5511999999999`),
    ).toHaveLength(1);
  });

  it('contacts.checkExists envia { numbers: [phone] } e mapeia is_in_whatsapp/jid', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/contacts/check`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists?.('5511999999999');

    expect(capturedBody?.numbers).toEqual(['5511999999999']);
    expect(result?.exists).toBe(true);
    expect(result?.chatId).toBe('5511999999999@s.whatsapp.net');
  });

  it('contacts.getProfilePicture devolve "url" de GET .../contacts/{jid}/picture', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture?.('5511999999999');
    expect(picture?.url).toBe('https://cdn.izapia-fake.test/foto.jpg');
  });

  it('contacts.block/unblock chamam os endpoints correspondentes sem lançar', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    await expect(wa.contacts.block?.('5511999999999')).resolves.toBeUndefined();
    await expect(wa.contacts.unblock?.('5511999999999')).resolves.toBeUndefined();
  });

  it('contacts.listBlocked mapeia o array direto de "data" para string[] de jids', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    const blocked = await wa.contacts.listBlocked?.();
    expect(blocked).toEqual(['5511988887777@s.whatsapp.net']);
  });

  it.each([
    ['archive', true, 'archived'],
    ['unarchive', false, 'archived'],
    ['mute', true, 'muted'],
    ['unmute', false, 'muted'],
    ['pin', true, 'pinned'],
    ['unpin', false, 'pinned'],
    ['markRead', true, 'read'],
    ['markUnread', false, 'read'],
  ] as const)('chats.%s envia { %s: %s } para o endpoint correto', async (method, expected, field) => {
    let capturedBody: Record<string, unknown> | undefined;
    const endpointByField: Record<string, string> = {
      archived: 'archive',
      muted: 'mute',
      pinned: 'pin',
      read: 'read',
    };
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith(`/chats/5511999999999/${endpointByField[field]}`)) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats?.[method]?.('5511999999999')).resolves.toBeUndefined();
    expect(capturedBody?.[field]).toBe(expected);
  });

  it('presence.setTyping envia state="composing" para "composing" e "paused" para "paused"', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/presence/typing`) {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.presence?.setTyping?.({ to: '5511999999999', state: 'composing' });
    await wa.presence?.setTyping?.({ to: '5511999999999', state: 'paused' });

    expect(capturedBodies[0]).toEqual({ to: '5511999999999', state: 'composing' });
    expect(capturedBodies[1]).toEqual({ to: '5511999999999', state: 'paused' });
  });

  it('presence.setTyping mapeia "recording" para state="composing" + media="audio"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/presence/typing`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.presence?.setTyping?.({ to: '5511999999999', state: 'recording' });
    expect(capturedBody).toEqual({ to: '5511999999999', state: 'composing', media: 'audio' });
  });

  it('presence.set mapeia "online"/"offline" para "available"/"unavailable"', async () => {
    const capturedStates: unknown[] = [];
    const adapter = izapia(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `/api/v1/sessions/${SID}/presence`) {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            capturedStates.push(body.state);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.presence?.set?.('online');
    await wa.presence?.set?.('offline');
    expect(capturedStates).toEqual(['available', 'unavailable']);
  });

  it('presence.subscribe chama POST .../presence/{jid}/subscribe sem lançar', async () => {
    const adapter = izapia(buildAdapterOptions());
    const wa = createConnector(adapter);
    await expect(wa.presence?.subscribe?.('5511999999999')).resolves.toBeUndefined();
  });

  it('parseWebhook normaliza "session.connected" para connection.update', () => {
    const adapter = izapia(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event_id: 'evt_1',
        type: 'session.connected',
        session_id: SID,
        tenant_id: 'tenant-1',
        data: { jid: '5511999999999@s.whatsapp.net' },
      },
    });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
      expect(event.instanceId).toBe(SID);
    }
  });

  it('parseWebhook normaliza "message.ack" para message.ack', () => {
    const adapter = izapia(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event_id: 'evt_2',
        type: 'message.ack',
        session_id: SID,
        tenant_id: 'tenant-1',
        data: {
          message_ids: ['3EB0C767D26A8A5F1234'],
          status: 'read',
          from: '5511988887777@s.whatsapp.net',
          chat: '5511988887777@s.whatsapp.net',
          timestamp: 1784289700,
        },
      },
    });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('3EB0C767D26A8A5F1234');
      expect(event.chatId).toBe('5511988887777@s.whatsapp.net');
      expect(event.ack).toBe('read');
    }
  });

  it('parseWebhook normaliza evento de mensagem recebida, incluindo timestamp em ms', () => {
    const adapter = izapia(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.id).toBe('3EB0C767D26A8A5F1234');
      expect(event.message.chatId).toBe('5511988887777@s.whatsapp.net');
      expect(event.message.text).toBe('Oi, tudo bem?');
      expect(event.message.timestamp).toBe(1784289650000);
      expect(event.message.fromMe).toBe(false);
    }
  });

  it('parseWebhook evento não mapeado (ex.: presence.update) vira "unknown"', () => {
    const adapter = izapia(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: {
        event_id: 'evt_3',
        type: 'presence.update',
        session_id: SID,
        tenant_id: 'tenant-1',
        data: {},
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = izapia(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { sem: 'campo-type' } })).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });
});
