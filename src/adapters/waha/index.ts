import type { InstanceApi, MessagesApi, WaAdapter, WebhookInput } from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { WaConnectorError } from '../../core/errors';
import type { CanonicalEvent, ConnectionUpdateEvent, UnknownEvent } from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ConnectResult,
  InstanceState,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  SentMessage,
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
}

const PROVIDER = 'waha';

const WAHA_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
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
  };

  return {
    provider: PROVIDER,
    capabilities: WAHA_CAPABILITIES,
    instance,
    messages,
    parseWebhook: (input) => parseWahaWebhook(input, session),
  };
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
 * Converte uma entrada canônica de `mentions` para o formato de JID que o WAHA espera em
 * `POST /api/sendText`. `"all"` é um valor especial documentado (mencionar todo mundo no grupo)
 * e não deve passar por `toWahaChatId` (viraria `all@c.us`, incorreto).
 */
function toWahaMention(entry: string): string {
  if (entry === 'all') return entry;
  return toWahaChatId(entry);
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

function buildWahaFile(media: MediaRef): WahaRemoteFile | WahaBinaryFile {
  const mimetype = media.mimeType ?? 'application/octet-stream';
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
 * Traduz um webhook WAHA para eventos canônicos. Nunca lança: eventos não mapeados nesta fase
 * (F1: `message`, `message.ack`, `session.status`) viram `unknown`. Ver docs/providers/waha.md.
 */
function parseWahaWebhook(input: WebhookInput, defaultSession: string): CanonicalEvent[] {
  const body = input.body;
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
