import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CallsApi,
  ChannelsApi,
  ChatsApi,
  ContactsApi,
  GroupsApi,
  InstanceApi,
  LabelsApi,
  MessagesApi,
  PresenceApi,
  WaAdapter,
  WebhookInput,
} from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { normalizeInviteLink } from '../../core/chat-id';
import { WaConnectorError } from '../../core/errors';
import type {
  CanonicalEvent,
  ConnectionUpdateEvent,
  GroupUpdateEvent,
  UnknownEvent,
} from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ChannelInfo,
  CheckExistsResult,
  ConnectResult,
  Contact,
  ContactAbout,
  ContactProfilePicture,
  GroupInfo,
  GroupInviteLink,
  GroupParticipant,
  InstanceState,
  LabelInfo,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  RejectCallInput,
  SentMessage,
  StarMessageInput,
  WaMessage,
} from '../../core/types';

/**
 * Opções do adapter WAHA (waha.devlike.pro). `baseUrl` é sempre fornecido pelo consumidor —
 * WAHA é self-hosted, não existe endpoint SaaS fixo. Ver docs/providers/waha.md.
 */
export interface WahaOptions {
  /** URL base da instância WAHA, ex.: `http://localhost:3000`. */
  baseUrl: string;
  /** Enviado no header `X-Api-Key`. Pode ser a chave global (`WAHA_API_KEY`) ou uma chave escopada por sessão (Keys API). */
  apiKey: string;
  /** Nome da sessão WAHA (equivalente a "instance" em outros providers). Padrão: `'default'`. */
  session?: string;
  /** Timeout por tentativa, em ms (repassado ao HttpClient). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao HttpClient). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de HttpClientOptions). */
  fetch?: typeof globalThis.fetch;
  /**
   * Chave HMAC configurada no lado do servidor WAHA (`config.webhooks[].hmac.key` na sessão, ou
   * `WHATSAPP_HOOK_HMAC_KEY` globalmente). Quando definida, `parseWebhook` verifica a assinatura
   * `X-Webhook-Hmac` (HMAC-SHA512, conforme `X-Webhook-Hmac-Algorithm: sha512`) antes de processar
   * o payload — ver docs/providers/waha.md#verificação-hmac-de-webhooks.
   *
   * **Exige `WebhookInput.rawBody`**: a verificação precisa do corpo bruto do request (bytes
   * originais, antes do `JSON.parse` do framework do consumidor) — reserializar `body` já
   * parseado não é garantidamente idêntico byte-a-byte ao que o WAHA assinou. Se `webhookHmacKey`
   * estiver configurada mas `rawBody` não vier em `parseWebhook`, o adapter falha fechado: trata o
   * webhook como não verificável e devolve evento `unknown` (nunca processa o payload como se a
   * assinatura fosse válida). Opt-in: se `webhookHmacKey` não for configurada, o comportamento é
   * o mesmo de antes (sem verificação).
   */
  webhookHmacKey?: string;
}

const PROVIDER = 'waha';

const WAHA_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'messages.sendReaction',
  'messages.edit',
  'messages.delete',
  'messages.forward',
  'messages.star',
  'messages.unstar',
  'messages.pin',
  'messages.unpin',
  'messages.markRead',
  'messages.sendLocation',
  'messages.sendContactCard',
  'messages.sendPoll',
  'groups.create',
  'groups.getInfo',
  'groups.list',
  'groups.addParticipants',
  'groups.removeParticipants',
  'groups.promoteParticipants',
  'groups.demoteParticipants',
  'groups.updateSubject',
  'groups.updateDescription',
  'groups.updatePicture',
  'groups.getInviteLink',
  'groups.revokeInviteLink',
  'groups.joinViaInviteLink',
  'groups.leaveGroup',
  'contacts.list',
  'contacts.get',
  'contacts.checkExists',
  'contacts.getProfilePicture',
  'contacts.getAbout',
  'contacts.block',
  'contacts.unblock',
  'chats.archive',
  'chats.unarchive',
  'chats.markRead',
  'chats.markUnread',
  'presence.setTyping',
  'presence.set',
  'presence.subscribe',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'channels.list',
  'channels.create',
  'channels.getInfo',
  'channels.delete',
  'channels.follow',
  'channels.unfollow',
  'calls.reject',
  'webhooks.parse',
];

/** Cria um adapter WAHA pronto para uso com `createConnector`. */
export function waha(options: WahaOptions): WaAdapter {
  const session = options.session ?? 'default';
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { 'X-Api-Key': options.apiKey },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.apiKey],
    provider: PROVIDER,
    fetch: options.fetch,
  });

  const instance: InstanceApi = {
    connect: async (): Promise<ConnectResult> => {
      await http.request({
        method: 'POST',
        path: `/api/sessions/${encodeURIComponent(session)}/start`,
      });
      const qrBody = await http.request<unknown>({
        method: 'GET',
        path: `/api/${encodeURIComponent(session)}/auth/qr`,
        query: { format: 'raw' },
      });
      return { qr: extractQr(qrBody), raw: qrBody };
    },

    status: async () => {
      const body = await http.request<unknown>({
        method: 'GET',
        path: `/api/sessions/${encodeURIComponent(session)}`,
      });
      const record = asRecord(body);
      return {
        state: mapWahaStatus(record ? asString(record.status) : undefined),
        raw: body,
      };
    },

    logout: async () => {
      await http.request({
        method: 'POST',
        path: `/api/sessions/${encodeURIComponent(session)}/logout`,
      });
    },
  };

  const messages: MessagesApi = {
    sendText: async (input) => {
      const chatId = toWahaChatId(input.to);
      const requestBody: Record<string, unknown> = {
        chatId,
        text: input.text,
        session,
        reply_to: input.quotedId,
      };
      if (input.mentions && input.mentions.length > 0) {
        requestBody.mentions = input.mentions.map(toWahaMention);
      }
      const body = await http.request<unknown>({
        method: 'POST',
        path: '/api/sendText',
        body: requestBody,
      });
      return mapSentMessage(body, chatId);
    },

    sendMedia: async (input) => {
      const chatId = toWahaChatId(input.to);
      const file = buildWahaFile(input.media);
      const requestBody: Record<string, unknown> = {
        chatId,
        file,
        session,
        reply_to: input.quotedId,
      };
      // MessageVoiceRequest (POST /api/sendVoice) não declara `caption` no schema real do WAHA —
      // diferente de Image/File/Video. Omitir de fato a chave (não só deixar undefined) para não
      // fingir suporte a um campo não documentado/não suportado pelo endpoint de áudio.
      if (input.media.kind !== 'audio') {
        requestBody.caption = input.caption;
      }
      // MessageVideoRequest/MessageVoiceRequest marcam `convert` como obrigatório no openapi.json
      // real do WAHA. `SendMediaInput` não expõe essa opção ao chamador, então enviamos um default
      // explícito (não converter) em vez de omitir um campo documentado como required.
      if (input.media.kind === 'video' || input.media.kind === 'audio') {
        requestBody.convert = false;
      }
      const body = await http.request<unknown>({
        method: 'POST',
        path: mediaEndpoint(input.media.kind),
        body: requestBody,
      });
      return mapSentMessage(body, chatId);
    },

    sendReaction: async (input) => {
      // Schema `MessageReactionRequest`, endpoint `PUT /api/reaction` — a doc oficial avisa
      // explicitamente que é PUT, não POST ("Reaction API uses PUT, not POST request!"). Não há
      // campo `chatId` separado no schema: a mensagem-alvo (e portanto o chat) é resolvida pelo
      // `messageId`, que já é o JID completo da mensagem (ex.:
      // "false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA"). `input.to` não é enviado no body — segue
      // como `requestedChatId` só para popular `SentMessage.chatId` no fallback de
      // `mapSentMessage`, mesmo padrão usado em sendText/sendMedia.
      const chatId = toWahaChatId(input.to);
      const body = await http.request<unknown>({
        method: 'PUT',
        path: '/api/reaction',
        body: {
          session,
          messageId: input.messageId,
          reaction: input.emoji,
        },
      });
      return mapSentMessage(body, chatId);
    },

    /**
     * `PUT /api/{session}/chats/{chatId}/messages/{messageId}` (retrofit ADR-0012; confirmado no
     * `openapi.json` oficial, operationId `ChatsController_editMessage`, schema
     * `EditMessageRequest` — confiança Alta, com exemplo curl completo em
     * `docs/how-to/send-messages/` e `docs/how-to/chats/`). Body: `{ text }` — o schema também
     * aceita `linkPreview`/`linkPreviewHighQuality` opcionais (mesma semântica de `sendText`), mas
     * `EditMessageInput` não expõe esses campos ao chamador, então não são enviados (mesma regra
     * de "não inventar campo fora do contrato canônico" já seguida em `sendMedia`/`convert`). A doc
     * confirma explicitamente: "You can edit text messages or 'caption' in media messages". Sem
     * janela de tempo validada pelo WAHA (nenhuma das duas fontes documenta um prazo de edição,
     * diferente do limite real de ~15min do WhatsApp) — a confirmar contra instância real. Resposta
     * `200` sem schema de conteúdo — `mapSentMessage` cai no mesmo fallback já usado por
     * `sendReaction`. Ver docs/providers/waha.md#edição-e-exclusão-de-mensagem.
     */
    edit: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request<unknown>({
        method: 'PUT',
        path: messagePath(session, input.to, input.messageId),
        body: { text: input.text },
      });
      return mapSentMessage(body, chatId);
    },

    /**
     * `DELETE /api/{session}/chats/{chatId}/messages/{messageId}` (retrofit ADR-0012; confirmado
     * no `openapi.json` oficial, operationId `ChatsController_deleteMessage` — confiança Alta,
     * mesmo exemplo em `docs/how-to/send-messages/` e `docs/how-to/chats/`). Sem body, sem schema
     * de resposta relevante — contrato retorna `void`. Nenhuma das duas fontes documenta uma
     * distinção "apagar só localmente" vs. "apagar para todos" (revoke) — `DeleteMessageInput` não
     * carrega campo de escopo (ver ADR-0012), o adapter apenas dispara a chamada. Ver
     * docs/providers/waha.md#edição-e-exclusão-de-mensagem.
     */
    delete: async (input) => {
      await http.request({
        method: 'DELETE',
        path: messagePath(session, input.to, input.messageId),
      });
    },

    /**
     * `POST /api/forwardMessage` (ADR-0013; `operationId ChattingController_forwardMessage`,
     * schema `MessageForwardRequest` — confiança Alta, página dedicada com exemplo completo).
     * Body: `{chatId, messageId, session}` — `chatId` aqui é o DESTINO (`input.to`); a origem da
     * mensagem é resolvida pelo próprio `messageId` (formato `{fromMe}_{chat}_{id}` já
     * autoidentifica o chat de origem), então `input.fromChatId` (opcional no contrato canônico,
     * ADR-0013) nunca é necessário para este provider e é ignorado se enviado. Resposta `201`:
     * `WAMessage` completo, mesmo shape de `mapSentMessage`. **Nuance documentada verbatim**: "You
     * can forward a message to another chat (that you chatted before, otherwise it may fail)" —
     * encaminhar para um chat nunca contatado pode falhar (limitação do protocolo, não bug do
     * adapter).
     */
    forward: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request<unknown>({
        method: 'POST',
        path: '/api/forwardMessage',
        body: { chatId, messageId: input.messageId, session },
      });
      return mapSentMessage(body, chatId);
    },

    /**
     * `PUT /api/star` (ADR-0013; `operationId ChattingController_setStar`, schema
     * `MessageStarRequest` — confiança Alta, página dedicada "Star and unstar message"). Body:
     * `{messageId, chatId, star, session}` — diferente de `sendReaction` (que resolve o chat só
     * pelo `messageId`), aqui `chatId` é campo obrigatório separado. Um único endpoint com flag
     * booleana cobre as duas direções; `star`/`unstar` do contrato canônico (ADR-0013, capabilities
     * separadas) mapeiam para `star: true`/`star: false` no mesmo endpoint. Resposta `200` sem
     * schema — ignorada, contrato retorna `void`.
     */
    star: async (input) => {
      await setStarred(http, session, input, true);
    },
    unstar: async (input) => {
      await setStarred(http, session, input, false);
    },

    /**
     * `POST .../messages/{messageId}/pin` / `.../unpin` (ADR-0013; schema `PinMessageRequest`,
     * confiança Alta para request, Média para o schema de resposta — doc e `openapi.json`
     * divergem, mesma classe de gap já documentada em `groups.updatePicture`). `pin` exige
     * `duration` em SEGUNDOS — só 3 valores são aceitos nativamente pelo WhatsApp: `86400` (24h),
     * `604800` (7 dias), `2592000` (30 dias). `PinMessageInput` do contrato canônico não expõe
     * duração (ADR-0013 — nenhum formato converge entre providers); este adapter usa `86400` (24h)
     * como default, decisão própria documentada aqui, não um default do provider. `unpin` não tem
     * body. Resposta (segundo a doc, não o schema): `{success: true}` — ignorada, `Promise<void>`.
     */
    pin: async (input) => {
      await http.request({
        method: 'POST',
        path: messagePath(session, input.to, input.messageId, 'pin'),
        body: { duration: WAHA_PIN_DURATION_SECONDS },
      });
    },
    unpin: async (input) => {
      await http.request({
        method: 'POST',
        path: messagePath(session, input.to, input.messageId, 'unpin'),
      });
    },

    /**
     * `POST /api/sendSeen` (ADR-0013; `operationId ChattingController_sendSeen`, schema
     * `SendSeenRequest` — confiança Alta). Nível de MENSAGEM (`messageIds`), distinto de
     * `chats.markRead` (nível de conversa, `POST .../chats/{chatId}/messages/read`, ADR-0012).
     * Body: `{chatId, messageIds: [messageId], session}` — `messageId` (singular) existe no schema
     * mas está `deprecated: true`; este adapter sempre usa o array `messageIds` com um elemento.
     * `participant` (obrigatório só para grupos em engines NOWEB/GOWS) não é enviado — não exposto
     * pelo contrato canônico (`MarkMessageReadInput` não carrega esse campo); pode ser necessário
     * para marcar mensagens de terceiros em grupo, não confirmado contra instância real.
     */
    markRead: async (input) => {
      const chatId = toWahaChatId(input.to);
      await http.request({
        method: 'POST',
        path: '/api/sendSeen',
        body: { chatId, messageIds: [input.messageId], session },
      });
    },

    /**
     * `POST /api/sendLocation` (ADR-0014; `operationId ChattingController_sendLocation`, schema
     * `MessageLocationRequest` — confiança Alta, página dedicada com exemplo curl idêntico). Body:
     * `{chatId, latitude, longitude, title, session}` — **`title` é campo obrigatório no schema,
     * não há `address`** (o `WALocation` de RECEPÇÃO tem `address`/`url`/`description`, mas o
     * request de ENVIO só aceita `title`); `input.address` do contrato canônico não tem para onde
     * ir neste provider e é ignorado. `input.name` mapeia para `title`; se ausente, envia string
     * vazia (o schema exige o campo presente, não necessariamente não-vazio).
     */
    sendLocation: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request<unknown>({
        method: 'POST',
        path: '/api/sendLocation',
        body: {
          chatId,
          latitude: input.latitude,
          longitude: input.longitude,
          title: input.name ?? '',
          session,
        },
      });
      return mapSentMessage(body, chatId);
    },

    /**
     * `POST /api/sendContactVcard` (ADR-0014; `operationId ChattingController_sendContactVcard`,
     * schema `MessageContactVcardRequest` — confiança Média, formatos alternativos do schema
     * `oneOf` não totalmente capturados). Body: `{session, chatId, contacts: [{fullName,
     * phoneNumber}]}` — array de contatos no schema (`VCardContact`), mas `SendContactCardInput`
     * do contrato canônico só modela um único contato; este adapter sempre envia um array de 1
     * elemento. `whatsappId`/`organization` (campos opcionais do schema) não têm de onde vir no
     * contrato canônico e são omitidos.
     */
    sendContactCard: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request<unknown>({
        method: 'POST',
        path: '/api/sendContactVcard',
        body: {
          session,
          chatId,
          contacts: [{ fullName: input.contactName, phoneNumber: input.contactPhone }],
        },
      });
      return mapSentMessage(body, chatId);
    },

    /**
     * `POST /api/sendPoll` (ADR-0014; `operationId ChattingController_sendPoll`, schema
     * `MessagePollRequest` — confiança Alta). Body: `{session, chatId, poll: {name, options,
     * multipleAnswers}}` — `question`/`options`/`allowMultipleAnswers` do contrato canônico mapeiam
     * direto para `name`/`options`/`multipleAnswers` (booleano, sem tradução de escala). A doc
     * recomenda salvar o `id` da resposta para casar com votos recebidos via webhook
     * (`poll.vote`/`poll.vote.failed`) — não modelado nesta fase (fora do escopo de ENVIO).
     */
    sendPoll: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request<unknown>({
        method: 'POST',
        path: '/api/sendPoll',
        body: {
          session,
          chatId,
          poll: {
            name: input.question,
            options: input.options,
            multipleAnswers: !!input.allowMultipleAnswers,
          },
        },
      });
      return mapSentMessage(body, chatId);
    },
  };

  const groups: GroupsApi = {
    create: async (input) => {
      const body = await http.request<unknown>({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/groups`,
        body: {
          name: input.subject,
          participants: toWahaParticipants(input.participants),
        },
      });
      return mapGroupInfo(body, { subject: input.subject, participants: input.participants });
    },

    getInfo: async (groupId) => {
      const body = await http.request<unknown>({
        method: 'GET',
        path: `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(toWahaGroupId(groupId))}`,
      });
      return mapGroupInfo(body, { id: groupId });
    },

    list: async () => {
      const body = await http.request<unknown>({
        method: 'GET',
        path: `/api/${encodeURIComponent(session)}/groups`,
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapGroupInfo(item));
    },

    addParticipants: async (input) => {
      await http.request({
        method: 'POST',
        path: groupParticipantsPath(session, input.groupId, 'participants/add'),
        body: { participants: toWahaParticipants(input.participants) },
      });
    },

    removeParticipants: async (input) => {
      await http.request({
        method: 'POST',
        path: groupParticipantsPath(session, input.groupId, 'participants/remove'),
        body: { participants: toWahaParticipants(input.participants) },
      });
    },

    promoteParticipants: async (input) => {
      await http.request({
        method: 'POST',
        path: groupParticipantsPath(session, input.groupId, 'admin/promote'),
        body: { participants: toWahaParticipants(input.participants) },
      });
    },

    demoteParticipants: async (input) => {
      await http.request({
        method: 'POST',
        path: groupParticipantsPath(session, input.groupId, 'admin/demote'),
        body: { participants: toWahaParticipants(input.participants) },
      });
    },

    updateSubject: async (input) => {
      // PUT /api/{session}/groups/{id}/subject, body { subject }. Resposta sem schema declarado
      // (mesmo gap já visto em `create`) — não precisa processar, contrato retorna void.
      await http.request({
        method: 'PUT',
        path: groupParticipantsPath(session, input.groupId, 'subject'),
        body: { subject: input.subject },
      });
    },

    updateDescription: async (input) => {
      // PUT /api/{session}/groups/{id}/description, body { description }. String vazia é um caso
      // válido (limpa a descrição) — já validado pelo conector, o adapter só repassa.
      await http.request({
        method: 'PUT',
        path: groupParticipantsPath(session, input.groupId, 'description'),
        body: { description: input.description },
      });
    },

    updatePicture: async (input) => {
      // PUT /api/{session}/groups/{id}/picture, body ProfilePictureRequest = { file }. `file`
      // segue o mesmo shape RemoteFile/BinaryFile de sendMedia (buildWahaFile), mas com mimetype
      // padrão 'image/jpeg' em vez de 'application/octet-stream' — grupos só aceitam foto.
      // Resposta documentada como `{ success: boolean }`; ignorada de propósito (contrato retorna
      // void e a doc não deixa claro o que fazer com `success: false`, mesmo padrão de "pode
      // retornar false silenciosamente" já observado em subject/description).
      const file = buildWahaFile(input.media, 'image/jpeg');
      await http.request({
        method: 'PUT',
        path: groupParticipantsPath(session, input.groupId, 'picture'),
        body: { file },
      });
    },

    getInviteLink: async (groupId) => {
      // GET /api/{session}/groups/{id}/invite-code. Resposta (openapi.json): STRING PURA (schema
      // `type: string`), o código bare — a doc manda montar o link completo à mão
      // ("then you can put it in the url https://chat.whatsapp.com/{inviteCode}").
      // `normalizeInviteLink` faz essa montagem (ver docs/providers/waha.md#grupos-convite).
      const body = await http.request<unknown>({
        method: 'GET',
        path: groupParticipantsPath(session, groupId, 'invite-code'),
      });
      return mapGroupInviteLink(body);
    },

    revokeInviteLink: async (groupId) => {
      // POST /api/{session}/groups/{id}/invite-code/revoke. Mesmo shape de resposta de
      // getInviteLink (string pura com o novo código bare) — mesma conversão.
      const body = await http.request<unknown>({
        method: 'POST',
        path: groupParticipantsPath(session, groupId, 'invite-code/revoke'),
      });
      return mapGroupInviteLink(body);
    },

    joinViaInviteLink: async (input) => {
      // POST /api/{session}/groups/join, body { code }. O conector já entrega `input.invite`
      // sempre como link completo (prepareJoinViaInviteLink) — a doc do WAHA aceita tanto o link
      // completo quanto o código bare em `code`, então repassamos direto, sem
      // `extractInviteCode` (diferente do que outros providers podem precisar).
      await http.request({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/groups/join`,
        body: { code: input.invite },
      });
    },

    leaveGroup: async (groupId) => {
      // POST /api/{session}/groups/{id}/leave. Sem body, sem schema de resposta relevante —
      // contrato retorna void.
      await http.request({
        method: 'POST',
        path: groupParticipantsPath(session, groupId, 'leave'),
      });
    },
  };

  const contacts: ContactsApi = {
    list: async () => {
      // GET /api/contacts/all, query { session }. Resposta: array de contatos no schema
      // WWebJSContact (id/number, name, pushname, shortName, isMe, isGroup, isWAContact,
      // isMyContact, isBlocked) — sem `about`/foto de perfil (endpoints próprios, ver
      // getProfilePicture/getAbout abaixo).
      const body = await http.request<unknown>({
        method: 'GET',
        path: '/api/contacts/all',
        query: { session },
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapContact(item));
    },

    get: async (chatId) => {
      // GET /api/contacts, query { contactId, session }. `contactId` aceita dígitos ou "@c.us" na
      // doc, mas usamos o formato "@c.us" (canônico do provider) via toWahaChatId, mesma conversão
      // já usada por sendText/sendMedia/groups.*. Mesmo shape de resposta de `list`, um objeto só.
      const contactId = toWahaChatId(chatId);
      const body = await http.request<unknown>({
        method: 'GET',
        path: '/api/contacts',
        query: { contactId, session },
      });
      return mapContact(body);
    },

    checkExists: async (phone) => {
      // GET /api/contacts/check-exists, query { phone, session }. Diferente de `get`, este
      // endpoint quer o telefone em DÍGITOS (não "@c.us") — toWahaPhoneDigits reaproveita
      // toWahaChatId para chegar num JID canônico e então extrai só a parte antes do "@".
      const phoneDigits = toWahaPhoneDigits(phone);
      const body = await http.request<unknown>({
        method: 'GET',
        path: '/api/contacts/check-exists',
        query: { phone: phoneDigits, session },
      });
      return mapCheckExistsResult(body);
    },

    getProfilePicture: async (chatId) => {
      // GET /api/contacts/profile-picture, query { contactId, session }. `refresh` é opcional
      // (default false na doc) — omitido, sem necessidade de forçar refresh nesta operação.
      const contactId = toWahaChatId(chatId);
      const body = await http.request<unknown>({
        method: 'GET',
        path: '/api/contacts/profile-picture',
        query: { contactId, session },
      });
      return mapContactProfilePicture(body);
    },

    getAbout: async (chatId) => {
      // GET /api/contacts/about, query { contactId, session }.
      const contactId = toWahaChatId(chatId);
      const body = await http.request<unknown>({
        method: 'GET',
        path: '/api/contacts/about',
        query: { contactId, session },
      });
      return mapContactAbout(body);
    },

    block: async (chatId) => {
      // POST /api/contacts/block, body ContactRequest = { contactId, session }. Resposta: 201,
      // sem schema de conteúdo declarado — contrato retorna void, ignorada de propósito (mesmo
      // padrão de updateSubject/leaveGroup: endpoint sem shape de resposta relevante).
      const contactId = toWahaChatId(chatId);
      await http.request({
        method: 'POST',
        path: '/api/contacts/block',
        body: { contactId, session },
      });
    },

    unblock: async (chatId) => {
      // POST /api/contacts/unblock, mesmo shape de body/resposta de block.
      const contactId = toWahaChatId(chatId);
      await http.request({
        method: 'POST',
        path: '/api/contacts/unblock',
        body: { contactId, session },
      });
    },

    // listBlocked NÃO é implementado: o WAHA não tem endpoint nativo de listagem de bloqueados
    // (busca exaustiva confirmou ausência de rota "blocklist"/"blocked" nos 18 tags do
    // openapi.json, e a doc oficial de features não lista essa operação entre as 7 de contato).
    // `isBlocked` existe por contato individual em GET /api/contacts/all (poderia ser
    // reconstruído client-side filtrando), mas isso não conta como endpoint nativo — mesma regra
    // já seguida para uazapi/contacts.getAbout: capability NÃO declarada, método NÃO implementado
    // (ver docs/providers/waha.md#contatos).
  };

  /**
   * Namespace `chats.*` (retrofit ADR-0012, pesquisa dedicada de 2026-07-12). Só as 4 operações
   * com endpoint confirmado (confiança Alta) são declaradas/implementadas:
   *
   * - `chats.mute`/`chats.unmute` NÃO são implementados: a busca não encontrou nenhum endpoint de
   *   silenciar CONVERSA no `openapi.json` oficial (o único "mute" confirmado é
   *   `POST /api/{session}/channels/{id}/mute`, domínio de WhatsApp Channels — não de chat comum).
   * - `chats.pin`/`chats.unpin` NÃO são implementados: o WAHA só documenta fixar MENSAGEM dentro
   *   do chat (`POST .../messages/{messageId}/pin`, operação distinta — ver ADR-0012), não fixar a
   *   CONVERSA no topo da lista; busca não encontrou `POST /chats/{chatId}/pin`.
   *
   * Ver docs/providers/waha.md#conversas-chats para o detalhe de cada endpoint.
   */
  const chats: ChatsApi = {
    /**
     * `POST /api/{session}/chats/{chatId}/archive` (operationId `ChatsController_archiveChat` —
     * confiança Alta). Sem body; resposta `201` com objeto genérico — ignorada, contrato retorna
     * `void`.
     */
    archive: async (chatId) => {
      await http.request({ method: 'POST', path: chatPath(session, chatId, 'archive') });
    },

    /**
     * `POST /api/{session}/chats/{chatId}/unarchive` (operationId `ChatsController_unarchiveChat`
     * — confiança Alta, par simétrico de `archive`). Mesmo tratamento de resposta.
     */
    unarchive: async (chatId) => {
      await http.request({ method: 'POST', path: chatPath(session, chatId, 'unarchive') });
    },

    /**
     * `POST /api/{session}/chats/{chatId}/messages/read` (operationId
     * `ChatsController_readChatMessages` — confiança Alta). Endpoint CONCORRENTE a
     * `POST /api/sendSeen` (nível de mensagem, exige `messageIds` explícito) — este é o único dos
     * dois que opera por `chatId` sozinho, coerente com a semântica de chat INTEIRO de
     * `ChatsApi.markRead` (ADR-0012, distinto de um eventual `messages.markRead` por id). Sem
     * query params: o adapter usa os defaults documentados do provider (marca como lidas as
     * mensagens não lidas dos últimos 7 dias, até 30 no DM / 100 em grupo) — o contrato canônico
     * não expõe `count`/`days` para esta operação. Resposta (schema `ReadChatMessagesResponse`):
     * `{ ids: string[] }` com os ids marcados — ignorada, contrato retorna `void`.
     */
    markRead: async (chatId) => {
      await http.request({ method: 'POST', path: chatPath(session, chatId, 'messages/read') });
    },

    /**
     * `POST /api/{session}/chats/{chatId}/unread` (operationId `ChatsController_unreadChat` —
     * confiança Alta). Sem body; resposta sem schema declarado — ignorada, contrato retorna
     * `void`.
     */
    markUnread: async (chatId) => {
      await http.request({ method: 'POST', path: chatPath(session, chatId, 'unread') });
    },
  };

  const presence: PresenceApi = {
    /**
     * `POST /api/{session}/presence` (ADR-0015; `operationId PresenceController_setPresence`,
     * schema `WAHASessionPresence` — confiança Alta). Body: `{chatId, presence}` — **`session` vai
     * no PATH aqui, não no body** (diferente de `sendText`/`sendMedia`/etc., que usam `/api/<op>`
     * com `session` no body — `presence` é um controller distinto, `PresenceController`, com
     * convenção de path própria). `chatId` OBRIGATÓRIO para `typing`/`recording`/`paused`, mas deve
     * ser OMITIDO para `online`/`offline` (presença global da conta) — confirmado na descrição do
     * campo: "Required for chat-related presence statuses; omit for ONLINE/OFFLINE".
     * `TypingState.composing` mapeia para o literal `typing` do provider (único desalinhamento de
     * nome).
     */
    setTyping: async (input) => {
      const chatId = toWahaChatId(input.to);
      await http.request({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/presence`,
        body: { chatId, presence: input.state === 'composing' ? 'typing' : input.state },
      });
    },
    set: async (state) => {
      await http.request({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/presence`,
        body: { presence: state },
      });
    },
    /**
     * `POST /api/{session}/presence/{chatId}/subscribe` (ADR-0015; `operationId
     * PresenceController_subscribe` — confiança Alta). Sem body. Necessário chamar antes de
     * receber `presence.update` de um contato específico via webhook.
     */
    subscribe: async (chatId) => {
      await http.request({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/presence/${encodeURIComponent(toWahaChatId(chatId))}/subscribe`,
      });
    },
  };

  /**
   * Namespace `labels.*` (ADR-0016). Cobertura 4/6 — CRUD confirmado com confiança Alta
   * (`openapi.json` + página dedicada), mas `addToChat`/`removeFromChat` NÃO são implementados: o
   * único endpoint de associação (`PUT /api/{session}/labels/chats/{chatId}`) é bulk-replace
   * ("You need to provide the full list of labels you want to set to the chat. All other labels
   * will be removed") — emular add/remove exigiria um GET prévio para montar a lista completa
   * antes do PUT, violando a convenção já estabelecida de "uma operação canônica = uma chamada
   * HTTP, sem round-trip extra" (mesmo critério do `chats.markRead` da Wuzapi, ADR-0012). Ver
   * docs/providers/waha.md#etiquetas-labels-adr-0016.
   *
   * **Pré-requisito documentado pelo provider, não validável por este adapter**: etiquetas só
   * existem em contas WhatsApp Business — o WAHA não expõe "esta sessão é Business?" antes da
   * chamada, então uma conta pessoal comum provavelmente falha com erro do provider (não deste
   * adapter) ao chamar qualquer método de `labels.*`.
   */
  const labels: LabelsApi = {
    /** `GET /api/{session}/labels` — resposta `[{id, name, color, colorHex}]`. */
    list: async () => {
      const body = await http.request<unknown>({
        method: 'GET',
        path: `/api/${encodeURIComponent(session)}/labels`,
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapWahaLabel(item));
    },

    /**
     * `POST /api/{session}/labels` (schema `LabelBody`: `name` obrigatório, `color` OU `colorHex`
     * — a doc recomenda preferir `color`, cujo mapa `color`↔`colorHex` "pode mudar no futuro").
     * `LabelInfo.color` é opaco (ver ADR-0016): repassado direto como `color`.
     */
    create: async (input) => {
      const body = await http.request<unknown>({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/labels`,
        body: { name: input.name, color: input.color },
      });
      return mapWahaLabel(body, input);
    },

    /** `PUT /api/{session}/labels/{labelId}` — mesmo body de `create`. */
    update: async (input) => {
      await http.request({
        method: 'PUT',
        path: `/api/${encodeURIComponent(session)}/labels/${encodeURIComponent(input.labelId)}`,
        body: { name: input.name, color: input.color },
      });
    },

    /** `DELETE /api/{session}/labels/{labelId}`. */
    delete: async (labelId) => {
      await http.request({
        method: 'DELETE',
        path: `/api/${encodeURIComponent(session)}/labels/${encodeURIComponent(labelId)}`,
      });
    },
  };

  /**
   * Namespace `channels.*` (ADR-0017). Cobertura 6/6, confiança Alta — schema completo
   * (`Channel`/`CreateChannelRequest`) confirmado no `openapi.json` oficial (tag "📢 Channels").
   */
  const channels: ChannelsApi = {
    /** `GET /api/{session}/channels` — `role` (query, filtro OWNER/ADMIN/SUBSCRIBER) não exposto pelo contrato canônico, omitido (lista todos). */
    list: async () => {
      const body = await http.request<unknown>({
        method: 'GET',
        path: `/api/${encodeURIComponent(session)}/channels`,
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapWahaChannel(item));
    },

    /** `POST /api/{session}/channels` (schema `CreateChannelRequest {name, description?, picture?}`) — `picture` não exposto pelo contrato canônico (ver ADR-0017). */
    create: async (input) => {
      const body = await http.request<unknown>({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/channels`,
        body: { name: input.name, description: input.description },
      });
      return mapWahaChannel(body, input);
    },

    /** `GET /api/{session}/channels/{id}` — aceita tanto o id (`@newsletter`) quanto o código de convite puro. */
    getInfo: async (channelId) => {
      const body = await http.request<unknown>({
        method: 'GET',
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}`,
      });
      return mapWahaChannel(body, { id: channelId });
    },

    /** `DELETE /api/{session}/channels/{id}` — só permite deletar canais onde o chamador é OWNER (restrição do provider). */
    delete: async (channelId) => {
      await http.request({
        method: 'DELETE',
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}`,
      });
    },

    /** `POST /api/{session}/channels/{id}/follow` — sem body. */
    follow: async (channelId) => {
      await http.request({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}/follow`,
      });
    },

    /** `POST /api/{session}/channels/{id}/unfollow` — sem body. */
    unfollow: async (channelId) => {
      await http.request({
        method: 'POST',
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}/unfollow`,
      });
    },
  };

  /**
   * Namespace `calls.*` (ADR-0019). Cobertura 1/2 — só `reject` (confiança Média: schema
   * confirmado no `openapi.json`, mas sem página de doc dedicada). `from`/`id` são AMBOS
   * obrigatórios (schema `RejectCallRequest`) — na prática só disponíveis inspecionando o payload
   * bruto do webhook de chamada recebida, já que este pacote não faz parsing desse evento ainda
   * (cai em `unknown`). Sem `calls.make`: não encontrado nenhum endpoint para originar chamada.
   */
  const calls: CallsApi = {
    reject: async (input) => rejectCall(http, session, input),
  };

  return {
    provider: PROVIDER,
    capabilities: WAHA_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    channels,
    calls,
    parseWebhook: (input) => parseWahaWebhook(input, session, options.webhookHmacKey),
  };
}

// ---------------------------------------------------------------------------
// calls.* (ver ADR-0019)
// ---------------------------------------------------------------------------

/**
 * `POST /api/{session}/calls/reject` (schema `RejectCallRequest {from, id}`, ambos obrigatórios,
 * confiança Média). Lança `INVALID_INPUT` se algum dos dois faltar — diferente da uazapi, este
 * provider não aceita corpo vazio.
 */
async function rejectCall(
  http: HttpClient,
  session: string,
  input: RejectCallInput,
): Promise<void> {
  if (!input.callerId || !input.callId) {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'calls.reject no WAHA exige "callerId" e "callId" (schema RejectCallRequest {from, id}).',
      { provider: PROVIDER },
    );
  }
  await http.request({
    method: 'POST',
    path: `/api/${encodeURIComponent(session)}/calls/reject`,
    body: { from: input.callerId, id: input.callId },
  });
}

// ---------------------------------------------------------------------------
// map-out: canônico -> WAHA
// ---------------------------------------------------------------------------

/**
 * Converte o chatId canônico (telefone só-dígitos ou JID explícito, já normalizado pelo
 * conector) para o formato que o WAHA espera. Ver docs/providers/waha.md#mapeamento-de-chatid.
 */
function toWahaChatId(canonical: string): string {
  if (canonical.includes('@')) {
    // Formato interno de engine (NOWEB/GOWS) que a doc manda converter antes de enviar.
    if (canonical.endsWith('@s.whatsapp.net')) {
      const number = canonical.slice(0, canonical.indexOf('@'));
      return `${number}@c.us`;
    }
    // Já é um JID que o WAHA reconhece (@c.us, @g.us, @newsletter, @broadcast, @lid...).
    return canonical;
  }
  return `${canonical}@c.us`;
}

/**
 * Extrai só os dígitos de um chatId canônico (telefone ou JID) para o parâmetro `phone` de
 * `GET /api/contacts/check-exists` — diferente de `toWahaChatId` (que devolve o JID "@c.us"
 * completo), esse endpoint específico quer o telefone cru. Reaproveita `toWahaChatId` (mesma
 * conversão já usada por sendText/sendMedia) em vez de duplicar a lógica de domínio
 * (`@s.whatsapp.net` → `@c.us`, JIDs já reconhecidos passam intactos) e só depois corta o `@...`
 * final.
 */
function toWahaPhoneDigits(canonical: string): string {
  const chatId = toWahaChatId(canonical);
  const atIndex = chatId.indexOf('@');
  return atIndex === -1 ? chatId : chatId.slice(0, atIndex);
}

/**
 * Converte uma entrada canônica de `mentions` para o formato de JID que o WAHA espera em
 * `POST /api/sendText`. `"all"` é um valor especial documentado (mencionar todo mundo no grupo)
 * e não deve passar por `toWahaChatId` (viraria `all@c.us`, incorreto).
 */
function toWahaMention(entry: string): string {
  if (entry === 'all') return entry;
  return toWahaChatId(entry);
}

/**
 * Converte o `groupId` opaco (ver ADR-0009) para o JID de grupo que o WAHA espera no path `{id}`
 * (`<dígitos>@g.us`). Diferente de `toWahaChatId` (pensado para `chatId` de mensagem, cujo domínio
 * padrão é `@c.us`), aqui o domínio padrão é `@g.us` — reaproveitar `toWahaChatId` cegamente
 * produziria `<dígitos>@c.us`, incorreto para um grupo. Ver docs/providers/waha.md#grupos-núcleo.
 */
function toWahaGroupId(groupId: string): string {
  return groupId.includes('@') ? groupId : `${groupId}@g.us`;
}

/**
 * Participantes individuais (dentro de `participants: string[]`), ao contrário do `groupId`, já
 * chegam normalizados pelo conector (telefone vira só-dígitos, JID passa intacto) — mesmo formato
 * de um `to` de mensagem comum, então reaproveitamos `toWahaChatId` para cada um antes de montar o
 * objeto `{ id }` que os endpoints de grupo do WAHA esperam (`createGroup`,
 * `participants/add|remove`, `admin/promote|demote`).
 */
function toWahaParticipants(participants: readonly string[]): Array<{ id: string }> {
  return participants.map((participant) => ({ id: toWahaChatId(participant) }));
}

/**
 * Monta o path `/api/{session}/groups/{id}/<suffix>` com `groupId` já convertido para `@g.us`.
 * Nome vem do uso original (endpoints de participantes/admin), mas é genérico o bastante para ser
 * reaproveitado por `updateSubject`/`updateDescription`/`updatePicture` (suffixes `subject`,
 * `description`, `picture`) — todos seguem o mesmo padrão de path.
 */
function groupParticipantsPath(session: string, groupId: string, suffix: string): string {
  return `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(toWahaGroupId(groupId))}/${suffix}`;
}

/**
 * Monta o path `/api/{session}/chats/{chatId}/<suffix>` usado pelas operações de `chats.*`
 * (retrofit ADR-0012). `chatId` de `chats.*` NÃO é opaco (diferente de `groupId`, ver ADR-0012 vs.
 * ADR-0009) — é o mesmo alvo endereçável de `messages.sendText`, então reaproveita `toWahaChatId`
 * (mesma conversão já usada por `sendText`/`sendMedia`/`sendReaction`/`groups.*`/`contacts.*`).
 */
function chatPath(session: string, chatId: string, suffix: string): string {
  return `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(toWahaChatId(chatId))}/${suffix}`;
}

/**
 * Monta o path `/api/{session}/chats/{chatId}/messages/{messageId}[/<suffix>]` usado por
 * `messages.edit`/`messages.delete` (ADR-0012) e `messages.pin`/`unpin` (ADR-0013, via `suffix`
 * opcional). `messageId` já vem no formato de JID de mensagem que o WAHA espera (ex.:
 * `true_5585999999999@c.us_AAAA...`) — a doc chama atenção explicitamente para escapar `@`
 * (`%40`) tanto em `chatId` quanto em `messageId`, o que `encodeURIComponent` já cobre para os dois.
 */
function messagePath(session: string, chatId: string, messageId: string, suffix?: string): string {
  const base = `messages/${encodeURIComponent(messageId)}`;
  return chatPath(session, chatId, suffix ? `${base}/${suffix}` : base);
}

/**
 * `messages.pin` (ADR-0013) exige `duration` em segundos; o WhatsApp só aceita 3 valores nativos
 * (24h/7d/30d — ver docstring de `pin` acima). Sem sentinela "permanente" documentado, este
 * adapter usa 24h (`86400`) como default — decisão própria, não do provider.
 */
const WAHA_PIN_DURATION_SECONDS = 86400;

/** `messages.star`/`unstar` (ADR-0013) compartilham `PUT /api/star`, variando só o campo `star`. */
async function setStarred(
  http: HttpClient,
  session: string,
  input: StarMessageInput,
  star: boolean,
): Promise<void> {
  const chatId = toWahaChatId(input.to);
  await http.request({
    method: 'PUT',
    path: '/api/star',
    body: { messageId: input.messageId, chatId, star, session },
  });
}

interface WahaRemoteFile {
  mimetype: string;
  filename?: string;
  url: string;
}

interface WahaBinaryFile {
  mimetype: string;
  filename?: string;
  data: string;
}

// Checagem de último recurso (o conector já valida isso) para quem instancia o adapter sem
// createConnector — ver CONTRIBUTING.md, seção "Convenções inegociáveis". `defaultMimetype`
// existe porque o mimetype-padrão difere por chamador: `sendMedia` cai em
// 'application/octet-stream' (mídia genérica), `groups.updatePicture` cai em 'image/jpeg' (grupos
// só aceitam foto).
function buildWahaFile(
  media: MediaRef,
  defaultMimetype = 'application/octet-stream',
): WahaRemoteFile | WahaBinaryFile {
  const mimetype = media.mimeType ?? defaultMimetype;
  if (media.url !== undefined) {
    return { mimetype, filename: media.filename, url: media.url };
  }
  if (media.base64 !== undefined) {
    return { mimetype, filename: media.filename, data: media.base64 };
  }
  throw new WaConnectorError('INVALID_INPUT', 'sendMedia exige "media.url" ou "media.base64".', {
    provider: PROVIDER,
  });
}

/**
 * WAHA expõe um endpoint por tipo de mídia (não um `sendMedia` genérico). `sticker` não tem
 * endpoint documentado no dossiê original — usamos `sendFile` como fallback best-effort
 * (assumido, ver docs/providers/waha.md).
 */
function mediaEndpoint(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return '/api/sendImage';
    case 'video':
      return '/api/sendVideo';
    case 'audio':
      return '/api/sendVoice';
    case 'document':
      return '/api/sendFile';
    case 'sticker':
      return '/api/sendFile';
  }
}

// ---------------------------------------------------------------------------
// map-in: WAHA -> canônico
// ---------------------------------------------------------------------------

function extractQr(body: unknown): string | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  return asString(record.value) ?? asString(record.data);
}

function mapSentMessage(body: unknown, requestedChatId: string): SentMessage {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : undefined) ?? `waha-${Date.now()}`;
  const chatId =
    (record ? (asString(record.chatId) ?? asString(record.to)) : undefined) ?? requestedChatId;
  const timestampRaw = record ? asNumber(record.timestamp) : undefined;
  return {
    id,
    chatId,
    timestamp: timestampRaw === undefined ? undefined : normalizeTimestamp(timestampRaw),
    raw: body,
  };
}

/**
 * Mapeia um participante de grupo do WAHA (schema inferido por cross-reference com o webhook
 * `group.v2.join`, ver docs/providers/waha.md#grupos-núcleo) para `GroupParticipant`. Em respostas,
 * o WAHA pode devolver o participante como `@lid` (privacidade) com o formato real `@c.us`
 * separado no campo `pn` — preferimos `pn` quando presente, senão caímos em `id`.
 */
function mapGroupParticipant(entry: unknown): GroupParticipant | undefined {
  const record = asRecord(entry);
  if (!record) return undefined;
  const id = asString(record.pn) ?? asString(record.id);
  if (id === undefined) return undefined;
  const role = asString(record.role);
  return {
    id,
    isAdmin: role === 'admin' || role === 'superadmin',
    isSuperAdmin: role === 'superadmin',
  };
}

function mapGroupParticipants(value: unknown): GroupParticipant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped: GroupParticipant[] = [];
  for (const entry of value) {
    const participant = mapGroupParticipant(entry);
    if (participant) mapped.push(participant);
  }
  return mapped;
}

/**
 * Mapeia o campo `type` do webhook `group.v2.participants` para a convenção de `action` de
 * `GroupUpdateEvent` (ver core/events.ts). `type` não reconhecido devolve `undefined` — o chamador
 * trata como evento não mapeável (cai em `unknown`); nunca inventamos uma `action` genérica para
 * um `type` desconhecido.
 */
function mapGroupParticipantsAction(type: string | undefined): string | undefined {
  switch (type) {
    case 'join':
      return 'participants.add';
    case 'leave':
      return 'participants.remove';
    case 'promote':
      return 'participants.promote';
    case 'demote':
      return 'participants.demote';
    default:
      return undefined;
  }
}

/**
 * Extrai os IDs dos participantes afetados do webhook `group.v2.participants`, no MESMO formato
 * (preferência `pn` sobre `id`) já usado por `mapGroupParticipant`/`mapGroupParticipants`
 * (`groups.getInfo`/`groups.list`) — reaproveitado aqui em vez de duplicar a lógica de preferência.
 * Devolve `undefined` (não `[]`) quando não há nenhum participante mapeável, para que
 * `GroupUpdateEvent.participants` fique ausente em vez de um array vazio sem sentido.
 */
function mapGroupUpdateParticipantIds(value: unknown): string[] | undefined {
  const participants = mapGroupParticipants(value);
  if (!participants || participants.length === 0) return undefined;
  return participants.map((participant) => participant.id);
}

/**
 * Entrada usada só quando o corpo da resposta não traz o campo correspondente — comum em
 * `createGroup` (a doc do WAHA não declara schema de resposta para esse endpoint). Mesmo padrão de
 * fallback de `mapSentMessage` (`chatId ?? requestedNumber`): cai nos valores já conhecidos da
 * requisição em vez de inventar um dado.
 */
interface GroupInfoFallback {
  /** Ex.: o `groupId` já usado para montar o path da requisição (`getInfo`). */
  id?: string;
  /** Ex.: `CreateGroupInput.subject` (`create`). */
  subject?: string;
  /** Ex.: `CreateGroupInput.participants`, já canônicos (`create`). */
  participants?: readonly string[];
}

function mapGroupInfo(body: unknown, fallback: GroupInfoFallback = {}): GroupInfo {
  const record = asRecord(body);
  const id =
    (record ? asString(record.id) : undefined) ?? fallback.id ?? `waha-group-${Date.now()}`;
  const subject = (record ? asString(record.subject) : undefined) ?? fallback.subject ?? '';
  const description = record ? asString(record.description) : undefined;
  const participants =
    (record ? mapGroupParticipants(record.participants) : undefined) ??
    (fallback.participants ?? []).map((participantId) => ({
      id: participantId,
      isAdmin: false,
      isSuperAdmin: false,
    }));
  return {
    id,
    subject,
    description,
    // O WAHA não expõe um campo de "dono" explícito no schema inferido de GroupInfo — ver
    // docs/providers/waha.md#grupos-núcleo.
    owner: undefined,
    participants,
    raw: body,
  };
}

/**
 * `getInviteLink`/`revokeInviteLink` do WAHA devolvem o corpo como STRING PURA (schema
 * `type: string` no openapi.json), o código bare do convite — não um objeto. `HttpClient.request`
 * já desembrulha tanto `"abc123"` (JSON) quanto `abc123` (texto puro) para uma string JS comum, daí
 * bastar checar `typeof body === 'string'`. `normalizeInviteLink` garante o link completo exigido
 * por `GroupInviteLink.link` mesmo partindo só do código.
 */
function mapGroupInviteLink(body: unknown): GroupInviteLink {
  const code = typeof body === 'string' ? body : '';
  return { link: normalizeInviteLink(code), raw: body };
}

/**
 * Mapeia um contato do schema `WWebJSContact` (`GET /api/contacts/all` e `GET /api/contacts`, mesmo
 * shape nos dois) para `Contact`. `id`/`number` já vêm em formato "@c.us" na doc, mas passamos pelo
 * MESMO `toWahaChatId` usado para envio — garante o formato canônico mesmo se um dos dois campos
 * vier sem domínio (ex.: `number` cru). Sem `about`/`profilePictureUrl` neste endpoint (endpoints
 * dedicados, ver `getAbout`/`getProfilePicture`) — ficam `undefined` por limitação do provider, não
 * por bug (ver docs/providers/waha.md#contatos).
 */
function mapContact(body: unknown): Contact {
  const record = asRecord(body);
  const idSource =
    (record ? asString(record.id) : undefined) ?? (record ? asString(record.number) : undefined);
  const id = idSource === undefined ? 'unknown' : toWahaChatId(idSource);
  const name =
    (record ? asString(record.name) : undefined) ??
    (record ? asString(record.pushname) : undefined);
  return {
    id,
    name,
    hasWhatsApp: record ? asBoolean(record.isWAContact) : undefined,
    isBlocked: record ? asBoolean(record.isBlocked) : undefined,
    raw: body,
  };
}

/**
 * Mapeia a resposta de `GET /api/contacts/check-exists` (schema `WANumberExistResult`) para
 * `CheckExistsResult`. `chatId` fica ausente quando o provider não o devolve (comum quando
 * `numberExists` é `false`) — passado por `toWahaChatId` quando presente pelo mesmo motivo de
 * `mapContact` (garantir formato canônico consistente).
 */
function mapCheckExistsResult(body: unknown): CheckExistsResult {
  const record = asRecord(body);
  const chatIdRaw = record ? asString(record.chatId) : undefined;
  return {
    exists: (record ? asBoolean(record.numberExists) : undefined) ?? false,
    chatId: chatIdRaw === undefined ? undefined : toWahaChatId(chatIdRaw),
    raw: body,
  };
}

/**
 * Mapeia a resposta de `GET /api/contacts/profile-picture` para `ContactProfilePicture`.
 * `profilePictureURL` pode vir `null` quando a privacidade do contato não permite — tratado como
 * `url` ausente, não como erro.
 */
function mapContactProfilePicture(body: unknown): ContactProfilePicture {
  const record = asRecord(body);
  return {
    url: record ? asString(record.profilePictureURL) : undefined,
    raw: body,
  };
}

/**
 * Mapeia a resposta de `GET /api/contacts/about` para `ContactAbout`. `about` pode vir `null`
 * quando a privacidade do contato não permite — tratado como ausente, não como erro.
 */
function mapContactAbout(body: unknown): ContactAbout {
  const record = asRecord(body);
  return {
    about: record ? asString(record.about) : undefined,
    raw: body,
  };
}

/**
 * Entrada usada só quando a resposta de `POST /labels` não traz `id`/`name`/`color` (a doc não
 * declara o schema de resposta com certeza total) — mesmo padrão de fallback de `mapGroupInfo`
 * (`GroupInfoFallback`): cai nos valores já conhecidos da requisição em vez de inventar um dado.
 */
interface LabelFallback {
  name?: string;
  color?: string;
}

/**
 * Mapeia um label do WAHA (`{id, name, color, colorHex}`) para `LabelInfo`. `color` é opaco (ver
 * ADR-0016) — o WAHA pode devolver `color` como índice numérico; convertido para string sem
 * tradução de vocabulário (mesmo critério de "não inventar mapeamento" já usado em `mapContact`).
 */
function mapWahaLabel(body: unknown, fallback: LabelFallback = {}): LabelInfo {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : undefined) ?? `waha-label-${Date.now()}`;
  const name = (record ? asString(record.name) : undefined) ?? fallback.name ?? '';
  const colorRaw = record?.color;
  const color =
    typeof colorRaw === 'string'
      ? colorRaw
      : typeof colorRaw === 'number'
        ? String(colorRaw)
        : fallback.color;
  return { id, name, color, raw: body };
}

/**
 * Entrada usada só quando a resposta não traz `id`/`name` (ex.: `getInfo`, cujo `channelId` já é
 * conhecido do chamador) — mesmo padrão de fallback de `mapWahaLabel`/`mapGroupInfo`.
 */
interface ChannelFallback {
  id?: string;
  name?: string;
  description?: string;
}

/**
 * Mapeia um `Channel` do WAHA (`{id, name, invite, preview, picture, role, description, verified,
 * subscribersCount}`) para `ChannelInfo` (ADR-0017). Campos exclusivos do provider (`invite`,
 * `preview`, `picture`, `role`, `verified`) não têm equivalente no contrato canônico desta rodada
 * — ficam só em `raw`.
 */
function mapWahaChannel(body: unknown, fallback: ChannelFallback = {}): ChannelInfo {
  const record = asRecord(body);
  const id =
    (record ? asString(record.id) : undefined) ?? fallback.id ?? `waha-channel-${Date.now()}`;
  const name = (record ? asString(record.name) : undefined) ?? fallback.name ?? '';
  const description = (record ? asString(record.description) : undefined) ?? fallback.description;
  const subscribersCount = record ? asNumber(record.subscribersCount) : undefined;
  return { id, name, description, subscribersCount, raw: body };
}

function mapWahaStatus(status: string | undefined): InstanceState {
  switch (status) {
    case 'STOPPED':
      return 'disconnected';
    case 'STARTING':
      return 'connecting';
    case 'SCAN_QR_CODE':
      return 'qr';
    case 'WORKING':
      return 'connected';
    case 'FAILED':
      return 'disconnected';
    default:
      return 'unknown';
  }
}

/**
 * A doc oficial só confirma `ackName: "READ"` ⇄ `ack: 3`. O restante da tabela segue a convenção
 * comum do WhatsApp (a confirmar contra uma instância real — ver docs/providers/waha.md).
 */
function mapWahaAck(ackName: string | undefined, ackNumber: number | undefined): MessageAck {
  switch (ackName?.toUpperCase()) {
    case 'ERROR':
      return 'error';
    case 'PENDING':
      return 'pending';
    case 'SERVER':
    case 'SENT':
      return 'sent';
    case 'DEVICE':
    case 'DELIVERED':
      return 'delivered';
    case 'READ':
      return 'read';
    case 'PLAYED':
      return 'played';
    default:
      break;
  }
  switch (ackNumber) {
    case -1:
      return 'error';
    case 0:
      return 'pending';
    case 1:
      return 'sent';
    case 2:
      return 'delivered';
    case 3:
      return 'read';
    case 4:
      return 'played';
    default:
      return 'sent';
  }
}

/**
 * Quirk documentado: `payload.timestamp` de mensagens vem em segundos, mas
 * `payload.statuses[].timestamp` do evento `session.status` já vem em milissegundos. Heurística
 * defensiva: valores abaixo de 10^12 são tratados como segundos.
 */
function normalizeTimestamp(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function mapMediaKindFromMime(mimetype: string | undefined): MediaKind {
  if (mimetype?.startsWith('image/')) return 'image';
  if (mimetype?.startsWith('video/')) return 'video';
  if (mimetype?.startsWith('audio/')) return 'audio';
  return 'document';
}

function mapMessageKind(hasMedia: boolean, mimetype: string | undefined): MessageKind {
  if (!hasMedia) return 'text';
  if (mimetype === undefined) return 'unknown';
  return mapMediaKindFromMime(mimetype);
}

function mapWahaMessage(payload: Record<string, unknown>): WaMessage {
  const fromMe = asBoolean(payload.fromMe) ?? false;
  const from = asString(payload.from);
  const to = asString(payload.to);
  const chatId = (fromMe ? to : from) ?? from ?? to ?? 'unknown';

  const hasMedia = asBoolean(payload.hasMedia) ?? false;
  const mediaRecord = asRecord(payload.media);
  // `hasMedia: true` com `media: null` é um estado válido (WAHA sem auto-download) — não é erro.
  const mediaUrl = mediaRecord ? asString(mediaRecord.url) : undefined;
  const mediaMimetype = mediaRecord ? asString(mediaRecord.mimetype) : undefined;
  const media: MediaRef | undefined =
    hasMedia && mediaUrl !== undefined
      ? {
          kind: mapMediaKindFromMime(mediaMimetype),
          url: mediaUrl,
          mimeType: mediaMimetype,
          filename: mediaRecord ? asString(mediaRecord.filename) : undefined,
        }
      : undefined;

  const timestampRaw = asNumber(payload.timestamp) ?? Math.floor(Date.now() / 1000);

  const replyTo = asRecord(payload.replyTo);
  const quotedId = replyTo ? asString(replyTo.id) : undefined;

  return {
    id: asString(payload.id) ?? `waha-unknown-${Date.now()}`,
    chatId,
    from,
    fromMe,
    timestamp: normalizeTimestamp(timestampRaw),
    kind: mapMessageKind(hasMedia, mediaMimetype),
    text: asString(payload.body),
    media,
    quotedId,
    raw: payload,
  };
}

/**
 * Traduz um webhook WAHA para eventos canônicos. Nunca lança: eventos não mapeados
 * (`message`, `message.ack`, `session.status`, `group.v2.participants`, `group.v2.update`,
 * `group.v2.join`, `group.v2.leave` — ver docs/providers/waha.md#webhooks-de-grupo para os 4
 * últimos, retrofit ADR-0009) viram `unknown`.
 *
 * Quando `webhookHmacKey` é fornecida, a assinatura é verificada ANTES de qualquer mapeamento —
 * payload com assinatura ausente/inválida, ou sem `rawBody` disponível para verificar, nunca chega
 * a ser processado (vira `unknown`). Ver docs/providers/waha.md#verificação-hmac-de-webhooks.
 */
function parseWahaWebhook(
  input: WebhookInput,
  defaultSession: string,
  webhookHmacKey: string | undefined,
): CanonicalEvent[] {
  const body = input.body;

  if (webhookHmacKey !== undefined) {
    const verification = verifyWahaHmac(input, webhookHmacKey);
    if (!verification.valid) {
      return [unknownEvent(body, verification.reason)];
    }
  }

  const envelope = asRecord(body);
  if (!envelope) {
    return [unknownEvent(body, 'Corpo do webhook WAHA não é um objeto JSON.')];
  }

  const eventName = asString(envelope.event);
  const session = asString(envelope.session) ?? defaultSession;
  const payload = asRecord(envelope.payload);

  if (eventName === 'message') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "message" do WAHA sem "payload".')];
    }
    const message = mapWahaMessage(payload);
    return [
      {
        type: message.fromMe ? 'message.sent' : 'message.received',
        provider: PROVIDER,
        instanceId: session,
        message,
        raw: body,
      },
    ];
  }

  if (eventName === 'message.ack') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "message.ack" do WAHA sem "payload".')];
    }
    return [
      {
        type: 'message.ack',
        provider: PROVIDER,
        instanceId: session,
        messageId: asString(payload.id) ?? 'unknown',
        chatId: asString(payload.from),
        ack: mapWahaAck(asString(payload.ackName), asNumber(payload.ack)),
        raw: body,
      },
    ];
  }

  if (eventName === 'session.status') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "session.status" do WAHA sem "payload".')];
    }
    const connectionUpdate: ConnectionUpdateEvent = {
      type: 'connection.update',
      provider: PROVIDER,
      instanceId: session,
      state: mapWahaStatus(asString(payload.status)),
      raw: body,
    };
    return [connectionUpdate];
  }

  // group.v2.participants: evento PRINCIPAL de mudança de participante (join/leave/promote/demote),
  // confirmado no openapi.json e em waha.devlike.pro/docs/how-to/groups/. `participants` no payload
  // já vem só com os afetados (não a lista completa do grupo). Nota documentada: este evento PODE
  // duplicar group.v2.join/leave para o ID da própria sessão — esperado, não deduplicado aqui (ver
  // docs/providers/waha.md#webhooks-de-grupo).
  if (eventName === 'group.v2.participants') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.participants" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : undefined;
    const action = mapGroupParticipantsAction(asString(payload.type));
    if (groupId === undefined || action === undefined) {
      return [
        unknownEvent(
          body,
          `Evento "group.v2.participants" do WAHA sem "group.id" ou "type" reconhecido ("${asString(payload.type) ?? '(ausente)'}").`,
        ),
      ];
    }
    const groupUpdate: GroupUpdateEvent = {
      type: 'group.update',
      provider: PROVIDER,
      instanceId: session,
      groupId,
      action,
      participants: mapGroupUpdateParticipantIds(payload.participants),
      raw: body,
    };
    return [groupUpdate];
  }

  // group.v2.update: `group` no payload pode ser PARCIAL (ex.: só {id, subject} quando só o
  // assunto mudou, ou {id, description} quando só a descrição mudou). Quando ambos aparecem juntos
  // (mudança simultânea, comum em providers baseados em whatsmeow), emitimos UM GroupUpdateEvent
  // POR mudança identificada — daí o array de eventos abaixo poder ter 2 entradas para 1 payload.
  if (eventName === 'group.v2.update') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.update" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : undefined;
    if (groupId === undefined) {
      return [unknownEvent(body, 'Evento "group.v2.update" do WAHA sem "group.id".')];
    }
    const groupUpdates: GroupUpdateEvent[] = [];
    const subject = group ? asString(group.subject) : undefined;
    if (subject !== undefined) {
      groupUpdates.push({
        type: 'group.update',
        provider: PROVIDER,
        instanceId: session,
        groupId,
        action: 'subject',
        raw: body,
      });
    }
    // `description` vazia (`''`) é um valor válido (limpa a descrição) — mesma convenção de
    // `groups.updateDescription`; `asString('')` devolve `''`, que é `!== undefined`.
    const description = group ? asString(group.description) : undefined;
    if (description !== undefined) {
      groupUpdates.push({
        type: 'group.update',
        provider: PROVIDER,
        instanceId: session,
        groupId,
        action: 'description',
        raw: body,
      });
    }
    if (groupUpdates.length === 0) {
      return [
        unknownEvent(
          body,
          'Evento "group.v2.update" do WAHA sem "subject"/"description" reconhecíveis em "group".',
        ),
      ];
    }
    return groupUpdates;
  }

  // group.v2.join: dispara quando a PRÓPRIA sessão entra/é adicionada a um grupo. O payload traz o
  // GroupInfo completo em `group`, mas não isola claramente qual participante foi adicionado sendo
  // "a própria sessão" vs a lista completa — por isso `participants` fica de fora (não inventamos
  // esse dado), diferente de `group.v2.participants`.
  if (eventName === 'group.v2.join') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.join" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : undefined;
    if (groupId === undefined) {
      return [unknownEvent(body, 'Evento "group.v2.join" do WAHA sem "group.id".')];
    }
    const groupUpdate: GroupUpdateEvent = {
      type: 'group.update',
      provider: PROVIDER,
      instanceId: session,
      groupId,
      action: 'participants.add',
      raw: body,
    };
    return [groupUpdate];
  }

  // group.v2.leave: payload traz só `{ id }` em `group`, sem mais nada.
  if (eventName === 'group.v2.leave') {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.leave" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : undefined;
    if (groupId === undefined) {
      return [unknownEvent(body, 'Evento "group.v2.leave" do WAHA sem "group.id".')];
    }
    const groupUpdate: GroupUpdateEvent = {
      type: 'group.update',
      provider: PROVIDER,
      instanceId: session,
      groupId,
      action: 'participants.remove',
      raw: body,
    };
    return [groupUpdate];
  }

  // "group.join"/"group.leave" (legado, sem versão "v2", marcados deprecated:true no openapi.json,
  // payload não documentado/genérico) caem propositalmente no fallback abaixo — confiança baixa
  // demais para implementar parsing estruturado (ver docs/providers/waha.md#webhooks-de-grupo).
  return [
    unknownEvent(
      body,
      `Evento WAHA não mapeado nesta fase: "${eventName ?? '(sem campo "event")'}".`,
    ),
  ];
}

function unknownEvent(raw: unknown, reason: string): UnknownEvent {
  return { type: 'unknown', provider: PROVIDER, raw, reason };
}

// ---------------------------------------------------------------------------
// verificação HMAC de webhooks (opt-in, ver ADR-0006 e docs/providers/waha.md)
// ---------------------------------------------------------------------------

interface HmacVerification {
  valid: boolean;
  reason: string;
}

/**
 * Verifica a assinatura `X-Webhook-Hmac` (HMAC-SHA512) de um webhook WAHA contra `webhookHmacKey`.
 * Falha fechado: sem `rawBody` (corpo bruto) não há como calcular o HMAC de forma confiável, então
 * o webhook é tratado como não verificável — nunca como válido por omissão.
 */
function verifyWahaHmac(input: WebhookInput, webhookHmacKey: string): HmacVerification {
  if (input.rawBody === undefined) {
    return {
      valid: false,
      reason:
        'webhookHmacKey está configurada, mas WebhookInput.rawBody não foi fornecido — a verificação ' +
        'HMAC exige o corpo bruto do request (ver docs/providers/waha.md#verificação-hmac-de-webhooks). ' +
        'Falhando fechado: webhook tratado como não verificável, não processado.',
    };
  }

  const receivedSignature = firstHeaderValue(input.headers, 'x-webhook-hmac');
  if (receivedSignature === undefined) {
    return {
      valid: false,
      reason: 'webhookHmacKey está configurada, mas o header "X-Webhook-Hmac" não veio no webhook.',
    };
  }

  const expectedSignature = createHmac('sha512', webhookHmacKey)
    .update(input.rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
  // timingSafeEqual lança se os buffers tiverem tamanhos diferentes — checar antes evita a
  // exceção (uma assinatura de tamanho errado é simplesmente inválida, não um erro interno).
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return {
      valid: false,
      reason: 'Assinatura HMAC do webhook WAHA inválida ("X-Webhook-Hmac" não confere).',
    };
  }

  return { valid: true, reason: '' };
}

/**
 * Nomes de header chegam em capitalização variada dependendo do framework do consumidor (Express
 * lower-case tudo; outros preservam a grafia original) — busca case-insensitive.
 */
function firstHeaderValue(headers: WebhookInput['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// type guards manuais (ADR-0004: zero dependências de runtime, sem zod)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
