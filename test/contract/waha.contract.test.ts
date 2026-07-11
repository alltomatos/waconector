import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError, type SentMessage } from '../../src';
import { type WahaOptions, waha } from '../../src/adapters/waha';
import ackFixture from '../../src/adapters/waha/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/waha/fixtures/webhook-connection-update.json';
import hmacValidFixture from '../../src/adapters/waha/fixtures/webhook-hmac-valid.json';
import messageReceivedFixture from '../../src/adapters/waha/fixtures/webhook-message-received.json';
import { describeAdapterContract } from './adapter-contract';

const BASE_URL = 'https://waha.example.com';
const API_KEY = 'test-api-key-should-be-redacted';
const SESSION = 'default';
/** JID de grupo usado nos testes de `groups.*` — mesmo formato `<dígitos>@g.us` da doc oficial. */
const GROUP_ID = '120363043140393908@g.us';
/** `encodeURIComponent(GROUP_ID)` — usado para casar o pathname exato batido pelo adapter. */
const GROUP_ID_ENCODED = '120363043140393908%40g.us';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stub de `fetch` sem rede real: responde com payloads fixos equivalentes aos reais (baseados no
 * dossiê docs/providers/waha.md) para os endpoints usados por esta fase do adapter.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    if (method === 'POST' && pathname === `/api/sessions/${SESSION}/start`) {
      return jsonResponse(201, { name: SESSION, status: 'STARTING' });
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/auth/qr`) {
      expect(url.searchParams.get('format')).toBe('raw');
      return jsonResponse(200, { value: 'mock-qr-code-raw-string' });
    }

    if (method === 'GET' && pathname === `/api/sessions/${SESSION}`) {
      return jsonResponse(200, {
        name: SESSION,
        status: 'WORKING',
        me: { id: '71111111111@c.us', pushName: 'Bot' },
      });
    }

    if (method === 'POST' && pathname === `/api/sessions/${SESSION}/logout`) {
      return new Response(null, { status: 204 });
    }

    if (method === 'POST' && pathname === '/api/sendText') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKSENDTEXT000000000000001',
        timestamp: 1700000010,
        from: '71111111111@c.us',
        to: '5585999999999@c.us',
        fromMe: true,
        body: 'contrato: ping',
        ack: 0,
      });
    }

    if (method === 'POST' && pathname === '/api/sendImage') {
      return jsonResponse(201, {
        id: 'true_5585999999999@c.us_MOCKSENDIMAGE00000000000001',
        timestamp: 1700000020,
        from: '71111111111@c.us',
        to: '5585999999999@c.us',
        fromMe: true,
        hasMedia: true,
        ack: 0,
      });
    }

    if (method === 'PUT' && pathname === '/api/reaction') {
      // Resposta real documentada como `object` genérico/vazio no openapi.json — sem campos.
      return jsonResponse(200, {});
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/groups`) {
      // Resposta 201 SEM schema declarado na doc oficial (gap do próprio WAHA) — devolve só
      // "id"/"subject", sem "participants", para exercitar o fallback de mapGroupInfo.
      return jsonResponse(201, {
        id: GROUP_ID,
        subject: 'Contrato: Grupo Teste',
      });
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}`) {
      // Schema inferido por cross-reference com o webhook group.v2.join (ver docs/providers/waha.md).
      return jsonResponse(200, {
        id: GROUP_ID,
        subject: 'Contrato: Grupo Teste',
        description: 'Descrição do grupo de teste',
        invite: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
        membersCanAddNewMember: false,
        membersCanSendMessages: true,
        newMembersApprovalRequired: false,
        participants: [
          { id: '5585999999999@c.us', role: 'admin' },
          // Participante devolvido como @lid (privacidade), com o formato real @c.us em "pn".
          { id: 'ANONYMIZEDLIDPLACEHOLDER@lid', pn: '5585888888888@c.us', role: 'participant' },
        ],
      });
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/groups`) {
      return jsonResponse(200, [
        {
          id: GROUP_ID,
          subject: 'Contrato: Grupo Teste',
          participants: [{ id: '5585999999999@c.us', role: 'superadmin' }],
        },
      ]);
    }

    if (method === 'GET' && pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code`) {
      // Resposta real (openapi.json): STRING PURA (schema type: string), o código bare.
      return jsonResponse(200, 'ABCDEFGHIJKLMNOPQRSTUV');
    }

    // Checado ANTES do catch-all genérico de POST abaixo (que também bate em
    // `/api/{session}/groups/{id}/...`) — senão invite-code/revoke e leave nunca seriam alcançados.
    if (
      method === 'POST' &&
      pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code/revoke`
    ) {
      // Mesmo shape de resposta de invite-code: string pura, o novo código bare.
      return jsonResponse(200, 'ZYXWVUTSRQPONMLKJIHGFE');
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/groups/join`) {
      // Resposta confirmada: { id } (id do grupo ingressado) — ignorada, contrato retorna void.
      return jsonResponse(200, { id: GROUP_ID });
    }

    if (method === 'POST' && pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/leave`) {
      return new Response(null, { status: 204 });
    }

    if (method === 'POST' && pathname.startsWith(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/`)) {
      // addParticipants/removeParticipants/promoteParticipants/demoteParticipants: contrato
      // devolve Promise<void>, resposta stub genérica basta.
      return jsonResponse(201, {});
    }

    if (
      method === 'PUT' &&
      (pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/subject` ||
        pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/description` ||
        pathname === `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/picture`)
    ) {
      // updateSubject/updateDescription/updatePicture: contrato devolve Promise<void>; a doc não
      // declara schema para subject/description, e picture devolve Result { success } (ignorado).
      return jsonResponse(200, { success: true });
    }

    throw new Error(`fetchStub: rota não configurada — ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<WahaOptions> = {}): WahaOptions {
  return {
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    session: SESSION,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'WAHA (waha.devlike.pro)',
  create() {
    const adapter = waha(buildAdapterOptions());
    return {
      adapter,
      // O adapter WAHA não guarda estado local de conexão: cada chamada bate direto no
      // provider, que é quem garante (ou nega) que a sessão está pronta para enviar.
      ready: async () => {},
      webhooks: {
        messageReceived: { body: messageReceivedFixture },
      },
      recipient: '5585999999999',
    };
  },
});

describe('WAHA adapter: comportamento específico do provider', () => {
  it('instance.connect inicia a sessão e devolve o QR cru em ConnectResult.qr', async () => {
    const adapter = waha(buildAdapterOptions());
    const result = await adapter.instance.connect();
    expect(result.qr).toBe('mock-qr-code-raw-string');
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia "WORKING" para InstanceState "connected"', async () => {
    const adapter = waha(buildAdapterOptions());
    const status = await adapter.instance.status();
    expect(status.state).toBe('connected');
    expect(status).toHaveProperty('raw');
  });

  it('instance.logout chama POST /api/sessions/{session}/logout sem lançar', async () => {
    const adapter = waha(buildAdapterOptions());
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
  });

  it('messages.sendText converte telefone canônico para chatId "@c.us"', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = waha(
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
    const sent: SentMessage = await wa.messages.sendText({
      to: '5585999999999',
      text: 'contrato: ping',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.path).toBe('/api/sendText');
    expect((call?.body as Record<string, unknown> | undefined)?.chatId).toBe('5585999999999@c.us');
    expect(sent.id).toContain('MOCKSENDTEXT');
    expect(sent.timestamp).toBe(1700000010 * 1000);
  });

  it('messages.sendMedia usa o endpoint por tipo de mídia (image -> /api/sendImage)', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5585999999999',
      media: { kind: 'image', url: 'https://picsum.photos/200', mimeType: 'image/jpeg' },
      caption: 'foto de teste',
    });

    expect(sent.id).toContain('MOCKSENDIMAGE');
    expect(sent.chatId).toBe('5585999999999@c.us');
  });

  it('messages.sendReaction chama PUT /api/reaction com { session, messageId, reaction }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent: SentMessage = await wa.messages.sendReaction({
      to: '5585999999999',
      messageId: 'false_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA',
      emoji: '👍',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe('/api/reaction');
    expect(call?.body).toEqual({
      session: SESSION,
      messageId: 'false_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA',
      reaction: '👍',
    });
    // Resposta stub não ecoa id/chatId (objeto genérico/vazio) -> mapSentMessage cai no fallback.
    expect(sent.id).toContain('waha-');
    expect(sent.chatId).toBe('5585999999999@c.us');
  });

  it('messages.sendReaction com emoji vazio envia "reaction": "" (remove reação, ADR-0008)', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendReaction({
      to: '5585999999999',
      messageId: 'false_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA',
      emoji: '',
    });

    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as Record<string, unknown> | undefined)?.reaction).toBe('');
  });

  it('groups.create converte participantes para {id} e envia { name, participants } para POST /api/{session}/groups', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = waha(
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
    const group = await wa.groups.create({
      subject: 'Contrato: Grupo Teste',
      participants: ['5585999999999', '5585888888888'],
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.path).toBe(`/api/${SESSION}/groups`);
    expect(call?.body).toEqual({
      name: 'Contrato: Grupo Teste',
      participants: [{ id: '5585999999999@c.us' }, { id: '5585888888888@c.us' }],
    });

    // Resposta stub não ecoa "participants" (gap real da doc do WAHA para este endpoint) ->
    // mapGroupInfo cai de volta para os participantes de entrada.
    expect(group.id).toBe(GROUP_ID);
    expect(group.subject).toBe('Contrato: Grupo Teste');
    expect(group.participants).toEqual([
      { id: '5585999999999', isAdmin: false, isSuperAdmin: false },
      { id: '5585888888888', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.getInfo converte groupId para "@g.us" no path e mapeia o schema WAHA (id/pn/role) para GroupInfo', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo(GROUP_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}`);

    expect(group.id).toBe(GROUP_ID);
    expect(group.subject).toBe('Contrato: Grupo Teste');
    expect(group.description).toBe('Descrição do grupo de teste');
    // WAHA não expõe um campo de "dono" explícito neste schema (ver docs/providers/waha.md).
    expect(group.owner).toBeUndefined();
    expect(group.participants).toEqual([
      { id: '5585999999999@c.us', isAdmin: true, isSuperAdmin: false },
      // Veio como @lid na resposta (privacidade) -> "pn" (sempre @c.us) tem preferência sobre "id".
      { id: '5585888888888@c.us', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.list chama GET /api/{session}/groups e mapeia cada item para GroupInfo', async () => {
    const adapter = waha(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.groups.list();

    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(GROUP_ID);
    expect(list[0]?.participants).toEqual([
      { id: '5585999999999@c.us', isAdmin: true, isSuperAdmin: true },
    ]);
  });

  it('groups.addParticipants envia { participants: [{id}] } para POST .../groups/{id}/participants/add', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.addParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/participants/add`);
    expect(call?.body).toEqual({ participants: [{ id: '5585999999999@c.us' }] });
  });

  it('groups.removeParticipants/promoteParticipants/demoteParticipants usam os endpoints dedicados (participants/remove, admin/promote, admin/demote)', async () => {
    const calls: string[] = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new URL(String(input)).pathname);
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.groups.removeParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] });
    await wa.groups.promoteParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] });
    await wa.groups.demoteParticipants({ groupId: GROUP_ID, participants: ['5585999999999'] });

    expect(calls).toEqual([
      `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/participants/remove`,
      `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/admin/promote`,
      `/api/${SESSION}/groups/${GROUP_ID_ENCODED}/admin/demote`,
    ]);
  });

  it('groups.updateSubject envia PUT .../groups/{id}/subject com { subject }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateSubject({ groupId: GROUP_ID, subject: 'Novo assunto' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/subject`);
    expect(call?.body).toEqual({ subject: 'Novo assunto' });
  });

  it('groups.updateDescription envia PUT .../groups/{id}/description com { description }', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({ groupId: GROUP_ID, description: 'Nova descrição' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/description`);
    expect(call?.body).toEqual({ description: 'Nova descrição' });
  });

  it('groups.updateDescription com description vazia é um caso válido (limpa a descrição), não erro', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({ groupId: GROUP_ID, description: '' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as Record<string, unknown> | undefined)?.description).toBe('');
  });

  it('groups.updatePicture com media.url monta ProfilePictureRequest RemoteFile {mimetype, filename, url}', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updatePicture({
        groupId: GROUP_ID,
        media: {
          kind: 'image',
          url: 'https://picsum.photos/200',
          mimeType: 'image/png',
          filename: 'foto.png',
        },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/picture`);
    expect(call?.body).toEqual({
      file: { mimetype: 'image/png', filename: 'foto.png', url: 'https://picsum.photos/200' },
    });
  });

  it('groups.updatePicture com media.base64 (sem url) monta ProfilePictureRequest BinaryFile {mimetype, filename, data} e usa "image/jpeg" como mimetype-padrão', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updatePicture({
        groupId: GROUP_ID,
        media: { kind: 'image', base64: 'ZmFrZS1pbWFnZS1ieXRlcw==' },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      file: { mimetype: 'image/jpeg', filename: undefined, data: 'ZmFrZS1pbWFnZS1ieXRlcw==' },
    });
  });

  it('groups.getInviteLink chama GET .../invite-code e monta o link completo a partir do código bare devolvido', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const invite = await wa.groups.getInviteLink(GROUP_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code`);

    // O provider devolve só o código bare ("ABCDEFGHIJKLMNOPQRSTUV") -> o adapter monta o link
    // completo (GroupInviteLink.link é sempre https://chat.whatsapp.com/<código>, ver ADR-0009).
    expect(invite.link).toBe('https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV');
    expect(invite).toHaveProperty('raw');
  });

  it('groups.revokeInviteLink chama POST .../invite-code/revoke e monta o link completo a partir do novo código bare', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const invite = await wa.groups.revokeInviteLink(GROUP_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/invite-code/revoke`);
    expect(invite.link).toBe('https://chat.whatsapp.com/ZYXWVUTSRQPONMLKJIHGFE');
    expect(invite).toHaveProperty('raw');
  });

  it('groups.joinViaInviteLink envia { code } para POST /api/{session}/groups/join com o LINK COMPLETO (conector já normaliza "invite")', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            method: (init?.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    // Entrada como CÓDIGO BARE — o conector normaliza para o link completo antes de o adapter
    // receber (WaConnector.prepareJoinViaInviteLink), e o adapter WAHA repassa o valor recebido
    // direto em "code" (a doc aceita ambos os formatos, então não usa extractInviteCode aqui).
    await expect(
      wa.groups.joinViaInviteLink({ invite: 'ABCDEFGHIJKLMNOPQRSTUV' }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe(`/api/${SESSION}/groups/join`);
    expect(call?.body).toEqual({
      code: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
    });
  });

  it('groups.joinViaInviteLink com o link completo como entrada repassa o mesmo link (idempotente)', async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink({
      invite: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
    });

    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as Record<string, unknown> | undefined)?.code).toBe(
      'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV',
    );
  });

  it('groups.leaveGroup chama POST /api/{session}/groups/{id}/leave sem lançar', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname });
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.groups.leaveGroup(GROUP_ID)).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/${SESSION}/groups/${GROUP_ID_ENCODED}/leave`);
  });

  it('parseWebhook normaliza "message.ack" do dossiê para MessageAckEvent', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.ack).toBe('read');
      expect(event.messageId).toBe('true_11111111111@c.us_4CC5EDD64BC22EBA6D639F2AF571346C');
    }
  });

  it('parseWebhook normaliza "session.status" do dossiê para ConnectionUpdateEvent', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: connectionUpdateFixture });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook nunca lança para payload desconhecido (vira "unknown")', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: { event: 'group.join', payload: {} } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');

    const eventsNonObject = adapter.parseWebhook({ body: 'não é json' });
    expect(eventsNonObject).toHaveLength(1);
    expect(eventsNonObject[0]?.type).toBe('unknown');
  });

  it('redige a apiKey de mensagens de erro (HttpClient secrets)', async () => {
    const adapter = waha(
      buildAdapterOptions({
        apiKey: 'super-secret-key',
        fetch: async () => jsonResponse(401, { error: 'bad key super-secret-key' }),
      }),
    );

    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain('super-secret-key');
      expect(failure.message).toContain('***');
    }
  });

  it('envia o header X-Api-Key configurado em toda chamada', async () => {
    const calls: Headers[] = [];
    const adapter = waha(
      buildAdapterOptions({
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          return createFetchStub()(input, init);
        },
      }),
    );

    await adapter.instance.status();
    expect(calls[0]?.get('X-Api-Key')).toBe(API_KEY);
  });
});

describe('WAHA adapter: verificação HMAC de webhooks (opt-in, ADR-0006)', () => {
  const { hmacKey, rawBody, signature } = hmacValidFixture;
  const parsedBody: unknown = JSON.parse(rawBody);

  /** Assinatura com o mesmo tamanho da válida, mas com o último caractere trocado. */
  function tamperedSignature(): string {
    const last = signature.at(-1) ?? '0';
    return `${signature.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  }

  it('(a) sem webhookHmacKey configurado, processa normalmente (comportamento atual, sem regressão)', () => {
    const adapter = waha(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: parsedBody });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message.received');
  });

  it('(b) com webhookHmacKey configurado e rawBody + assinatura válidos, processa normalmente', () => {
    const adapter = waha(buildAdapterOptions({ webhookHmacKey: hmacKey }));
    const events = adapter.parseWebhook({
      body: parsedBody,
      rawBody,
      headers: { 'x-webhook-hmac': signature },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message.received');
  });

  it('(c) com webhookHmacKey configurado e assinatura inválida (ou ausente), vira evento "unknown"', () => {
    const adapter = waha(buildAdapterOptions({ webhookHmacKey: hmacKey }));

    const eventsWrongSignature = adapter.parseWebhook({
      body: parsedBody,
      rawBody,
      headers: { 'x-webhook-hmac': tamperedSignature() },
    });
    expect(eventsWrongSignature).toHaveLength(1);
    expect(eventsWrongSignature[0]?.type).toBe('unknown');

    const eventsMissingSignature = adapter.parseWebhook({ body: parsedBody, rawBody });
    expect(eventsMissingSignature).toHaveLength(1);
    expect(eventsMissingSignature[0]?.type).toBe('unknown');
  });

  it('(d) com webhookHmacKey configurado mas rawBody ausente, vira evento "unknown" (falha fechada)', () => {
    const adapter = waha(buildAdapterOptions({ webhookHmacKey: hmacKey }));
    const events = adapter.parseWebhook({
      body: parsedBody,
      headers: { 'x-webhook-hmac': signature },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
    if (events[0]?.type === 'unknown') {
      expect(events[0].reason).toContain('rawBody');
    }
  });
});
