import type {
  ContactsApi,
  GroupsApi,
  InstanceApi,
  MessagesApi,
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
  CheckExistsResult,
  ConnectResult,
  CreateGroupInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipant,
  GroupParticipantsInput,
  InstanceState,
  InstanceStatus,
  JoinGroupInviteInput,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  SendMediaInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
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
 * Só as capabilities com endpoint E shape de resposta confirmados pela pesquisa
 * (docs/providers/wppconnect.md). Deliberadamente de fora, com justificativa registrada no
 * dossiê:
 * - `instance.pairingCode`: mesmo obstáculo estrutural de todo adapter deste pacote —
 *   `InstanceApi.connect()` não recebe telefone como parâmetro, e o WPPConnect só produz pairing
 *   code quando `phone` é enviado no body de `start-session` (momento de criação da sessão).
 * - `groups.list`: o único endpoint de listagem (`GET /all-groups`) está marcado como
 *   `#swagger.deprecated` pelo próprio provider ("Deprecated in favor of 'list-chats'") e a
 *   pesquisa não confirma o shape de resposta — implementar exigiria adivinhar.
 * - `contacts.list`/`contacts.get`/`contacts.getProfilePicture`/`contacts.getAbout`: os endpoints
 *   existem (`/all-contacts`, `/contact/:phone`, `/profile-pic/:phone`, `/profile-status/:phone`),
 *   mas a pesquisa não trouxe o shape de resposta de nenhum dos quatro (só a transformação do lado
 *   do request). `contacts.checkExists`/`block`/`unblock`/`listBlocked` SÃO implementadas porque a
 *   pesquisa confirma o shape de resposta dos quatro (a primeira via reuso do middleware
 *   `statusConnection`, que consome `checkNumberStatus` internamente).
 */
const WPPCONNECT_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'messages.sendReaction',
  'groups.create',
  'groups.getInfo',
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
  'contacts.checkExists',
  'contacts.block',
  'contacts.unblock',
  'contacts.listBlocked',
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
  };

  const groups: GroupsApi = {
    create: (input) => createGroup(http, session, input),
    getInfo: (groupId) => getGroupInfo(http, session, groupId),
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
    checkExists: (phone) => checkContactExists(http, session, phone),
    block: (chatId) => blockContact(http, session, chatId),
    unblock: (chatId) => unblockContact(http, session, chatId),
    listBlocked: () => listBlockedContacts(http, session),
  };

  return {
    provider: PROVIDER,
    capabilities: WPPCONNECT_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
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

// ---------------------------------------------------------------------------
// contacts.*
// ---------------------------------------------------------------------------

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
