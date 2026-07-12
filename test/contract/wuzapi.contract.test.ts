import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type WuzapiOptions, wuzapi } from '../../src/adapters/wuzapi';
import ackFixture from '../../src/adapters/wuzapi/fixtures/webhook-ack.json';
import connectionUpdateFixture from '../../src/adapters/wuzapi/fixtures/webhook-connection-update.json';
import groupMetadataFixture from '../../src/adapters/wuzapi/fixtures/webhook-group-metadata.json';
import groupParticipantsFixture from '../../src/adapters/wuzapi/fixtures/webhook-group-participants.json';
import groupUnknownChangeFixture from '../../src/adapters/wuzapi/fixtures/webhook-group-unknown-change.json';
import joinedGroupFixture from '../../src/adapters/wuzapi/fixtures/webhook-joined-group.json';
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

    if (method === 'POST' && pathname === '/group/create') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          JID: '120363000000000000@g.us',
          Name: 'Grupo de teste',
          OwnerJID: '5511999999999@s.whatsapp.net',
          GroupCreated: '2026-07-11T12:00:00Z',
          Participants: [
            { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
            { JID: '5511988887777@s.whatsapp.net', IsAdmin: false, IsSuperAdmin: false },
          ],
        },
      });
    }

    if (method === 'GET' && pathname === '/group/info') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          JID: url.searchParams.get('groupJID'),
          OwnerJID: '5511999999999@s.whatsapp.net',
          Name: 'Grupo de teste',
          Topic: 'Descrição do grupo',
          IsLocked: false,
          GroupCreated: '2026-07-11T12:00:00Z',
          Participants: [
            { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
            { JID: '5511988887777@s.whatsapp.net', IsAdmin: false, IsSuperAdmin: false },
          ],
        },
      });
    }

    if (method === 'GET' && pathname === '/group/list') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          Groups: [
            {
              JID: '120363000000000000@g.us',
              OwnerJID: '5511999999999@s.whatsapp.net',
              Name: 'Grupo de teste',
              Topic: 'Descrição do grupo',
              Participants: [
                { JID: '5511999999999@s.whatsapp.net', IsAdmin: true, IsSuperAdmin: true },
              ],
            },
          ],
        },
      });
    }

    if (method === 'POST' && pathname === '/group/updateparticipants') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Group Participants updated successfully' },
      });
    }

    if (method === 'POST' && pathname === '/group/name') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Group Name set successfully' },
      });
    }

    if (method === 'POST' && pathname === '/group/topic') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Group Topic set successfully' },
      });
    }

    if (method === 'POST' && pathname === '/group/photo') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Group Photo set successfully', PictureID: 'contrato-picture-id' },
      });
    }

    if (method === 'GET' && pathname === '/group/invitelink') {
      const reset = url.searchParams.get('reset') === 'true';
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          InviteLink: reset
            ? 'https://chat.whatsapp.com/CONTRATO_NOVO_CODIGO'
            : 'CONTRATO_CODIGO_BARE',
        },
      });
    }

    if (method === 'POST' && pathname === '/group/join') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Group joined successfully' },
      });
    }

    if (method === 'POST' && pathname === '/group/leave') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Group left successfully' },
      });
    }

    if (method === 'GET' && pathname === '/user/contacts') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          '5511999999999@s.whatsapp.net': {
            Found: true,
            FirstName: 'Fulano',
            FullName: 'Fulano da Silva',
            PushName: 'Fulaninho',
          },
          '5511988887777@s.whatsapp.net': {
            Found: true,
            FirstName: 'Beltrano',
            PushName: 'Beltraninho',
          },
        },
      });
    }

    if (method === 'POST' && pathname === '/user/info') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          Users: {
            '5511999999999@s.whatsapp.net': {
              VerifiedName: '',
              Status: 'Disponível',
              PictureID: 'contrato-picture-id',
              Devices: [],
              LID: '',
            },
          },
        },
      });
    }

    if (method === 'POST' && pathname === '/user/check') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          Users: [
            {
              Query: '5511999999999',
              IsInWhatsapp: true,
              JID: '5511999999999@s.whatsapp.net',
              VerifiedName: '',
            },
          ],
        },
      });
    }

    if (method === 'POST' && pathname === '/user/avatar') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          url: 'https://pps.exemplo.test/foto.jpg',
          id: 'contrato-avatar-id',
          type: 'image',
          direct_path: '/v/contrato-direct-path',
          hash: 'contrato-hash',
        },
      });
    }

    if (method === 'POST' && pathname === '/user/block') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          Details: 'User blocked',
          JID: '5511988887777@s.whatsapp.net',
          Blocklist: ['5511988887777@s.whatsapp.net'],
          DHash: 'contrato-dhash',
        },
      });
    }

    if (method === 'POST' && pathname === '/user/unblock') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          Details: 'User unblocked',
          JID: '5511988887777@s.whatsapp.net',
          Blocklist: [],
          DHash: 'contrato-dhash',
        },
      });
    }

    if (method === 'GET' && pathname === '/user/blocklist') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          Blocklist: ['5511988887777@s.whatsapp.net'],
          DHash: 'contrato-dhash',
        },
      });
    }

    if (method === 'POST' && pathname === '/chat/send/edit') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Sent', Timestamp: 1751000003, Id: 'contrato-msg-editado' },
      });
    }

    if (method === 'POST' && pathname === '/chat/delete') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Deleted', Timestamp: 1751000004, Id: 'contrato-msg-apagada' },
      });
    }

    // messages.markRead (ADR-0013, nível de MENSAGEM): POST /chat/markread — distinto de
    // chats.markRead (não implementado neste adapter, ver dossiê).
    if (method === 'POST' && pathname === '/chat/markread') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { Details: 'Message(s) marked as read' },
      });
    }

    if (method === 'POST' && pathname === '/chat/archive') {
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: { success: true, message: 'Chat archived' },
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

  it('messages.edit envia { Phone, Body, Id } para POST /chat/send/edit e mapeia a resposta (Id ecoado, sem novo id)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/send/edit') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const edited = await wa.messages.edit({
      to: '5511999999999',
      messageId: 'contrato-msg-editado',
      text: 'texto editado',
    });

    expect(capturedBody).toEqual({
      Phone: '5511999999999',
      Body: 'texto editado',
      Id: 'contrato-msg-editado',
    });
    expect(edited.id).toBe('contrato-msg-editado');
    expect(edited.chatId).toBe('5511999999999');
    expect(edited.timestamp).toBe(1751000003 * 1000);
    expect(edited).toHaveProperty('raw');
  });

  it('messages.delete envia { Phone, Id } para POST /chat/delete (sempre revogação/"apagar para todos") e ignora a resposta', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/delete') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.messages.delete({
      to: '5511999999999',
      messageId: 'contrato-msg-apagada',
    });

    expect(capturedBody).toEqual({ Phone: '5511999999999', Id: 'contrato-msg-apagada' });
    expect(result).toBeUndefined();
  });

  it('messages.markRead envia { Id: [messageId], ChatPhone } (array, sem SenderPhone) para POST /chat/markread', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/markread') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.markRead({ to: '5511999999999', messageId: 'contrato-msg-lida' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ Id: ['contrato-msg-lida'], ChatPhone: '5511999999999' });
  });

  it('não declara messages.forward/star/unstar/pin/unpin (busca exaustiva em routes.go não encontrou endpoint)', () => {
    const adapter = wuzapi(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.forward');
    expect(adapter.capabilities).not.toContain('messages.pin');
    expect(adapter.messages.forward).toBeUndefined();
  });

  it('chats.archive envia { jid, archive: true } (tags minúsculas) para POST /chat/archive, completando o sufixo @s.whatsapp.net quando o chatId vem em dígitos crus', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/archive') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.chats?.archive?.('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ jid: '5511999999999@s.whatsapp.net', archive: true });
  });

  it('chats.unarchive usa o MESMO endpoint POST /chat/archive com archive: false, repassando um JID explícito intacto', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/chat/archive') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.chats?.unarchive?.('5511999999999@s.whatsapp.net')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ jid: '5511999999999@s.whatsapp.net', archive: false });
  });

  it('não declara chats.mute/unmute/pin/unpin/markRead/markUnread (sem endpoint equivalente confirmado no código-fonte para o contrato canônico)', () => {
    const adapter = wuzapi(buildAdapterOptions());

    expect(adapter.capabilities).not.toContain('chats.mute');
    expect(adapter.capabilities).not.toContain('chats.unmute');
    expect(adapter.capabilities).not.toContain('chats.pin');
    expect(adapter.capabilities).not.toContain('chats.unpin');
    expect(adapter.capabilities).not.toContain('chats.markRead');
    expect(adapter.capabilities).not.toContain('chats.markUnread');
    expect(adapter.chats?.mute).toBeUndefined();
    expect(adapter.chats?.pin).toBeUndefined();
    expect(adapter.chats?.markRead).toBeUndefined();
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

  it('parseWebhook normaliza "GroupInfo" com MÚLTIPLAS mudanças de participante num único payload para um GroupUpdateEvent por mudança (RECONSTRUÍDO)', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupParticipantsFixture });

    expect(events).toHaveLength(4);
    expect(events.every((event) => event.type === 'group.update')).toBe(true);

    const byAction = new Map(
      events.map((event) => [event.type === 'group.update' ? event.action : undefined, event]),
    );

    const add = byAction.get('participants.add');
    expect(add?.type === 'group.update' && add.groupId).toBe('120363000000000000@g.us');
    expect(add?.type === 'group.update' && add.participants).toEqual([
      '5511988887777@s.whatsapp.net',
    ]);
    expect(add?.provider).toBe('wuzapi');
    expect(add?.instanceId).toBe('minha-sessao');

    const remove = byAction.get('participants.remove');
    expect(remove?.type === 'group.update' && remove.participants).toEqual([
      '5511966665555@s.whatsapp.net',
    ]);

    const promote = byAction.get('participants.promote');
    expect(promote?.type === 'group.update' && promote.participants).toEqual([
      '5511977776666@s.whatsapp.net',
    ]);

    const demote = byAction.get('participants.demote');
    expect(demote?.type === 'group.update' && demote.participants).toEqual([
      '5511955554444@s.whatsapp.net',
    ]);
  });

  it('parseWebhook normaliza "GroupInfo" com Name+Topic populados em "subject"+"description", sem "participants" (RECONSTRUÍDO)', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupMetadataFixture });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.type === 'group.update')).toBe(true);

    const actions = events.map((event) =>
      event.type === 'group.update' ? event.action : undefined,
    );
    expect(actions).toEqual(['subject', 'description']);

    for (const event of events) {
      if (event.type === 'group.update') {
        expect(event.groupId).toBe('120363000000000000@g.us');
        expect(event.participants).toBeUndefined();
      }
    }
  });

  it('parseWebhook cai em "unknown" para "GroupInfo" sem nenhuma mudança reconhecida (ex.: só "Locked")', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupUnknownChangeFixture });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook normaliza "JoinedGroup" para group.update com action "participants.add", sem "participants" (RECONSTRUÍDO)', () => {
    const adapter = wuzapi(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: joinedGroupFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe('120363000000000001@g.us');
      expect(event.action).toBe('participants.add');
      expect(event.participants).toBeUndefined();
      expect(event.provider).toBe('wuzapi');
      expect(event.instanceId).toBe('minha-sessao');
    }
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

  it('groups.create envia { name, participants } (tags minúsculas) para POST /group/create e mapeia a resposta', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
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

    // as tags JSON de /group/create são minúsculas ("name"/"participants") — diferente da maioria
    // dos outros endpoints do Wuzapi (PascalCase sem tag) — confirmado no código-fonte.
    expect(capturedBody?.name).toBe('Grupo de teste');
    expect(capturedBody?.participants).toEqual(['5511988887777', '5511977776666@s.whatsapp.net']);

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
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/create') {
            return jsonResponse(200, { code: 200, success: true, data: {} });
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

  it('groups.getInfo envia "groupJID" na QUERY STRING (não no body) e mapeia GroupInfo (Topic -> description)', async () => {
    let capturedQuery: string | null = null;
    let capturedBody: string | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/info') {
            capturedQuery = url.searchParams.get('groupJID');
            capturedBody = init?.body === undefined ? undefined : String(init.body);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo('120363000000000000@g.us');

    expect(capturedQuery).toBe('120363000000000000@g.us');
    expect(capturedBody).toBeUndefined();
    expect(group.id).toBe('120363000000000000@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.description).toBe('Descrição do grupo');
    expect(group.owner).toBe('5511999999999@s.whatsapp.net');
    expect(group.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
      { id: '5511988887777@s.whatsapp.net', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('groups.list chama GET /group/list (sem parâmetros) e mapeia cada item de "Groups" para GroupInfo', async () => {
    const adapter = wuzapi(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.groups.list();

    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('120363000000000000@g.us');
    expect(list[0]?.subject).toBe('Grupo de teste');
    expect(list[0]?.description).toBe('Descrição do grupo');
    expect(list[0]?.participants).toEqual([
      { id: '5511999999999@s.whatsapp.net', isAdmin: true, isSuperAdmin: true },
    ]);
  });

  it('groups.addParticipants envia { GroupJID, Phone, Action: "add" } para POST /group/updateparticipants', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateparticipants') {
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

    expect(capturedBody?.GroupJID).toBe('120363000000000000@g.us');
    expect(capturedBody?.Action).toBe('add');
    // note o campo se chama "Phone" (não "Participants") neste endpoint.
    expect(capturedBody?.Phone).toEqual(['5511988887777', '5511977776666@s.whatsapp.net']);
  });

  it('groups.removeParticipants/promoteParticipants/demoteParticipants usam o mesmo endpoint com o "Action" correto', async () => {
    const capturedActions: string[] = [];
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/updateparticipants') {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            capturedActions.push(String(body.Action));
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

  it('groups.updateSubject envia { GroupJID, Name } para POST /group/name', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/name') {
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
        subject: 'Novo nome do grupo',
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({
      GroupJID: '120363000000000000@g.us',
      Name: 'Novo nome do grupo',
    });
  });

  it('groups.updateDescription envia { GroupJID, Topic } para POST /group/topic', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/topic') {
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
        description: 'Nova descrição do grupo',
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({
      GroupJID: '120363000000000000@g.us',
      Topic: 'Nova descrição do grupo',
    });
  });

  it('groups.updateDescription envia Topic vazio (string vazia limpa a descrição no servidor)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/topic') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.groups.updateDescription({ groupId: '120363000000000000@g.us', description: '' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ GroupJID: '120363000000000000@g.us', Topic: '' });
  });

  it('groups.updatePicture (via media.url) repassa a URL como está em "Image", sem conversão', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/photo') {
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

    expect(capturedBody).toEqual({
      GroupJID: '120363000000000000@g.us',
      Image: 'https://cdn.exemplo.test/foto-grupo.jpg',
    });
  });

  it('groups.updatePicture (via media.base64 cru) monta data URI FORÇANDO image/jpeg (único formato aceito pelo servidor)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/photo') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    // mimeType 'image/png' é intencionalmente ignorado: o servidor só aceita JPEG de fato.
    await expect(
      wa.groups.updatePicture({
        groupId: '120363000000000000@g.us',
        media: { kind: 'image', base64: 'ZmFrZS1mb3RvLWdydXBv', mimeType: 'image/png' },
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({
      GroupJID: '120363000000000000@g.us',
      Image: 'data:image/jpeg;base64,ZmFrZS1mb3RvLWdydXBv',
    });
  });

  it('groups.updatePicture (via media.base64 já como data URI) extrai a porção base64 e remonta forçando image/jpeg', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/photo') {
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
        media: { kind: 'image', base64: 'data:image/png;base64,ZmFrZS1mb3RvLWdydXBv' },
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({
      GroupJID: '120363000000000000@g.us',
      Image: 'data:image/jpeg;base64,ZmFrZS1mb3RvLWdydXBv',
    });
  });

  it('groups.getInviteLink chama GET /group/invitelink com groupJID/reset=false na query e normaliza código bare para link completo', async () => {
    let capturedQuery: URLSearchParams | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/invitelink') {
            capturedQuery = url.searchParams;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink('120363000000000000@g.us');

    expect(capturedQuery?.get('groupJID')).toBe('120363000000000000@g.us');
    expect(capturedQuery?.get('reset')).toBe('false');
    // o stub devolve só o código bare para reset=false — o adapter deve completar o link.
    expect(result.link).toBe('https://chat.whatsapp.com/CONTRATO_CODIGO_BARE');
    expect(result).toHaveProperty('raw');
  });

  it('groups.revokeInviteLink chama o MESMO endpoint com reset=true e repassa o novo link completo', async () => {
    let capturedQuery: URLSearchParams | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/group/invitelink') {
            capturedQuery = url.searchParams;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.groups.revokeInviteLink('120363000000000000@g.us');

    expect(capturedQuery?.get('groupJID')).toBe('120363000000000000@g.us');
    expect(capturedQuery?.get('reset')).toBe('true');
    expect(result.link).toBe('https://chat.whatsapp.com/CONTRATO_NOVO_CODIGO');
    expect(result).toHaveProperty('raw');
  });

  it('groups.joinViaInviteLink envia { Code } com SÓ O CÓDIGO (não o link completo) para POST /group/join', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
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

    // o conector já normaliza "invite" para o link completo antes de chamar o adapter — mesmo
    // passando só o código, o adapter deve extrair de volta só o código para o body.
    await expect(
      wa.groups.joinViaInviteLink({ invite: 'CONTRATO_CODIGO_CONVITE' }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ Code: 'CONTRATO_CODIGO_CONVITE' });
  });

  it('groups.joinViaInviteLink extrai o código de um link completo informado pelo chamador', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
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
    await wa.groups.joinViaInviteLink({
      invite: 'https://chat.whatsapp.com/CONTRATO_CODIGO_CONVITE',
    });

    expect(capturedBody).toEqual({ Code: 'CONTRATO_CODIGO_CONVITE' });
  });

  it('groups.leaveGroup envia { GroupJID } para POST /group/leave', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
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

    expect(capturedBody).toEqual({ GroupJID: '120363000000000000@g.us' });
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

  it('contacts.list chama GET /user/contacts (sem corpo) e mapeia a chave do mapa -> id, FullName (fallback FirstName/PushName) -> name', async () => {
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
    const wa = createConnector(adapter);
    const contacts = await wa.contacts.list();

    expect(calls).toContain('GET /user/contacts');
    expect(contacts).toEqual([
      { id: '5511999999999@s.whatsapp.net', name: 'Fulano da Silva', raw: expect.anything() },
      { id: '5511988887777@s.whatsapp.net', name: 'Beltrano', raw: expect.anything() },
    ]);
  });

  it('contacts.list cai para FirstName e depois PushName quando FullName está ausente', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/contacts') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: {
                '5511977776666@s.whatsapp.net': { Found: true, PushName: 'Só PushName' },
              },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contacts = await wa.contacts.list();

    expect(contacts).toEqual([
      { id: '5511977776666@s.whatsapp.net', name: 'Só PushName', raw: expect.anything() },
    ]);
  });

  it('contacts.get envia { Phone: [chatId] } para POST /user/info e mapeia Status -> about, deixando name/profilePictureUrl undefined (limitação do provider)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/info') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5511999999999');

    expect(capturedBody?.Phone).toEqual(['5511999999999']);
    expect(contact.id).toBe('5511999999999');
    expect(contact.about).toBe('Disponível');
    // sem nome de exibição nesta resposta (mesma limitação do Evolution GO, mesma lib whatsmeow).
    expect(contact.name).toBeUndefined();
    // PictureID não é a URL da foto (só um id/hash interno) — não populado a partir dele.
    expect(contact.profilePictureUrl).toBeUndefined();
    expect(contact).toHaveProperty('raw');
  });

  it('contacts.getAbout reaproveita o MESMO endpoint de contacts.get (POST /user/info) e mapeia Status -> about', async () => {
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
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout('5511999999999');

    expect(calls).toContain('POST /user/info');
    expect(about.about).toBe('Disponível');
    expect(about).toHaveProperty('raw');
  });

  it('contacts.checkExists envia { Phone: [phone] } para POST /user/check e mapeia IsInWhatsapp->exists, JID->chatId (primeiro item)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/check') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511999999999');

    expect(capturedBody?.Phone).toEqual(['5511999999999']);
    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('5511999999999@s.whatsapp.net');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.checkExists mapeia JID mesmo quando IsInWhatsapp é false (JID sintetizado, não confirmação de existência)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/check') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: {
                Users: [
                  {
                    Query: '5511000000000',
                    IsInWhatsapp: false,
                    JID: '5511000000000@s.whatsapp.net',
                    VerifiedName: '',
                  },
                ],
              },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511000000000');

    expect(result.exists).toBe(false);
    // JID vem preenchido mesmo com IsInWhatsapp: false — é só o JID sintetizado a partir do
    // número consultado, não uma confirmação de existência (ver docs/providers/wuzapi.md).
    expect(result.chatId).toBe('5511000000000@s.whatsapp.net');
  });

  it('contacts.checkExists devolve exists: false sem chatId quando a resposta vem sem "Users" (nunca lança)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/check') {
            return jsonResponse(200, { code: 200, success: true, data: { Users: [] } });
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

  it('contacts.getProfilePicture envia { Phone: chatId, Preview: false } (POST, não GET — API.md diverge do código-fonte) e mapeia data.url -> url', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const calls: string[] = [];
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          if (url.pathname === '/user/avatar') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(calls).toContain('POST /user/avatar');
    expect(capturedBody).toEqual({ Phone: '5511999999999', Preview: false });
    expect(picture.url).toBe('https://pps.exemplo.test/foto.jpg');
    expect(picture).toHaveProperty('raw');
  });

  it('contacts.getProfilePicture devolve url undefined quando a resposta não inclui "url"', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/avatar') {
            return jsonResponse(200, { code: 200, success: true, data: { id: 'sem-url' } });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(picture.url).toBeUndefined();
  });

  it('contacts.block envia { Phone: chatId } para POST /user/block e ignora a resposta (Promise<void>)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const calls: string[] = [];
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          if (url.pathname === '/user/block') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.contacts.block('5511988887777')).resolves.toBeUndefined();

    expect(calls).toContain('POST /user/block');
    expect(capturedBody).toEqual({ Phone: '5511988887777' });
  });

  it('contacts.unblock envia { Phone: chatId } para POST /user/unblock e ignora a resposta (Promise<void>)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const calls: string[] = [];
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          if (url.pathname === '/user/unblock') {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.contacts.unblock('5511988887777')).resolves.toBeUndefined();

    expect(calls).toContain('POST /user/unblock');
    expect(capturedBody).toEqual({ Phone: '5511988887777' });
  });

  it('contacts.listBlocked chama GET /user/blocklist (sem corpo) e mapeia data.Blocklist -> array de chatIds', async () => {
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
    const wa = createConnector(adapter);

    const blocked = await wa.contacts.listBlocked();

    expect(calls).toContain('GET /user/blocklist');
    expect(blocked).toEqual(['5511988887777@s.whatsapp.net']);
  });

  it('contacts.listBlocked devolve array vazio quando "Blocklist" vem vazio (ninguém bloqueado)', async () => {
    const adapter = wuzapi(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === '/user/blocklist') {
            return jsonResponse(200, {
              code: 200,
              success: true,
              data: { Blocklist: [], DHash: 'contrato-dhash-vazio' },
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const blocked = await wa.contacts.listBlocked();

    expect(blocked).toEqual([]);
  });
});
