import type {
  GroupsApi,
  InstanceApi,
  MessagesApi,
  WaAdapter,
  WebhookInput,
} from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { digitsOnly, isJid } from '../../core/chat-id';
import { WaConnectorError } from '../../core/errors';
import type { CanonicalEvent, ConnectionUpdateEvent, UnknownEvent } from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ConnectResult,
  CreateGroupInput,
  GroupInfo,
  GroupParticipant,
  GroupParticipantsInput,
  InstanceState,
  InstanceStatus,
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
 * Opções do adapter uazapi (SaaS multi-tenant, `https://{subdomain}.uazapi.com`).
 *
 * @see docs/providers/uazapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
export interface UazapiOptions {
  /** URL base da instância uazapi do cliente, ex.: `https://minhaempresa.uazapi.com`. */
  baseUrl: string;
  /**
   * Token de instância, enviado cru (sem prefixo `Bearer`) no header `token`. Escopo: todas as
   * capabilities implementadas por este adapter (connect/status/disconnect, send/text, send/media).
   */
  token: string;
  /**
   * Token administrativo, enviado cru no header `admintoken`. Escopo real: endpoints
   * administrativos (`POST /instance/create`, listar instâncias, webhook global, rotacionar
   * admin token) — **nenhum implementado nesta fase**. Opcional aqui apenas para permitir guardar
   * os dois tokens num único lugar (e redigi-los em erros); reservado para uma fase futura que
   * exponha provisionamento de instância. Ver docs/providers/uazapi.md#autenticação.
   */
  adminToken?: string;
  /**
   * Nome/identificador da instância, apenas para referência do chamador. Não é enviado em
   * nenhuma requisição — as rotas operacionais resolvem a instância a partir do header `token`.
   */
  instance?: string;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'uazapi';

const UAZAPI_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'messages.sendReaction',
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
  'webhooks.parse',
];

/** Fábrica do adapter uazapi. */
export function uazapi(options: UazapiOptions): WaAdapter {
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
    connect: () => connectInstance(http),
    status: () => statusInstance(http),
    logout: () => logoutInstance(http),
  };

  const messages: MessagesApi = {
    sendText: (input) => sendText(http, input),
    sendMedia: (input) => sendMedia(http, input),
    sendReaction: (input) => sendReaction(http, input),
  };

  const groups: GroupsApi = {
    create: (input) => createGroup(http, input),
    getInfo: (groupId) => getGroupInfo(http, groupId),
    list: () => listGroups(http),
    addParticipants: (input) => updateGroupParticipants(http, input, 'add'),
    removeParticipants: (input) => updateGroupParticipants(http, input, 'remove'),
    promoteParticipants: (input) => updateGroupParticipants(http, input, 'promote'),
    demoteParticipants: (input) => updateGroupParticipants(http, input, 'demote'),
    updateSubject: (input) => updateGroupSubject(http, input),
    updateDescription: (input) => updateGroupDescription(http, input),
    updatePicture: (input) => updateGroupPicture(http, input),
  };

  return {
    provider: PROVIDER,
    capabilities: UAZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// map-out: canônico -> uazapi
// ---------------------------------------------------------------------------

/**
 * Converte o chatId canônico do waconector (dígitos crus OU JID explícito — ver
 * `normalizeChatId`) para o campo `number` do uazapi.
 *
 * O provider aceita exatamente os dois mesmos formatos (dígitos internacionais sem `+` para chat
 * 1:1, ou um JID completo `@g.us`/`@s.whatsapp.net`/`@lid`/`@newsletter`), então o chatId canônico
 * já chega pronto — repassado sem transformação. Função existe como ponto único de mudança, mesmo
 * padrão do adapter Evolution GO (`toProviderNumber`).
 */
function toUazapiNumber(chatId: string): string {
  return chatId;
}

/**
 * Constrói o valor esperado pelo campo `mentions` de `POST /send/text` — diferente de `number`,
 * esse campo é uma STRING de dígitos separados por vírgula (ou o valor especial `"all"`), não uma
 * lista de JIDs. Entradas em formato JID têm o sufixo removido; `"all"` passa intacto.
 */
function toUazapiMentions(mentions: string[]): string {
  return mentions.map(toMentionDigits).join(',');
}

function toMentionDigits(entry: string): string {
  if (entry === 'all') return entry;
  if (isJid(entry)) return digitsOnly(entry.slice(0, entry.indexOf('@')));
  return digitsOnly(entry);
}

/**
 * Converte o `groupId` opaco do waconector (ver ADR-0009) para o campo `groupjid` esperado pelos
 * endpoints `/group/*`. Para uazapi, `GroupInfo.id` já É o JID de grupo nativo do provider
 * (`Group.JID`, formato `<dígitos>@g.us`) — devolvido tal como veio de `getGroupInfo`/`listGroups`,
 * então a conversão é identidade. Função existe como ponto único de mudança (mesmo padrão de
 * `toUazapiNumber`); deliberadamente separada dela porque `groupId` NÃO passa pelo conector (não é
 * normalizado via `normalizeChatId`), diferente do `to` de mensagens.
 */
function toUazapiGroupJid(groupId: string): string {
  return groupId;
}

/**
 * `POST /group/create` aceita participantes como dígitos de telefone CRUS — ao contrário de
 * `POST /group/updateParticipants` (usado por add/remove/promote/demote), NÃO aceita JID. Entradas
 * em formato JID (o conector já normaliza `CreateGroupInput.participants` como um `to` de
 * mensagem comum) têm o sufixo `@...` removido; entradas já em dígitos passam direto. Mesma
 * extração usada em `toMentionDigits`, mas sem o caso especial `"all"` (não se aplica a
 * participantes de grupo).
 */
function toCreateGroupParticipant(participant: string): string {
  return isJid(participant)
    ? digitsOnly(participant.slice(0, participant.indexOf('@')))
    : digitsOnly(participant);
}

function mapMediaKindToUazapiType(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
  }
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

async function connectInstance(http: HttpClient): Promise<ConnectResult> {
  // Sem "phone" no body: só o fluxo de QR code é exposto nesta fase (ver docs/providers/uazapi.md
  // — instance.pairingCode não é uma capability declarada, pois InstanceApi.connect() não recebe
  // telefone como parâmetro).
  const body = await http.request<unknown>({ method: 'POST', path: '/instance/connect', body: {} });
  return { qr: extractQr(body), raw: body };
}

async function statusInstance(http: HttpClient): Promise<InstanceStatus> {
  const body = await http.request<unknown>({ method: 'GET', path: '/instance/status' });
  const record = asRecord(body);
  const instanceRecord = record ? asRecord(record.instance) : undefined;
  const providerStatus = instanceRecord ? asString(instanceRecord.status) : undefined;
  const hasQr = instanceRecord !== undefined && hasNonEmptyQr(instanceRecord);
  return { state: mapInstanceState(providerStatus, hasQr), raw: body };
}

async function logoutInstance(http: HttpClient): Promise<void> {
  // Soft-disconnect (mantém o registro da instância; exige novo QR/pairing code para reconectar) —
  // não `DELETE /instance` (hard-delete, apaga a instância). Ver docs/providers/uazapi.md.
  await http.request({ method: 'POST', path: '/instance/disconnect' });
}

function extractQr(body: unknown): string | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  const instanceRecord = asRecord(record.instance);
  return (instanceRecord ? asString(instanceRecord.qrcode) : undefined) ?? asString(record.qrcode);
}

function hasNonEmptyQr(instanceRecord: Record<string, unknown>): boolean {
  const qr = asString(instanceRecord.qrcode);
  return qr !== undefined && qr.length > 0;
}

/**
 * Mapeia `instance.status` (uazapi: `disconnected | connecting | connected | hibernated`) para o
 * `InstanceState` canônico. `hibernated` é mapeado deliberadamente para `disconnected` (decisão
 * explícita documentada em docs/providers/uazapi.md, não um fallback) — qualquer outro valor não
 * reconhecido cai em `unknown` (nunca lança).
 */
function mapInstanceState(status: string | undefined, hasQr: boolean): InstanceState {
  switch (status) {
    case 'disconnected':
      return 'disconnected';
    case 'connecting':
      return hasQr ? 'qr' : 'connecting';
    case 'connected':
      return 'connected';
    case 'hibernated':
      return 'disconnected';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

async function sendText(http: HttpClient, input: SendTextInput): Promise<SentMessage> {
  const number = toUazapiNumber(input.to);
  const body: Record<string, unknown> = { number, text: input.text };
  if (input.quotedId) {
    body.replyid = input.quotedId;
  }
  if (input.mentions && input.mentions.length > 0) {
    body.mentions = toUazapiMentions(input.mentions);
  }
  const response = await http.request<unknown>({ method: 'POST', path: '/send/text', body });
  return mapSentMessage(response, number);
}

async function sendMedia(http: HttpClient, input: SendMediaInput): Promise<SentMessage> {
  const number = toUazapiNumber(input.to);
  // Checagem de último recurso (o conector já valida isso) para quem instancia o adapter sem
  // createConnector — ver CONTRIBUTING.md, seção "Convenções inegociáveis".
  const file = input.media.url ?? input.media.base64;
  if (!file) {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'uazapi: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER },
    );
  }

  const body: Record<string, unknown> = {
    number,
    type: mapMediaKindToUazapiType(input.media.kind),
    file,
  };
  if (input.caption) body.text = input.caption;
  if (input.media.kind === 'document' && input.media.filename) {
    body.docName = input.media.filename;
  }
  if (input.media.mimeType) body.mimetype = input.media.mimeType;
  if (input.quotedId) body.replyid = input.quotedId;

  const response = await http.request<unknown>({ method: 'POST', path: '/send/media', body });
  return mapSentMessage(response, number);
}

/**
 * `POST /message/react`: body `{ number, text, id }`, todos obrigatórios — `text` é o emoji
 * Unicode da reação (string vazia remove uma reação já enviada, convenção do próprio WhatsApp,
 * ver ADR-0008/`SendReactionInput.emoji`), `id` é o ID da mensagem-alvo. Sem `idempotent: true`
 * (mesma regra de `sendText`/`sendMedia` — ver ADR-0007): reenviar após NETWORK_ERROR poderia
 * duplicar/alternar a reação.
 *
 * Limitações documentadas pelo provider (não impostas pelo adapter, apenas registradas aqui):
 * só é possível reagir a mensagens de outros usuários (não às enviadas pela própria instância),
 * não a mensagens com mais de 7 dias, e um único usuário só tem uma reação ativa por mensagem.
 * Ver docs/providers/uazapi.md#operações-core.
 */
async function sendReaction(http: HttpClient, input: SendReactionInput): Promise<SentMessage> {
  const number = toUazapiNumber(input.to);
  const body: Record<string, unknown> = { number, text: input.emoji, id: input.messageId };
  const response = await http.request<unknown>({ method: 'POST', path: '/message/react', body });
  return mapSentMessage(response, number);
}

/**
 * A doc não mostra um exemplo JSON literal do corpo de resposta de `POST /send/text` /
 * `POST /send/media` — assumido como (ou contendo, no nível raiz) o shape do schema `Message`
 * documentado. Ver docs/providers/uazapi.md#formato-de-resposta-de-envio-assunção.
 *
 * Reaproveitada por `sendReaction` (`POST /message/react`): o schema de resposta 200 documentado
 * para esse endpoint segue o mesmo padrão genérico (`id`, `messageid`, `messageTimestamp`, ...),
 * sem um campo `chatid` — daqui vem o fallback para `requestedNumber` também nesse caso.
 */
function mapSentMessage(body: unknown, requestedNumber: string): SentMessage {
  const record = asRecord(body);
  const id =
    (record ? (asString(record.messageid) ?? asString(record.id)) : undefined) ??
    `uazapi-${Date.now()}`;
  const chatId = (record ? asString(record.chatid) : undefined) ?? requestedNumber;
  const timestamp = record ? asNumber(record.messageTimestamp) : undefined;
  return { id, chatId, timestamp, raw: body };
}

// ---------------------------------------------------------------------------
// groups.*
// ---------------------------------------------------------------------------

/**
 * `POST /group/create`: body `{ name, participants }` — `participants` aqui é dígitos crus (ver
 * `toCreateGroupParticipant`), diferente de `updateParticipants` abaixo. Resposta 200 documentada
 * como o schema `Group` completo (mesmo shape de `getGroupInfo`), mas sem exemplo JSON literal na
 * doc — por isso `mapGroupInfo` recebe um fallback com os valores de entrada (`subject`,
 * `participants`), mesmo padrão de `mapSentMessage` (`chatId ?? requestedNumber`).
 */
async function createGroup(http: HttpClient, input: CreateGroupInput): Promise<GroupInfo> {
  const body = {
    name: input.subject,
    participants: input.participants.map(toCreateGroupParticipant),
  };
  const response = await http.request<unknown>({ method: 'POST', path: '/group/create', body });
  return mapGroupInfo(response, { subject: input.subject, participants: input.participants });
}

/**
 * `POST /group/info`: body `{ groupjid }`. Resposta = schema `Group` verbatim na doc: `{ JID, Name,
 * Topic (descrição), OwnerJID`/`OwnerPN (dono), GroupCreated, Participants: [{ JID, IsAdmin,
 * IsSuperAdmin }] }`.
 */
async function getGroupInfo(http: HttpClient, groupId: string): Promise<GroupInfo> {
  const groupjid = toUazapiGroupJid(groupId);
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/group/info',
    body: { groupjid },
  });
  return mapGroupInfo(response, { id: groupId });
}

/**
 * `GET /group/list`: sem body; query params `force`/`noparticipants` são opcionais e omitidos por
 * este adapter (não expostos por `GroupsApi.list()`, que não recebe parâmetros). Resposta:
 * `{ groups: Group[] }` — mesmo shape de `getGroupInfo`, um item por grupo.
 */
async function listGroups(http: HttpClient): Promise<GroupInfo[]> {
  const response = await http.request<unknown>({ method: 'GET', path: '/group/list' });
  const record = asRecord(response);
  const groups = record?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => mapGroupInfo(group));
}

/**
 * `addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` do contrato
 * são, na uazapi, o MESMO endpoint (`POST /group/updateParticipants`), discriminado pelo campo
 * `action`. Diferente de `/group/create`, aqui `participants` aceita telefone OU JID — reaproveita
 * `toUazapiNumber` (identidade), a mesma função usada para o `to` de mensagens. Resposta
 * (`{ groupUpdated, group, needs_refresh }`) é ignorada: o contrato exige apenas `Promise<void>`.
 */
async function updateGroupParticipants(
  http: HttpClient,
  input: GroupParticipantsInput,
  action: 'add' | 'remove' | 'promote' | 'demote',
): Promise<void> {
  const body = {
    groupjid: toUazapiGroupJid(input.groupId),
    action,
    participants: input.participants.map(toUazapiNumber),
  };
  await http.request({ method: 'POST', path: '/group/updateParticipants', body });
}

/**
 * `POST /group/updateName`: body `{ groupjid, name }`. `name` é o limite do próprio WhatsApp
 * (1-25 caracteres) — não validado por este adapter (ver docs/providers/uazapi.md#grupos-núcleo).
 * Resposta (`{ response, group, needs_refresh }`) é ignorada: o contrato exige `Promise<void>`.
 */
async function updateGroupSubject(http: HttpClient, input: UpdateGroupSubjectInput): Promise<void> {
  const body = { groupjid: toUazapiGroupJid(input.groupId), name: input.subject };
  await http.request({ method: 'POST', path: '/group/updateName', body });
}

/**
 * `POST /group/updateDescription`: body `{ groupjid, description }`. `description` vazia é
 * permitida e limpa a descrição do grupo (já validado como caso válido pelo conector, não um erro
 * — ver `prepareUpdateGroupDescription` em `src/core/connector.ts`). Limite documentado de 512
 * caracteres, não validado por este adapter. Resposta ignorada (`Promise<void>`).
 */
async function updateGroupDescription(
  http: HttpClient,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  const body = { groupjid: toUazapiGroupJid(input.groupId), description: input.description };
  await http.request({ method: 'POST', path: '/group/updateDescription', body });
}

/**
 * `POST /group/updateImage`: body `{ groupjid, image }`. `image` aceita URL ou uma data-URI
 * base64 (o literal `"remove"`/`"delete"` também é aceito pelo provider para apagar a foto, mas
 * essa capability só cobre "definir" a foto — não usado aqui). Construído a partir de `MediaRef`
 * via `toUazapiGroupImage`: `media.url` é repassada diretamente quando presente; caso contrário,
 * `media.base64` é envolvida numa data-URI com o prefixo derivado de `media.mimeType` (fallback
 * `image/jpeg`, já que o próprio WhatsApp exige JPEG para foto de grupo — resolução máxima 640x640,
 * requisito do WhatsApp, não validado no código). Resposta ignorada (`Promise<void>`).
 */
async function updateGroupPicture(http: HttpClient, input: UpdateGroupPictureInput): Promise<void> {
  const body = {
    groupjid: toUazapiGroupJid(input.groupId),
    image: toUazapiGroupImage(input.media),
  };
  await http.request({ method: 'POST', path: '/group/updateImage', body });
}

/**
 * Converte `MediaRef` (garantido pelo conector com `kind === 'image'` e ao menos um de
 * `url`/`base64` presente — ver `requireImageMedia` em `src/core/connector.ts`) para a string
 * única esperada pelo campo `image` de `POST /group/updateImage`. `url` tem prioridade (mesmo
 * padrão de `sendMedia`/`file`); sem `url`, monta uma data-URI a partir de `base64` com o prefixo
 * `data:<mimeType>;base64,` — `mimeType` ausente cai em `image/jpeg` (default neutro, alinhado ao
 * requisito de formato do próprio WhatsApp para foto de grupo).
 */
function toUazapiGroupImage(media: MediaRef): string {
  if (media.url) return media.url;
  const mimeType = media.mimeType ?? 'image/jpeg';
  return `data:${mimeType};base64,${media.base64}`;
}

/**
 * Mapeia o schema `Group` da uazapi (`JID`, `Name`, `Topic`, `OwnerJID`/`OwnerPN`, `Participants`)
 * para `GroupInfo`. `fallback` cobre os campos que a doc não confirma estarem sempre presentes na
 * resposta (comum em `createGroup`, sem exemplo JSON literal): `id`/`subject` caem de volta nos
 * valores de entrada quando ausentes, e `participants` cai de volta nos IDs de entrada (com
 * `isAdmin`/`isSuperAdmin: false` como suposição neutra) quando o provider não devolve
 * `Participants`.
 */
function mapGroupInfo(
  body: unknown,
  fallback: { id?: string; subject?: string; participants?: string[] } = {},
): GroupInfo {
  const record = asRecord(body);
  const id = (record ? asString(record.JID) : undefined) ?? fallback.id ?? '';
  const subject = (record ? asString(record.Name) : undefined) ?? fallback.subject ?? '';
  const description = record ? asString(record.Topic) : undefined;
  const owner = record ? (asString(record.OwnerJID) ?? asString(record.OwnerPN)) : undefined;
  const participantsRaw = record?.Participants;
  const participants = Array.isArray(participantsRaw)
    ? participantsRaw.map(mapGroupParticipant)
    : (fallback.participants ?? []).map(toFallbackParticipant);
  return { id, subject, description, owner, participants, raw: body };
}

function mapGroupParticipant(value: unknown): GroupParticipant {
  const record = asRecord(value);
  return {
    id: (record ? asString(record.JID) : undefined) ?? 'unknown',
    isAdmin: (record ? asBoolean(record.IsAdmin) : undefined) ?? false,
    isSuperAdmin: (record ? asBoolean(record.IsSuperAdmin) : undefined) ?? false,
  };
}

function toFallbackParticipant(id: string): GroupParticipant {
  return { id, isAdmin: false, isSuperAdmin: false };
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook uazapi para eventos canônicos. Nunca lança: qualquer formato inesperado
 * (incluindo exceções internas) vira um evento `unknown` com `reason`.
 *
 * A doc oficial não publica um exemplo literal completo do envelope de webhook para os eventos
 * mapeados aqui — os payloads usados para construir este parser são RECONSTRUÍDOS a partir do
 * schema genérico `WebhookEvent` e dos schemas `Message`/`Instance` (ver
 * docs/providers/uazapi.md#webhooks). O schema `WebhookEvent` não é referenciado por nenhum
 * endpoint documentado, então o envelope `{ event, instance, data }` em si é uma suposição não
 * confirmada; `GET /webhook/errors` mostra um payload de tentativa real com shape diferente
 * (`{ EventType, token }`), por isso `envelope.EventType` também é aceito como sinônimo defensivo
 * de `envelope.event`. Além disso, como a própria especificação diverge sobre os nomes de `event`
 * (enum do envelope usa singular `message`/`status`/`connection`; a lista de configuração de
 * eventos usa plural/nomes diferentes: `messages`/`messages_update`), o parser reconhece ambas as
 * grafias defensivamente. **Nada disso foi validado contra uma instância uazapi real** — ver
 * docs/providers/uazapi.md#webhooks para o risco completo.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook uazapi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const body = input.body;
  const envelope = asRecord(body);
  if (!envelope) {
    return [unknownEvent(body, 'Corpo do webhook uazapi não é um objeto JSON.')];
  }

  // `envelope.event` é o nome de campo do schema `WebhookEvent` documentado nos components do
  // OpenAPI — mas esse schema não é referenciado por nenhum endpoint documentado, então não há
  // exemplo confirmado do envelope realmente entregue. `GET /webhook/errors` (log de tentativas)
  // mostra um payload de tentativa com o shape `{ EventType, token }` (PascalCase, sem `event`
  // minúsculo nem `instance`/`data`) — por isso `envelope.EventType` também é aceito aqui como
  // sinônimo defensivo de `envelope.event`, até haver validação empírica contra uma instância real
  // (ver docs/providers/uazapi.md#webhooks).
  const eventNameRaw = asString(envelope.event) ?? asString(envelope.EventType);
  if (!eventNameRaw) {
    return [unknownEvent(body, 'Payload de webhook uazapi sem campo "event"/"EventType".')];
  }

  const instanceId = asString(envelope.instance);
  const data = asRecord(envelope.data);
  const eventName = eventNameRaw.toLowerCase();

  if (eventName === 'message' || eventName === 'messages') {
    if (!data) {
      return [
        unknownEvent(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId),
      ];
    }
    const message = mapUazapiMessage(data, body);
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

  if (eventName === 'status' || eventName === 'messages_update' || eventName === 'message.ack') {
    if (!data) {
      return [
        unknownEvent(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId),
      ];
    }
    return [
      {
        type: 'message.ack',
        provider: PROVIDER,
        instanceId,
        messageId: asString(data.messageid) ?? asString(data.id) ?? 'unknown',
        chatId: asString(data.chatid),
        ack: mapUazapiAck(asString(data.status)),
        raw: body,
      },
    ];
  }

  if (eventName === 'connection' || eventName === 'connection.update') {
    if (!data) {
      return [
        unknownEvent(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId),
      ];
    }
    const instanceRecord = asRecord(data.instance);
    const providerStatus = instanceRecord ? asString(instanceRecord.status) : undefined;
    const hasQr = instanceRecord !== undefined && hasNonEmptyQr(instanceRecord);
    const connectionUpdate: ConnectionUpdateEvent = {
      type: 'connection.update',
      provider: PROVIDER,
      instanceId,
      state: mapInstanceState(providerStatus, hasQr),
      qr: instanceRecord ? asString(instanceRecord.qrcode) : undefined,
      raw: body,
    };
    return [connectionUpdate];
  }

  return [
    unknownEvent(body, `Evento uazapi não mapeado nesta fase: "${eventNameRaw}".`, instanceId),
  ];
}

/**
 * `data.messageType` NÃO tem um valor confirmado por um exemplo literal do OpenAPI oficial para
 * mensagens de texto recebidas via webhook — o schema `Message` documenta o campo como
 * `type: string` livre, sem enum. `"conversation"` é a suposição original (terminologia comum em
 * outros providers baseados em Baileys), mantida apenas como sinônimo. Os únicos valores literais
 * de `messageType` encontrados na especificação real (respostas de `POST /message/react` e
 * `POST /message/edit`) usam `"text"` — por isso `"text"` também é aceito aqui defensivamente.
 * Qualquer outro valor (presumivelmente tipos de mídia, não enumerados pela doc) vira
 * `MessageKind: 'unknown'` nesta fase. `data.text` continua populado quando presente,
 * independente do `kind` resultante. **Não validado contra uma instância uazapi real** — ver
 * docs/providers/uazapi.md#webhooks.
 */
function mapMessageKind(messageType: string | undefined): MessageKind {
  if (messageType === 'conversation' || messageType === 'text') return 'text';
  return 'unknown';
}

function mapUazapiMessage(data: Record<string, unknown>, rawBody: unknown): WaMessage {
  const fromMe = asBoolean(data.fromMe) ?? false;
  const timestamp = asNumber(data.messageTimestamp) ?? Date.now();

  return {
    id: asString(data.messageid) ?? asString(data.id) ?? `uazapi-unknown-${Date.now()}`,
    chatId: asString(data.chatid) ?? 'unknown',
    from: asString(data.sender),
    fromMe,
    timestamp,
    kind: mapMessageKind(asString(data.messageType)),
    text: asString(data.text),
    quotedId: asString(data.quoted),
    raw: rawBody,
  };
}

/**
 * A doc só documenta "exemplos comuns" para `status` (não uma lista exaustiva). Valor não
 * reconhecido cai em `sent` (fallback neutro, nunca lança) — o próprio evento de update já
 * implica que a mensagem foi processada pelo provider.
 */
function mapUazapiAck(status: string | undefined): MessageAck {
  switch (status) {
    case 'Queued':
      return 'pending';
    case 'Sent':
      return 'sent';
    case 'Delivered':
      return 'delivered';
    case 'Read':
      return 'read';
    case 'Failed':
      return 'error';
    case 'Canceled':
      return 'error';
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
