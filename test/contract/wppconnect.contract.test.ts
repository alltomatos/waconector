import { describe, expect, it } from 'vitest';
import { createConnector, isWaConnectorError } from '../../src';
import { type WppconnectOptions, wppconnect } from '../../src/adapters/wppconnect';
import ackFixture from '../../src/adapters/wppconnect/fixtures/webhook-ack.json';
import groupParticipantsFixture from '../../src/adapters/wppconnect/fixtures/webhook-group-participants.json';
import imageMessageFixture from '../../src/adapters/wppconnect/fixtures/webhook-message-image-received.json';
import messageReceivedFixture from '../../src/adapters/wppconnect/fixtures/webhook-message-received.json';
import qrcodeFixture from '../../src/adapters/wppconnect/fixtures/webhook-qrcode.json';
import statusFindFixture from '../../src/adapters/wppconnect/fixtures/webhook-status-find.json';
import { describeAdapterContract } from './adapter-contract';

const BASE_URL = 'https://contrato.wppconnect.test';
const SESSION = 'contrato-wppconnect';
const TOKEN = 'wpp-token-de-teste-nao-real';
const API_PREFIX = `/api/${SESSION}`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function envelope(response: unknown): unknown {
  return { status: 'success', response, mapper: 'return' };
}

/**
 * Stub de `fetch` que roteia por (método, pathname) e devolve respostas fixas equivalentes às
 * reais do WPPConnect Server — ver docs/providers/wppconnect.md — sem rede real, sem credenciais
 * reais.
 */
function createFetchStub(): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;
    if (!pathname.startsWith(API_PREFIX)) {
      throw new Error(`fetchStub (wppconnect): fora do prefixo esperado ${method} ${pathname}`);
    }
    const suffix = pathname.slice(API_PREFIX.length);

    if (method === 'POST' && suffix === '/start-session') {
      return jsonResponse(200, {
        status: 'qrcode',
        qrcode: 'ZmFrZS1xcmNvZGU=',
        urlcode: '2@fakeurlcode,fakekey,fakeid==',
        session: SESSION,
      });
    }

    if (method === 'GET' && suffix === '/status-session') {
      return jsonResponse(200, {
        status: 'CONNECTED',
        qrcode: null,
        urlcode: null,
        version: '2.10.0',
      });
    }

    if (method === 'POST' && suffix === '/logout-session') {
      return jsonResponse(200, { status: true, message: 'Session successfully closed' });
    }

    if (method === 'POST' && suffix === '/send-message') {
      // O handler real (`sendMessage`) sempre reescreve `phone` para array (middleware
      // `statusConnection`) e faz `results.push(await client.sendText(...))` num loop — `response`
      // é sempre um ARRAY de um elemento, nunca o objeto bare (ver docs/providers/wppconnect.md).
      return jsonResponse(
        200,
        envelope([
          {
            id: 'true_5511999999999@c.us_3EB0FAKECONTRATOTXT',
            body: 'contrato: ping',
            type: 'chat',
            t: 1751000010,
            timestamp: 1751000010,
            from: `${SESSION}@c.us`,
            to: '5511999999999@c.us',
            chatId: '5511999999999@c.us',
            fromMe: true,
            ack: 1,
          },
        ]),
      );
    }

    if (method === 'POST' && suffix === '/send-mentioned') {
      return jsonResponse(
        200,
        envelope({
          id: 'true_5511999999999@c.us_3EB0FAKECONTRATOMENTION',
          chatId: '5511999999999@c.us',
          timestamp: 1751000011,
        }),
      );
    }

    if (method === 'POST' && suffix === '/send-file-base64') {
      // Mesmo padrão de array de um elemento que /send-message (ver comentário acima).
      return jsonResponse(200, envelope([{ ack: 1, id: '3EB0FAKECONTRATOMEDIA' }]));
    }

    if (method === 'POST' && suffix === '/send-voice-base64') {
      return jsonResponse(200, envelope([{ ack: 1, id: '3EB0FAKECONTRATOAUDIO' }]));
    }

    if (method === 'POST' && suffix === '/send-sticker') {
      return jsonResponse(200, envelope([{ ack: 1, id: '3EB0FAKECONTRATOSTICKER' }]));
    }

    if (method === 'POST' && suffix === '/react-message') {
      return jsonResponse(200, envelope({ message: 'Reaction sended' }));
    }

    if (method === 'POST' && suffix === '/edit-message') {
      // Resposta BARE (não array) — este endpoint não passa pelo middleware statusConnection
      // (ver docs/providers/wppconnect.md).
      return jsonResponse(
        200,
        envelope({
          id: 'true_5511999999999@c.us_3EB0FAKECONTRATOTXT',
          body: 'contrato: texto editado',
          type: 'chat',
          t: 1751000020,
          timestamp: 1751000020,
          chatId: '5511999999999@c.us',
          fromMe: true,
        }),
      );
    }

    if (method === 'POST' && suffix === '/delete-message') {
      return jsonResponse(200, envelope({ message: 'Message deleted' }));
    }

    // messages.forward (ADR-0013): POST /forward-messages, envelope padrão.
    if (method === 'POST' && suffix === '/forward-messages') {
      return jsonResponse(
        200,
        envelope({
          id: 'true_5511999999999@c.us_3EB0FAKEFORWARD',
          chatId: '5511999999999@c.us',
          t: 1751000030,
        }),
      );
    }

    // messages.star/unstar (ADR-0013): POST /star-message, envelope padrão.
    if (method === 'POST' && suffix === '/star-message') {
      return jsonResponse(200, envelope(2));
    }

    // messages.sendLocation (ADR-0014): POST /send-location — mesmo padrão de array de um
    // elemento que /send-message (results.push(...) num loop sobre phone).
    if (method === 'POST' && suffix === '/send-location') {
      return jsonResponse(
        200,
        envelope([
          {
            id: 'true_5511999999999@c.us_3EB0FAKELOCATION',
            chatId: '5511999999999@c.us',
            t: 1751000040,
          },
        ]),
      );
    }

    // messages.sendContactCard (ADR-0014): POST /contact-vcard — resposta BARE (não array, o
    // controller não faz `push`, só sobrescreve `response` a cada iteração do loop).
    if (method === 'POST' && suffix === '/contact-vcard') {
      return jsonResponse(
        200,
        envelope({
          id: 'true_5511999999999@c.us_3EB0FAKECONTACT',
          chatId: '5511999999999@c.us',
          t: 1751000041,
        }),
      );
    }

    // messages.sendPoll (ADR-0014): POST /send-poll-message — mesmo padrão de array de
    // /send-location.
    if (method === 'POST' && suffix === '/send-poll-message') {
      return jsonResponse(
        200,
        envelope([
          {
            id: 'true_5511999999999@c.us_3EB0FAKEPOLL',
            chatId: '5511999999999@c.us',
            t: 1751000042,
          },
        ]),
      );
    }

    if (method === 'POST' && suffix === '/archive-chat') {
      return jsonResponse(200, envelope({ wid: '5511999999999@c.us', archive: true }));
    }

    if (method === 'POST' && suffix === '/pin-chat') {
      return jsonResponse(200, envelope({ message: 'Chat fixed' }));
    }

    if (method === 'POST' && suffix === '/send-mute') {
      return jsonResponse(200, envelope({ type: 'sendMute', time: 87600, timeType: 'hours' }));
    }

    if (method === 'POST' && suffix === '/mark-unseen') {
      return jsonResponse(200, envelope({ message: 'unseen checked' }));
    }

    if (method === 'POST' && suffix === '/send-seen') {
      // Terceira exceção de envelope confirmada no dossiê: "S" maiúsculo, payload dois níveis
      // abaixo (response.data) — não afeta o adapter (resposta ignorada, contrato retorna void).
      return jsonResponse(201, {
        status: 'Success',
        response: { message: 'ok', contact: '5511999999999', session: SESSION, data: null },
      });
    }

    if (method === 'POST' && suffix === '/create-group') {
      // Shape real do controller: {message, group, groupInfo: [{name, id, participants}]} — id/
      // name ficam ANINHADOS em groupInfo[0], não diretamente em response (ver dossiê).
      return jsonResponse(
        200,
        envelope({
          message: 'Group(s) created successfully',
          group: 'Grupo de teste',
          groupInfo: [
            {
              name: 'Grupo de teste',
              // bare digits (sem @g.us) — comportamento confirmado do provider (ver dossiê).
              id: '120363000000000099',
              participants: ['5511999999999@c.us', '5511988887777@c.us'],
            },
          ],
        }),
      );
    }

    const groupInfoMatch = suffix.match(/^\/group-info\/(.+)$/);
    if (method === 'GET' && groupInfoMatch) {
      return jsonResponse(
        200,
        envelope({
          id: decodeURIComponent(groupInfoMatch[1] ?? ''),
          name: 'Grupo de teste',
          subject: 'Grupo de teste (subject)',
          description: 'Descrição do grupo',
          participants: [
            { id: '5511999999999@c.us', isAdmin: true },
            { id: '5511988887777@c.us', isAdmin: false },
          ],
        }),
      );
    }

    if (
      method === 'POST' &&
      (suffix === '/add-participant-group' ||
        suffix === '/remove-participant-group' ||
        suffix === '/promote-participant-group' ||
        suffix === '/demote-participant-group')
    ) {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    if (method === 'POST' && suffix === '/group-subject') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    if (method === 'POST' && suffix === '/group-description') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    if (method === 'POST' && suffix === '/group-pic') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    const inviteLinkMatch = suffix.match(/^\/group-invite-link\/(.+)$/);
    if (method === 'GET' && inviteLinkMatch) {
      // resposta = string direta dentro de "response" (um dos dois shapes defensivos aceitos).
      return jsonResponse(200, envelope('https://chat.whatsapp.com/CONTRATOCODIGO'));
    }

    const revokeLinkMatch = suffix.match(/^\/group-revoke-link\/(.+)$/);
    if (method === 'GET' && revokeLinkMatch) {
      // resposta = objeto com chave "link" (o outro shape defensivo aceito).
      return jsonResponse(200, envelope({ link: 'https://chat.whatsapp.com/CONTRATONOVOCODIGO' }));
    }

    if (method === 'POST' && suffix === '/join-code') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    if (method === 'POST' && suffix === '/leave-group') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    const checkNumberMatch = suffix.match(/^\/check-number-status\/(.+)$/);
    if (method === 'GET' && checkNumberMatch) {
      const phone = decodeURIComponent(checkNumberMatch[1] ?? '');
      return jsonResponse(
        200,
        envelope({
          numberExists: true,
          id: { server: 'c.us', user: phone, _serialized: `${phone}@c.us` },
        }),
      );
    }

    if (method === 'POST' && suffix === '/block-contact') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    if (method === 'POST' && suffix === '/unblock-contact') {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    if (method === 'GET' && suffix === '/blocklist') {
      return jsonResponse(200, envelope([{ phone: '5511988887777' }]));
    }

    if (method === 'POST' && suffix === '/list-chats') {
      // Shape real da lib (`Chat[]`, src/api/model/chat.ts) — sem "participants" (ver dossiê).
      // ATENÇÃO: diferente de todos os outros handlers deste stub, `DeviceController.listChats`
      // responde com `res.status(200).json(response)` — o array BRUTO, SEM o envelope
      // `{status, response, mapper}` — confirmado no código-fonte real do wppconnect-server
      // (commit f09e2fed, src/controller/deviceController.ts). Não envolver em `envelope(...)`
      // aqui: faria o teste exercitar um shape que o servidor real nunca devolve.
      return jsonResponse(200, [
        {
          id: {
            server: 'g.us',
            user: '120363000000000000',
            _serialized: '120363000000000000@g.us',
          },
          name: 'Grupo de teste (list-chats)',
          isGroup: true,
          archive: false,
          pin: false,
          unreadCount: 0,
        },
      ]);
    }

    if (method === 'GET' && suffix === '/all-contacts') {
      // Array do MESMO shape de "get-contact.js" (_serializeContactObj) — ver dossiê.
      return jsonResponse(
        200,
        envelope([
          {
            id: { server: 'c.us', user: '5511988887777', _serialized: '5511988887777@c.us' },
            name: 'Contato de teste',
            pushname: 'Fulano',
            isWAContact: true,
            profilePicThumbObj: {
              eurl: 'https://pps.whatsapp.net/fake-eurl',
              img: 'https://pps.whatsapp.net/fake-img.jpg',
              imgFull: 'https://pps.whatsapp.net/fake-img-full.jpg',
              tag: 'fake-tag',
            },
          },
        ]),
      );
    }

    const contactMatch = suffix.match(/^\/contact\/(.+)$/);
    if (method === 'GET' && contactMatch) {
      const phone = decodeURIComponent(contactMatch[1] ?? '');
      return jsonResponse(
        200,
        envelope({
          id: { server: 'c.us', user: phone, _serialized: `${phone}@c.us` },
          name: 'Contato de teste',
          pushname: 'Fulano',
          isWAContact: true,
          profilePicThumbObj: {
            eurl: 'https://pps.whatsapp.net/fake-eurl',
            img: 'https://pps.whatsapp.net/fake-img.jpg',
            imgFull: 'https://pps.whatsapp.net/fake-img-full.jpg',
            tag: 'fake-tag',
          },
        }),
      );
    }

    const profilePicMatch = suffix.match(/^\/profile-pic\/(.+)$/);
    if (method === 'GET' && profilePicMatch) {
      const phone = decodeURIComponent(profilePicMatch[1] ?? '');
      // `ProfilePicThumbObj` (src/api/model/profile-pic-thumb.ts) — ver dossiê.
      return jsonResponse(
        200,
        envelope({
          eurl: 'https://pps.whatsapp.net/fake-eurl',
          id: { server: 'c.us', user: phone, _serialized: `${phone}@c.us` },
          img: 'https://pps.whatsapp.net/fake-img.jpg',
          imgFull: 'https://pps.whatsapp.net/fake-img-full.jpg',
          raw: null,
          tag: 'fake-tag',
        }),
      );
    }

    const profileStatusMatch = suffix.match(/^\/profile-status\/(.+)$/);
    if (method === 'GET' && profileStatusMatch) {
      const phone = decodeURIComponent(profileStatusMatch[1] ?? '');
      // `ContactStatus` (src/api/model/contact-status.ts) — ver dossiê.
      return jsonResponse(
        200,
        envelope({ id: `${phone}@c.us`, status: 'Disponível para contrato de teste' }),
      );
    }

    // presence.setTyping (ADR-0015): POST /typing (composing/paused) ou /recording (recording).
    if (method === 'POST' && (suffix === '/typing' || suffix === '/recording')) {
      return jsonResponse(200, envelope({ message: 'ok' }));
    }

    // presence.set (ADR-0015): POST /set-online-presence.
    if (method === 'POST' && suffix === '/set-online-presence') {
      return jsonResponse(200, envelope({ message: 'Set Online Presence Successfully' }));
    }

    // presence.subscribe (ADR-0015): POST /subscribe-presence.
    if (method === 'POST' && suffix === '/subscribe-presence') {
      return jsonResponse(200, envelope({ message: 'Subscribe presence executed' }));
    }

    // labels.list (ADR-0016): GET /get-all-labels.
    if (method === 'GET' && suffix === '/get-all-labels') {
      return jsonResponse(
        200,
        envelope([{ id: '1', name: 'Cliente', color: 2, count: 0, hexColor: '#fed428' }]),
      );
    }

    // labels.create (ADR-0016): POST /add-new-label — resposta real não devolve o label criado
    // (bug confirmado no wrapper do provider, ver docstring de createLabel).
    if (method === 'POST' && suffix === '/add-new-label') {
      return jsonResponse(201, envelope(undefined));
    }

    // labels.delete (ADR-0016): PUT /delete-label/{id} — método PUT, não DELETE.
    if (method === 'PUT' && /^\/delete-label\/.+$/.test(suffix)) {
      return jsonResponse(201, envelope({ message: 'success' }));
    }

    // labels.addToChat/removeFromChat (ADR-0016): POST /add-or-remove-label.
    if (method === 'POST' && suffix === '/add-or-remove-label') {
      return jsonResponse(201, envelope({ message: 'success' }));
    }

    // channels.create (ADR-0017): POST /newsletter — resposta SEM envelope (diferente de
    // /add-new-label), `client.createNewsletter` faz `return` corretamente no wa-js.
    if (method === 'POST' && suffix === '/newsletter') {
      return jsonResponse(201, {
        idJid: '222222222222222222@newsletter',
        inviteCode: 'ABC123',
        inviteLink: 'https://whatsapp.com/channel/ABC123',
        name: 'Contrato: Canal Novo',
        state: 'active',
        subscribersCount: 0,
        description: null,
        timestamp: 1700000000,
      });
    }

    // channels.delete (ADR-0017): DELETE /newsletter/{id} — resposta SEM envelope.
    if (method === 'DELETE' && /^\/newsletter\/.+$/.test(suffix)) {
      return jsonResponse(201, { idJid: '111111111111111111@newsletter' });
    }

    // business.updateProfile (ADR-0018): POST /edit-business-profile — resposta bruta, ignorada.
    if (method === 'POST' && suffix === '/edit-business-profile') {
      return jsonResponse(201, { status: 'success' });
    }

    // calls.reject (ADR-0019): POST /reject-call — resposta bruta, ignorada.
    if (method === 'POST' && suffix === '/reject-call') {
      return jsonResponse(201, { status: 'success' });
    }

    throw new Error(`fetchStub (wppconnect): rota não configurada ${method} ${pathname}`);
  };
}

function buildAdapterOptions(overrides: Partial<WppconnectOptions> = {}): WppconnectOptions {
  return {
    baseUrl: BASE_URL,
    session: SESSION,
    token: TOKEN,
    fetch: createFetchStub(),
    ...overrides,
  };
}

describeAdapterContract({
  name: 'wppconnect',
  create() {
    const adapter = wppconnect(buildAdapterOptions());
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

describe('wppconnect adapter: comportamento específico do provider', () => {
  it('instance.connect chama POST /start-session com waitQrCode:true por padrão e extrai qr quando status é "qrcode"', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/start-session`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.connect();

    expect(capturedBody?.waitQrCode).toBe(true);
    expect(result.qr).toBe('ZmFrZS1xcmNvZGU=');
    expect(result).toHaveProperty('raw');
  });

  it('instance.connect envia "webhook" no body quando configurado', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        webhook: 'https://meuapp.exemplo.test/webhook',
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/start-session`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    await adapter.instance.connect();
    expect(capturedBody?.webhook).toBe('https://meuapp.exemplo.test/webhook');
  });

  it('instance.connect com waitQrCode:false ainda funciona e não exige status "qrcode" para não lançar', async () => {
    const adapter = wppconnect(buildAdapterOptions({ waitQrCode: false }));
    const result = await adapter.instance.connect();
    // o stub sempre devolve status "qrcode" independente do body enviado — o importante aqui é
    // confirmar que connect() não lança e sempre carrega "raw", mesmo com waitQrCode:false.
    expect(result).toHaveProperty('raw');
  });

  it('instance.connect deixa "qr" undefined quando a resposta não tem status "qrcode" (ex.: sessão já conectada)', async () => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/start-session`) {
            return jsonResponse(200, { status: 'CONNECTED', qrcode: null });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.connect();
    expect(result.qr).toBeUndefined();
    expect(result).toHaveProperty('raw');
  });

  it.each([
    [null, 'disconnected'],
    ['CLOSED', 'disconnected'],
    ['INITIALIZING', 'connecting'],
    ['QRCODE', 'qr'],
    ['PHONECODE', 'qr'],
    ['CONNECTED', 'connected'],
    ['ALGO_NAO_MAPEADO', 'unknown'],
  ] as const)('instance.status mapeia status=%s para "%s"', async (status, expected) => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/status-session`) {
            return jsonResponse(200, { status, qrcode: null, urlcode: null });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.status();
    expect(result.state).toBe(expected);
    expect(result).toHaveProperty('raw');
  });

  it('instance.status mapeia campo "status" ausente para "unknown" (nunca lança)', async () => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/status-session`) {
            return jsonResponse(200, {});
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const result = await adapter.instance.status();
    expect(result.state).toBe('unknown');
  });

  it('instance.logout chama POST /logout-session sem lançar', async () => {
    const calls: string[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`);
          return createFetchStub()(input, init);
        },
      }),
    );
    await expect(adapter.instance.logout()).resolves.toBeUndefined();
    expect(calls).toContain(`POST ${API_PREFIX}/logout-session`);
  });

  it('messages.sendText envia phone (sem sufixo JID), isGroup/isNewsletter/isLid e mapeia id/chatId/timestamp', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({ to: '5511999999999', text: 'contrato: ping' });

    expect(capturedBody?.phone).toBe('5511999999999');
    expect(capturedBody?.isGroup).toBe(false);
    expect(capturedBody?.isNewsletter).toBe(false);
    expect(capturedBody?.isLid).toBe(false);
    expect(capturedBody?.message).toBe('contrato: ping');
    expect(sent.id).toBe('true_5511999999999@c.us_3EB0FAKECONTRATOTXT');
    expect(sent.chatId).toBe('5511999999999@c.us');
    expect(sent.timestamp).toBe(1751000010 * 1000);
  });

  it('regressão: messages.sendText desembrulha o array de um elemento que /send-message realmente devolve (não cai no fallback "wppconnect-<timestamp>")', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendText({ to: '5511999999999', text: 'contrato: ping' });

    // Se o adapter voltar a tratar `response` como objeto bare (em vez de array de um elemento),
    // asRecord() descarta o array e id/chatId caem no fallback fabricado — esta asserção falharia.
    expect(sent.id).not.toMatch(/^wppconnect-\d+$/);
    expect(sent.id).toBe('true_5511999999999@c.us_3EB0FAKECONTRATOTXT');
    expect(sent.chatId).toBe('5511999999999@c.us');
  });

  it('messages.sendText extrai a parte local do JID e marca isGroup:true para chatId de grupo (evita sufixo duplicado no servidor)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendText({ to: '120363000000000000@g.us', text: 'oi grupo' });

    expect(capturedBody?.phone).toBe('120363000000000000');
    expect(capturedBody?.isGroup).toBe(true);
  });

  it('messages.sendText inclui options.quotedMsg quando quotedId é informado', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-message`) {
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

    expect(capturedBody?.options).toEqual({ quotedMsg: '3EB0ORIGINAL' });
  });

  it('messages.sendText com mentions chama POST /send-mentioned com mentioned normalizado para JID', async () => {
    let capturedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-mentioned`) {
            capturedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendText({
      to: '5511999999999',
      text: 'oi @fulano',
      mentions: ['+55 11 98888-7777', '5511977776666@c.us'],
    });

    expect(capturedPath).toBe(`${API_PREFIX}/send-mentioned`);
    expect(capturedBody?.mentioned).toEqual(['5511988887777@c.us', '5511977776666@c.us']);
  });

  it('messages.sendMedia (image) envia via /send-file-base64 no campo "base64", com caption', async () => {
    let capturedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-file-base64`) {
            capturedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const sent = await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto.jpg' },
      caption: 'legenda',
    });

    expect(capturedPath).toBe(`${API_PREFIX}/send-file-base64`);
    expect(capturedBody?.base64).toBe('https://cdn.exemplo.test/foto.jpg');
    expect(capturedBody?.caption).toBe('legenda');
    // regressão: /send-file-base64 devolve um array de um elemento ([{ack,id}]), não o objeto
    // bare — se o adapter voltar a tratar `response` como bare, id cai no fallback fabricado.
    expect(sent.id).not.toMatch(/^wppconnect-\d+$/);
    expect(sent.id).toBe('3EB0FAKECONTRATOMEDIA');
    expect(sent.chatId).toBe('5511999999999');
    // {ack,id} não carrega timestamp — fica undefined, nunca inventado.
    expect(sent.timestamp).toBeUndefined();
  });

  it('messages.sendMedia (audio) envia via /send-voice-base64, sem caption', async () => {
    let capturedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-voice-base64`) {
            capturedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'audio', base64: 'ZmFrZS1hdWRpbw==', mimeType: 'audio/ogg' },
      caption: 'não deveria ir (áudio não suporta legenda)',
    });

    expect(capturedPath).toBe(`${API_PREFIX}/send-voice-base64`);
    expect(capturedBody?.base64).toBe('data:audio/ogg;base64,ZmFrZS1hdWRpbw==');
    expect(capturedBody?.caption).toBeUndefined();
  });

  it('messages.sendMedia (sticker) envia via /send-sticker no campo "path" (não "base64")', async () => {
    let capturedPath: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-sticker`) {
            capturedPath = url.pathname;
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendMedia({
      to: '5511999999999',
      media: { kind: 'sticker', url: 'https://cdn.exemplo.test/figurinha.webp' },
    });

    expect(capturedPath).toBe(`${API_PREFIX}/send-sticker`);
    expect(capturedBody?.path).toBe('https://cdn.exemplo.test/figurinha.webp');
    expect(capturedBody?.base64).toBeUndefined();
  });

  it('messages.sendMedia (document) inclui "filename" quando presente', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-file-base64`) {
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

    expect(capturedBody?.filename).toBe('contrato.pdf');
  });

  it('sendMedia sem media.url nem media.base64 lança INVALID_INPUT', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.messages
      .sendMedia({ to: '5511999999999', media: { kind: 'image' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('INVALID_INPUT');
    }
  });

  it('messages.sendReaction envia { msgId, reaction } e ecoa messageId/to no SentMessage (resposta do provider é fixa, sem id próprio)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/react-message`) {
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

    expect(capturedBody?.msgId).toBe('contrato-msg-1');
    expect(capturedBody?.reaction).toBe('👍');
    expect(sent.id).toBe('contrato-msg-1');
    expect(sent.chatId).toBe('5511999999999');
  });

  it('messages.sendReaction traduz emoji vazio para o literal booleano "false" (sentinela de remoção da lib)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/react-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.messages.sendReaction({ to: '5511999999999', messageId: 'contrato-msg-1', emoji: '' });

    expect(capturedBody?.reaction).toBe(false);
  });

  it('envia o header Authorization Bearer configurado em toda chamada e redige o token de erros', async () => {
    const calls: Headers[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        token: 'super-secret-wpp-token',
        fetch: async (input, init) => {
          calls.push(new Headers(init?.headers));
          if (new URL(String(input)).pathname === `${API_PREFIX}/status-session`) {
            return jsonResponse(401, {
              status: 'error',
              error: 'bad token super-secret-wpp-token',
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );

    const failure = await adapter.instance.status().catch((error: unknown) => error);
    expect(calls[0]?.get('authorization')).toBe('Bearer super-secret-wpp-token');
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain('super-secret-wpp-token');
      expect(failure.message).toContain('***');
    }
  });

  it('groups.create reconstrói o JID completo (@g.us) quando a resposta devolve só os dígitos crus', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo de teste',
      participants: ['5511999999999', '5511988887777'],
    });

    expect(group.id).toBe('120363000000000099@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.participants).toEqual([
      { id: '5511999999999', isAdmin: false, isSuperAdmin: false },
      { id: '5511988887777', isAdmin: false, isSuperAdmin: false },
    ]);
    expect(group).toHaveProperty('raw');
  });

  it('regressão: groups.create lê "id"/"name" de dentro de groupInfo[0] (aninhado), não diretamente da raiz de "response"', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const group = await wa.groups.create({
      subject: 'Grupo de teste',
      participants: ['5511999999999'],
    });

    // Se o adapter voltar a ler `response.id`/`response.name` direto (em vez de
    // `response.groupInfo[0].id`/`.name`), id fica '' (toWppconnectGroupId(undefined) === '') e
    // subject cai no fallback do input — esta asserção capturaria essa regressão.
    expect(group.id).not.toBe('');
    expect(group.id).toBe('120363000000000099@g.us');
  });

  it('groups.getInfo prioriza "name" sobre "subject" e mapeia participants (isSuperAdmin sempre false, não confirmado)', async () => {
    let capturedPath: string | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith(`${API_PREFIX}/group-info/`)) {
            capturedPath = url.pathname;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const group = await wa.groups.getInfo('120363000000000000@g.us');

    expect(capturedPath).toBe(`${API_PREFIX}/group-info/120363000000000000%40g.us`);
    expect(group.id).toBe('120363000000000000@g.us');
    expect(group.subject).toBe('Grupo de teste');
    expect(group.description).toBe('Descrição do grupo');
    expect(group.participants).toEqual([
      { id: '5511999999999@c.us', isAdmin: true, isSuperAdmin: false },
      { id: '5511988887777@c.us', isAdmin: false, isSuperAdmin: false },
    ]);
  });

  it('groups.addParticipants chama o endpoint uma vez POR PARTICIPANTE (batch não confirmado)', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/add-participant-group`) {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.addParticipants({
      groupId: '120363000000000000@g.us',
      participants: ['5511988887777', '5511977776666'],
    });

    expect(capturedBodies).toEqual([
      { groupId: '120363000000000000@g.us', phone: '5511988887777' },
      { groupId: '120363000000000000@g.us', phone: '5511977776666' },
    ]);
  });

  it('groups.removeParticipants/promoteParticipants/demoteParticipants usam os endpoints corretos', async () => {
    const hitPaths: string[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('-participant-group')) {
            hitPaths.push(url.pathname);
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

    expect(hitPaths).toEqual([
      `${API_PREFIX}/remove-participant-group`,
      `${API_PREFIX}/promote-participant-group`,
      `${API_PREFIX}/demote-participant-group`,
    ]);
  });

  it('groups.updateSubject envia { groupId, title } (campo "title", não "subject"/"name")', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/group-subject`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updateSubject({ groupId: '120363000000000000@g.us', subject: 'Novo nome' });

    expect(capturedBody).toEqual({ groupId: '120363000000000000@g.us', title: 'Novo nome' });
  });

  it('groups.updateDescription envia { groupId, description }', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/group-description`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updateDescription({
      groupId: '120363000000000000@g.us',
      description: 'Nova descrição',
    });

    expect(capturedBody).toEqual({
      groupId: '120363000000000000@g.us',
      description: 'Nova descrição',
    });
  });

  it('groups.updatePicture envia { groupId, path } (campo "path", mesmo tratamento do sticker)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/group-pic`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.updatePicture({
      groupId: '120363000000000000@g.us',
      media: { kind: 'image', url: 'https://cdn.exemplo.test/foto-grupo.jpg' },
    });

    expect(capturedBody).toEqual({
      groupId: '120363000000000000@g.us',
      path: 'https://cdn.exemplo.test/foto-grupo.jpg',
    });
  });

  it('groups.getInviteLink extrai a URL quando "response" é uma string direta', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.groups.getInviteLink('120363000000000000@g.us');

    expect(result.link).toBe('https://chat.whatsapp.com/CONTRATOCODIGO');
    expect(result).toHaveProperty('raw');
  });

  it('groups.revokeInviteLink extrai a URL quando "response" é um objeto com chave "link"', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.groups.revokeInviteLink('120363000000000000@g.us');

    expect(result.link).toBe('https://chat.whatsapp.com/CONTRATONOVOCODIGO');
  });

  it('groups.joinViaInviteLink envia o LINK COMPLETO em "inviteCode" (endpoint confirmado aceitar ambos os formatos)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/join-code`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await wa.groups.joinViaInviteLink({ invite: 'CONTRATO_CODIGO_CONVITE' });

    expect(capturedBody).toEqual({
      inviteCode: 'https://chat.whatsapp.com/CONTRATO_CODIGO_CONVITE',
    });
  });

  it('groups.leaveGroup envia { groupId }', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/leave-group`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.groups.leaveGroup('120363000000000000@g.us')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ groupId: '120363000000000000@g.us' });
  });

  it('groups.list chama POST /list-chats com {onlyGroups:true} e mapeia Chat[] para GroupInfo[] (participants sempre vazio)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/list-chats`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const groups = await wa.groups.list();

    expect(capturedBody).toEqual({ onlyGroups: true });
    expect(groups).toEqual([
      {
        id: '120363000000000000@g.us',
        subject: 'Grupo de teste (list-chats)',
        description: undefined,
        participants: [],
        raw: expect.anything(),
      },
    ]);
  });

  it('groups.list devolve [] (em vez de lançar) quando POST /list-chats responde algo que não é array', async () => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/list-chats`) {
            return jsonResponse(200, {});
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.groups.list()).resolves.toEqual([]);
  });

  it('contacts.checkExists mapeia numberExists->exists e id._serialized->chatId', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const result = await wa.contacts.checkExists('5511999999999');

    expect(result.exists).toBe(true);
    expect(result.chatId).toBe('5511999999999@c.us');
    expect(result).toHaveProperty('raw');
  });

  it('contacts.list mapeia o array de _serializeContactObj (GET /all-contacts) para Contact[]', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const list = await wa.contacts.list();

    expect(list).toEqual([
      {
        id: '5511988887777@c.us',
        name: 'Contato de teste',
        about: undefined,
        profilePictureUrl: 'https://pps.whatsapp.net/fake-img-full.jpg',
        hasWhatsApp: true,
        isBlocked: undefined,
        raw: expect.anything(),
      },
    ]);
  });

  it('contacts.list devolve [] (em vez de lançar) quando GET /all-contacts responde algo que não é array', async () => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/all-contacts`) {
            return jsonResponse(200, envelope(null));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.contacts.list()).resolves.toEqual([]);
  });

  it('contacts.get mapeia _serializeContactObj (GET /contact/:phone) e prioriza "name" sobre "pushname"', async () => {
    let capturedPath: string | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith(`${API_PREFIX}/contact/`)) {
            capturedPath = url.pathname;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const contact = await wa.contacts.get('5511999999999');

    expect(capturedPath).toBe(`${API_PREFIX}/contact/5511999999999`);
    expect(contact.id).toBe('5511999999999@c.us');
    expect(contact.name).toBe('Contato de teste');
    expect(contact.hasWhatsApp).toBe(true);
    expect(contact.profilePictureUrl).toBe('https://pps.whatsapp.net/fake-img-full.jpg');
  });

  it('contacts.getProfilePicture prioriza "imgFull" sobre "img" (GET /profile-pic/:phone)', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(picture.url).toBe('https://pps.whatsapp.net/fake-img-full.jpg');
    expect(picture).toHaveProperty('raw');
  });

  it('contacts.getProfilePicture cai para "img" quando "imgFull" está ausente', async () => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith(`${API_PREFIX}/profile-pic/`)) {
            return jsonResponse(
              200,
              envelope({ img: 'https://pps.whatsapp.net/fake-img-so.jpg', imgFull: null }),
            );
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const picture = await wa.contacts.getProfilePicture('5511999999999');

    expect(picture.url).toBe('https://pps.whatsapp.net/fake-img-so.jpg');
  });

  it('contacts.getAbout mapeia "status" -> "about" (GET /profile-status/:phone)', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout('5511999999999');

    expect(about.about).toBe('Disponível para contrato de teste');
    expect(about).toHaveProperty('raw');
  });

  it('contacts.getAbout trata "status" vazio como "about" ausente (nunca string vazia)', async () => {
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith(`${API_PREFIX}/profile-status/`)) {
            return jsonResponse(200, envelope({ id: '5511999999999@c.us', status: '' }));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const about = await wa.contacts.getAbout('5511999999999');

    expect(about.about).toBeUndefined();
  });

  it('contacts.block envia { phone } para /block-contact e ignora a resposta', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/block-contact`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.block('5511988887777')).resolves.toBeUndefined();
    expect(capturedBody).toEqual({ phone: '5511988887777' });
  });

  it('contacts.unblock envia { phone } para /unblock-contact e ignora a resposta', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/unblock-contact`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.contacts.unblock('5511988887777')).resolves.toBeUndefined();
    expect(capturedBody).toEqual({ phone: '5511988887777' });
  });

  it('contacts.listBlocked mapeia data[].phone -> array de chatIds (bare digits, sem sufixo JID)', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const blocked = await wa.contacts.listBlocked();

    expect(blocked).toEqual(['5511988887777']);
  });

  it('messages.edit envia { id, newText } para POST /edit-message (sem phone/isGroup) e mapeia a resposta BARE (sem array)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/edit-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const edited = await wa.messages.edit({
      to: '5511999999999',
      messageId: 'true_5511999999999@c.us_3EB0FAKECONTRATOTXT',
      text: 'contrato: texto editado',
    });

    expect(capturedBody).toEqual({
      id: 'true_5511999999999@c.us_3EB0FAKECONTRATOTXT',
      newText: 'contrato: texto editado',
    });
    expect(capturedBody?.phone).toBeUndefined();
    expect(edited.id).toBe('true_5511999999999@c.us_3EB0FAKECONTRATOTXT');
    expect(edited.chatId).toBe('5511999999999@c.us');
    expect(edited.timestamp).toBe(1751000020 * 1000);
  });

  it('messages.delete envia { phone, isGroup, messageId, onlyLocal: false } para POST /delete-message (revogação sempre para todos)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/delete-message`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.delete({
        to: '5511999999999',
        messageId: 'true_5511999999999@c.us_3EB0FAKECONTRATOTXT',
      }),
    ).resolves.toBeUndefined();

    expect(capturedBody).toEqual({
      phone: '5511999999999',
      isGroup: false,
      messageId: 'true_5511999999999@c.us_3EB0FAKECONTRATOTXT',
      onlyLocal: false,
    });
  });

  it('messages.forward envia { phone, isGroup, messageId } para POST /forward-messages', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/forward-messages`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const forwarded = await wa.messages.forward({
      to: '5511999999999',
      messageId: 'true_5511988887777@c.us_3EB0FAKEORIGINAL',
    });

    expect(capturedBody).toEqual({
      phone: '5511999999999',
      isGroup: false,
      messageId: 'true_5511988887777@c.us_3EB0FAKEORIGINAL',
    });
    expect(forwarded.chatId).toBe('5511999999999@c.us');
  });

  it('messages.star/unstar chamam POST /star-message com {messageId, star: boolean} (sem phone/isGroup)', async () => {
    const hits: unknown[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/star-message`) {
            hits.push(JSON.parse(String(init?.body)));
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(
      wa.messages.star({ to: '5511999999999', messageId: 'true_5511999999999@c.us_MOCKSTAR' }),
    ).resolves.toBeUndefined();
    await expect(
      wa.messages.unstar({ to: '5511999999999', messageId: 'true_5511999999999@c.us_MOCKSTAR' }),
    ).resolves.toBeUndefined();

    expect(hits).toEqual([
      { messageId: 'true_5511999999999@c.us_MOCKSTAR', star: true },
      { messageId: 'true_5511999999999@c.us_MOCKSTAR', star: false },
    ]);
  });

  it('messages.sendLocation envia {phone, isGroup, lat, lng, title, address} (lat/lng como strings) para POST /send-location', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-location`) {
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

    expect(sent.chatId).toBe('5511999999999@c.us');
    expect(capturedBody).toEqual({
      phone: '5511999999999',
      isGroup: false,
      lat: '-3.7',
      lng: '-38.5',
      title: 'Escritório',
      address: 'Av. Principal, 100',
    });
  });

  it('messages.sendContactCard envia {phone, isGroup, name, contactsId: [contactPhone]} para POST /contact-vcard', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/contact-vcard`) {
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

    expect(sent.chatId).toBe('5511999999999@c.us');
    expect(capturedBody).toEqual({
      phone: '5511999999999',
      isGroup: false,
      name: 'Fulano',
      contactsId: ['5511988888888'],
    });
  });

  it('messages.sendPoll envia {phone, isGroup, name, choices, options: {selectableCount}} para POST /send-poll-message', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-poll-message`) {
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

    expect(sent.chatId).toBe('5511999999999@c.us');
    expect(capturedBody).toEqual({
      phone: '5511999999999',
      isGroup: false,
      name: 'Qual sua cor favorita?',
      choices: ['Azul', 'Verde'],
      options: { selectableCount: 2 },
    });
  });

  it('não declara messages.pin/unpin/markRead (nível de mensagem — só /pin-chat e mark-unseen/send-seen de nível de conversa existem)', () => {
    const adapter = wppconnect(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('messages.pin');
    expect(adapter.capabilities).not.toContain('messages.markRead');
    expect(adapter.messages.pin).toBeUndefined();
  });

  it('presence.setTyping roteia composing/paused para POST /typing e recording para POST /recording, com {phone, isGroup, value}', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === `${API_PREFIX}/typing` ||
            url.pathname === `${API_PREFIX}/recording`
          ) {
            calls.push({
              path: url.pathname,
              body: JSON.parse(String(init?.body)),
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.presence.setTyping({ to: '5511999999999', state: 'composing' });
    await wa.presence.setTyping({ to: '5511999999999', state: 'recording' });
    await wa.presence.setTyping({ to: '5511999999999', state: 'paused' });

    expect(calls).toEqual([
      {
        path: `${API_PREFIX}/typing`,
        body: { phone: '5511999999999', isGroup: false, value: true },
      },
      {
        path: `${API_PREFIX}/recording`,
        body: { phone: '5511999999999', isGroup: false, value: true },
      },
      {
        path: `${API_PREFIX}/typing`,
        body: { phone: '5511999999999', isGroup: false, value: false },
      },
    ]);
  });

  it('presence.set envia {isOnline} para POST /set-online-presence', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/set-online-presence`) {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await wa.presence.set('online');
    await wa.presence.set('offline');

    expect(capturedBodies).toEqual([{ isOnline: true }, { isOnline: false }]);
  });

  it('presence.subscribe envia {phone, isGroup, all: false} para POST /subscribe-presence', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/subscribe-presence`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.presence.subscribe('5511999999999')).resolves.toBeUndefined();
    expect(capturedBody).toEqual({ phone: '5511999999999', isGroup: false, all: false });
  });

  it('labels.list chama GET /get-all-labels e mapeia {id, name, color}', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);
    const labels = await wa.labels.list();

    expect(labels).toEqual([{ id: '1', name: 'Cliente', color: '2', raw: expect.anything() }]);
  });

  it('labels.create chama POST /add-new-label e descobre o id criado por diff em GET /get-all-labels (antes/depois) — a resposta de create não devolve o label', async () => {
    let listCalls = 0;
    const editCalls: Array<Record<string, unknown>> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/get-all-labels' && (init?.method ?? 'GET').toUpperCase() === 'GET') {
            listCalls += 1;
            const response =
              listCalls === 1
                ? [{ id: '1', name: 'Cliente', color: 2 }]
                : [
                    { id: '1', name: 'Cliente', color: 2 },
                    { id: '2', name: 'Cliente VIP', color: 3 },
                  ];
            return jsonResponse(200, envelope(response));
          }
          if (suffix === '/add-new-label') {
            editCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const label = await wa.labels.create({ name: 'Cliente VIP', color: '3' });

    expect(listCalls).toBe(2);
    expect(editCalls).toEqual([{ name: 'Cliente VIP', options: { labelColor: '3' } }]);
    expect(label).toEqual({ id: '2', name: 'Cliente VIP', color: '3', raw: expect.anything() });
  });

  it('labels.create omite "options" quando color está ausente', async () => {
    const editCalls: Array<Record<string, unknown>> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/add-new-label') {
            editCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const failure = await wa.labels
      .create({ name: 'Cliente novo' })
      .catch((error: unknown) => error);
    // A stub padrão devolve sempre o mesmo label — nenhum id novo aparece, então cai em PROVIDER_ERROR
    // (mesmo assim, o corpo de /add-new-label já foi capturado antes da segunda listagem).
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
    expect(editCalls).toEqual([{ name: 'Cliente novo' }]);
  });

  it('labels.create falha com PROVIDER_ERROR quando GET /get-all-labels não traz nenhum id novo após o create', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.labels
      .create({ name: 'Cliente VIP' })
      .catch((error: unknown) => error);
    expect(isWaConnectorError(failure) && failure.code === 'PROVIDER_ERROR').toBe(true);
  });

  it('labels.delete chama PUT /delete-label/{id} (método PUT, não DELETE)', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/delete-label/1') {
            calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: suffix });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.labels.delete('1')).resolves.toBeUndefined();

    expect(calls).toEqual([{ method: 'PUT', path: '/delete-label/1' }]);
  });

  it('labels.addToChat/removeFromChat chamam POST /add-or-remove-label com {chatIds: [jid], options: [{labelId, type}]}', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/add-or-remove-label') {
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
      { chatIds: ['5511999999999@c.us'], options: [{ labelId: '1', type: 'add' }] },
      { chatIds: ['5511999999999@c.us'], options: [{ labelId: '1', type: 'remove' }] },
    ]);
  });

  it('não declara "labels.update" (sem endpoint de edição de label confirmado na pesquisa) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('labels.update');
    expect(adapter.labels?.update).toBeUndefined();

    const wa = createConnector(adapter);
    const failure = await wa.labels
      .update({ labelId: '1', name: 'Cliente VIP' })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
    }
  });

  it('channels.create chama POST /newsletter com {name, options: {description}} e mapeia idJid/name/description/subscribersCount', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/newsletter') {
            calls.push({ path: suffix, body: JSON.parse(String(init?.body)) });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    const channel = await wa.channels.create({ name: 'Canal Novo', description: 'Descrição' });

    expect(calls).toEqual([
      { path: '/newsletter', body: { name: 'Canal Novo', options: { description: 'Descrição' } } },
    ]);
    expect(channel).toEqual({
      id: '222222222222222222@newsletter',
      name: 'Contrato: Canal Novo',
      // A resposta simulada devolve description:null (real do provider — o campo não é sempre
      // ecoado); o mapper cai para o description enviado no input original ("Descrição").
      description: 'Descrição',
      subscribersCount: 0,
      raw: expect.anything(),
    });
  });

  it('channels.delete chama DELETE /newsletter/{id}', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix.startsWith('/newsletter/')) {
            calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: suffix });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(wa.channels.delete('111111111111111111@newsletter')).resolves.toBeUndefined();

    expect(calls).toEqual([
      { method: 'DELETE', path: '/newsletter/111111111111111111%40newsletter' },
    ]);
  });

  it('não declara "channels.list"/"getInfo"/"follow"/"unfollow" (sem endpoint HTTP exposto pelo servidor, mesmo com a lib subjacente suportando follow/unfollow) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    for (const capability of [
      'channels.list',
      'channels.getInfo',
      'channels.follow',
      'channels.unfollow',
    ] as const) {
      expect(adapter.capabilities).not.toContain(capability);
    }
    expect(adapter.channels?.list).toBeUndefined();
    expect(adapter.channels?.getInfo).toBeUndefined();
    expect(adapter.channels?.follow).toBeUndefined();
    expect(adapter.channels?.unfollow).toBeUndefined();

    const wa = createConnector(adapter);
    const calls = [
      () => wa.channels.list(),
      () => wa.channels.getInfo('111111111111111111@newsletter'),
      () => wa.channels.follow('111111111111111111@newsletter'),
      () => wa.channels.unfollow('111111111111111111@newsletter'),
    ];
    for (const call of calls) {
      const failure = await call().catch((error: unknown) => error);
      expect(isWaConnectorError(failure)).toBe(true);
      if (isWaConnectorError(failure)) {
        expect(failure.code).toBe('UNSUPPORTED_CAPABILITY');
      }
    }
  });

  it('business.updateProfile chama POST /edit-business-profile com {adress, email} (sem description) e resolve void', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/edit-business-profile') {
            calls.push({
              method: (init?.method ?? 'GET').toUpperCase(),
              body: init?.body ? JSON.parse(String(init.body)) : undefined,
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(
      wa.business.updateProfile({
        description: 'Descrição ignorada por este provider',
        address: 'Rua Contrato, 1',
        email: 'contrato@exemplo.com',
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        method: 'POST',
        body: { adress: 'Rua Contrato, 1', email: 'contrato@exemplo.com' },
      },
    ]);
  });

  it('não declara "business.getProfile" (sem rota de leitura exposta pelo servidor) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('business.getProfile');
    expect(adapter.business?.getProfile).toBeUndefined();

    const wa = createConnector(adapter);
    const failure = await wa.business.getProfile().catch((error: unknown) => error);
    expect(isWaConnectorError(failure) && failure.code === 'UNSUPPORTED_CAPABILITY').toBe(true);
  });

  it('calls.reject chama POST /reject-call com {callId} (sem callerId) e resolve void', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const suffix = url.pathname.slice(API_PREFIX.length);
          if (suffix === '/reject-call') {
            calls.push({
              method: (init?.method ?? 'GET').toUpperCase(),
              body: init?.body ? JSON.parse(String(init.body)) : undefined,
            });
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);

    await expect(
      wa.calls.reject({ callId: 'call-1', callerId: '5585999999999' }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([{ method: 'POST', body: { callId: 'call-1' } }]);
  });

  it('calls.reject exige callId com INVALID_INPUT quando faltar', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    const wa = createConnector(adapter);

    const failure = await wa.calls.reject({}).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_INPUT').toBe(true);
  });

  it('não declara "calls.make" (nenhum endpoint para originar chamada encontrado) e lança UNSUPPORTED_CAPABILITY ao chamar', async () => {
    const adapter = wppconnect(buildAdapterOptions());
    expect(adapter.capabilities).not.toContain('calls.make');
    expect(adapter.calls?.make).toBeUndefined();

    const wa = createConnector(adapter);
    const failure = await wa.calls.make({ to: '5585999999999' }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isWaConnectorError(failure) && failure.code === 'UNSUPPORTED_CAPABILITY').toBe(true);
  });

  it('chats.archive envia { phone, isGroup, value: true } para POST /archive-chat', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/archive-chat`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.archive('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ phone: '5511999999999', isGroup: false, value: true });
  });

  it('chats.unarchive envia { phone, isGroup, value: false } no MESMO endpoint /archive-chat (toggle)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/archive-chat`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.unarchive('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ phone: '5511999999999', isGroup: false, value: false });
  });

  it('chats.pin envia state como STRING "true" (não booleano) para POST /pin-chat — workaround do bug confirmado (state === \'true\')', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/pin-chat`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.pin('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody?.state).toBe('true');
    expect(typeof capturedBody?.state).toBe('string');
  });

  it('chats.unpin envia state como STRING "false" (não booleano) para POST /pin-chat', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/pin-chat`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.unpin('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody?.state).toBe('false');
    expect(typeof capturedBody?.state).toBe('string');
  });

  it('chats.mute envia { phone, isGroup, time, type: "hours" } para POST /send-mute (duração escolhida pelo adapter, sem "year" bugado)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-mute`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.mute('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({
      phone: '5511999999999',
      isGroup: false,
      time: 24 * 365 * 10,
      type: 'hours',
    });
  });

  it('chats.unmute OMITE time/type de propósito (cai no branch de remoção confirmado no dossiê)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-mute`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.unmute('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ phone: '5511999999999', isGroup: false });
    expect(capturedBody?.time).toBeUndefined();
    expect(capturedBody?.type).toBeUndefined();
  });

  it('chats.markUnread envia { phone, isGroup } para POST /mark-unseen', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/mark-unseen`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.markUnread('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ phone: '5511999999999', isGroup: false });
  });

  it('chats.markRead envia { phone, isGroup } para POST /send-seen e ignora a resposta mesmo com o envelope de "S" maiúsculo', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === `${API_PREFIX}/send-seen`) {
            capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    await expect(wa.chats.markRead('5511999999999')).resolves.toBeUndefined();

    expect(capturedBody).toEqual({ phone: '5511999999999', isGroup: false });
  });

  it('chats.archive/pin/mute usam o chatId de grupo extraindo a parte local do JID (isGroup:true, evitando sufixo duplicado)', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const adapter = wppconnect(
      buildAdapterOptions({
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (
            url.pathname === `${API_PREFIX}/archive-chat` ||
            url.pathname === `${API_PREFIX}/pin-chat` ||
            url.pathname === `${API_PREFIX}/send-mute`
          ) {
            capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          }
          return createFetchStub()(input, init);
        },
      }),
    );
    const wa = createConnector(adapter);
    const groupChatId = '120363000000000000@g.us';
    await wa.chats.archive(groupChatId);
    await wa.chats.pin(groupChatId);
    await wa.chats.mute(groupChatId);

    for (const body of capturedBodies) {
      expect(body.phone).toBe('120363000000000000');
      expect(body.isGroup).toBe(true);
    }
  });

  it('parseWebhook normaliza "onmessage" (texto) para message.received', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: messageReceivedFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.provider).toBe('wppconnect');
      expect(event.instanceId).toBe('minha-sessao');
      expect(event.message.id).toBe('true_5511999999999@c.us_3EB0FAKE000000000WPP1');
      expect(event.message.chatId).toBe('5511999999999@c.us');
      expect(event.message.kind).toBe('text');
      expect(event.message.text).toBe('Ola, tudo bem?');
      expect(event.message.fromMe).toBe(false);
      expect(event.message.timestamp).toBe(1751000000 * 1000);
    }
  });

  it('parseWebhook normaliza "onmessage" (imagem) com caption em "text" e mimeType em "media", sem url (não confirmado)', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: imageMessageFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.received');
    if (event?.type === 'message.received') {
      expect(event.message.kind).toBe('image');
      expect(event.message.text).toBe('Legenda da foto');
      expect(event.message.media).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    }
  });

  it('parseWebhook normaliza "onack" extraindo id._serialized e mapeando ack numérico (3 -> read)', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: ackFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('message.ack');
    if (event?.type === 'message.ack') {
      expect(event.messageId).toBe('true_5511999999999@c.us_3EB0FAKE000000000WPP1');
      expect(event.chatId).toBe('5511999999999@c.us');
      expect(event.ack).toBe('read');
    }
  });

  it('parseWebhook normaliza "qrcode" para connection.update com qr SEM prefixo data URI', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: qrcodeFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('qr');
      expect(event.qr).toBe('iVBORw0KGgoAAAANSUhEUgAAAfakeQrBase64Payload==');
      expect(event.instanceId).toBe('minha-sessao');
    }
  });

  it('parseWebhook normaliza "status-find" (inChat) para connection.update "connected"', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: statusFindFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('connection.update');
    if (event?.type === 'connection.update') {
      expect(event.state).toBe('connected');
    }
  });

  it('parseWebhook normaliza "onparticipantschanged" (operation=add) para group.update com action "participants.add"', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({ body: groupParticipantsFixture });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('group.update');
    if (event?.type === 'group.update') {
      expect(event.groupId).toBe('120363000000000000@g.us');
      expect(event.action).toBe('participants.add');
      expect(event.participants).toEqual(['5511988887777@c.us']);
      expect(event.provider).toBe('wppconnect');
      expect(event.instanceId).toBe('minha-sessao');
    }
  });

  it('parseWebhook reconhece "onpresencechanged" mas cai em "unknown" (sem equivalente canônico)', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { event: 'onpresencechanged', session: 'minha-sessao', id: '5511999999999@c.us' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
    if (events[0]?.type === 'unknown') {
      expect(events[0].reason).toContain('onpresencechanged');
    }
  });

  it('parseWebhook reconhece "onreactionmessage" mas cai em "unknown" (sem shape confirmado)', () => {
    const adapter = wppconnect(buildAdapterOptions());
    const events = adapter.parseWebhook({
      body: { event: 'onreactionmessage', session: 'minha-sessao' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  it('parseWebhook nunca lança para payload desconhecido ou quebrado (vira "unknown")', () => {
    const adapter = wppconnect(buildAdapterOptions());

    expect(() => adapter.parseWebhook({ body: null })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: 'string-solta' })).not.toThrow();
    expect(() => adapter.parseWebhook({ body: { session: 'minha-sessao' } })).not.toThrow();
    expect(() =>
      adapter.parseWebhook({ body: { event: 'algo-nao-mapeado', session: 'x' } }),
    ).not.toThrow();

    const events = adapter.parseWebhook({ body: { formato: 'desconhecido' } });
    expect(events.every((event) => event.type === 'unknown')).toBe(true);
  });
});
