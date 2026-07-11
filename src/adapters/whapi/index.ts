import type {
  ContactsApi,
  GroupsApi,
  InstanceApi,
  MessagesApi,
  WaAdapter,
  WebhookInput,
} from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { WaConnectorError } from '../../core/errors';
import type { CanonicalEvent, UnknownEvent } from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ConnectResult,
  InstanceState,
  InstanceStatus,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  SendMediaInput,
  SendTextInput,
  SentMessage,
  WaMessage,
} from '../../core/types';

/**
 * Opções do adapter Whapi.Cloud (SaaS, host único `https://gate.whapi.cloud` para todos os
 * clientes — sem opção self-hosted documentada).
 *
 * @see docs/providers/whapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
export interface WhapiOptions {
  /**
   * URL base da API Whapi.Cloud. Padrão: `https://gate.whapi.cloud`. Existe mesmo assim (em vez de
   * uma constante interna) para permitir apontar para um proxy/gateway de teste sem rede real.
   */
  baseUrl?: string;
  /**
   * Bearer token do CANAL ("channel"), exibido no dashboard do canal. Diferente da Z-API
   * (`instanceId` + `token` separados no path), o Whapi usa um único token por canal, enviado como
   * `Authorization: Bearer <token>` — não há um segundo identificador de instância. Um token por
   * conta (a "Partner API", `manager.whapi.cloud`, usada para criar/listar canais) existe mas é uma
   * API totalmente separada, fora do escopo deste adapter — ver docs/providers/whapi.md#autenticação.
   */
  token: string;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'whapi';
const DEFAULT_BASE_URL = 'https://gate.whapi.cloud';

/**
 * Só as capabilities núcleo desta fase (ver CONTEXT.md#metodologia-por-adapter). `groups.*`/
 * `contacts.*`/`messages.sendReaction` NÃO são declaradas aqui mesmo quando a pesquisa confirma
 * suporte no provider (reação: `PUT/DELETE /messages/{MessageID}/reaction`, confirmado) — ficam
 * para um incremento futuro, ver docs/providers/whapi.md#capabilities-confirmadas-mas-não-implementadas-nesta-fase.
 * `instance.pairingCode` também não é declarada: `InstanceApi.connect()` não recebe telefone como
 * parâmetro, e o pairing code do Whapi (`GET /users/login/{PhoneNumber}`) exige o telefone no path
 * — mesmo obstáculo estrutural já documentado nos adapters Z-API/uazapi/Wuzapi.
 */
const WHAPI_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'webhooks.parse',
];

/** Fábrica do adapter Whapi.Cloud. */
export function whapi(options: WhapiOptions): WaAdapter {
  const http = new HttpClient({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    headers: { Authorization: `Bearer ${options.token}` },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.token],
    provider: PROVIDER,
    fetch: options.fetch,
  });

  const instance: InstanceApi = {
    connect: () => connectInstance(http),
    status: () => statusInstance(http),
    logout: () => logoutInstance(http),
  };

  const messages: MessagesApi = {
    sendText: (input) => sendText(http, input),
    sendMedia: (input) => sendMedia(http, input),
  };

  // Núcleo desta fase: nenhum método de groups.*/contacts.* implementado (ver WHAPI_CAPABILITIES).
  const groups: GroupsApi = {};
  const contacts: ContactsApi = {};

  return {
    provider: PROVIDER,
    capabilities: WHAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// map-out: canônico -> Whapi
// ---------------------------------------------------------------------------

/**
 * O chatId canônico do waconector (dígitos crus OU JID explícito — ver `normalizeChatId`) já bate
 * 1:1 com o campo `to` do Whapi: o schema `Sender.to` aceita
 * `^[\d-]{9,31}(@[\w\.]{1,})?$` — dígitos puros OU JID completo, ambos sem transformação
 * (confirmado no dossiê com exemplos literais usando telefone cru em `to`). Função identidade
 * mantida como ponto único de mudança, mesmo padrão do `toWuzapiPhone` do adapter Wuzapi.
 */
function toWhapiChatId(chatId: string): string {
  return chatId;
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

async function connectInstance(http: HttpClient): Promise<ConnectResult> {
  // `wakeup: true` (default do provider, explicitado aqui por clareza): connect() precisa
  // efetivamente lançar o canal para produzir um QR — diferente de status(), que usa `wakeup:false`
  // (ver statusInstance) para não ter esse efeito colateral numa chamada que deveria ser só leitura.
  const body = await http.request<unknown>({
    method: 'GET',
    path: '/users/login',
    query: { wakeup: true },
  });
  return { qr: extractQr(body), raw: body };
}

/**
 * `body.base64` é o campo confirmado no schema `QR` do OpenAPI oficial para o QR pronto para uso.
 * **Não confirmado literalmente** se o valor já inclui o prefixo de data URI completo
 * (`data:image/png;base64,...`) ou é só o base64 cru — a doc renderizada descreve o campo como
 * "imagem do QR em base64 pronta para `<img src="data:image/png;base64,...">`", frase compatível
 * com as duas leituras. Este adapter repassa o valor verbatim, sem adicionar/remover prefixo.
 * **Assunção a validar contra uma instância real** — ver docs/providers/whapi.md.
 */
function extractQr(body: unknown): string | undefined {
  const record = asRecord(body);
  return record ? asString(record.base64) : undefined;
}

async function statusInstance(http: HttpClient): Promise<InstanceStatus> {
  // `wakeup: false`: leitura pura. O default do provider (`wakeup: true`) também relança o canal
  // se estiver parado ("allows you to track... but also to start it autonomously") — efeito
  // colateral indesejado numa chamada que só quer consultar o estado atual.
  const body = await http.request<unknown>({
    method: 'GET',
    path: '/health',
    query: { wakeup: false },
  });
  return { state: mapInstanceState(body), raw: body };
}

/**
 * Mapeia `Health.status.text` (mesmo schema usado por `GET /health` e pelo campo `health` do
 * webhook `channel` — ver `mapChannelState`, reaproveitada por ambos os caminhos). Tabela
 * confirmada no dossiê (enum `ChannelStatus` do OpenAPI + Help Desk oficial):
 * `NOT_INIT`/`INIT`/`LAUNCH`/`QR`/`AUTH`/`ERROR`/`SYNC_ERROR`. `ERROR`/`SYNC_ERROR` mapeiam para
 * `'unknown'` (não há um estado canônico de "erro" dedicado) — decisão de implementação, não fato
 * documentado. Qualquer valor não reconhecido também vira `'unknown'`, nunca lança.
 */
function mapInstanceState(body: unknown): InstanceState {
  const record = asRecord(body);
  const status = record ? asRecord(record.status) : undefined;
  const text = status ? asString(status.text) : undefined;
  return mapChannelState(text);
}

function mapChannelState(text: string | undefined): InstanceState {
  switch (text) {
    case 'NOT_INIT':
      return 'disconnected';
    case 'INIT':
    case 'LAUNCH':
      return 'connecting';
    case 'QR':
      return 'qr';
    case 'AUTH':
      return 'connected';
    case 'ERROR':
    case 'SYNC_ERROR':
      return 'unknown';
    default:
      return 'unknown';
  }
}

async function logoutInstance(http: HttpClient): Promise<void> {
  // Sem corpo, confirmado no dossiê. 409 ("Channel already logged out") não é tratado como caso
  // especial — vira PROVIDER_ERROR como qualquer outro erro HTTP, mesmo padrão dos demais adapters
  // deste pacote (nenhum trata "já desconectado" como sucesso silencioso).
  await http.request({ method: 'POST', path: '/users/logout' });
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

async function sendText(http: HttpClient, input: SendTextInput): Promise<SentMessage> {
  const to = toWhapiChatId(input.to);
  const body: Record<string, unknown> = { to, body: input.text };
  if (input.quotedId) {
    body.quoted = input.quotedId;
  }
  if (input.mentions && input.mentions.length > 0) {
    body.mentions = input.mentions;
  }
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/messages/text',
    body,
  });
  return mapSentMessage(response, to);
}

interface MediaEndpoint {
  path: string;
  /** áudio/voice e sticker não suportam legenda no WhatsApp — confirmado no dossiê para áudio. */
  supportsCaption: boolean;
}

/**
 * Um endpoint por `MediaKind`, confirmado no dossiê (`POST /messages/{tipo}`). O Whapi distingue
 * `audio` (arquivo de áudio) de `voice` (nota de voz) em endpoints separados
 * (`/messages/audio` vs `/messages/voice`) — `MediaKind` do waconector não tem essa distinção, então
 * este adapter sempre usa `/messages/audio` para `kind: 'audio'` (arquivo de áudio "normal", não
 * nota de voz gravada no app).
 */
function resolveMediaEndpoint(kind: MediaKind): MediaEndpoint {
  switch (kind) {
    case 'image':
      return { path: '/messages/image', supportsCaption: true };
    case 'video':
      return { path: '/messages/video', supportsCaption: true };
    case 'audio':
      return { path: '/messages/audio', supportsCaption: false };
    case 'document':
      return { path: '/messages/document', supportsCaption: true };
    case 'sticker':
      return { path: '/messages/sticker', supportsCaption: false };
  }
}

/** Mimetype-padrão usado só para montar a data URI quando `media.mimeType` não é informado. */
const DEFAULT_MIME_BY_KIND: Partial<Record<MediaKind, string>> = {
  image: 'image/png',
  video: 'video/mp4',
  // WhatsApp/Whapi exigem OGG+opus para áudio (confirmado no Help Desk) — usado só como fallback
  // quando nem media.mimeType nem media.base64 (já em data URI) esclarecem o formato real.
  audio: 'audio/ogg; codecs=opus',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

/**
 * O campo `media` do Whapi aceita URL, base64 (o Help Desk recomenda como data URI completa; o
 * schema OpenAPI só diz "base64 encoded file", sem exigir o prefixo — confidence média) ou um
 * media ID pré-upload (`POST /media`, não usado por este adapter). Mesmo padrão defensivo já usado
 * pelos adapters Z-API/Wuzapi: se `media.base64` não vier como data URI, o adapter monta uma.
 */
function resolveMediaValue(media: MediaRef): string {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith('data:')) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND[media.kind] ?? 'application/octet-stream';
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    'INVALID_INPUT',
    'Whapi: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER },
  );
}

async function sendMedia(http: HttpClient, input: SendMediaInput): Promise<SentMessage> {
  const to = toWhapiChatId(input.to);
  const endpoint = resolveMediaEndpoint(input.media.kind);
  const value = resolveMediaValue(input.media);

  const body: Record<string, unknown> = { to, media: value };
  if (endpoint.supportsCaption && input.caption) {
    body.caption = input.caption;
  }
  if (input.media.kind === 'document' && input.media.filename) {
    body.filename = input.media.filename;
  }
  if (input.quotedId) {
    body.quoted = input.quotedId;
  }

  const response = await http.request<unknown>({
    method: 'POST',
    path: endpoint.path,
    body,
  });
  return mapSentMessage(response, to);
}

/**
 * Resposta confirmada por schema (`SentMessage`/`Message` do OpenAPI, sem payload de resposta
 * literal capturado): `{ sent: boolean, message: { id, chat_id, timestamp, ... } }`. `timestamp` é
 * assumido em segundos (mesma unidade confirmada por payload literal nos webhooks de `messages`) —
 * convertido para ms via `toEpochMs`. Fallback em `requestedTo`/id sintético quando o campo
 * aninhado `message` não vem (nunca lança).
 */
function mapSentMessage(body: unknown, requestedTo: string): SentMessage {
  const record = asRecord(body);
  const message = record ? asRecord(record.message) : undefined;
  const id = (message ? asString(message.id) : undefined) ?? `whapi-${Date.now()}`;
  const chatId = (message ? asString(message.chat_id) : undefined) ?? requestedTo;
  const timestamp = message ? toEpochMs(message.timestamp) : undefined;
  return { id, chatId, timestamp, raw: body };
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook Whapi para eventos canônicos. Nunca lança: qualquer formato inesperado
 * (incluindo exceções internas) vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Whapi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

/**
 * Envelope confirmado no dossiê: `{ <categoria>: [...], event: { type, event }, channel_id }` (modo
 * de entrega `body`, o padrão — os modos `path`/`method` mudam a FORMA do request HTTP, não o
 * conteúdo, e não são tratados de forma diferente aqui já que `WebhookInput.body` já chega
 * parseado independente do modo). `event.type` é o discriminador principal
 * (`messages`/`statuses`/`channel`/`users`); nomes legados (`message`/`ack`/`chat`/`status`,
 * deprecated segundo o dossiê) NÃO são reconhecidos nesta fase — caem em `unknown`.
 */
function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, 'Corpo do webhook Whapi não é um objeto JSON.')];
  }

  const instanceId = asString(record.channel_id);
  const eventMeta = asRecord(record.event);
  const eventType = eventMeta ? asString(eventMeta.type) : undefined;
  const eventVerb = eventMeta ? asString(eventMeta.event) : undefined;

  switch (eventType) {
    case 'messages':
      return mapMessagesEvent(record, instanceId, body);
    case 'statuses':
      return mapStatusesEvent(record, instanceId, body);
    case 'channel':
      return [mapChannelEvent(record, instanceId, body)];
    case 'users':
      return [mapUsersEvent(eventVerb, instanceId, body)];
    default:
      // Fallback defensivo por presença de campo (caso `event.type` esteja ausente por alguma
      // variação de configuração não coberta pela pesquisa) — nunca lança, só amplia o
      // reconhecimento antes de desistir para `unknown`.
      if (Array.isArray(record.messages)) return mapMessagesEvent(record, instanceId, body);
      if (Array.isArray(record.statuses)) return mapStatusesEvent(record, instanceId, body);
      if (record.health !== undefined) return [mapChannelEvent(record, instanceId, body)];
      return [
        unknownEvent(
          body,
          `Payload de webhook Whapi não reconhecido nesta fase (event.type="${eventType ?? 'ausente'}").`,
          instanceId,
        ),
      ];
  }
}

function mapMessagesEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent[] {
  const items = asRecordArray(record.messages);
  if (items.length === 0) {
    return [unknownEvent(rawBody, 'Evento "messages" do Whapi sem itens no array.', instanceId)];
  }
  return items.map((item) => mapMessageItem(item, instanceId, rawBody));
}

function mapMessageItem(
  item: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const fromMe = asBoolean(item.from_me) ?? false;
  const content = mapMessageContent(item);
  const context = asRecord(item.context);

  const message: WaMessage = {
    id: asString(item.id) ?? `whapi-unknown-${Date.now()}`,
    chatId: asString(item.chat_id) ?? 'unknown',
    from: asString(item.from),
    fromMe,
    // Confirmado no dossiê: `timestamp` de `messages` é epoch em SEGUNDOS (diferente de
    // `WaMessage.timestamp`, que é ms) — convertido via `toEpochMs`.
    timestamp: toEpochMs(item.timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
    quotedId: context ? asString(context.quoted_id) : undefined,
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

interface MessageContent {
  kind: MessageKind;
  text?: string;
  media?: MediaRef;
}

/**
 * `record.type` discrimina o conteúdo, com um sub-objeto de mesmo nome (ou `voice` para nota de
 * voz — ver `resolveMediaEndpoint`). Confiança por tipo (ver docs/providers/whapi.md#webhooks):
 * - `text`: **alta** (payload literal confirmado, `text.body`).
 * - `document`: **alta** (payload literal confirmado, incluindo `document.caption`,
 *   `document.link` e `document.filename` — extraídos para `text`/`media`).
 * - `image`/`video`: **média** (campos comuns confirmados por analogia com `document`; a doc não
 *   traz um exemplo literal dedicado de imagem/vídeo, mas `sendMedia` confirma `caption` como
 *   campo simétrico de envio para estes tipos — por isso `image.caption`/`video.caption` também
 *   são extraídos para `text`, mesmo sem exemplo literal de recebimento).
 * - `sticker`/`audio` (`voice`): **baixa** (sem exemplo literal capturado; shape assumido por
 *   analogia com `document`, mesmo padrão de risco já documentado nos adapters Z-API/Wuzapi para
 *   casos equivalentes). Sem `caption` — WhatsApp não permite legenda em áudio/sticker (mesma
 *   restrição documentada em `messages.sendMedia`, ver dossiê).
 * - `location`/`contact`/`poll`: reconhecidos só pelo `kind` (sem `MediaRef` — `MediaKind` não
 *   cobre estes três), mesmo padrão dos demais adapters deste pacote.
 * - `action` (reação/voto): **deliberadamente NÃO implementado nesta fase** — mesma decisão de
 *   escopo de `messages.sendReaction` (ver dossiê); cai em `kind: 'unknown'`.
 */
function mapMessageContent(record: Record<string, unknown>): MessageContent {
  const type = asString(record.type);
  switch (type) {
    case 'text': {
      const text = asRecord(record.text);
      return { kind: 'text', text: text ? asString(text.body) : undefined };
    }
    case 'image': {
      const image = asRecord(record.image);
      return {
        kind: 'image',
        text: image ? asString(image.caption) : undefined,
        media: image ? buildMediaRef('image', image) : undefined,
      };
    }
    case 'video': {
      const video = asRecord(record.video);
      return {
        kind: 'video',
        text: video ? asString(video.caption) : undefined,
        media: video ? buildMediaRef('video', video) : undefined,
      };
    }
    case 'audio':
    case 'voice': {
      const audio = asRecord(record.audio) ?? asRecord(record.voice);
      return { kind: 'audio', media: audio ? buildMediaRef('audio', audio) : undefined };
    }
    case 'document': {
      const document = asRecord(record.document);
      return {
        kind: 'document',
        text: document ? asString(document.caption) : undefined,
        media: document ? buildMediaRef('document', document) : undefined,
      };
    }
    case 'sticker': {
      const sticker = asRecord(record.sticker);
      return { kind: 'sticker', media: sticker ? buildMediaRef('sticker', sticker) : undefined };
    }
    case 'location':
      return { kind: 'location' };
    case 'contact':
      return { kind: 'contact' };
    case 'poll':
      return { kind: 'poll' };
    default:
      return { kind: 'unknown' };
  }
}

/**
 * `link` é o campo confirmado com exemplo literal para `image` e `document` — "quando
 * auto-download habilitado". Para os tipos sem exemplo literal dedicado (`video`/`audio`/
 * `sticker`) o mesmo nome de campo é assumido por analogia (ver confiança por tipo em
 * `mapMessageContent`); quando ausente, `media` fica `undefined` (kind ainda é reportado
 * corretamente) em vez de inventar uma URL.
 */
function buildMediaRef(kind: MediaKind, record: Record<string, unknown>): MediaRef | undefined {
  const url = asString(record.link);
  if (!url) return undefined;
  return {
    kind,
    url,
    mimeType: asString(record.mime_type),
    filename: asString(record.file_name),
  };
}

function mapStatusesEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent[] {
  const items = asRecordArray(record.statuses);
  if (items.length === 0) {
    return [unknownEvent(rawBody, 'Evento "statuses" do Whapi sem itens no array.', instanceId)];
  }
  return items.map((item) => mapStatusItem(item, instanceId, rawBody));
}

function mapStatusItem(
  item: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const messageId = asString(item.id);
  if (!messageId) {
    return unknownEvent(rawBody, 'Item de "statuses" do Whapi sem "id".', instanceId);
  }
  const statusText = asString(item.status);
  const ack = mapWhapiAckStatus(statusText);
  if (!ack) {
    return unknownEvent(
      rawBody,
      `Status Whapi não mapeável para MessageAck: "${statusText ?? 'ausente'}".`,
      instanceId,
    );
  }
  return {
    type: 'message.ack',
    provider: PROVIDER,
    instanceId,
    messageId,
    chatId: asString(item.recipient_id),
    ack,
    raw: rawBody,
  };
}

/**
 * Valores confirmados no dossiê (Help Desk, dois artigos independentes): `pending`, `sent`,
 * `delivered` (único com `code` numérico confirmado, `3`), `read`, `played`, `failed`, `deleted`.
 * `failed` → `'error'`. `deleted` (mensagem apagada pelo usuário) **não tem equivalente** em
 * `MESSAGE_ACKS` — retorna `undefined` (o chamador emite `unknown` em vez de inventar um ack),
 * mesma postura para qualquer valor não reconhecido. Mapeamento feito pela STRING `status`, nunca
 * pelo `code` numérico (só `delivered=3` está confirmado; os demais códigos são reconstrução de
 * terceiros, não citação direta da doc).
 */
function mapWhapiAckStatus(status: string | undefined): MessageAck | undefined {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'played':
      return 'played';
    case 'failed':
      return 'error';
    default:
      return undefined;
  }
}

/**
 * Payload confirmado no dossiê: `{ health: { status: { code, text }, ... }, event: {type:
 * "channel"}, channel_id }`, com o mesmo schema `Health` de `GET /health` (reaproveita
 * `mapChannelState`). O envelope também pode carregar um `qr` opcional (schema `QR`) quando o tipo
 * de evento "channel" está habilitado — **não confirmado nos exemplos literais capturados** (a
 * pesquisa não viu um payload real com QR embutido no webhook), extraído defensivamente do campo
 * `qr.base64` quando presente (mesmo campo de `extractQr`).
 */
function mapChannelEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const health = asRecord(record.health);
  const status = health ? asRecord(health.status) : undefined;
  const state = mapChannelState(status ? asString(status.text) : undefined);
  const qr = asRecord(record.qr);
  return {
    type: 'connection.update',
    provider: PROVIDER,
    instanceId,
    state,
    qr: qr ? asString(qr.base64) : undefined,
    raw: rawBody,
  };
}

/**
 * Evento `users` (`users.post`/`users.delete`, payload confirmado no dossiê): sinaliza a conta
 * WhatsApp sendo vinculada/desvinculada do canal — distinto do status de saúde do canal em si
 * (`channel`), mas igualmente dentro do escopo de `connection.update`. `post` → `'connected'`,
 * `delete` → `'disconnected'`. Qualquer outro verbo (`put`/`patch`, sem exemplo confirmado para
 * este tipo) vira `unknown`.
 */
function mapUsersEvent(
  eventVerb: string | undefined,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  if (eventVerb === 'post') {
    return {
      type: 'connection.update',
      provider: PROVIDER,
      instanceId,
      state: 'connected',
      raw: rawBody,
    };
  }
  if (eventVerb === 'delete') {
    return {
      type: 'connection.update',
      provider: PROVIDER,
      instanceId,
      state: 'disconnected',
      raw: rawBody,
    };
  }
  return unknownEvent(
    rawBody,
    `Evento "users" com verbo desconhecido: "${eventVerb}".`,
    instanceId,
  );
}

function unknownEvent(raw: unknown, reason: string, instanceId?: string): UnknownEvent {
  return { type: 'unknown', provider: PROVIDER, instanceId, raw, reason };
}

/** Converte epoch em SEGUNDOS (número ou string numérica, ver `statuses[].timestamp`) para ms. */
function toEpochMs(value: unknown): number | undefined {
  const seconds = asNumber(value);
  if (seconds === undefined || Number.isNaN(seconds)) return undefined;
  return seconds * 1000;
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
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : [];
}
