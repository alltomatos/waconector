import type { InstanceApi, MessagesApi, WaAdapter, WebhookInput } from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { WaConnectorError } from '../../core/errors';
import type {
  CanonicalEvent,
  ConnectionUpdateEvent,
  MessageAckEvent,
  MessageReceivedEvent,
  UnknownEvent,
} from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ConnectResult,
  InstanceState,
  InstanceStatus,
  MediaKind,
  MessageAck,
  SendMediaInput,
  SendTextInput,
  SentMessage,
  WaMessage,
} from '../../core/types';

/**
 * Opções do adapter izapia (SaaS multi-tenant, `https://api.izapia.com`).
 *
 * @see docs/providers/izapia.md para o dossiê completo (auth, endpoints, payloads, gaps confirmados).
 */
export interface IzapiaOptions {
  /** URL base da API, ex.: `https://api.izapia.com`. */
  baseUrl: string;
  /** API key do tenant, enviada como `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /**
   * ID de uma sessão JÁ CRIADA (`POST /api/v1/sessions/`) — a criação da sessão é um passo de
   * provisionamento fora do contrato `WaAdapter` (mesmo critério de "criação de instância" nos
   * demais adapters SaaS deste pacote: uazapi/Z-API tratam isso como operação administrativa,
   * fora de `instance.connect()`). `instance.connect()` deste adapter só inicia o pareamento
   * (`POST /sessions/{sid}/pair`) de uma sessão que já existe.
   */
  sid: string;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'izapia';

const IZAPIA_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'webhooks.parse',
];

/** Fábrica do adapter izapia. */
export function izapia(options: IzapiaOptions): WaAdapter {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.apiKey}` },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.apiKey],
    provider: PROVIDER,
    fetch: options.fetch,
  });
  const sid = options.sid;

  const instance: InstanceApi = {
    connect: () => connectInstance(http, sid),
    status: () => statusInstance(http, sid),
    logout: () => logoutInstance(http, sid),
  };

  const messages: MessagesApi = {
    sendText: (input) => sendText(http, sid, input),
    sendMedia: (input) => sendMedia(http, sid, input),
  };

  return {
    provider: PROVIDER,
    capabilities: IZAPIA_CAPABILITIES,
    instance,
    messages,
    // groups/contacts obrigatórios no contrato `WaAdapter`, mas ainda não implementados nesta
    // fase (issues #48/#49 desta Epic) — objetos vazios, sem capability declarada.
    groups: {},
    contacts: {},
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

async function connectInstance(http: HttpClient, sid: string): Promise<ConnectResult> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/pair`,
  });
  const data = unwrapEnvelope(body);
  return { qr: asString(data.qr_png_base64), raw: body };
}

async function statusInstance(http: HttpClient, sid: string): Promise<InstanceStatus> {
  const body = await http.request<unknown>({ method: 'GET', path: `/api/v1/sessions/${sid}` });
  const data = unwrapEnvelope(body);
  return { state: mapInstanceState(asString(data.status)), raw: body };
}

async function logoutInstance(http: HttpClient, sid: string): Promise<void> {
  // Soft logout (ver docs/providers/izapia.md): invalida a sessão do lado do WhatsApp, mas
  // preserva a linha da sessão — um novo instance.connect() volta a funcionar.
  await http.request({ method: 'POST', path: `/api/v1/sessions/${sid}/logout` });
}

/**
 * Mapeia `Session.status` (izapia: `created | pairing | connected | disconnected | logged_out`)
 * para o `InstanceState` canônico — ver docs/providers/izapia.md#mapeamento-de-status. `disconnected`
 * do izapia preserva o JID/credenciais (só o socket caiu), então mapeia para `connecting` (mesmo
 * critério já usado no dossiê Wuzapi), não para `disconnected` canônico.
 */
function mapInstanceState(status: string | undefined): InstanceState {
  switch (status) {
    case 'created':
      return 'disconnected';
    case 'pairing':
      return 'qr';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'connecting';
    case 'logged_out':
      return 'disconnected';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// messages.* (núcleo — sendText/sendMedia são obrigatórios em todo adapter)
// ---------------------------------------------------------------------------

async function sendText(http: HttpClient, sid: string, input: SendTextInput): Promise<SentMessage> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/text`,
    body: { to: input.to, text: input.text },
  });
  return mapSentMessage(body, input.to);
}

async function sendMedia(
  http: HttpClient,
  sid: string,
  input: SendMediaInput,
): Promise<SentMessage> {
  // Checagem de último recurso (o conector já valida isso) para quem instancia o adapter sem
  // createConnector — ver CONTRIBUTING.md, seção "Convenções inegociáveis".
  const source = input.media.url ?? input.media.base64;
  if (!source) {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'izapia: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER },
    );
  }
  const requestBody: Record<string, unknown> = {
    to: input.to,
    kind: mapMediaKind(input.media.kind),
  };
  if (input.media.url) requestBody.url = input.media.url;
  else requestBody.base64 = input.media.base64;
  if (input.media.mimeType) requestBody.mimetype = input.media.mimeType;
  if (input.caption) requestBody.caption = input.caption;

  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/media`,
    body: requestBody,
  });
  return mapSentMessage(body, input.to);
}

function mapMediaKind(kind: MediaKind): string {
  return kind;
}

/** Resposta de envio (`{message_id}`) não traz `chatId`/`timestamp` — ver docs/providers/izapia.md. */
function mapSentMessage(body: unknown, requestedTo: string): SentMessage {
  const data = unwrapEnvelope(body);
  const id = asString(data.message_id) ?? `izapia-${Date.now()}`;
  return { id, chatId: requestedTo, raw: body };
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook izapia para eventos canônicos. O corpo entregue É o envelope de evento cru
 * (`{event_id, type, session_id, tenant_id, data, published_at}` — ver
 * docs/providers/izapia.md#webhooks), sem wrapper adicional. Nunca lança: formato inesperado ou
 * exceção interna vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook izapia: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const envelope = asRecord(input.body);
  if (!envelope) {
    return [unknownEvent(input.body, 'Corpo do webhook izapia não é um objeto JSON.')];
  }

  const type = asString(envelope.type);
  const sessionId = asString(envelope.session_id);
  const data = asRecord(envelope.data) ?? {};
  if (!type) {
    return [unknownEvent(input.body, 'Payload de webhook izapia sem campo "type".', sessionId)];
  }

  switch (type) {
    case 'session.qr':
      return [connectionUpdate(input.body, sessionId, 'qr')];
    case 'session.connected':
      return [connectionUpdate(input.body, sessionId, 'connected')];
    case 'session.disconnected':
      return [connectionUpdate(input.body, sessionId, 'connecting')];
    case 'session.logged_out':
      return [connectionUpdate(input.body, sessionId, 'disconnected')];
    case 'message.received':
      return [messageReceived(input.body, sessionId, data)];
    case 'message.ack':
      return [messageAck(input.body, sessionId, data)];
    default:
      // message.interactiveReply/pollVote, presence.update, call.*, history.sync, usage.*,
      // status.received: sem evento canônico equivalente hoje (ver dossiê) — vira unknown.
      return [
        unknownEvent(input.body, `Evento izapia não mapeado nesta fase: "${type}".`, sessionId),
      ];
  }
}

function connectionUpdate(
  raw: unknown,
  sessionId: string | undefined,
  state: InstanceState,
): ConnectionUpdateEvent {
  return { type: 'connection.update', provider: PROVIDER, instanceId: sessionId, state, raw };
}

function messageReceived(
  raw: unknown,
  sessionId: string | undefined,
  data: Record<string, unknown>,
): MessageReceivedEvent {
  const message: WaMessage = {
    id: asString(data.message_id) ?? `izapia-unknown-${Date.now()}`,
    chatId: asString(data.chat) ?? 'unknown',
    from: asString(data.from),
    fromMe: asBoolean(data.from_me) ?? false,
    timestamp: (asNumber(data.timestamp) ?? 0) * 1000,
    kind: asString(data.text) ? 'text' : 'unknown',
    text: asString(data.text),
    raw,
  };
  return { type: 'message.received', provider: PROVIDER, instanceId: sessionId, message, raw };
}

function messageAck(
  raw: unknown,
  sessionId: string | undefined,
  data: Record<string, unknown>,
): MessageAckEvent {
  const messageIds = Array.isArray(data.message_ids) ? data.message_ids.map(asString) : [];
  return {
    type: 'message.ack',
    provider: PROVIDER,
    instanceId: sessionId,
    messageId: messageIds.find((id): id is string => id !== undefined) ?? 'unknown',
    chatId: asString(data.chat),
    ack: mapAckStatus(asString(data.status)),
    raw,
  };
}

/** Ver `receiptStatus` em `internal/session/message.go` — "" (ausente) do whatsmeow é `delivered`. */
function mapAckStatus(status: string | undefined): MessageAck {
  switch (status) {
    case 'delivered':
      return 'delivered';
    case 'read':
    case 'read-self':
      return 'read';
    case 'played':
    case 'played-self':
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

/** Extrai `data` do envelope canônico da API `{ok, data, error}` (ver docs/providers/izapia.md). */
function unwrapEnvelope(body: unknown): Record<string, unknown> {
  const record = asRecord(body);
  return (record ? asRecord(record.data) : undefined) ?? {};
}

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
