import type { InstanceApi, MessagesApi, WaAdapter, WebhookInput } from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { WaConnectorError } from '../../core/errors';
import type {
  CanonicalEvent,
  ConnectionUpdateEvent,
  MessageAckEvent,
  UnknownEvent,
} from '../../core/events';
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
 * Opções do adapter Wuzapi (self-hosted, construído sobre `tulir/whatsmeow`).
 *
 * @see docs/providers/wuzapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
export interface WuzapiOptions {
  /** URL base do servidor Wuzapi self-hosted (ex.: `https://wuzapi.exemplo.com`). */
  baseUrl: string;
  /**
   * Token de usuário, enviado cru (sem prefixo `Bearer`) no header `token`. Escopo: todas as
   * capabilities implementadas por este adapter (`/session/*`, `/chat/send/*`). Definido pelo
   * admin ao criar o usuário via `POST /admin/users` — não é autogerado pelo servidor.
   */
  token: string;
  /**
   * Token administrativo, enviado no header `Authorization` (comparação em tempo constante no
   * servidor). Escopo real: rotas `/admin/**` (ex. `POST /admin/users`) — **nenhuma implementada
   * nesta fase**. Opcional aqui apenas para permitir guardar os dois segredos num único lugar (e
   * redigi-los em erros); reservado para uma fase futura que exponha provisionamento de usuário.
   * Mesmo padrão de `UazapiOptions.adminToken`. Ver docs/providers/wuzapi.md#autenticação.
   */
  adminToken?: string;
  /**
   * Nome/identificador da sessão, apenas para referência do chamador. Não é enviado em nenhuma
   * requisição — as rotas operacionais resolvem o usuário a partir do header `token`.
   */
  instance?: string;
  /** Categorias de evento enviadas em `Subscribe` no `POST /session/connect` (ex.: `["Message", "ReadReceipt"]`, ou `["All"]`). */
  subscribe?: string[];
  /**
   * Valor de `Immediate` em `POST /session/connect`. Quando `false`, a chamada bloqueia por até
   * 10s no servidor para validar o login antes de responder. Padrão: `true` (não bloqueia).
   */
  immediate?: boolean;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'wuzapi';

const WUZAPI_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'webhooks.parse',
];

/** Fábrica do adapter Wuzapi. */
export function wuzapi(options: WuzapiOptions): WaAdapter {
  const secrets = [options.token, ...(options.adminToken ? [options.adminToken] : [])];
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { token: options.token },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets,
    provider: PROVIDER,
    fetch: options.fetch,
  });

  const instance: InstanceApi = {
    connect: () => connectInstance(http, options),
    status: () => statusInstance(http),
    logout: () => logoutInstance(http),
  };

  const messages: MessagesApi = {
    sendText: (input) => sendText(http, input),
    sendMedia: (input) => sendMedia(http, input),
  };

  return {
    provider: PROVIDER,
    capabilities: WUZAPI_CAPABILITIES,
    instance,
    messages,
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// map-out: canônico -> Wuzapi
// ---------------------------------------------------------------------------

/**
 * Converte o chatId canônico do waconector (dígitos crus OU JID explícito — ver `normalizeChatId`)
 * para o campo `Phone` do Wuzapi.
 *
 * `wmiau.go` (func `parseJID`) aceita exatamente os dois mesmos formatos: se a string não contém
 * `@`, vira `user@s.whatsapp.net` no servidor; se contém `@`, é parseada como JID literal
 * (incluindo grupos `@g.us`). O chatId canônico já chega pronto — repassado sem transformação.
 * Função existe como ponto único de mudança, mesmo padrão dos demais adapters deste pacote.
 */
function toWuzapiPhone(chatId: string): string {
  return chatId;
}

interface MediaEndpoint {
  path: string;
  field: string;
}

/** Um endpoint por `MediaKind`, mesma forma de corpo, trocando o nome do campo de mídia. */
const MEDIA_ENDPOINTS: Record<MediaKind, MediaEndpoint> = {
  image: { path: '/chat/send/image', field: 'Image' },
  video: { path: '/chat/send/video', field: 'Video' },
  audio: { path: '/chat/send/audio', field: 'Audio' },
  document: { path: '/chat/send/document', field: 'Document' },
  sticker: { path: '/chat/send/sticker', field: 'Sticker' },
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
 * O Wuzapi só aceita, no campo de mídia (`Image`/`Audio`/`Video`/`Document`/`Sticker`), uma data
 * URI (`data:image/png;base64,...`) OU uma URL `http(s)` — base64 cru sem o prefixo `data:` é
 * REJEITADO pelo servidor com erro explícito. Se `media.base64` já vier como data URI, repassa
 * intacto; se vier "cru", monta a data URI usando `media.mimeType` (ou um mimetype-padrão por
 * `MediaKind`, best-effort). `media.url`, quando presente, é preferido e repassado como está.
 * Mesmo padrão do adapter Z-API (`resolveMediaValue`), mas aqui é uma exigência confirmada do
 * servidor, não apenas uma conveniência.
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
    'Wuzapi: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER },
  );
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

/** Envelope padrão de toda resposta HTTP do Wuzapi (`handlers.go`, func `Respond`). */
interface WuzapiEnvelope {
  code?: number;
  success?: boolean;
  data?: unknown;
  error?: string;
}

async function connectInstance(http: HttpClient, options: WuzapiOptions): Promise<ConnectResult> {
  const body: Record<string, unknown> = { Immediate: options.immediate ?? true };
  if (options.subscribe && options.subscribe.length > 0) {
    body.Subscribe = options.subscribe;
  }

  const connectResponse = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/session/connect',
    body,
  });

  // GET /session/qr é best-effort: só retorna sucesso se a sessão estiver "connected" e ainda não
  // "loggedIn" — em qualquer outro caso (ainda conectando, ou já logada) responde com erro. Uma
  // falha aqui não deve impedir connect() de retornar (ver docs/providers/wuzapi.md).
  let qrResponse: WuzapiEnvelope | undefined;
  try {
    qrResponse = await http.request<WuzapiEnvelope>({ method: 'GET', path: '/session/qr' });
  } catch {
    qrResponse = undefined;
  }

  const qrData = asRecord(qrResponse?.data);
  const qr = asString(qrData?.QRCode) ?? asString(qrData?.qrcode);

  return {
    qr,
    raw: { connect: connectResponse, qr: qrResponse },
  };
}

async function statusInstance(http: HttpClient): Promise<InstanceStatus> {
  const response = await http.request<WuzapiEnvelope>({ method: 'GET', path: '/session/status' });
  const data = asRecord(response.data);
  return { state: mapInstanceState(data), raw: response };
}

async function logoutInstance(http: HttpClient): Promise<void> {
  // Hard logout: invalida a sessão no WhatsApp, exige novo QR/pairing na próxima conexão. Distinto
  // de POST /session/disconnect (soft, preserva credenciais) — ver docs/providers/wuzapi.md.
  await http.request({ method: 'POST', path: '/session/logout' });
}

/**
 * As chaves reais no wire são `connected`/`loggedIn` minúsculas (confirmado no código-fonte); o
 * exemplo minimalista do próprio API.md usa `Connected`/`LoggedIn` capitalizados — aceitos aqui só
 * como fallback defensivo. Ver docs/providers/wuzapi.md (divergência confirmada).
 */
function mapInstanceState(data: Record<string, unknown> | undefined): InstanceState {
  if (!data) return 'unknown';
  const connected = asBoolean(data.connected) ?? asBoolean(data.Connected);
  const loggedIn = asBoolean(data.loggedIn) ?? asBoolean(data.LoggedIn);
  if (connected === undefined || loggedIn === undefined) return 'unknown';
  if (!connected && !loggedIn) return 'disconnected';
  if (connected && !loggedIn) return 'qr';
  if (connected && loggedIn) return 'connected';
  // connected === false && loggedIn === true: credenciais existem, socket caiu temporariamente
  // (suposição — ver docs/providers/wuzapi.md, mesmo raciocínio do adapter Evolution GO).
  return 'connecting';
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

async function sendText(http: HttpClient, input: SendTextInput): Promise<SentMessage> {
  const phone = toWuzapiPhone(input.to);
  const body: Record<string, unknown> = { Phone: phone, Body: input.text };
  if (input.quotedId) {
    // ContextInfo exige StanzaID e Participant juntos; SendTextInput não carrega o remetente da
    // mensagem citada — suposição documentada em docs/providers/wuzapi.md (Participant = Phone).
    body.ContextInfo = { StanzaID: input.quotedId, Participant: phone };
  }
  // SendTextInput.mentions não tem campo confirmado em /chat/send/text nesta pesquisa — ignorado
  // silenciosamente (mesmo padrão do adapter Z-API). Ver docs/providers/wuzapi.md.

  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/chat/send/text',
    body,
  });
  return mapSentMessage(response, phone);
}

async function sendMedia(http: HttpClient, input: SendMediaInput): Promise<SentMessage> {
  const phone = toWuzapiPhone(input.to);
  const endpoint = MEDIA_ENDPOINTS[input.media.kind];
  const value = resolveMediaValue(input.media);

  const body: Record<string, unknown> = { Phone: phone, [endpoint.field]: value };
  if (input.caption) body.Caption = input.caption;
  if (input.media.mimeType) body.MimeType = input.media.mimeType;
  if (input.media.kind === 'document') {
    if (!input.media.filename) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'Wuzapi: sendMedia para "document" exige "media.filename" (campo "FileName" obrigatório).',
        { provider: PROVIDER },
      );
    }
    body.FileName = input.media.filename;
  }
  if (input.quotedId) {
    body.ContextInfo = { StanzaID: input.quotedId, Participant: phone };
  }

  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: endpoint.path,
    body,
  });
  return mapSentMessage(response, phone);
}

/**
 * Confirmado no dossiê para `POST /chat/send/text`: `data` = `{"Details":"Sent","Timestamp":<unix
 * seconds>,"Id":"<msgid>"}`. `Timestamp` vem em SEGUNDOS (não ms, diferente da maioria dos outros
 * exemplos deste pacote) — convertido explicitamente. O mesmo shape é assumido, por analogia, para
 * `POST /chat/send/*` de mídia (não confirmado individualmente por tipo). Ver
 * docs/providers/wuzapi.md.
 */
function mapSentMessage(response: WuzapiEnvelope, requestedPhone: string): SentMessage {
  const data = asRecord(response.data);
  const id = asString(data?.Id) ?? `wuzapi-${Date.now()}`;
  const timestamp = secondsToEpochMs(data?.Timestamp);
  return { id, chatId: requestedPhone, timestamp, raw: response };
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook Wuzapi para eventos canônicos. Nunca lança: qualquer formato inesperado
 * (incluindo exceções internas) vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Wuzapi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, 'Corpo do webhook Wuzapi não é um objeto JSON.')];
  }

  // WEBHOOK_FORMAT (env var global do servidor, não por usuário): modo "form" (default) entrega
  // {jsonData, userID, instanceName} onde `jsonData` é uma STRING com o JSON do evento real; modo
  // "json" entrega o objeto do evento com userID/instanceName mesclados no topo. O adapter aceita
  // ambos defensivamente — ver docs/providers/wuzapi.md#webhooks.
  let eventRecord = record;
  const jsonData = asString(record.jsonData);
  if (jsonData !== undefined) {
    const parsedRecord = asRecord(safeJsonParse(jsonData));
    if (!parsedRecord) {
      return [
        unknownEvent(
          body,
          'Webhook Wuzapi em modo "form": campo "jsonData" não contém um objeto JSON válido.',
        ),
      ];
    }
    eventRecord = parsedRecord;
  }

  const instanceId = asString(record.instanceName) ?? asString(eventRecord.instanceName);

  const type = asString(eventRecord.type);
  if (!type) {
    return [unknownEvent(body, 'Payload de webhook Wuzapi sem campo "type".', instanceId)];
  }

  const data = asRecord(eventRecord.event);

  switch (type) {
    case 'Message':
      return [mapMessageEvent(instanceId, data, eventRecord, body)];
    case 'ReadReceipt':
      return mapReceiptEvent(instanceId, asString(eventRecord.state), data, body);
    case 'Connected':
      return [connectionEvent(instanceId, 'connected', undefined, body)];
    case 'PairSuccess':
      return [connectionEvent(instanceId, 'connected', undefined, body)];
    case 'Disconnected':
    case 'LoggedOut':
    case 'ConnectFailure':
      return [connectionEvent(instanceId, 'disconnected', undefined, body)];
    case 'QR':
      // Diferente de "Message"/"ReadReceipt", aqui `event` é a STRING literal "code" (nome do
      // evento interno do whatsmeow), não um objeto — `qrCodeBase64` é entregue como campo IRMÃO
      // de "type"/"event", no NÍVEL RAIZ do payload (confirmado em `wmiau.go`, func `startClient`,
      // loop `for evt := range qrChan`: `postmap["qrCodeBase64"]` é escrito no mesmo mapa que
      // `postmap["type"]`/`postmap["event"]`, sem aninhamento — mesmo padrão de `attachRootMedia`
      // para mídia recebida). Ver docs/providers/wuzapi.md.
      return [connectionEvent(instanceId, 'qr', asString(eventRecord.qrCodeBase64), body)];
    case 'QRTimeout':
      // Suposição: o código confirma que o valor existe, mas não detalha a semântica exata —
      // tratado como "parou de esperar o scan" (ver docs/providers/wuzapi.md).
      return [connectionEvent(instanceId, 'disconnected', undefined, body)];
    default:
      return [unknownEvent(body, `Evento Wuzapi não reconhecido: "${type}".`, instanceId)];
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `event.Info`/`event.Message` são RECONSTRUÍDOS a partir da serialização de
 * `whatsmeow/types/events.Message`, por analogia direta com o adapter Evolution GO (mesma lib
 * subjacente) — não confirmados campo-a-campo para o Wuzapi. Ver docs/providers/wuzapi.md.
 */
function mapMessageEvent(
  instanceId: string | undefined,
  data: Record<string, unknown> | undefined,
  eventRecord: Record<string, unknown>,
  rawBody: unknown,
): CanonicalEvent {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "Message" sem campo "event".', instanceId);
  }
  const info = asRecord(data.Info);
  if (!info) {
    return unknownEvent(rawBody, 'Evento "Message" sem "event.Info".', instanceId);
  }

  const fromMe = asBoolean(info.IsFromMe) ?? false;
  const content = mapMessageContent(asRecord(data.Message));

  // Quando media_delivery inclui base64 (default do usuário), o Wuzapi anexa mimeType/base64/
  // fileName no NÍVEL RAIZ do evento entregue (fora de "event") — não dentro de event.Message.
  // Usado para completar WaMessage.media quando o tipo detectado não é texto.
  const media = attachRootMedia(content, eventRecord);

  const message: WaMessage = {
    id: asString(info.ID) ?? '',
    chatId: asString(info.Chat) ?? '',
    from: asString(info.Sender),
    fromMe,
    timestamp: toEpochMs(info.Timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
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

interface MessageContent {
  kind: MessageKind;
  text?: string;
  media?: MediaRef;
}

/**
 * Deriva `kind`/`text`/`media` a partir do objeto `Message` (encoding protobuf→JSON do whatsmeow).
 * Mesma lógica do adapter Evolution GO (`mapMessageContent`) — por analogia, dado que ambos
 * envolvem eventos da mesma lib `whatsmeow`. Não enumerado de forma independente para o Wuzapi na
 * pesquisa original. Ver docs/providers/wuzapi.md.
 */
function mapMessageContent(message: Record<string, unknown> | undefined): MessageContent {
  if (!message) return { kind: 'unknown' };

  if (typeof message.conversation === 'string') {
    return { kind: 'text', text: message.conversation };
  }
  const extendedText = asRecord(message.extendedTextMessage);
  if (extendedText) {
    return { kind: 'text', text: asString(extendedText.text) };
  }
  const image = asRecord(message.imageMessage);
  if (image) {
    return { kind: 'image', text: asString(image.caption), media: buildMediaRef('image', image) };
  }
  const video = asRecord(message.videoMessage);
  if (video) {
    return { kind: 'video', text: asString(video.caption), media: buildMediaRef('video', video) };
  }
  const audio = asRecord(message.audioMessage);
  if (audio) {
    return { kind: 'audio', media: buildMediaRef('audio', audio) };
  }
  const document = asRecord(message.documentMessage);
  if (document) {
    return {
      kind: 'document',
      text: asString(document.caption),
      media: buildMediaRef('document', document),
    };
  }
  const sticker = asRecord(message.stickerMessage);
  if (sticker) {
    return { kind: 'sticker', media: buildMediaRef('sticker', sticker) };
  }
  if (message.locationMessage) return { kind: 'location' };
  if (message.contactMessage) return { kind: 'contact' };
  if (message.reactionMessage) return { kind: 'reaction' };
  if (message.pollCreationMessage || message.pollUpdateMessage) return { kind: 'poll' };

  return { kind: 'unknown' };
}

function buildMediaRef(
  kind: MediaRef['kind'],
  record: Record<string, unknown>,
): MediaRef | undefined {
  // Mesmo cuidado de casing do adapter Evolution GO: os structs gerados do whatsmeow tagueiam este
  // campo como `URL` maiúsculo — aceito aqui por analogia (não confirmado especificamente para o
  // Wuzapi), com fallback defensivo para `url` minúsculo.
  const url = asString(record.URL) ?? asString(record.url);
  if (!url) return undefined;
  return {
    kind,
    url,
    mimeType: asString(record.mimetype),
    filename: asString(record.fileName),
  };
}

/**
 * Completa `content.media` com os campos `mimeType`/`base64`/`fileName` do NÍVEL RAIZ do evento
 * (fora de `event`), presentes quando o usuário tem `media_delivery` configurado para incluir
 * base64 (default). Só se aplica a tipos de mídia (não `text`/`unknown`).
 */
function attachRootMedia(
  content: MessageContent,
  eventRecord: Record<string, unknown>,
): MediaRef | undefined {
  if (content.kind === 'text' || content.kind === 'unknown') return content.media;
  const rootBase64 = asString(eventRecord.base64);
  if (!rootBase64) return content.media;
  const kind = content.kind as MediaKind;
  return {
    kind,
    url: content.media?.url,
    base64: rootBase64,
    mimeType: content.media?.mimeType ?? asString(eventRecord.mimeType),
    filename: content.media?.filename ?? asString(eventRecord.fileName),
  };
}

function mapReceiptEvent(
  instanceId: string | undefined,
  state: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent[] {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "ReadReceipt" sem campo "event".', instanceId)];
  }
  const messageIds = asStringArray(data.MessageIDs);
  if (messageIds.length === 0) {
    return [unknownEvent(rawBody, 'Evento "ReadReceipt" sem "event.MessageIDs".', instanceId)];
  }
  const chatId = asString(data.Chat);
  const ack = mapAckState(state);

  return messageIds.map((messageId): MessageAckEvent => {
    return {
      type: 'message.ack',
      provider: PROVIDER,
      instanceId,
      messageId,
      chatId,
      ack,
      raw: rawBody,
    };
  });
}

/** `state` desconhecido cai em `'sent'` (nunca lança) — o evento "ReadReceipt" em si já implica que a mensagem saiu. */
function mapAckState(state: string | undefined): MessageAck {
  if (state === 'Delivered') return 'delivered';
  if (state === 'Read' || state === 'ReadSelf') return 'read';
  return 'sent';
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** `data.Timestamp` de `POST /chat/send/*` é confirmado em SEGUNDOS (unix), não ms. */
function secondsToEpochMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value * 1000;
}

/** Timestamps do whatsmeow chegam ora como string ISO/RFC3339, ora (heuristicamente) como epoch. */
function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
