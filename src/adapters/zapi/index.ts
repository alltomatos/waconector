import type { InstanceApi, MessagesApi, WaAdapter, WebhookInput } from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { digitsOnly, isJid } from '../../core/chat-id';
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
 * Opções do adapter Z-API (SaaS, `https://api.z-api.io`, hospedagem própria da Z-API — sem opção
 * self-hosted documentada).
 *
 * @see docs/providers/zapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
export interface ZapiOptions {
  /**
   * URL base da API Z-API. Padrão: `https://api.z-api.io` — diferente de WAHA/Evolution GO/uazapi
   * (self-hosted ou multi-tenant por subdomínio), a Z-API é um único host fixo para todos os
   * clientes, então este campo raramente precisa ser sobrescrito. Existe mesmo assim (em vez de
   * uma constante interna) para permitir apontar para um proxy/gateway de teste sem rede real.
   */
  baseUrl?: string;
  /**
   * ID da instância, exibido no painel Z-API. **Não é enviado em header** — vai embutido como
   * segmento da URL de toda chamada (`/instances/{instanceId}/token/{token}/...`), conforme o
   * mecanismo de autenticação documentado (não há `Authorization: Bearer`).
   */
  instanceId: string;
  /**
   * Token da instância, exibido no painel Z-API. Mesma observação de `instanceId`: vai embutido
   * como segmento da URL, não em header.
   */
  token: string;
  /**
   * "Token de Segurança da Conta" opcional (painel > Segurança), desabilitado por padrão. Quando
   * uma conta o ativa, TODAS as instâncias da conta passam a exigir o header `Client-Token` em
   * toda requisição — sem ele a Z-API responde 200 com `{"error":"null not allowed"}`. Deixe
   * indefinido se o recurso não estiver ativado na conta.
   */
  clientToken?: string;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'zapi';
const DEFAULT_BASE_URL = 'https://api.z-api.io';

const ZAPI_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'webhooks.parse',
];

/** Fábrica do adapter Z-API. */
export function zapi(options: ZapiOptions): WaAdapter {
  const secrets = [
    options.instanceId,
    options.token,
    ...(options.clientToken ? [options.clientToken] : []),
  ];
  const http = new HttpClient({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    headers: options.clientToken ? { 'Client-Token': options.clientToken } : {},
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets,
    provider: PROVIDER,
    fetch: options.fetch,
  });

  // Prefixo de path repetido em toda chamada. Deliberadamente NÃO usamos `encodeURIComponent` aqui:
  // o texto passado em `HttpRequestOptions.path` é o mesmo texto usado literalmente nas mensagens
  // de erro do HttpClient (`HTTP ${status} em ${method} ${options.path}`), então manter o token cru
  // no path garante que `redactSecrets` (que faz replace de string exata) sempre encontre e redija
  // o valor — uma versão URL-encoded do token não bateria com a entrada de `secrets`.
  const prefix = `/instances/${options.instanceId}/token/${options.token}`;

  const instance: InstanceApi = {
    connect: () => connectInstance(http, prefix),
    status: () => statusInstance(http, prefix),
    logout: () => logoutInstance(http, prefix),
  };

  const messages: MessagesApi = {
    sendText: (input) => sendText(http, prefix, input),
    sendMedia: (input) => sendMedia(http, prefix, input),
  };

  return {
    provider: PROVIDER,
    capabilities: ZAPI_CAPABILITIES,
    instance,
    messages,
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// map-out: canônico -> Z-API
// ---------------------------------------------------------------------------

/**
 * Converte o chatId canônico do waconector (dígitos crus OU JID explícito — ver `normalizeChatId`)
 * para o campo `phone` da Z-API.
 *
 * O dossiê confirma que `phone` aceita dígitos DDI+DDD+número para chats 1:1 ("SOMENTE DÍGITOS,
 * sem +, espaços ou máscara") e que, para grupos, "o mesmo campo 'phone' recebe o ID do grupo" —
 * sem especificar se esse ID de grupo inclui o sufixo `@g.us`. Decisão do adapter: JIDs explícitos
 * (grupos `@g.us`, `@s.whatsapp.net`, `@lid`, etc.) passam intactos; qualquer outra entrada é
 * filtrada para dígitos puros como camada defensiva (o conector já normaliza isso antes de chamar
 * o adapter, mas o adapter pode ser instanciado sem `createConnector`).
 */
function toZapiPhone(chatId: string): string {
  if (isJid(chatId)) return chatId;
  return digitsOnly(chatId);
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

async function connectInstance(http: HttpClient, prefix: string): Promise<ConnectResult> {
  // `/qr-code` devolve os bytes crus do QR (não serve para `ConnectResult.qr: string`);
  // `/qr-code/image` devolve uma imagem pronta para uso — usado aqui. `InstanceApi.connect()` não
  // recebe telefone como parâmetro, então o fluxo de pairing code (`/phone-code/{phone}`) não é
  // exposto nesta fase (`instance.pairingCode` não é uma capability declarada).
  const body = await http.request<unknown>({ method: 'GET', path: `${prefix}/qr-code/image` });
  return { qr: extractQr(body), raw: body };
}

/**
 * O dossiê não traz um exemplo JSON literal do corpo de `/qr-code/image` — só confirma que "retorna
 * imagem base64 pronta para `<img>`". O nome de campo `value` é uma suposição por analogia com o
 * endpoint irmão `/phone-code/{phone}`, cujo shape de resposta É confirmado (`{"value":"A1B2C3D4E5"}`).
 * Como fallback defensivo, também aceitamos `qrcode`/`base64`, e se a resposta não vier como objeto
 * JSON (texto puro), tratamos o corpo inteiro como o próprio valor do QR. **Assunção a validar
 * contra uma instância real** — ver docs/providers/zapi.md.
 */
function extractQr(body: unknown): string | undefined {
  const record = asRecord(body);
  if (record) {
    return asString(record.value) ?? asString(record.qrcode) ?? asString(record.base64);
  }
  return asString(body);
}

async function statusInstance(http: HttpClient, prefix: string): Promise<InstanceStatus> {
  const body = await http.request<unknown>({ method: 'GET', path: `${prefix}/status` });
  return { state: mapInstanceState(body), raw: body };
}

/**
 * O dossiê só confirma três campos para `GET /status`: `connected` (boolean), `smartphoneConnected`
 * (boolean) e `error` (string, com mensagens soltas de outros fluxos). Não há um valor dedicado que
 * distinga "aguardando leitura de QR" de "conectando" — por isso esta fase mapeia apenas
 * `connected: true → 'connected'` / `connected: false → 'disconnected'`; para saber se está no meio
 * do fluxo de pareamento, o consumidor usa `instance.connect()` (que devolve o QR atual). Qualquer
 * shape sem `connected` booleano vira `'unknown'` — nunca lança.
 */
function mapInstanceState(body: unknown): InstanceState {
  const record = asRecord(body);
  if (!record) return 'unknown';
  const connected = asBoolean(record.connected);
  if (connected === undefined) return 'unknown';
  return connected ? 'connected' : 'disconnected';
}

async function logoutInstance(http: HttpClient, prefix: string): Promise<void> {
  // Quirk confirmado no dossiê: `/disconnect` é GET, não POST/DELETE, apesar do efeito colateral.
  // Isso o torna elegível ao retry automático de GET do HttpClient — seguro aqui, pois desconectar
  // uma instância já desconectada é idempotente em efeito.
  await http.request({ method: 'GET', path: `${prefix}/disconnect` });
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

async function sendText(
  http: HttpClient,
  prefix: string,
  input: SendTextInput,
): Promise<SentMessage> {
  const phone = toZapiPhone(input.to);
  const body: Record<string, unknown> = { phone, message: input.text };
  // O dossiê confirma, na página dedicada "reply-message" (mesma URL de `/send-text`, mas com o
  // campo opcional `messageId` no corpo), que `send-text` aceita sim citar/responder uma mensagem:
  // "when you use the send-text method there is an optional attribute called messageId (...) your
  // message will be directly related to the message of the informed Id". Por isso `quotedId` é
  // mapeado para `messageId`, no mesmo padrão já usado em sendMedia para image/video/document.
  // `mentions` continua sem campo confirmado em nenhuma página consultada (nem send-text nem
  // reply-message) — segue silenciosamente ignorado. Ver docs/providers/zapi.md.
  if (input.quotedId) {
    body.messageId = input.quotedId;
  }
  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}/send-text`,
    body,
  });
  return mapSentMessage(response, phone);
}

interface MediaEndpoint {
  path: string;
  field: string;
  supportsCaption: boolean;
  supportsQuotedId: boolean;
}

/**
 * Resolve o endpoint/campo de corpo por `MediaKind`, conforme confirmado no dossiê: um endpoint por
 * tipo de mídia (`/send-image`, `/send-video`, `/send-audio`, `/send-document/{extension}`,
 * `/send-sticker`), sem endpoint genérico.
 */
function resolveMediaEndpoint(media: MediaRef): MediaEndpoint {
  switch (media.kind) {
    case 'image':
      return { path: '/send-image', field: 'image', supportsCaption: true, supportsQuotedId: true };
    case 'video':
      return { path: '/send-video', field: 'video', supportsCaption: true, supportsQuotedId: true };
    case 'audio':
      // O dossiê não documenta `caption` nem `messageId` no corpo de `/send-audio` (só
      // `delayMessage`/`delayTyping`/`viewOnce`/`async`/`waveform`) — coerente com o WhatsApp não
      // suportar legenda em mensagens de voz.
      return {
        path: '/send-audio',
        field: 'audio',
        supportsCaption: false,
        supportsQuotedId: false,
      };
    case 'document':
      return {
        path: `/send-document/${resolveDocumentExtension(media)}`,
        field: 'document',
        supportsCaption: true,
        supportsQuotedId: true,
      };
    case 'sticker':
      // `/send-sticker` confirmado no dossiê: corpo `{ phone, sticker, messageId?, delayMessage?,
      // stickerAuthor? }`, resposta `{ zaapId, messageId, id }` no mesmo formato dos demais
      // `send-*`. A doc não lista `caption` para sticker (coerente com o WhatsApp não suportar
      // legenda em figurinhas) — só `supportsQuotedId` via `messageId`.
      return {
        path: '/send-sticker',
        field: 'sticker',
        supportsCaption: false,
        supportsQuotedId: true,
      };
  }
}

/**
 * `/send-document/{extension}` exige a extensão como segmento literal da URL (não um campo do
 * corpo) — deriva de `media.filename` (preferencial) ou de um mapeamento best-effort a partir de
 * `media.mimeType`. Lança `INVALID_INPUT` se nenhum dos dois permitir derivar uma extensão.
 */
function resolveDocumentExtension(media: MediaRef): string {
  const fromFilename = extensionFromFilename(media.filename);
  if (fromFilename) return fromFilename;
  const fromMime = extensionFromMimeType(media.mimeType);
  if (fromMime) return fromMime;
  throw new WaConnectorError(
    'INVALID_INPUT',
    'Z-API: sendMedia para "document" exige "media.filename" (com extensão) ou um ' +
      '"media.mimeType" reconhecido, para compor o segmento /send-document/{extension} da URL.',
    { provider: PROVIDER },
  );
}

function extensionFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === filename.length - 1) return undefined;
  return filename.slice(dotIndex + 1).toLowerCase();
}

const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

function extensionFromMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  return MIME_TO_EXTENSION[mimeType.toLowerCase()];
}

/** Mimetype-padrão usado só para montar a data URI de base64 quando `media.mimeType` não é informado. */
const DEFAULT_MIME_BY_KIND: Partial<Record<MediaKind, string>> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  document: 'application/octet-stream',
};

/**
 * A Z-API aceita tanto URL quanto data URI base64 (`data:image/png;base64,...`) no mesmo campo. Se
 * `media.base64` já vier como data URI, repassa intacto; se vier "cru" (sem prefixo `data:`),
 * monta a data URI usando `media.mimeType` (ou um mimetype-padrão por `MediaKind`, best-effort).
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
    'Z-API: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER },
  );
}

async function sendMedia(
  http: HttpClient,
  prefix: string,
  input: SendMediaInput,
): Promise<SentMessage> {
  const phone = toZapiPhone(input.to);
  const endpoint = resolveMediaEndpoint(input.media);
  const value = resolveMediaValue(input.media);

  const body: Record<string, unknown> = { phone, [endpoint.field]: value };
  if (endpoint.supportsCaption && input.caption) {
    body.caption = input.caption;
  }
  if (endpoint.field === 'document' && input.media.filename) {
    body.fileName = input.media.filename;
  }
  if (endpoint.supportsQuotedId && input.quotedId) {
    body.messageId = input.quotedId;
  }

  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}${endpoint.path}`,
    body,
  });
  return mapSentMessage(response, phone);
}

/**
 * Resposta confirmada no dossiê para `send-text`/`send-image`/`send-video`/`send-audio`/
 * `send-document`: `{ zaapId, messageId, id }` (`id` é um alias de `messageId`, mantido só por
 * compat com Zapier). Não há campo de timestamp documentado na resposta — `SentMessage.timestamp`
 * fica `undefined`; `chatId` usa o `phone` requisitado (a resposta não ecoa o destinatário).
 */
function mapSentMessage(body: unknown, requestedPhone: string): SentMessage {
  const record = asRecord(body);
  const id =
    (record ? (asString(record.messageId) ?? asString(record.id)) : undefined) ??
    `zapi-${Date.now()}`;
  return { id, chatId: requestedPhone, raw: body };
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook Z-API para eventos canônicos. Nunca lança: qualquer formato inesperado
 * (incluindo exceções internas) vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Z-API: ${
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
    return [unknownEvent(body, 'Corpo do webhook Z-API não é um objeto JSON.')];
  }

  const type = asString(record.type);
  if (!type) {
    return [unknownEvent(body, 'Payload de webhook Z-API sem campo "type".')];
  }

  const instanceId = asString(record.instanceId);

  switch (type) {
    case 'ReceivedCallback': {
      const message = mapZapiMessage(record, body);
      return [
        {
          type: message.fromMe ? 'message.sent' : 'message.received',
          provider: PROVIDER,
          instanceId,
          message,
          raw: body,
        },
      ];
    }

    case 'DeliveryCallback': {
      // Confirma a entrega ao SERVIDOR do WhatsApp (não ao destinatário) — não carrega campo
      // `status` próprio; só carrega `error` quando a entrega falha (ex.: "Phone number does not
      // exist"). Mapeado para `ack: 'sent'` (aceito pela rede) ou `'error'` quando `error` presente.
      const messageId = asString(record.messageId) ?? asString(record.zaapId) ?? 'unknown';
      const errorText = asString(record.error);
      return [
        {
          type: 'message.ack',
          provider: PROVIDER,
          instanceId,
          messageId,
          chatId: asString(record.phone),
          ack: errorText ? 'error' : 'sent',
          raw: body,
        },
      ];
    }

    case 'MessageStatusCallback': {
      const ids = asStringArray(record.ids);
      if (ids.length === 0) {
        return [
          unknownEvent(body, 'Evento "MessageStatusCallback" do Z-API sem "ids".', instanceId),
        ];
      }
      const chatId = asString(record.phone);
      const ack = mapZapiAckStatus(asString(record.status));
      return ids.map((messageId) => ({
        type: 'message.ack' as const,
        provider: PROVIDER,
        instanceId,
        messageId,
        chatId,
        ack,
        raw: body,
      }));
    }

    case 'ConnectedCallback':
      return [
        {
          type: 'connection.update',
          provider: PROVIDER,
          instanceId,
          state: 'connected',
          raw: body,
        },
      ];

    case 'DisconnectedCallback':
      return [
        {
          type: 'connection.update',
          provider: PROVIDER,
          instanceId,
          state: 'disconnected',
          raw: body,
        },
      ];

    default:
      return [unknownEvent(body, `Evento Z-API não mapeado nesta fase: "${type}".`, instanceId)];
  }
}

/**
 * `record.phone` representa o chat (para 1:1, o próprio remetente; para grupos, presumivelmente o
 * ID do grupo) — inferência a partir dos nomes de campo `isGroup`/`participantPhone` do envelope,
 * já que o único exemplo literal capturado no dossiê é uma mensagem 1:1 (`isGroup: false`,
 * `participantPhone: null`). Quando `participantPhone` está presente (mensagem de grupo), é usado
 * como remetente real (`from`); caso contrário `from` cai para `phone`. **Não validado contra uma
 * mensagem de grupo real** — ver docs/providers/zapi.md.
 */
function mapZapiMessage(record: Record<string, unknown>, rawBody: unknown): WaMessage {
  const fromMe = asBoolean(record.fromMe) ?? false;
  const content = mapMessageContent(record);
  const chatId = asString(record.phone) ?? 'unknown';

  return {
    id: asString(record.messageId) ?? `zapi-unknown-${Date.now()}`,
    chatId,
    from: asString(record.participantPhone) ?? asString(record.phone),
    fromMe,
    timestamp: asNumber(record.momment) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
    raw: rawBody,
  };
}

interface MessageContent {
  kind: MessageKind;
  text?: string;
  media?: MediaRef;
}

/**
 * O único payload de `ReceivedCallback` copiado verbatim no dossiê é de texto (`text: { message }`).
 * A doc menciona dezenas de outras variantes (image, audio, video, document, sticker, contact,
 * location, reaction, poll, ...) sem shape de campo completo capturado — EXCETO pelos nomes de
 * campo `image.imageUrl`/`audio.audioUrl`, confirmados indiretamente pela nota de expiração de
 * mídia do dossiê ("URLs em image.imageUrl, audio.audioUrl, etc. expiram... em 30 dias").
 * `video.videoUrl`/`document.documentUrl`/`sticker.stickerUrl` seguem esse mesmo padrão por
 * analogia — **não confirmados individualmente**. Qualquer outra chave de tipo (contact, location,
 * reaction, poll, buttons, list, templates hidratados, carousel, chamadas, notificações de
 * grupo/canal) vira `MessageKind: 'unknown'` nesta fase. Ver docs/providers/zapi.md#webhooks.
 */
function mapMessageContent(record: Record<string, unknown>): MessageContent {
  const text = asRecord(record.text);
  if (text) {
    return { kind: 'text', text: asString(text.message) };
  }
  const image = asRecord(record.image);
  if (image) {
    return {
      kind: 'image',
      text: asString(image.caption),
      media: buildMediaRef('image', image, 'imageUrl'),
    };
  }
  const video = asRecord(record.video);
  if (video) {
    return {
      kind: 'video',
      text: asString(video.caption),
      media: buildMediaRef('video', video, 'videoUrl'),
    };
  }
  const audio = asRecord(record.audio);
  if (audio) {
    return { kind: 'audio', media: buildMediaRef('audio', audio, 'audioUrl') };
  }
  const document = asRecord(record.document);
  if (document) {
    return {
      kind: 'document',
      text: asString(document.caption),
      media: buildMediaRef('document', document, 'documentUrl'),
    };
  }
  const sticker = asRecord(record.sticker);
  if (sticker) {
    return { kind: 'sticker', media: buildMediaRef('sticker', sticker, 'stickerUrl') };
  }
  return { kind: 'unknown' };
}

function buildMediaRef(
  kind: MediaKind,
  record: Record<string, unknown>,
  urlField: string,
): MediaRef | undefined {
  const url = asString(record[urlField]);
  if (!url) return undefined;
  return {
    kind,
    url,
    mimeType: asString(record.mimeType),
    filename: asString(record.fileName),
  };
}

/**
 * Valores documentados de `MessageStatusCallback.status`: `SENT`, `RECEIVED`, `READ`, `READ_BY_ME`,
 * `PLAYED`. `RECEIVED` mapeia para `'delivered'` (chegou ao dispositivo do destinatário — não
 * confundir com `ReceivedCallback`, o tipo de EVENTO usado para mensagens recebidas, nome
 * infelizmente parecido mas semântica diferente). `READ_BY_ME` (lido a partir de outro
 * dispositivo vinculado à mesma conta) é tratado como `'read'` por falta de um valor canônico mais
 * específico. Qualquer valor não reconhecido cai em `'sent'` (fallback neutro, nunca lança) — mesmo
 * padrão dos adapters uazapi/Evolution GO.
 */
function mapZapiAckStatus(status: string | undefined): MessageAck {
  switch (status) {
    case 'SENT':
      return 'sent';
    case 'RECEIVED':
      return 'delivered';
    case 'READ':
    case 'READ_BY_ME':
      return 'read';
    case 'PLAYED':
      return 'played';
    default:
      return 'sent';
  }
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

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
