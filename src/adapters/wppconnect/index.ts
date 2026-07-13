import type {
  BusinessApi,
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
import { digitsOnly, isGroupChatId, isJid, normalizeInviteLink } from '../../core/chat-id';
import { WaConnectorError } from '../../core/errors';
import type {
  CanonicalEvent,
  ConnectionUpdateEvent,
  GroupUpdateEvent,
  MessageAckEvent,
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
  CreateChannelInput,
  CreateGroupInput,
  CreateLabelInput,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipant,
  GroupParticipantsInput,
  InstanceState,
  InstanceStatus,
  JoinGroupInviteInput,
  LabelChatInput,
  LabelInfo,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  PresenceState,
  RejectCallInput,
  SendContactCardInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  SetTypingInput,
  StarMessageInput,
  UpdateBusinessProfileInput,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
  WaMessage,
} from '../../core/types';

/**
 * Opções do adapter WPPConnect Server (self-hosted via Docker, `wppconnect-team/wppconnect-server`
 * — wrapper REST em cima da lib `@wppconnect-team/wppconnect`, que controla o WhatsApp Web via
 * Puppeteer).
 *
 * @see docs/providers/wppconnect.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
export interface WppconnectOptions {
  /** URL base do servidor WPPConnect Server (ex.: `http://localhost:21465`). */
  baseUrl: string;
  /**
   * Nome da sessão. Diferente de outros adapters self-hosted deste pacote (Wuzapi/uazapi, onde a
   * sessão é resolvida a partir do header de auth), o WPPConnect exige o nome da sessão embutido
   * no PATH de toda chamada (`/api/{session}/...`) — por isso é obrigatório aqui, não opcional.
   */
  session: string;
  /**
   * Token Bearer da sessão, obtido via `POST /api/{session}/{secretkey}/generate-token` (fora do
   * escopo deste adapter — provisionamento feito pelo operador do servidor, que precisa conhecer o
   * `secretKey` global do `config.ts`; mesmo padrão de "token pré-provisionado" já usado em
   * `WuzapiOptions.token`/`UazapiOptions.token`). Enviado como `Authorization: Bearer <token>` —
   * ver docs/providers/wppconnect.md#autenticação para a forma alternativa (token embutido no
   * próprio path `:session`), não usada por este adapter.
   */
  token: string;
  /**
   * URL de webhook a configurar para esta sessão especificamente (campo `webhook` do body de
   * `POST /start-session`, sobrepõe o `webhook.url` global do `config.ts` do servidor). Opcional —
   * quando ausente, vale o que já estiver configurado no servidor.
   */
  webhook?: string;
  /**
   * Quando `true` (padrão), `instance.connect()` envia `waitQrCode: true` — a única forma de obter
   * o QR (ou pairing code) de volta na própria resposta HTTP síncrona, em vez de precisar fazer
   * polling em `instance.status()`. **Risco reavaliado, ainda não confirmado empiricamente**: a
   * leitura de `src/controller/sessionController.ts` mostra que `startSession` chama
   * `getSessionState` incondicionalmente ANTES do fluxo de espera pelo QR, e esta responde de
   * imediato sempre que a sessão já existir (`req.client` truthy) — em QUALQUER estado
   * (`CONNECTED`, `INITIALIZING`, etc.), não só quando já conectada. Ou seja, o "pendurar até o
   * QR/pairing code chegar" só deveria ocorrer para uma sessão genuinamente NOVA (nunca iniciada,
   * ou removida após logout), não para uma reconexão de sessão já vista antes — cenário mais
   * estreito do que a versão anterior deste aviso sugeria. Ainda não testado contra uma instância
   * real (ver docs/providers/wppconnect.md#instanceconnect). Defina `false` para retornar
   * imediatamente (sem QR) e fazer polling via `instance.status()` em vez disso.
   */
  waitQrCode?: boolean;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'wppconnect';

/**
 * Capabilities com endpoint E shape de resposta confirmados pela pesquisa
 * (docs/providers/wppconnect.md). Só `instance.pairingCode` fica deliberadamente de fora, com
 * justificativa registrada no dossiê:
 * - `instance.pairingCode`: mesmo obstáculo estrutural de todo adapter deste pacote —
 *   `InstanceApi.connect()` não recebe telefone como parâmetro, e o WPPConnect só produz pairing
 *   code quando `phone` é enviado no body de `start-session` (momento de criação da sessão).
 *
 * `groups.list` e as 4 operações de `contacts.*` abaixo foram reavaliadas descendo à LIB
 * subjacente (`@wppconnect-team/wppconnect`, não só o controller fino do server, que era a fonte
 * da versão anterior deste dossiê) — o shape de resposta de todas está tipado
 * (`src/api/model/*.ts`) ou visível no script injetado (`src/lib/wapi/functions/*.js`), então
 * nenhuma segue sendo gap por "shape não confirmado":
 * - `groups.list`: o único endpoint dedicado (`GET /all-groups`) está `#swagger.deprecated`
 *   ("Deprecated in favor of 'list-chats'") — usamos o substituto, `POST /list-chats`
 *   (`listChats(options?: ChatListOptions): Promise<Chat[]>`), com `{onlyGroups: true}` filtrando
 *   só grupos. Ver `listGroups`.
 * - `contacts.list`/`contacts.get`: `GET /all-contacts`/`GET /contact/:phone` — shape confirmado
 *   pelo script injetado real (`get-all-contacts.js`/`get-contact.js`):
 *   `WAPI._serializeContactObj(...)`, consistente com a interface `Contact` da lib. Ver
 *   `mapContact`.
 * - `contacts.getProfilePicture`: `GET /profile-pic/:phone` → `getProfilePicFromServer(chatId):
 *   Promise<ProfilePicThumbObj>` (assinatura tipada). Ver `getContactProfilePicture`.
 * - `contacts.getAbout`: `GET /profile-status/:phone` → `getStatus(contactId):
 *   Promise<ContactStatus>` (assinatura tipada, montagem do retorno visível no código-fonte da
 *   lib). Ver `getContactAbout`.
 *
 * `messages.edit`/`messages.delete` e as 8 operações de `chats.*` (retrofit ADR-0012, pesquisa
 * dedicada de 2026-07-12, `docs/providers/wppconnect.md`) — TODAS com endpoint E delegação até a
 * lib confirmados com confiança Alta:
 * - `messages.edit`: `POST /edit-message` → `WPP.chat.editMessage`. Ver `editMessage`.
 * - `messages.delete`: `POST /delete-message` → `WPP.chat.deleteMessage`; comportamento PADRÃO é
 *   revogação ("apagar para todos"), coerente com `DeleteMessageInput` (sem campo de escopo). Ver
 *   `deleteMessage`.
 * - `chats.archive`/`unarchive`: `POST /archive-chat` (toggle único via `value`). Ver
 *   `setChatArchived`.
 * - `chats.pin`/`unpin`: `POST /pin-chat`. **Bug confirmado no controller** (`state === 'true'`,
 *   comparação com STRING, não booleano) — este adapter contorna enviando `state` como a string
 *   literal `"true"`/`"false"`. Ver `setChatPinned`.
 * - `chats.mute`/`unmute`: `POST /send-mute`. `ChatsApi.mute`/`unmute` não recebem duração (ver
 *   ADR-0012) — `mute` usa uma duração longa arbitrária escolhida por este adapter (não um default
 *   do provider); `unmute` omite `time`/`type` de propósito para cair no branch de remoção
 *   confirmado no dossiê. Ver `setChatMuted`.
 * - `chats.markRead`/`markUnread`: `POST /send-seen` / `POST /mark-unseen` — dois endpoints
 *   distintos (não um toggle), com uma TERCEIRA exceção de envelope confirmada só em `send-seen`
 *   (`status` com "S" maiúsculo). Ver `markChatRead`/`markChatUnread`.
 */
const WPPCONNECT_CAPABILITIES: CapabilitySet = [
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
  'contacts.listBlocked',
  'chats.archive',
  'chats.unarchive',
  'chats.mute',
  'chats.unmute',
  'chats.pin',
  'chats.unpin',
  'chats.markRead',
  'chats.markUnread',
  'presence.setTyping',
  'presence.set',
  'presence.subscribe',
  'labels.list',
  'labels.create',
  'labels.delete',
  'labels.addToChat',
  'labels.removeFromChat',
  'channels.create',
  'channels.delete',
  'business.updateProfile',
  'calls.reject',
  'webhooks.parse',
];

/** Fábrica do adapter WPPConnect Server. */
export function wppconnect(options: WppconnectOptions): WaAdapter {
  const session = options.session;
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { Authorization: `Bearer ${options.token}` },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.token],
    provider: PROVIDER,
    fetch: options.fetch,
  });

  const instance: InstanceApi = {
    connect: () => connectInstance(http, session, options),
    status: () => statusInstance(http, session),
    logout: () => logoutInstance(http, session),
  };

  const messages: MessagesApi = {
    sendText: (input) => sendText(http, session, input),
    sendMedia: (input) => sendMedia(http, session, input),
    sendReaction: (input) => sendReaction(http, session, input),
    edit: (input) => editMessage(http, session, input),
    delete: (input) => deleteMessage(http, session, input),
    forward: (input) => forwardMessage(http, session, input),
    star: (input) => setMessageStarred(http, session, input, true),
    unstar: (input) => setMessageStarred(http, session, input, false),
    sendLocation: (input) => sendLocation(http, session, input),
    sendContactCard: (input) => sendContactCard(http, session, input),
    sendPoll: (input) => sendPoll(http, session, input),
  };

  const groups: GroupsApi = {
    create: (input) => createGroup(http, session, input),
    getInfo: (groupId) => getGroupInfo(http, session, groupId),
    list: () => listGroups(http, session),
    addParticipants: (input) => updateGroupParticipants(http, session, input, 'add'),
    removeParticipants: (input) => updateGroupParticipants(http, session, input, 'remove'),
    promoteParticipants: (input) => updateGroupParticipants(http, session, input, 'promote'),
    demoteParticipants: (input) => updateGroupParticipants(http, session, input, 'demote'),
    updateSubject: (input) => updateGroupSubject(http, session, input),
    updateDescription: (input) => updateGroupDescription(http, session, input),
    updatePicture: (input) => updateGroupPicture(http, session, input),
    getInviteLink: (groupId) => fetchGroupInviteLink(http, session, groupId, false),
    revokeInviteLink: (groupId) => fetchGroupInviteLink(http, session, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, session, input),
    leaveGroup: (groupId) => leaveGroupCall(http, session, groupId),
  };

  const contacts: ContactsApi = {
    list: () => listContacts(http, session),
    get: (chatId) => getContact(http, session, chatId),
    checkExists: (phone) => checkContactExists(http, session, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, session, chatId),
    getAbout: (chatId) => getContactAbout(http, session, chatId),
    block: (chatId) => blockContact(http, session, chatId),
    unblock: (chatId) => unblockContact(http, session, chatId),
    listBlocked: () => listBlockedContacts(http, session),
  };

  const chats: ChatsApi = {
    archive: (chatId) => setChatArchived(http, session, chatId, true),
    unarchive: (chatId) => setChatArchived(http, session, chatId, false),
    mute: (chatId) => setChatMuted(http, session, chatId, true),
    unmute: (chatId) => setChatMuted(http, session, chatId, false),
    pin: (chatId) => setChatPinned(http, session, chatId, true),
    unpin: (chatId) => setChatPinned(http, session, chatId, false),
    markRead: (chatId) => markChatRead(http, session, chatId),
    markUnread: (chatId) => markChatUnread(http, session, chatId),
  };

  const presence: PresenceApi = {
    setTyping: (input) => setTyping(http, session, input),
    set: (state) => setOnlinePresence(http, session, state),
    subscribe: (chatId) => subscribePresence(http, session, chatId),
  };

  /**
   * Namespace `labels.*` (ADR-0016). Cobertura 5/6 — **sem `labels.update`**: busca exaustiva nas
   * rotas registradas (`routes.ts`) só encontrou `add-new-label`/`get-all-labels`/`delete-label`/
   * `add-or-remove-label` — nenhuma rota edita um label existente (renomear/recolorir). Capability
   * NÃO declarada, método NÃO implementado.
   */
  const labels: LabelsApi = {
    list: () => listLabels(http, session),
    create: (input) => createLabel(http, session, input),
    delete: (labelId) => deleteLabel(http, session, labelId),
    addToChat: (input) => setChatLabel(http, session, input, 'add'),
    removeFromChat: (input) => setChatLabel(http, session, input, 'remove'),
  };

  /**
   * Namespace `channels.*` (ADR-0017). Cobertura 2/6 (`create`/`delete`) — achado ao vivo que
   * corrige o relatório original (que não tinha encontrado NADA sobre canais/newsletters neste
   * provider). `routes.ts` só registra 4 rotas de newsletter no total; `list`/`getInfo`/`follow`/
   * `unfollow` NÃO existem como endpoint HTTP no servidor — mesmo que a lib `@wppconnect/wa-js`
   * subjacente tenha `follow`/`unfollow` internamente, o `wppconnect-server` não os expõe via
   * rota (achado confirmado ao vivo contra o código-fonte de ambos os repositórios).
   */
  const channels: ChannelsApi = {
    create: (input) => createChannel(http, session, input),
    delete: (channelId) => deleteChannel(http, session, channelId),
  };

  /**
   * Namespace `business.*` (ADR-0018). Cobertura 1/2 — só `updateProfile`, achado ao vivo
   * (`routes.ts`, seção `// Business`): não existe rota de LEITURA de perfil comercial
   * (`get-business-profiles-products`/`get-order-by-messageId` são de catálogo/pedidos, fora de
   * escopo). `getProfile` não declarado.
   */
  const business: BusinessApi = {
    updateProfile: (input) => updateBusinessProfile(http, session, input),
  };

  /**
   * Namespace `calls.*` (ADR-0019). Cobertura 1/2 — só `reject`, achado ao vivo em `routes.ts`.
   * `callId` é o ÚNICO campo exigido (`req.client.rejectCall(callId)`, sem `callerId`) — diferente
   * de WAHA/Whapi/Wuzapi/Evolution GO. Sem `calls.make`: nenhum endpoint para originar chamada.
   */
  const calls: CallsApi = {
    reject: (input) => rejectCall(http, session, input),
  };

  return {
    provider: PROVIDER,
    capabilities: WPPCONNECT_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    channels,
    business,
    calls,
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// map-out: canônico -> WPPConnect
// ---------------------------------------------------------------------------

/** Path de toda chamada operacional: `/api/{session}<suffix>`, com o nome da sessão codificado. */
function sessionPath(session: string, suffix: string): string {
  return `/api/${encodeURIComponent(session)}${suffix}`;
}

interface WppconnectRecipient {
  phone: string;
  isGroup: boolean;
  isNewsletter: boolean;
  isLid: boolean;
}

/**
 * O middleware `statusConnection` do servidor (aplicado a `send-message`/`send-image`/
 * `send-file-base64`/`send-voice-base64`/`send-sticker`/etc., confirmado na pesquisa) reconstrói o
 * JID a partir de `phone` + flags (`isGroup`/`isNewsletter`/`isLid`) via `contactToArray`, que
 * SEMPRE concatena um sufixo (`@g.us`/`@newsletter`/`@lid`/`@c.us`) ao valor de `phone` — mesmo que
 * ele já contenha `@`. Ou seja: se o chatId canônico já chega como JID explícito (com sufixo), enviá-lo
 * cru no campo `phone` produziria um sufixo DUPLICADO no servidor (`...@s.whatsapp.net@c.us`).
 * Por isso este adapter sempre extrai só a parte local (antes do `@`) para `phone`, e deriva as
 * flags a partir do sufixo original do JID (quando presente) — nunca repassa um JID completo no
 * campo `phone`.
 */
function toWppconnectRecipient(chatId: string): WppconnectRecipient {
  if (!isJid(chatId)) {
    return { phone: chatId, isGroup: false, isNewsletter: false, isLid: false };
  }
  const atIndex = chatId.indexOf('@');
  const user = atIndex >= 0 ? chatId.slice(0, atIndex) : chatId;
  const server = atIndex >= 0 ? chatId.slice(atIndex + 1) : '';
  return {
    phone: user,
    isGroup: isGroupChatId(chatId),
    isNewsletter: server === 'newsletter',
    isLid: server === 'lid',
  };
}

/**
 * `POST /send-mentioned` exige `mentioned` como array de JIDs completos (`"556593077171@c.us"`,
 * exemplo literal do dossiê) — `SendTextInput.mentions` não é normalizado pelo conector (só `to`
 * passa por `normalizeChatId`), então cada item pode chegar como dígitos crus, E.164 com `+`/
 * pontuação, ou já um JID. Aqui: JIDs passam intactos; o resto vira `<dígitos>@c.us`.
 */
function toWppconnectMentionJid(mention: string): string {
  return isJid(mention) ? mention : `${digitsOnly(mention)}@c.us`;
}

interface MediaEndpoint {
  path: string;
  /** Nome do campo do body que recebe a URL/data-URI — ver `MEDIA_ENDPOINTS`. */
  field: string;
  supportsCaption: boolean;
}

/**
 * Um endpoint por `MediaKind`, confirmado no dossiê:
 * - `image`/`video`/`document` -> `POST /send-file-base64` (MESMO handler do servidor para os
 *   três — o tipo real é detectado pelo mimetype do conteúdo, não pela rota chamada; `send-image`/
 *   `send-file` também existem mas exigem multipart/path local, que este adapter não usa).
 * - `audio` -> `POST /send-voice-base64` (nota de voz/PTT — endpoint dedicado, distinto do
 *   genérico). Nome do campo do body não confirmado individualmente para esta rota na pesquisa —
 *   assumido `base64` por analogia com o padrão dos demais endpoints `-base64` deste provider.
 * - `sticker` -> `POST /send-sticker`. **Campo confirmado é `path`, não `base64`** (o controller
 *   só lê `{phone, path}`, nenhum campo de legenda) — divergência de nome de campo em relação aos
 *   demais endpoints deste próprio provider, citada aqui deliberadamente para não confundir com o
 *   padrão dos outros quatro. `send-sticker-gif` (sticker animado) não é usado — `MediaKind` não
 *   distingue sticker estático de animado.
 */
const MEDIA_ENDPOINTS: Record<MediaKind, MediaEndpoint> = {
  image: { path: '/send-file-base64', field: 'base64', supportsCaption: true },
  video: { path: '/send-file-base64', field: 'base64', supportsCaption: true },
  document: { path: '/send-file-base64', field: 'base64', supportsCaption: true },
  audio: { path: '/send-voice-base64', field: 'base64', supportsCaption: false },
  sticker: { path: '/send-sticker', field: 'path', supportsCaption: false },
};

/** Mimetype-padrão usado só para montar a data URI de base64 quando `media.mimeType` não é informado. */
const DEFAULT_MIME_BY_KIND: Record<MediaKind, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/ogg',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

/**
 * O controller `sendFile` monta `pathFile = path || base64 || req.file?.path` — confirma URL
 * `http(s)` e base64 (com ou sem prefixo `data:`) como valores aceitos no mesmo campo. Este adapter
 * nunca usa `path` (caminho local no servidor) nem multipart — só URL ou data URI, mesmo padrão já
 * usado nos adapters Wuzapi/Whapi (`resolveMediaValue`).
 */
function resolveMediaValue(media: MediaRef): string {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith('data:')) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND[media.kind];
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    'INVALID_INPUT',
    'WPPConnect: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER },
  );
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

async function connectInstance(
  http: HttpClient,
  session: string,
  options: WppconnectOptions,
): Promise<ConnectResult> {
  const body: Record<string, unknown> = { waitQrCode: options.waitQrCode ?? true };
  if (options.webhook) {
    body.webhook = options.webhook;
  }

  // `waitQrCode: true` (padrão) faz a chamada aguardar (bounded pelo timeoutMs do HttpClient) até o
  // QR ou o pairing code chegar. Este adapter nunca envia "phone" no body (ver
  // WPPCONNECT_CAPABILITIES — instance.pairingCode não declarada), então a resposta síncrona só
  // pode ser o shape de QR (`status: "qrcode"`, literal MINÚSCULO — diferente do enum
  // `client.status` usado por GET /status-session, ver mapInstanceState) ou, se a sessão já estiver
  // conectada/autenticada, algo que NÃO é esse shape — ver risco documentado em
  // `WppconnectOptions.waitQrCode`.
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/start-session'),
    body,
  });
  const record = asRecord(response);
  const status = record ? asString(record.status) : undefined;
  const qr = status === 'qrcode' ? asString(record?.qrcode) : undefined;
  return { qr, raw: response };
}

/**
 * `GET /status-session` (== `getSessionState`). `data.status` é o enum `client.status` do
 * provider: `null | 'CLOSED' | 'INITIALIZING' | 'QRCODE' | 'PHONECODE' | 'CONNECTED'` (string solta,
 * sem tipo declarado no servidor). Note que este é um conjunto de valores DIFERENTE do literal
 * `status: 'qrcode'`/`'phoneCode'` (minúsculo) devolvido pela resposta síncrona de
 * `POST /start-session` (ver `connectInstance`) — mesmo nome de campo, dois vocabulários distintos,
 * confirmado no código-fonte do provider.
 */
async function statusInstance(http: HttpClient, session: string): Promise<InstanceStatus> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, '/status-session'),
  });
  const record = asRecord(response);
  return { state: mapInstanceState(record?.status), raw: response };
}

/**
 * | `status` | `InstanceState` |
 * | --- | --- |
 * | `null` | `disconnected` |
 * | `'CLOSED'` | `disconnected` |
 * | `'INITIALIZING'` | `connecting` |
 * | `'QRCODE'` | `qr` |
 * | `'PHONECODE'` | `qr` *(decisão de implementação — sem estado canônico dedicado a pairing code;
 *   "aguardando ação externa do usuário" é o denominador comum com `QRCODE`, ver
 *   docs/providers/wppconnect.md)* |
 * | `'CONNECTED'` | `connected` |
 * | ausente/tipo inesperado | `unknown` (nunca lança) |
 * | qualquer outra string | `unknown` (nunca lança) |
 */
function mapInstanceState(status: unknown): InstanceState {
  if (status === null) return 'disconnected';
  const value = asString(status);
  if (value === undefined) return 'unknown';
  switch (value) {
    case 'CLOSED':
      return 'disconnected';
    case 'INITIALIZING':
      return 'connecting';
    case 'QRCODE':
      return 'qr';
    case 'PHONECODE':
      return 'qr';
    case 'CONNECTED':
      return 'connected';
    default:
      return 'unknown';
  }
}

/**
 * `POST /logout-session` — hard logout: invalida o dispositivo vinculado no WhatsApp e apaga as
 * credenciais persistidas, exigindo novo QR/pairing na próxima conexão. Distinto de
 * `POST /close-session` (soft, só fecha o Puppeteer em memória preservando credenciais) — sem
 * equivalente no contrato atual (`InstanceApi` só tem `logout()`), mesmo gap já documentado nos
 * dossiês Wuzapi/QuePasa para a mesma distinção hard/soft.
 */
async function logoutInstance(http: HttpClient, session: string): Promise<void> {
  await http.request({ method: 'POST', path: sessionPath(session, '/logout-session') });
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

/**
 * Envelope padrão de toda resposta HTTP do WPPConnect Server para operações de
 * mensagem/grupo/contato (função `returnSucess` do servidor, confirmada como universal na
 * pesquisa): `{status: 'success'|'error', response: <conteúdo específico da operação>, mapper}`.
 * **Não se aplica** aos endpoints de sessão (`start-session`/`status-session`/`logout-session`/
 * `generate-token`), que têm shapes próprios com significado semântico no próprio campo `status`
 * (ver `connectInstance`/`statusInstance`).
 *
 * **Segunda exceção confirmada, isolada**: `POST /list-chats` (`groups.list`, ver `listGroups`)
 * também foge do envelope — `DeviceController.listChats` responde `res.status(200).json(response)`
 * sem embrulho, diferente de todos os outros handlers de mensagem/grupo/contato verificados. Esta
 * função "funciona" para `/list-chats` só porque `asRecord` rejeita arrays e cai no `return body`
 * bruto, que por coincidência já é o array cru esperado — não remover essa checagem defensiva de
 * array sem revalidar `listGroups`.
 */
function unwrapResponse(body: unknown): unknown {
  const record = asRecord(body);
  return record && 'response' in record ? record.response : body;
}

/**
 * O middleware `statusConnection` SEMPRE reescreve `req.body.phone` para um ARRAY antes dos
 * handlers de `sendMessage`/`sendFile`/`sendVoice64`/`sendImageAsSticker` rodarem — e esses
 * handlers, por sua vez, montam a resposta com `results.push(await client.sendXxx(...))` dentro de
 * um loop sobre esse array, então `response` do envelope é sempre um array de um elemento
 * (`[Message]` ou `[{ack,id}]`), nunca o objeto bare que se poderia esperar. **Exceção confirmada**:
 * `sendMentioned` (`POST /send-mentioned`) atribui `response = await client.sendMentioned(...)`
 * diretamente dentro do loop, sem `push` — response ali já é o objeto bare. Esta função cobre os
 * dois casos: desembrulha um array de um elemento quando presente, e repassa intacto quando já é o
 * objeto bare (caso `send-mentioned`).
 */
function unwrapArrayResponse(body: unknown): unknown {
  const unwrapped = unwrapResponse(body);
  return Array.isArray(unwrapped) ? unwrapped[0] : unwrapped;
}

async function sendText(
  http: HttpClient,
  session: string,
  input: SendTextInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);

  if (input.mentions && input.mentions.length > 0) {
    // `POST /send-mentioned` é um endpoint dedicado e não aceita `options.quotedMsg` (não
    // confirmado no dossiê) — quotedId é ignorado neste caminho, mesmo padrão de "melhor esforço,
    // sem inventar suporte" já usado em outros adapters para combinações não confirmadas.
    const body: Record<string, unknown> = {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      message: input.text,
      mentioned: input.mentions.map(toWppconnectMentionJid),
    };
    const response = await http.request<unknown>({
      method: 'POST',
      path: sessionPath(session, '/send-mentioned'),
      body,
    });
    return mapSentMessageFromMessage(response, recipient.phone);
  }

  const body: Record<string, unknown> = {
    phone: recipient.phone,
    isGroup: recipient.isGroup,
    isNewsletter: recipient.isNewsletter,
    isLid: recipient.isLid,
    message: input.text,
  };
  if (input.quotedId) {
    body.options = { quotedMsg: input.quotedId };
  }

  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/send-message'),
    body,
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}

async function sendMedia(
  http: HttpClient,
  session: string,
  input: SendMediaInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);
  const endpoint = MEDIA_ENDPOINTS[input.media.kind];
  const value = resolveMediaValue(input.media);

  const body: Record<string, unknown> = {
    phone: recipient.phone,
    isGroup: recipient.isGroup,
    [endpoint.field]: value,
  };
  if (endpoint.supportsCaption && input.caption) {
    body.caption = input.caption;
  }
  if (input.media.kind === 'document' && input.media.filename) {
    body.filename = input.media.filename;
  }
  if (input.quotedId) {
    // Campo assumido por analogia com o parâmetro posicional `quotedMessageId` visto no snippet do
    // controller (`sendFile(contact, pathFile, {..., quotedMsg: quotedMessageId})`) — o NOME exato
    // do campo do body de entrada não foi confirmado por um exemplo JSON literal (diferente de
    // `send-message`, que confirma `options.quotedMsg` aninhado). Ver docs/providers/wppconnect.md.
    body.quotedMessageId = input.quotedId;
  }

  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, endpoint.path),
    body,
  });
  return mapSentMessageFromAckId(response, recipient.phone);
}

/**
 * `POST /react-message`, body `{msgId, reaction}`. Resposta é FIXA
 * (`{message: 'Reaction sended'}`, dentro do envelope padrão) — sem `id`/`chatId`/`timestamp` da
 * reação em si (confirmado no dossiê). `SentMessage.id` ecoa `input.messageId` (a mensagem-alvo,
 * mesmo padrão do adapter Wuzapi para o mesmo caso), `chatId` ecoa `to` requisitado; `timestamp`
 * fica `undefined` (não há valor real para popular).
 *
 * Remoção de reação: a convenção canônica usa `emoji === ''`. A assinatura da lib subjacente
 * (`sendReactionToMessage(msgId, reaction: string | false)`) confirma que o valor booleano `false`
 * (não uma string) é o sentinela real de remoção — este adapter traduz `emoji === ''` para o
 * literal JSON `false` no campo `reaction`. **Confiança média-alta**: não testado contra uma
 * instância real (ver docs/providers/wppconnect.md).
 */
async function sendReaction(
  http: HttpClient,
  session: string,
  input: SendReactionInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);
  const reaction: string | boolean = input.emoji === '' ? false : input.emoji;

  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/react-message'),
    body: { msgId: input.messageId, reaction },
  });

  return { id: input.messageId, chatId: recipient.phone, raw: response };
}

/**
 * `POST /edit-message` (`MessageController.editMessage`, retrofit ADR-0012 — pesquisa dedicada de
 * 2026-07-12, confiança Alta). Body `{id, newText, options?}` — SEM `phone`/`isGroup`: o `id` da
 * mensagem já identifica o chat sozinho (mesmo padrão do adapter uazapi para o mesmo tipo de
 * endpoint), então `input.to` NÃO é enviado no request — só usado como fallback de `chatId` no
 * mapeamento da resposta.
 *
 * **Delegação confirmada até a lib** (`controls.layer.ts`, `e153ff72`): edita, RE-BUSCA a mensagem
 * completa via `getMessageById` e valida `result.body === newText`, lançando o próprio resultado
 * bruto do WPP (não um `Error` padrão) se a checagem falhar. Resposta HTTP em si segue o envelope
 * padrão (`returnSucess`, `messageController.ts`) — `response` é o objeto `Message` completo, BARE
 * (diferente de `sendText`/`sendMedia`: este endpoint não passa pelo middleware
 * `statusConnection`, que é quem produz o array de um elemento — não usa `unwrapArrayResponse`).
 *
 * **Sem janela de tempo verificável**: a checagem de "pode editar" (`canEditMsg`/`canEditCaption`)
 * é um re-export de símbolo interno do bundle fechado do WhatsApp Web — se falhar, `WPP.chat.
 * editMessage` lança ANTES de qualquer chamada de rede, propagando pelo `page.evaluate` até o
 * catch do controller, que devolve uma mensagem genérica fixa (`'Erro ao enviar a mensagem.'`),
 * com o motivo real só dentro da chave `error` do corpo HTTP. Este adapter não valida nenhum prazo
 * localmente (nenhum provider pesquisado confirma essa janela em código, ver ADR-0012).
 *
 * **Sem webhook de entrada correspondente**: o controller emite a edição só via Socket.IO
 * (`req.io.emit('edited-message', edited)`), não via `callWebHook` — busca exaustiva nos registros
 * de hook (`src/util/createSessionUtil.ts`) não encontra um `onEditMessage`/equivalente. Uma
 * mensagem editada por OUTRA parte não gera nenhum evento canônico de entrada nesta fase.
 */
async function editMessage(
  http: HttpClient,
  session: string,
  input: EditMessageInput,
): Promise<SentMessage> {
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/edit-message'),
    body: { id: input.messageId, newText: input.text },
  });
  const message = asRecord(unwrapResponse(response));
  const id = asString(message?.id) ?? input.messageId;
  const chatId = extractChatId(message?.chatId) ?? toWppconnectRecipient(input.to).phone;
  const timestamp = secondsToEpochMs(message?.timestamp ?? message?.t);
  return { id, chatId, timestamp, raw: response };
}

/**
 * `POST /delete-message` (`DeviceController.deleteMessage`, retrofit ADR-0012 — confiança Alta).
 * Body `{phone, isGroup, messageId, onlyLocal, deleteMediaInDevice}`.
 *
 * **Achado central confirmado em código**: a lib subjacente (`controls.layer.ts`) tem
 * `onlyLocal = false` como default e repassa `!onlyLocal` para `WPP.chat.deleteMessage` — ou seja,
 * o comportamento PADRÃO do provider já é revogação ("apagar para todos"), exatamente a semântica
 * assumida por `DeleteMessageInput` (sem campo de escopo, ver ADR-0012). Este adapter envia
 * `onlyLocal: false` EXPLICITAMENTE (em vez de confiar num default silencioso que poderia mudar
 * numa versão futura do provider) — não usa `deleteMediaInDevice` (fica no default `true` da lib,
 * que só afeta o cache local de mídia, não o alcance da revogação).
 *
 * **Achado extra, registrado para não ser redescoberto**: o próprio exemplo de documentação do
 * provider rotula um payload sem `onlyLocal: true` como "delete only me" — dado o default real,
 * esse exemplo produziria revogação para todos, não exclusão local (divergência confirmada entre
 * doc e código, ver docs/providers/wppconnect.md).
 *
 * Resposta é mensagem FIXA (`{message: 'Message deleted'}`, sem `id`/`chatId`/`timestamp`) —
 * ignorada, contrato retorna `Promise<void>`.
 */
async function deleteMessage(
  http: HttpClient,
  session: string,
  input: DeleteMessageInput,
): Promise<void> {
  const recipient = toWppconnectRecipient(input.to);
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/delete-message'),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      messageId: input.messageId,
      onlyLocal: false,
    },
  });
}

/**
 * `POST /forward-messages` (ADR-0013; `DeviceController.forwardMessages`, confirmado em código —
 * commit `f09e2fed`). Body confirmado pelo Swagger real: `{phone, isGroup, messageId}` — o
 * handler faz `phone[0]` (reescrito para array pelo middleware `statusConnection`, mesmo
 * mecanismo de `sendText`/`sendMedia`) e chama `forwardMessagesV2(phone[0], messageId)` da lib.
 * `ForwardMessageInput.fromChatId` nunca é enviado — a implementação real usa só o `messageId` da
 * mensagem original (que já a identifica), não uma origem separada.
 *
 * **Bug real confirmado no controller** (`deviceController.ts:968-1021`): o `if (!isGroup)
 * {...} else {...}` tem os DOIS ramos chamando exatamente a mesma linha
 * (`forwardMessagesV2(phone[0], messageId)`) — `isGroup` não tem nenhum efeito real no
 * comportamento, apesar de aceito no schema. Este adapter envia `isGroup` mesmo assim (por
 * completude/estabilidade futura), mas documentado aqui para não ser redescoberto.
 *
 * Resposta segue o envelope padrão (`{status:'success', response}`) — diferente de `list-chats`
 * (ver `unwrapResponse`), este endpoint passa pelo padrão normal `returnSucess`. `response` é o
 * retorno de `forwardMessagesV2` da lib — shape exato não capturado; `mapSentMessageFromMessage`
 * cai no fallback de id sintético se a resposta não ecoar `id`/`chatId`.
 */
async function forwardMessage(
  http: HttpClient,
  session: string,
  input: ForwardMessageInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/forward-messages'),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      messageId: input.messageId,
    },
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}

/**
 * `POST /star-message` (ADR-0013; `DeviceController.starMessage`, confirmado em código). Body:
 * `{messageId, star: boolean}` — SEM `phone`/`isGroup`: o `messageId` sozinho identifica a
 * mensagem (`client.starMessage(messageId, star)` da lib). As 2 capabilities canônicas
 * (`messages.star`/`unstar`, ADR-0013) mapeiam para `star: true`/`star: false` no mesmo endpoint.
 * Resposta segue o envelope padrão — ignorada, contrato retorna `Promise<void>`.
 */
async function setMessageStarred(
  http: HttpClient,
  session: string,
  input: StarMessageInput,
  star: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/star-message'),
    body: { messageId: input.messageId, star },
  });
}

/**
 * `POST /send-location` (ADR-0014; `MessageController.sendLocation`, confirmado em código —
 * commit `f09e2fed`). Body confirmado pelo Swagger real: `{phone, isGroup, lat, lng, title,
 * address}` — **`lat`/`lng` são STRINGS no schema, não números** (`{"lat":"-89898322","lng":
 * "-545454", ...}` no exemplo literal). `phone` é reescrito para array pelo middleware
 * `statusConnection` (mesmo mecanismo de `sendText`/`forwardMessage`); o handler faz `for (const
 * contato of phone) { results.push(await req.client.sendLocation(contato, {lat, lng, address,
 * name: title})) }` — resposta é um array de 1 elemento para este adapter (sempre 1 destinatário),
 * mesmo padrão de `unwrapArrayResponse` já usado por `sendText`/`sendMedia`.
 * `SendLocationInput.name` mapeia para `title` (rótulo do pin); `address` direto.
 */
async function sendLocation(
  http: HttpClient,
  session: string,
  input: SendLocationInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);
  const body: Record<string, unknown> = {
    phone: recipient.phone,
    isGroup: recipient.isGroup,
    lat: String(input.latitude),
    lng: String(input.longitude),
  };
  if (input.name) body.title = input.name;
  if (input.address) body.address = input.address;

  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/send-location'),
    body,
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}

/**
 * `POST /contact-vcard` (ADR-0014; `DeviceController.sendContactVcard`, confirmado em código).
 * Body confirmado pelo Swagger real: `{phone, isGroup, name, contactsId}` — `contactsId` é um
 * ARRAY de contatos (permite enviar múltiplos contatos numa única mensagem; exemplo literal:
 * `contactsId: ['5521999999999']`), diferente da maioria dos outros adapters (que aceitam só um
 * contato solto) — `SendContactCardInput` só modela um contato/telefone, então este adapter sempre
 * envia um array de 1 elemento. `name` é o rótulo exibido na mensagem de contato (não precisa
 * bater com o nome salvo do contato em si). **Divergência de envelope confirmada no controller**:
 * diferente de `sendLocation`/`sendPollMessage` (que fazem `results.push(...)` e retornam um
 * ARRAY), este handler faz `response = await client.sendContactVcard(...)` dentro do loop SEM
 * `push` — o último valor sobrescreve os anteriores, resultando num objeto BARE, não um array (para
 * este adapter, que sempre envia 1 destinatário, o resultado prático é o mesmo objeto de qualquer
 * forma). `unwrapArrayResponse` cobre os dois casos sem alteração.
 */
async function sendContactCard(
  http: HttpClient,
  session: string,
  input: SendContactCardInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/contact-vcard'),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      name: input.contactName,
      contactsId: [input.contactPhone],
    },
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}

/**
 * `POST /send-poll-message` (ADR-0014; `MessageController.sendPollMessage`, confirmado em código).
 * Body confirmado pelo Swagger real: `{phone, isGroup, name, choices, options: {selectableCount}}`
 * — `SendPollInput.question`/`.options` mapeiam para `name`/`choices`; `selectableCount` é o
 * NÚMERO MÁXIMO de opções selecionáveis (exemplo literal do schema usa `1`, escolha única).
 * `allowMultipleAnswers` mapeia para `selectableCount: options.length` (qualquer número de opções)
 * quando `true`, `1` quando `false`/ausente — mesmo critério "default mais restritivo" já usado
 * nos demais adapters desta ADR. Mesmo padrão de array de `sendLocation` (`results.push(...)`).
 */
async function sendPoll(
  http: HttpClient,
  session: string,
  input: SendPollInput,
): Promise<SentMessage> {
  const recipient = toWppconnectRecipient(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/send-poll-message'),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      name: input.question,
      choices: input.options,
      options: { selectableCount: input.allowMultipleAnswers ? input.options.length : 1 },
    },
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}

/**
 * `sendText` (via `POST /send-message`) retorna, dentro do envelope, um ARRAY de um elemento
 * contendo o objeto `Message` COMPLETO da lib (o handler do servidor sempre reescreve `phone` para
 * array via `statusConnection` e faz `results.push(await client.sendText(...))` num loop — ver
 * `unwrapArrayResponse`); `send-mentioned` é a exceção confirmada e retorna o `Message` bare, sem
 * array. `timestamp` é assumido em SEGUNDOS por analogia com a convenção documentada em
 * `IncomingCall.offerTime` ("Epoch timestamp (seconds)", mesmo arquivo de tipos) — **não confirmado
 * literalmente para este campo específico** (ver docs/providers/wppconnect.md).
 */
function mapSentMessageFromMessage(body: unknown, requestedPhone: string): SentMessage {
  const message = asRecord(unwrapArrayResponse(body));
  const id = asString(message?.id) ?? `wppconnect-${Date.now()}`;
  const chatId = extractChatId(message?.chatId) ?? requestedPhone;
  const timestamp = secondsToEpochMs(message?.timestamp ?? message?.t);
  return { id, chatId, timestamp, raw: body };
}

/**
 * `sendFile`/`sendImageFromBase64`/`sendPttFromBase64` (usados por `messages.sendMedia`) retornam,
 * dentro do envelope, um ARRAY de um elemento contendo `{ack, id}` — SEM `chatId` nem `timestamp`
 * (confirmado no dossiê, shape diferente do `Message` completo de `sendText`; ver
 * `unwrapArrayResponse` para o porquê do array). `chatId` cai no `to` requisitado; `timestamp`
 * fica `undefined` (nenhum valor real disponível para popular, não inventado).
 */
function mapSentMessageFromAckId(body: unknown, requestedPhone: string): SentMessage {
  const data = asRecord(unwrapArrayResponse(body));
  const id = asString(data?.id) ?? `wppconnect-${Date.now()}`;
  return { id, chatId: requestedPhone, raw: body };
}

/** `chatId`/`Message.id` de campos tipados `string | Wid` no dossiê — aceita string direta ou objeto `{_serialized}`. */
function extractChatId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return record ? asString(record._serialized) : undefined;
}

// ---------------------------------------------------------------------------
// groups.*
// ---------------------------------------------------------------------------

/**
 * `POST /create-group`, body `{participants, name}`. **Achado crítico confirmado na pesquisa**: o
 * controller do servidor monta `infoGroup.push({name: group, id: response.gid.user, participants:
 * response.participants})` e responde com `{message, group: name, groupInfo: infoGroup}` — ou
 * seja, `id`/`name`/`participants` ficam ANINHADOS em `data.groupInfo[0]`, não diretamente em
 * `data`. `id` ali é só a parte "user" do JID do grupo (dígitos crus), NÃO o JID completo
 * `<dígitos>@g.us` que `GET /group-info/:groupId` e todo o resto de `groups.*` espera como
 * `:groupId`. Sem o sufixo, o `id` devolvido por `create()` seria inútil para operações
 * subsequentes no MESMO grupo. Este adapter lê `data.groupInfo[0]` e corrige o `id` reconstruindo o
 * JID completo (`toWppconnectGroupId`) sempre que o valor devolvido não contém `@` — decisão
 * deliberada para manter `GroupInfo.id` de fato opaco e reutilizável (ADR-0009), não uma tentativa
 * de adivinhar um campo ausente.
 *
 * `groupInfo[0].participants` da resposta não tem shape confirmado (array de string vs. de objeto)
 * — este adapter não tenta parseá-lo; cai sempre nos participantes requisitados
 * (`isAdmin`/`isSuperAdmin` assumidos `false`), mesmo padrão de fallback do adapter Wuzapi quando a
 * resposta não ecoa todos os campos.
 */
async function createGroup(
  http: HttpClient,
  session: string,
  input: CreateGroupInput,
): Promise<GroupInfo> {
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/create-group'),
    body: { name: input.subject, participants: input.participants },
  });
  const data = asRecord(unwrapResponse(response));
  const groupInfoList = Array.isArray(data?.groupInfo) ? data.groupInfo : undefined;
  const info = asRecord(groupInfoList?.[0]);
  const id = toWppconnectGroupId(asString(info?.id));
  const subject = asString(info?.name) ?? input.subject;
  return {
    id,
    subject,
    participants: input.participants.map(toFallbackParticipant),
    raw: response,
  };
}

/** Grupos do WhatsApp sempre têm JID `<dígitos>@g.us` — reconstrói o sufixo quando ausente (ver `createGroup`). */
function toWppconnectGroupId(rawId: string | undefined): string {
  if (!rawId) return '';
  return rawId.includes('@') ? rawId : `${rawId}@g.us`;
}

function toFallbackParticipant(id: string): GroupParticipant {
  return { id, isAdmin: false, isSuperAdmin: false };
}

/**
 * `GET /group-info/:groupId`. Resposta confirmada (dentro de `response`):
 * `{id, name, description, subject, subjectUpdatedAt/By, descriptionUpdatedAt/By, createdAt,
 * lastActivityAt, participants: [{id, isAdmin}]}`. Note que `name` E `subject` coexistem no mesmo
 * objeto (redundância aparente do provider, não confirmada qual é a fonte de verdade) — este
 * adapter prioriza `name`, com fallback para `subject`. `participants[].isSuperAdmin` **não é
 * confirmado** nesta resposta (só `isAdmin`) — sempre `false` (ver `mapGroupParticipants`).
 */
async function getGroupInfo(
  http: HttpClient,
  session: string,
  groupId: string,
): Promise<GroupInfo> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, `/group-info/${encodeURIComponent(groupId)}`),
  });
  const data = asRecord(unwrapResponse(response));
  return {
    id: asString(data?.id) ?? groupId,
    subject: asString(data?.name) ?? asString(data?.subject) ?? '',
    description: asString(data?.description),
    participants: mapGroupParticipants(data?.participants) ?? [],
    raw: response,
  };
}

function mapGroupParticipants(value: unknown): GroupParticipant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const record = asRecord(item);
    return {
      id: asString(record?.id) ?? '',
      isAdmin: asBoolean(record?.isAdmin) ?? false,
      // isSuperAdmin não confirmado nesta resposta (ver docs/providers/wppconnect.md) — sempre false.
      isSuperAdmin: false,
    };
  });
}

type GroupParticipantsAction = 'add' | 'remove' | 'promote' | 'demote';

/**
 * Quatro endpoints distintos (diferente do Wuzapi, que reaproveita um único endpoint variando
 * `Action`): `add-participant-group`/`remove-participant-group`/`promote-participant-group`/
 * `demote-participant-group`, todos `{groupId, phone}`. **Não confirmado se `phone` aceita um
 * array** para adicionar/remover vários participantes numa única chamada — este adapter chama o
 * endpoint uma vez POR PARTICIPANTE (`Promise.all`), garantindo correção mesmo que o servidor só
 * aceite um valor por chamada (formato mínimo confirmado, sem depender de um comportamento de lote
 * não verificado). `phone` é repassado como o chatId canônico do participante, sem transformação
 * (identity passthrough, mesmo padrão dos demais adapters para participantes de grupo — o formato
 * exato esperado por ESTES quatro endpoints especificamente não foi confirmado por exemplo
 * literal).
 */
const PARTICIPANT_ENDPOINTS: Record<GroupParticipantsAction, string> = {
  add: '/add-participant-group',
  remove: '/remove-participant-group',
  promote: '/promote-participant-group',
  demote: '/demote-participant-group',
};

async function updateGroupParticipants(
  http: HttpClient,
  session: string,
  input: GroupParticipantsInput,
  action: GroupParticipantsAction,
): Promise<void> {
  const path = sessionPath(session, PARTICIPANT_ENDPOINTS[action]);
  await Promise.all(
    input.participants.map((phone) =>
      http.request({ method: 'POST', path, body: { groupId: input.groupId, phone } }),
    ),
  );
}

/** `POST /group-subject`, body `{groupId, title}` — atenção: o campo é `title`, não `subject`/`name`. */
async function updateGroupSubject(
  http: HttpClient,
  session: string,
  input: UpdateGroupSubjectInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/group-subject'),
    body: { groupId: input.groupId, title: input.subject },
  });
}

/** `POST /group-description`, body `{groupId, description}`. */
async function updateGroupDescription(
  http: HttpClient,
  session: string,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/group-description'),
    body: { groupId: input.groupId, description: input.description },
  });
}

/**
 * `POST /group-pic`, body `{groupId, path}` (multipart/path local no servidor real — este adapter
 * usa o mesmo campo `path` para URL/data-URI, via `resolveMediaValue`, mesmo tratamento de
 * `messages.sendMedia` para o campo homônimo de `send-sticker`). Diferente do Wuzapi, a pesquisa
 * não confirma nenhuma restrição de formato (JPEG-only) para este endpoint especificamente.
 */
async function updateGroupPicture(
  http: HttpClient,
  session: string,
  input: UpdateGroupPictureInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/group-pic'),
    body: { groupId: input.groupId, path: resolveMediaValue(input.media) },
  });
}

/**
 * `getInviteLink`/`revokeInviteLink` usam endpoints SEPARADOS (diferente do Wuzapi, que reaproveita
 * um único endpoint com um parâmetro `reset`): `GET /group-invite-link/:groupId` e
 * `GET /group-revoke-link/:groupId`, ambos devolvendo a URL completa `https://chat.whatsapp.com/
 * <código>` (confirmado em `group.layer.ts` da lib). **Resolvido**: `group.layer.ts` mostra que
 * `getGroupInviteLink` sempre retorna uma string bare, nunca um objeto — `response` dentro do
 * envelope é sempre essa string direta para os dois endpoints. `extractInviteLinkValue` trata o
 * caso string primeiro; o ramo de objeto com chaves comuns (`link`/`inviteLink`/`url`) é
 * defensividade extra, na prática código morto para este par de endpoints, mantido por segurança.
 * `normalizeInviteLink` garante o formato completo de qualquer forma.
 */
async function fetchGroupInviteLink(
  http: HttpClient,
  session: string,
  groupId: string,
  revoke: boolean,
): Promise<GroupInviteLink> {
  const routeSuffix = revoke ? '/group-revoke-link/' : '/group-invite-link/';
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, `${routeSuffix}${encodeURIComponent(groupId)}`),
  });
  const link = extractInviteLinkValue(unwrapResponse(response)) ?? '';
  return { link: normalizeInviteLink(link), raw: response };
}

function extractInviteLinkValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return undefined;
  return asString(record.link) ?? asString(record.inviteLink) ?? asString(record.url);
}

/**
 * `POST /join-code`, body `{inviteCode}`. **Confirmado** (diferente do Wuzapi, onde isso era só
 * suposição): a lib subjacente remove qualquer prefixo (`https://`, `chat.whatsapp.com/`,
 * `invite/`) antes de processar — ou seja, aceita tanto o código bare quanto a URL completa. Este
 * adapter repassa `input.invite` como o conector já entrega (sempre normalizado para o link
 * completo, ver `WaConnector.prepareJoinViaInviteLink`), sem precisar extrair o código antes.
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  session: string,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/join-code'),
    body: { inviteCode: input.invite },
  });
}

/** `POST /leave-group`, body `{groupId}`. */
async function leaveGroupCall(http: HttpClient, session: string, groupId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/leave-group'),
    body: { groupId },
  });
}

/**
 * `POST /list-chats` (== `DeviceController.listChats` do server → `listChats(options?:
 * ChatListOptions): Promise<Chat[]>` da lib). Substitui `GET /all-groups`
 * (`GroupController.getAllGroups`), confirmado `#swagger.deprecated` ("Deprecated in favor of
 * 'list-chats'") — não usado por este adapter. Body `{onlyGroups: true}` filtra a listagem para só
 * devolver grupos (sem esse filtro, `listChats` devolveria TODOS os chats, incluindo conversas
 * individuais).
 *
 * **Resposta SEM envelope — anomalia confirmada e isolada deste único endpoint do provider**:
 * diferente de literalmente todos os outros handlers verificados (`getGroupInfo`,
 * `getAllContacts`, `getContact`, `getProfilePicFromServer`, `getStatus`, `getBlockList`,
 * `blockContact`, `unblockContact`, `checkNumberStatus`, `createGroup`, ...), que respondem
 * `res.json({status: 'success', response})`, `DeviceController.listChats` termina com
 * `res.status(200).json(response)` (confirmado no commit `f09e2fed`,
 * `src/controller/deviceController.ts`, tanto nesse commit pinado quanto em HEAD do branch main —
 * não é drift de branch). Ou seja, o corpo HTTP É o array `Chat[]` (`src/api/model/chat.ts` da
 * lib) BRUTO: `{id: Wid, name, isGroup, archive, pin, unreadCount, ephemeralDuration, ...}`, nunca
 * `{status, response, mapper}`. Ver `unwrapResponse` para o porquê disso não quebrar hoje. **Note
 * também a limitação de conteúdo**: `Chat` não carrega a lista de participantes — só
 * `groups.getInfo` traz isso. Este adapter mapeia `participants: []` de propósito (não inventado);
 * quem precisar da lista completa deve encadear `groups.getInfo(id)` por grupo depois de listar.
 */
async function listGroups(http: HttpClient, session: string): Promise<GroupInfo[]> {
  const response = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/list-chats'),
    body: { onlyGroups: true },
  });
  // `unwrapResponse` acerta aqui só "por acidente": o corpo cru já É o array (ver docstring acima),
  // e `asRecord` rejeita arrays (`Array.isArray` -> undefined), então `unwrapResponse` cai no
  // `return body` bruto — que por coincidência é exatamente o array que queremos. Não simplificar
  // `unwrapResponse`/`asRecord` assumindo que todo endpoint segue o envelope `{status, response}`
  // sem revalidar este caso especificamente.
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  return array.map((item) => mapChatToGroupInfo(item));
}

/** `Chat.id` é um `Wid` (`{..., _serialized}`) — mesmo padrão de `extractChatId` usado no resto do arquivo. */
function mapChatToGroupInfo(item: unknown): GroupInfo {
  const data = asRecord(item);
  return {
    id: extractChatId(data?.id) ?? '',
    subject: asString(data?.name) ?? '',
    // `Chat` não expõe participantes (ver docstring de `listGroups`) — vazio de propósito, nunca
    // inventado a partir de outro campo.
    participants: [],
    raw: item,
  };
}

// ---------------------------------------------------------------------------
// contacts.*
// ---------------------------------------------------------------------------

/**
 * `GET /all-contacts` (== `DeviceController.getAllContacts` do server → script injetado
 * `get-all-contacts.js`): `WPP.whatsapp.ContactStore.map(c => WAPI._serializeContactObj(c))` — um
 * array do MESMO shape usado por `contacts.get` (ver `mapContact`).
 */
async function listContacts(http: HttpClient, session: string): Promise<Contact[]> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, '/all-contacts'),
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  return array.map((item) => mapContact(item));
}

/**
 * `GET /contact/:phone` (== `DeviceController.getContact` do server → script injetado
 * `get-contact.js`): `return window.WAPI._serializeContactObj(found)`. **Confiança média-alta**
 * (script injetado real, não a interface TS tipada diretamente da lib) — ver
 * docs/providers/wppconnect.md.
 */
async function getContact(http: HttpClient, session: string, chatId: string): Promise<Contact> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, `/contact/${encodeURIComponent(chatId)}`),
  });
  return mapContact(unwrapResponse(response));
}

/**
 * Mapeia o objeto montado por `WAPI._serializeContactObj` (comum a `contacts.list`/`contacts.get`):
 * `{...serializeRawObj(obj), formattedName, isHighLevelVerified, isMe, isMyContact, isPSA, isUser,
 * isVerified, isWAContact, profilePicThumbObj, statusMute, msgs: null}` — consistente com a
 * interface `Contact` da lib (`src/api/model/contact.ts`: `id, name, pushname, shortName, type`).
 * `name` prioriza o nome salvo na agenda (`name`), caindo para `pushname`/`formattedName`/
 * `shortName` quando ausente. `profilePictureUrl` só é populado quando `profilePicThumbObj` vem
 * embutido no próprio objeto de contato, preferindo `imgFull` sobre `img` (mesmo padrão "prefira a
 * versão full" já usado por outros adapters deste pacote, ex.: Whapi `profile_pic_full`/
 * `profile_pic`). `about`/`isBlocked` ficam sempre `undefined` aqui — este payload não carrega
 * recado nem status de bloqueio (endpoints dedicados: `contacts.getAbout`/`contacts.listBlocked`).
 */
function mapContact(value: unknown): Contact {
  const data = asRecord(value);
  const thumb = asRecord(data?.profilePicThumbObj);
  return {
    id: extractChatId(data?.id) ?? '',
    name:
      asString(data?.name) ??
      asString(data?.pushname) ??
      asString(data?.formattedName) ??
      asString(data?.shortName),
    hasWhatsApp: asBoolean(data?.isWAContact),
    profilePictureUrl: thumb ? (asString(thumb.imgFull) ?? asString(thumb.img)) : undefined,
    raw: value,
  };
}

/**
 * `GET /check-number-status/:phone`. O corpo da resposta HTTP em si não tem um exemplo literal na
 * pesquisa, mas o shape do OBJETO retornado por `checkNumberStatus` (o mesmo método usado
 * internamente pelo middleware `statusConnection`) É confirmado por um trecho de código real:
 * `profile.numberExists` (boolean) e `profile.id._serialized` (JID completo, string) — usado aqui
 * assumindo que o controller apenas embrulha esse mesmo objeto no envelope padrão `{response: ...}`.
 */
async function checkContactExists(
  http: HttpClient,
  session: string,
  phone: string,
): Promise<CheckExistsResult> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, `/check-number-status/${encodeURIComponent(phone)}`),
  });
  const data = asRecord(unwrapResponse(response));
  const idRecord = asRecord(data?.id);
  return {
    exists: asBoolean(data?.numberExists) ?? false,
    chatId: idRecord ? asString(idRecord._serialized) : undefined,
    raw: response,
  };
}

/**
 * `GET /profile-pic/:phone` (== `DeviceController.getProfilePicFromServer` do server → lib
 * `getProfilePicFromServer(chatId): Promise<ProfilePicThumbObj>`, assinatura tipada). Resposta
 * (dentro do envelope): `ProfilePicThumbObj` (`src/api/model/profile-pic-thumb.ts`):
 * `{eurl, id, img, imgFull, raw: null, tag}`. Prioriza `imgFull` sobre `img` (mesmo padrão "prefira
 * a versão full" de `mapContact`/de outros adapters deste pacote). Ausência de foto/privacidade
 * fecha o contato não é modelada aqui como caso especial — se o provider responder sem `img`/
 * `imgFull`, `url` fica `undefined` (nunca inventado).
 */
async function getContactProfilePicture(
  http: HttpClient,
  session: string,
  chatId: string,
): Promise<ContactProfilePicture> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, `/profile-pic/${encodeURIComponent(chatId)}`),
  });
  const data = asRecord(unwrapResponse(response));
  return { url: asString(data?.imgFull) ?? asString(data?.img), raw: response };
}

/**
 * `GET /profile-status/:phone` (== `DeviceController.getStatus` do server → lib
 * `getStatus(contactId): Promise<ContactStatus>`). Montagem do retorno confirmada no código-fonte
 * da lib: `return {id: contactId, status: (status as any)?.status || status}`. Resposta (dentro do
 * envelope): `ContactStatus` (`src/api/model/contact-status.ts`): `{id, status, stale?}`. `status`
 * mapeia para `about` — string vazia é tratada como "sem recado" (mesma convenção do resto deste
 * pacote para campos opcionais textuais).
 */
async function getContactAbout(
  http: HttpClient,
  session: string,
  chatId: string,
): Promise<ContactAbout> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, `/profile-status/${encodeURIComponent(chatId)}`),
  });
  const data = asRecord(unwrapResponse(response));
  const about = asString(data?.status);
  return { about: about === '' ? undefined : about, raw: response };
}

/** `POST /block-contact`, body `{phone}`. Resposta ignorada — contrato retorna `Promise<void>`. */
async function blockContact(http: HttpClient, session: string, chatId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/block-contact'),
    body: { phone: chatId },
  });
}

/** `POST /unblock-contact`, body `{phone}`. Resposta ignorada — contrato retorna `Promise<void>`. */
async function unblockContact(http: HttpClient, session: string, chatId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/unblock-contact'),
    body: { phone: chatId },
  });
}

/**
 * `GET /blocklist` — resposta confirmada no dossiê: o controller mapeia a lista interna para
 * `[{phone: contato.split('@')[0]}, ...]` (dentro de `response`) — só o número, sem o sufixo `@c.us`
 * (o provider descarta o JID completo antes de responder). Bare digits ainda são um chatId
 * canônico válido (mesmo formato que `normalizeChatId` produz para telefones).
 */
async function listBlockedContacts(http: HttpClient, session: string): Promise<string[]> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, '/blocklist'),
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  const phones: string[] = [];
  for (const item of array) {
    const phone = asString(asRecord(item)?.phone);
    if (phone !== undefined) phones.push(phone);
  }
  return phones;
}

// ---------------------------------------------------------------------------
// chats.* (retrofit ADR-0012, pesquisa dedicada de 2026-07-12)
// ---------------------------------------------------------------------------

/**
 * `POST /archive-chat`, body `{phone, isGroup, value}` (`DeviceController.archiveChat`, confiança
 * Alta) — toggle único: o MESMO endpoint arquiva/desarquiva conforme `value`. Chamada única
 * confirmada no controller (sem loop): `await req.client.archiveChat(`${phone}`, value)` — `phone`
 * segue o mesmo tratamento de `toWppconnectRecipient` (extração da parte local do JID) já usado
 * por `messages.*`, evitando o mesmo risco de sufixo duplicado. Resposta é um objeto REAL
 * (`{wid, archive}`, confirmado em `wa-js@a4c57173`) — ignorada aqui, contrato retorna
 * `Promise<void>`.
 *
 * **Nuance de comportamento confirmada (`wa-js` HEAD, dependência ativa não pinada pelo dossiê
 * original — confiança média-alta)**: o provider LANÇA erro se o chat já estiver no estado pedido
 * (arquivar um chat já arquivado, ou desarquivar um já desarquivado) — não é um no-op idempotente.
 * Este adapter não tenta mascarar isso (não inventa idempotência que o provider não garante);
 * consumidores que chamem `archive`/`unarchive` sem checar o estado atual podem receber um erro
 * nesse caso específico.
 */
async function setChatArchived(
  http: HttpClient,
  session: string,
  chatId: string,
  value: boolean,
): Promise<void> {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/archive-chat'),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, value },
  });
}

/**
 * `POST /send-mute`, body `{phone, isGroup, time, type}` (`DeviceController.sendMute`, confiança
 * Alta — controller + duas camadas da lib, incluindo o script injetado `send-mute.js`). `time`+
 * `type` são OBRIGATÓRIOS JUNTOS para de fato silenciar: só 3 valores de `type` acionam o mute
 * (`'hours'`/`'minutes'`/`'year'` — este ÚLTIMO soma DIAS, não anos, bug de nomenclatura confirmado
 * na própria linha do script injetado). Qualquer outro valor — incluindo OMITIR os dois campos —
 * cai no branch de REMOÇÃO do mute (restaura a partir da expiração já registrada no chat, não zera
 * incondicionalmente).
 *
 * `ChatsApi.mute`/`ChatsApi.unmute` do contrato canônico não recebem duração (ver ADR-0012 —
 * nenhum formato de duração converge entre os providers pesquisados, decisão deliberada de manter
 * o campo fora do contrato). A duração abaixo é uma DECISÃO DESTE ADAPTER, não um default do
 * provider: como não existe um `type` de fato permanente, `mute(chatId)` usa
 * `type: 'hours', time: 87600` (10 anos em horas) para aproximar "silenciar indefinidamente" — não
 * usa o `type: 'year'` confirmado-bugado (que somaria só 87600 DIAS, um valor absurdo) nem um
 * número pequeno de `'year'` (que somaria só alguns DIAS, muito curto). `unmute(chatId)` OMITE
 * `time`/`type` de propósito, para cair no branch de remoção confirmado no dossiê. Consumidores que
 * precisem de uma duração específica só têm essa granularidade via `raw`/chamada direta ao
 * provider, fora do contrato canônico.
 */
const MUTE_DURATION = { time: 24 * 365 * 10, type: 'hours' } as const;

async function setChatMuted(
  http: HttpClient,
  session: string,
  chatId: string,
  muted: boolean,
): Promise<void> {
  const recipient = toWppconnectRecipient(chatId);
  const body: Record<string, unknown> = { phone: recipient.phone, isGroup: recipient.isGroup };
  if (muted) {
    // Ver docstring acima da constante MUTE_DURATION para a justificativa da duração escolhida.
    body.time = MUTE_DURATION.time;
    body.type = MUTE_DURATION.type;
  }
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/send-mute'),
    body,
  });
}

/**
 * `POST /pin-chat`, body `{phone, isGroup, state}` (`DeviceController.pinChat`, confiança Alta — o
 * achado mais acionável da pesquisa desta rodada). Schema Swagger declara `state:
 * {type:"boolean"}`, mas o controller real faz `state === 'true'` — comparação com a STRING
 * `'true'`, não o booleano. Enviar `state: true` (booleano JSON, como o próprio schema pede)
 * resultaria SEMPRE em desafixar, independente da intenção. Este adapter contorna o bug enviando
 * `state` sempre como a STRING literal `"true"`/`"false"` (nunca o booleano). Resposta é mensagem
 * FIXA (`{message: 'Chat fixed'}`, usada tanto para pin quanto unpin) — ignorada, contrato retorna
 * `Promise<void>`. Mesmo padrão "lança se já no estado pedido" de `archive` (confirmado em
 * `wa-js@a4c57173`, confiança média-alta).
 */
async function setChatPinned(
  http: HttpClient,
  session: string,
  chatId: string,
  pinned: boolean,
): Promise<void> {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/pin-chat'),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      state: pinned ? 'true' : 'false',
    },
  });
}

/**
 * `POST /mark-unseen` (`DeviceController.markUnseenMessage`, confiança Alta). Body
 * `{phone, isGroup}` — sem toggle booleano, só liga o estado "não lida" (nunca desliga; o par
 * simétrico é `markChatRead`, endpoint TOTALMENTE diferente, não o mesmo com um parâmetro
 * invertido). Resposta: envelope PADRÃO (`status: 'success'` minúsculo), mensagem fixa
 * (`{message: 'unseen checked'}`) — ignorada, contrato retorna `Promise<void>`.
 */
async function markChatUnread(http: HttpClient, session: string, chatId: string): Promise<void> {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/mark-unseen'),
    body: { phone: recipient.phone, isGroup: recipient.isGroup },
  });
}

/**
 * `POST /send-seen` (`DeviceController.sendSeen`, confiança Alta). Body `{phone, isGroup}` — outro
 * endpoint, não o mesmo de `markChatUnread` com um parâmetro invertido.
 *
 * **Terceira exceção de envelope confirmada no dossiê, isolada deste endpoint (e de
 * `delete-chat`/`clear-chat`, não usados por este adapter)**: usa um `returnSucess` LOCAL diferente
 * do padrão do resto do arquivo — `status` vem com "S" MAIÚSCULO (`'Success'`, não `'success'`) e o
 * payload real fica DOIS níveis abaixo (`response.data`), não em `response` diretamente. Não afeta
 * este adapter: a resposta inteira é ignorada (contrato retorna `Promise<void>`) — citado aqui só
 * para não ser redescoberto por engano como um bug de parsing numa manutenção futura.
 */
async function markChatRead(http: HttpClient, session: string, chatId: string): Promise<void> {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/send-seen'),
    body: { phone: recipient.phone, isGroup: recipient.isGroup },
  });
}

// ---------------------------------------------------------------------------
// presence.*
// ---------------------------------------------------------------------------

/**
 * `presence.setTyping` (ADR-0015) — WPPConnect divide o indicador em DOIS endpoints separados por
 * `MediaKind` implícito, diferente de todos os demais adapters desta ADR (que usam um único
 * endpoint com um enum de estado): `POST /typing` (`DeviceController.setTyping`, body `{phone,
 * isGroup, value}`) para "digitando…", e `POST /recording` (`DeviceController.setRecording`, body
 * `{phone, isGroup, duration?, value}`) para "gravando áudio…". `value: true` inicia o indicador
 * (`startTyping`/`startRecording` da lib), `value: false` encerra (`stopTyping`/`stopRecording`).
 * Mapeamento: `composing` → `POST /typing {value: true}`; `recording` → `POST /recording {value:
 * true}` (sem `duration`, não exposto por `SetTypingInput`); **`paused`** (decisão própria deste
 * adapter, não há um terceiro endpoint "parar qualquer indicador"): roteado para `POST /typing
 * {value: false}` — `stopTyping` é o par semântico mais direto de "parar de mostrar o indicador"
 * (mesmo padrão de "encerrar manualmente" que `pause` tem nos demais providers).
 */
async function setTyping(http: HttpClient, session: string, input: SetTypingInput): Promise<void> {
  const recipient = toWppconnectRecipient(input.to);
  const path = input.state === 'recording' ? '/recording' : '/typing';
  const value = input.state !== 'paused';
  await http.request({
    method: 'POST',
    path: sessionPath(session, path),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, value },
  });
}

/**
 * `presence.set` (ADR-0015) — `POST /set-online-presence` (`SessionController.setOnlinePresence`,
 * confirmado em código). Body: `{isOnline: boolean}` — `PresenceState` mapeia direto (`online` →
 * `true`, `offline` → `false`). Presença GLOBAL da conta, distinta do indicador por-chat acima.
 */
async function setOnlinePresence(
  http: HttpClient,
  session: string,
  state: PresenceState,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/set-online-presence'),
    body: { isOnline: state === 'online' },
  });
}

/**
 * `presence.subscribe` (ADR-0015) — `POST /subscribe-presence`
 * (`SessionController.subscribePresence`, confirmado em código). Body: `{phone, isGroup, all}` —
 * este adapter sempre envia `all: false` (inscrição num contato específico; `all: true` inscreveria
 * em todos os contatos/grupos, fora do escopo de `chatId` único do contrato canônico).
 */
async function subscribePresence(http: HttpClient, session: string, chatId: string): Promise<void> {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/subscribe-presence'),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, all: false },
  });
}

// ---------------------------------------------------------------------------
// labels.* (ver ADR-0016)
// ---------------------------------------------------------------------------

/**
 * `GET /api/{session}/get-all-labels` (`LabelsController.getAllLabels`, confiança Alta — rota e
 * controller confirmados ao vivo via `gh api`). Resposta `{status, response: Label[]}` — `Label
 * {id, name, color, count, hexColor}` (interface da lib `@wppconnect/wa-js`, reaproveitada pelo
 * server). `LabelInfo.color` mapeia do campo numérico `color` (convertido para string) —
 * `hexColor` (cor computada) não é usado, mesmo critério de "repassar o valor nativo, sem campo
 * derivado" já aplicado a outros adapters desta ADR.
 */
async function listLabels(http: HttpClient, session: string): Promise<LabelInfo[]> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: sessionPath(session, '/get-all-labels'),
  });
  const record = asRecord(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapWppconnectLabel(item));
}

/**
 * `POST /api/{session}/add-new-label` (confiança Alta) — body `{name, options?: {labelColor}}`.
 * **A resposta não devolve o label criado com confiabilidade**: o wrapper do server
 * (`client.addNewLabel`, `labels.layer.ts` da lib `@wppconnect/wa-js`) chama
 * `WPP.labels.addNewLabel(name, options)` dentro de uma função avaliada no browser SEM `return`
 * (confirmado ao vivo via `gh api`) — o campo `response` da resposta HTTP fica `undefined`. Este
 * adapter, como a uazapi (ADR-0016), descobre o `id` atribuído por DIFF: lista os labels antes e
 * depois da criação, e usa o `id` presente só na segunda lista — 3 chamadas HTTP no total (list,
 * create, list), necessárias porque não há outra forma confiável de saber qual id foi atribuído.
 * Lança `PROVIDER_ERROR` se nenhum id novo aparecer (ex.: condição de corrida com outra criação
 * concorrente no mesmo instante).
 */
async function createLabel(
  http: HttpClient,
  session: string,
  input: CreateLabelInput,
): Promise<LabelInfo> {
  const before = new Set((await listLabels(http, session)).map((label) => label.id));
  const body: Record<string, unknown> = { name: input.name };
  if (input.color !== undefined) {
    body.options = { labelColor: input.color };
  }
  await http.request({ method: 'POST', path: sessionPath(session, '/add-new-label'), body });
  const after = await listLabels(http, session);
  const created = after.find((label) => !before.has(label.id));
  if (!created) {
    throw new WaConnectorError(
      'PROVIDER_ERROR',
      'WPPConnect: não foi possível determinar o id do label criado por /add-new-label — ' +
        'GET /get-all-labels não trouxe nenhum id novo em relação à listagem anterior.',
      { provider: PROVIDER },
    );
  }
  return created;
}

/**
 * `labels.delete`: `PUT /api/{session}/delete-label/{id}` — **método PUT, não DELETE** (confirmado
 * na rota registrada em `routes.ts`, quirk do próprio provider). Sem body.
 */
async function deleteLabel(http: HttpClient, session: string, labelId: string): Promise<void> {
  await http.request({
    method: 'PUT',
    path: sessionPath(session, `/delete-label/${encodeURIComponent(labelId)}`),
  });
}

/**
 * `labels.addToChat`/`removeFromChat`: `POST /api/{session}/add-or-remove-label` — endpoint BULK
 * (`chatIds: string[]`, `options: [{labelId, type: 'add'|'remove'}]`, exemplo literal do dossiê),
 * usado aqui com arrays de 1 elemento — mesma chamada única, sem round-trip, só varia o tamanho do
 * array. `chatIds` exige JID completo (`"[number]@c.us"`) — reaproveita `toWppconnectMentionJid`
 * (mesma conversão já usada para `mentions` de `messages.sendText`).
 */
async function setChatLabel(
  http: HttpClient,
  session: string,
  input: LabelChatInput,
  type: 'add' | 'remove',
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/add-or-remove-label'),
    body: {
      chatIds: [toWppconnectMentionJid(input.chatId)],
      options: [{ labelId: input.labelId, type }],
    },
  });
}

function mapWppconnectLabel(body: unknown): LabelInfo {
  const record = asRecord(body);
  const color = record ? asNumber(record.color) : undefined;
  return {
    id: (record ? asString(record.id) : undefined) ?? '',
    name: (record ? asString(record.name) : undefined) ?? '',
    color: color === undefined ? undefined : String(color),
    raw: body,
  };
}

// ---------------------------------------------------------------------------
// channels.* (ver ADR-0017)
// ---------------------------------------------------------------------------

/**
 * `POST /api/{session}/newsletter` (confiança Alta) — body `{name, options?: {description?,
 * picture?}}`; `options.picture` não exposto pelo contrato canônico (ver ADR-0017). Diferente do
 * bug confirmado em `client.addNewLabel` (ADR-0016, sem `return` na função avaliada no browser),
 * `client.createNewsletter` do wa-js FAZ `return` corretamente (`(name, options) =>
 * WPP.newsletter.create(name, options)`, confirmado ao vivo via `gh api` contra
 * `wppconnect-team/wa-js`) — a resposta é confiável, shape `ResultCreateNewsletter {idJid,
 * inviteCode, inviteLink, name, state, subscribersCount, description, timestamp}`.
 */
async function createChannel(
  http: HttpClient,
  session: string,
  input: CreateChannelInput,
): Promise<ChannelInfo> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: sessionPath(session, '/newsletter'),
    body: { name: input.name, options: { description: input.description } },
  });
  return mapWppconnectChannel(body, input);
}

/**
 * `DELETE /api/{session}/newsletter/{id}` (confiança Alta) — sem body. **Sem `channels.list`/
 * `getInfo`/`follow`/`unfollow`**: `routes.ts` só registra 4 rotas de newsletter no total
 * (`create`/`edit`/`destroy`/`mute-newsletter`); mesmo a lib `@wppconnect/wa-js` subjacente tendo
 * `follow`/`unfollow`/`getSubscribers` internamente, o `wppconnect-server` não expõe rota HTTP
 * para eles (achado confirmado ao vivo contra o código-fonte de ambos os repositórios).
 */
async function deleteChannel(http: HttpClient, session: string, channelId: string): Promise<void> {
  await http.request({
    method: 'DELETE',
    path: sessionPath(session, `/newsletter/${encodeURIComponent(channelId)}`),
  });
}

/**
 * Mapeia um `ResultCreateNewsletter` (wa-js) para `ChannelInfo`. `idJid` (não `id`) é o campo do
 * identificador — confirmado ao vivo em `wa-js/src/newsletter/functions/create.ts`.
 */
function mapWppconnectChannel(
  body: unknown,
  fallback: { name?: string; description?: string } = {},
): ChannelInfo {
  const record = asRecord(body);
  return {
    id: (record ? asString(record.idJid) : undefined) ?? '',
    name: (record ? asString(record.name) : undefined) ?? fallback.name ?? '',
    description: (record ? asString(record.description) : undefined) ?? fallback.description,
    subscribersCount: record ? asNumber(record.subscribersCount) : undefined,
    raw: body,
  };
}

// ---------------------------------------------------------------------------
// business.* (ver ADR-0018)
// ---------------------------------------------------------------------------

/**
 * `POST /api/{session}/edit-business-profile` (confiança Alta para o endpoint, achado ao vivo em
 * `routes.ts`). Body `{adress?, email?, categories?, websites?}` — **`adress` é a grafia
 * INCORRETA real do provider** (confirmado no exemplo `#swagger.parameters` de
 * `SessionController.editBusinessProfile`), não um erro deste adapter. **Sem campo
 * `description`**: o endpoint não aceita esse campo — `UpdateBusinessProfileInput.description` é
 * silenciosamente ignorado quando fornecido (caveat documentado, ver ADR-0018). Resposta é o
 * resultado bruto de `client.editBusinessProfile`, shape não confirmado com confiança —
 * ignorada (contrato exige `Promise<void>`).
 */
async function updateBusinessProfile(
  http: HttpClient,
  session: string,
  input: UpdateBusinessProfileInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/edit-business-profile'),
    body: { adress: input.address, email: input.email },
  });
}

// ---------------------------------------------------------------------------
// calls.* (ver ADR-0019)
// ---------------------------------------------------------------------------

/**
 * `POST /api/{session}/reject-call` (achado ao vivo em `routes.ts`,
 * `DeviceController.rejectCall`). Body `{callId}` — **ÚNICO campo exigido**
 * (`req.client.rejectCall(callId)`, sem `callerId`), diferente de WAHA/Whapi/Wuzapi/Evolution GO.
 * `callId` só disponível inspecionando o payload bruto do webhook de chamada recebida (este
 * pacote não faz parsing desse evento ainda) — lança `INVALID_INPUT` se faltar. Resposta é o
 * resultado bruto de `client.rejectCall`, shape não confirmado com confiança — ignorada.
 */
async function rejectCall(
  http: HttpClient,
  session: string,
  input: RejectCallInput,
): Promise<void> {
  if (!input.callId) {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'calls.reject no WPPConnect exige "callId" (body {callId}).',
      { provider: PROVIDER },
    );
  }
  await http.request({
    method: 'POST',
    path: sessionPath(session, '/reject-call'),
    body: { callId: input.callId },
  });
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook WPPConnect para eventos canônicos. Nunca lança: qualquer formato inesperado
 * (incluindo exceções internas) vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook WPPConnect: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

/**
 * Envelope confirmado no dossiê (`callWebHook`, `src/util/functions.ts`): `data = Object.assign(
 * {event, session}, data)` — todo payload é um objeto PLANO, sem chave aninhada tipo `data`/
 * `event`-objeto: `event` (string, nome do evento) e `session` (nome da sessão, popula
 * `instanceId`) ficam no MESMO nível que todos os campos do evento original. Diferente de Wuzapi
 * (`{type, event: {...}}` aninhado) e Whapi (`{event:{type,event}, messages:[...]}`).
 */
function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, 'Corpo do webhook WPPConnect não é um objeto JSON.')];
  }

  const instanceId = asString(record.session);
  const event = asString(record.event);
  if (!event) {
    return [unknownEvent(body, 'Payload de webhook WPPConnect sem campo "event".', instanceId)];
  }

  switch (event) {
    case 'onmessage':
    case 'unreadmessages':
    case 'onselfmessage':
      return [mapMessageEvent(record, instanceId, body)];
    case 'onack':
      return [mapAckEvent(record, instanceId, body)];
    case 'status-find':
      return [mapStatusFindEvent(record, instanceId, body)];
    case 'qrcode':
      // qrcode aqui é base64 SEM o prefixo "data:image/png;base64," (removido explicitamente pelo
      // servidor antes de disparar o webhook, `exportQR`) — repassado verbatim, sem adicionar
      // prefixo (mesma convenção dos demais adapters deste pacote: nunca reformatar o QR).
      return [connectionEvent(instanceId, 'qr', asString(record.qrcode), body)];
    case 'phoneCode':
      // Sem equivalente de "pairing code" em ConnectionUpdateEvent (só tem "qr") — mapeado como
      // 'qr' (mesmo "aguardando ação externa do usuário"), decisão de implementação documentada em
      // docs/providers/wppconnect.md. Nunca disparado por sessões criadas por ESTE adapter (que
      // nunca envia "phone" em start-session), mas pode chegar se a sessão foi criada por outro
      // meio com o mesmo webhook configurado.
      return [connectionEvent(instanceId, 'qr', undefined, body)];
    case 'onparticipantschanged':
      return [mapParticipantsChangedEvent(record, instanceId, body)];
    case 'onpresencechanged':
    case 'location':
    case 'incomingcall':
      return [
        unknownEvent(
          body,
          `Evento WPPConnect "${event}" reconhecido, mas sem equivalente canônico nesta fase ` +
            '(core não modela presença/localização ao vivo/chamada recebida).',
          instanceId,
        ),
      ];
    case 'onreactionmessage':
    case 'onrevokedmessage':
    case 'onpollresponse':
    case 'onupdatelabel':
      return [
        unknownEvent(
          body,
          `Evento WPPConnect "${event}" reconhecido, mas sem shape de payload confirmado nesta ` +
            'fase (a lib subjacente tipa esses callbacks como "any") — ver docs/providers/wppconnect.md.',
          instanceId,
        ),
      ];
    default:
      return [unknownEvent(body, `Evento WPPConnect não reconhecido: "${event}".`, instanceId)];
  }
}

/**
 * `Message` (interface confirmada da lib, `src/api/model/message.ts`) — mensagem recebida
 * (`onmessage`/`unreadmessages`) ou ecoada (`onselfmessage`, `fromMe` sempre `true` quando o
 * servidor dispara este evento). `type` é o enum `MessageType` (`chat`/`image`/`video`/`audio`/
 * `ptt`/`sticker`/`document`/`location`/`vcard`/`gp2`/...) — mapeado para `MessageKind` via
 * `MESSAGE_KIND_BY_TYPE`; valores fora da tabela caem em `'unknown'`, nunca lançam.
 */
const MESSAGE_KIND_BY_TYPE: Partial<Record<string, MessageKind>> = {
  chat: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  ptt: 'audio',
  document: 'document',
  sticker: 'sticker',
  location: 'location',
  vcard: 'contact',
};

const MEDIA_MESSAGE_KINDS = new Set<MessageKind>([
  'image',
  'video',
  'audio',
  'document',
  'sticker',
]);

function mapMessageEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const id = asString(record.id) ?? `wppconnect-unknown-${Date.now()}`;
  const chatId = extractChatId(record.chatId) ?? '';
  const fromMe = asBoolean(record.fromMe) ?? false;
  const from = asString(record.author) ?? asString(record.from);
  const timestamp = secondsToEpochMs(record.timestamp ?? record.t) ?? Date.now();
  const typeValue = asString(record.type);
  const kind: MessageKind = (typeValue && MESSAGE_KIND_BY_TYPE[typeValue]) || 'unknown';
  const text = kind === 'text' ? asString(record.body) : asString(record.caption);
  const media = MEDIA_MESSAGE_KINDS.has(kind)
    ? buildMediaRef(kind as MediaKind, record)
    : undefined;

  const message: WaMessage = {
    id,
    chatId,
    from,
    fromMe,
    timestamp,
    kind,
    text,
    media,
    raw: rawBody,
  };

  return {
    type: fromMe ? 'message.sent' : 'message.received',
    provider: PROVIDER,
    instanceId,
    message,
    raw: rawBody,
  };
}

/**
 * A interface `Message` confirmada na pesquisa NÃO expõe um campo de URL de mídia (`mediaKey` é a
 * chave de criptografia do WhatsApp, não uma URL de download) — `media.url`/`media.base64` ficam
 * `undefined` deliberadamente; só `mimeType` é populado quando presente. Ver
 * docs/providers/wppconnect.md.
 */
function buildMediaRef(kind: MediaKind, record: Record<string, unknown>): MediaRef {
  return { kind, mimeType: asString(record.mimetype) };
}

/**
 * `Ack` (interface confirmada, `src/api/model/ack.ts`). `id` é um OBJETO (`Id`), não uma string —
 * diferente de `Message.id`. `Ack` não tem campo `chatId`; `to` é usado como melhor aproximação
 * (confiança média, ver docs/providers/wppconnect.md). `ack` (enum `AckType`, numérico) sem
 * equivalente reconhecido (`PEER=5` ou qualquer valor fora da tabela) vira `unknown` — nunca
 * inventa um `MessageAck`.
 */
function mapAckEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const idRecord = asRecord(record.id);
  const messageId = idRecord
    ? (asString(idRecord._serialized) ?? asString(idRecord.id))
    : undefined;
  if (!messageId) {
    return unknownEvent(
      rawBody,
      'Evento "onack" do WPPConnect sem "id._serialized"/"id.id" reconhecível.',
      instanceId,
    );
  }
  const ack = mapAckType(record.ack);
  if (!ack) {
    return unknownEvent(
      rawBody,
      `Evento "onack" com valor de "ack" não mapeável para MessageAck: ${String(record.ack)}.`,
      instanceId,
    );
  }
  const event: MessageAckEvent = {
    type: 'message.ack',
    provider: PROVIDER,
    instanceId,
    messageId,
    chatId: asString(record.to),
    ack,
    raw: rawBody,
  };
  return event;
}

/**
 * `AckType` (enum confirmado, `src/api/model/enum/ack-type.ts`): `CLOCK=0`, `SENT=1`,
 * `RECEIVED=2`, `READ=3`, `PLAYED=4`, `PEER=5`, e vários negativos de falha
 * (`FAILED=-1`/`EXPIRED=-2`/`CONTENT_GONE=-3`/`CONTENT_TOO_BIG=-4`/`CONTENT_UNUPLOADABLE=-5`/
 * `INACTIVE=-6`/`MD_DOWNGRADE=-7`). Qualquer negativo mapeia para `'error'`; `PEER` (sincronização
 * entre dispositivos próprios, não um estado de entrega) e valores fora da enumeração ficam sem
 * equivalente — retornam `undefined` (o chamador emite `unknown`, nunca inventa).
 */
function mapAckType(value: unknown): MessageAck | undefined {
  const code = asNumber(value);
  if (code === undefined) return undefined;
  if (code < 0) return 'error';
  switch (code) {
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
      return undefined;
  }
}

/**
 * `status-find` — enum `StatusFind` (confirmado, `src/api/model/enum/status-find.ts`). Mapeamento
 * proposto pela pesquisa (interpretação do autor, não fato documentado pelo provider):
 * `inChat`/`isLogged` -> `connected`; `notLogged` -> `qr`; `qrReadSuccess` -> `connecting`;
 * `autocloseCalled`/`browserClose`/`disconnectedMobile`/`phoneNotConnected`/`serverClose` ->
 * `disconnected`; `qrReadError`/`qrReadFail` -> `unknown`.
 */
const STATUS_FIND_STATE: Partial<Record<string, InstanceState>> = {
  inChat: 'connected',
  isLogged: 'connected',
  notLogged: 'qr',
  qrReadSuccess: 'connecting',
  autocloseCalled: 'disconnected',
  browserClose: 'disconnected',
  disconnectedMobile: 'disconnected',
  phoneNotConnected: 'disconnected',
  serverClose: 'disconnected',
  qrReadError: 'unknown',
  qrReadFail: 'unknown',
};

function mapStatusFindEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const status = asString(record.status);
  const state = (status && STATUS_FIND_STATE[status]) || 'unknown';
  return connectionEvent(instanceId, state, undefined, rawBody);
}

/**
 * `ParticipantEvent` (interface confirmada, `src/api/model/participant-event.ts`):
 * `{by?, byPushName?, groupId, action, operation, who: string[]}`. `operation` é o campo mais
 * limpo para determinar a mudança (só 4 valores: `add`/`remove`/`demote`/`promote` — diferente de
 * `action`, que tem 6 valores com sinônimos `join`≈`add`/`leaver`≈`remove`).
 */
const PARTICIPANT_OPERATION_ACTION: Partial<Record<string, string>> = {
  add: 'participants.add',
  remove: 'participants.remove',
  promote: 'participants.promote',
  demote: 'participants.demote',
};

function mapParticipantsChangedEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const groupId = asString(record.groupId);
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "onparticipantschanged" sem "groupId".', instanceId);
  }
  const operation = asString(record.operation);
  const action = operation ? PARTICIPANT_OPERATION_ACTION[operation] : undefined;
  const participants = asStringArray(record.who);

  const event: GroupUpdateEvent = {
    type: 'group.update',
    provider: PROVIDER,
    instanceId,
    groupId,
    action,
    participants: participants.length > 0 ? participants : undefined,
    raw: rawBody,
  };
  return event;
}

function connectionEvent(
  instanceId: string | undefined,
  state: InstanceState,
  qr: string | undefined,
  rawBody: unknown,
): ConnectionUpdateEvent {
  return { type: 'connection.update', provider: PROVIDER, instanceId, state, qr, raw: rawBody };
}

function unknownEvent(raw: unknown, reason: string, instanceId?: string): UnknownEvent {
  return { type: 'unknown', provider: PROVIDER, instanceId, raw, reason };
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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Timestamps de `Message`/`Ack` (`t`/`timestamp`) são assumidos em SEGUNDOS, por analogia com o
 * comentário explícito `"Epoch timestamp (seconds)"` em `IncomingCall.offerTime` (mesmo arquivo de
 * tipos da lib) — não confirmado literalmente para estes dois campos específicos. Ver
 * docs/providers/wppconnect.md.
 */
function secondsToEpochMs(value: unknown): number | undefined {
  const seconds = asNumber(value);
  return seconds === undefined ? undefined : seconds * 1000;
}
