import type {
  ChatsApi,
  ContactsApi,
  GroupsApi,
  InstanceApi,
  MessagesApi,
  WaAdapter,
  WebhookInput,
} from '../../core/adapter';
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
  CheckExistsResult,
  ConnectResult,
  Contact,
  ContactAbout,
  ContactProfilePicture,
  CreateGroupInput,
  DeleteMessageInput,
  EditMessageInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipant,
  GroupParticipantsInput,
  InstanceState,
  InstanceStatus,
  JoinGroupInviteInput,
  MarkMessageReadInput,
  MediaKind,
  MediaRef,
  MessageAck,
  PinMessageInput,
  SendContactCardInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  StarMessageInput,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
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
  'messages.sendReaction',
  'messages.edit',
  'messages.delete',
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
  'contacts.listBlocked',
  'chats.archive',
  'chats.unarchive',
  'chats.mute',
  'chats.unmute',
  'chats.pin',
  'chats.unpin',
  'chats.markRead',
  'chats.markUnread',
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
    sendReaction: (input) => sendReaction(http, sid, input),
    edit: (input) => editMessage(http, sid, input),
    delete: (input) => deleteMessage(http, sid, input),
    star: (input) => setMessageStarred(http, sid, input, true),
    unstar: (input) => setMessageStarred(http, sid, input, false),
    pin: (input) => setMessagePinned(http, sid, input, true),
    unpin: (input) => setMessagePinned(http, sid, input, false),
    markRead: (input) => markMessageRead(http, sid, input),
    sendLocation: (input) => sendLocation(http, sid, input),
    sendContactCard: (input) => sendContactCard(http, sid, input),
    sendPoll: (input) => sendPoll(http, sid, input),
    // `messages.forward` NÃO implementado: POST .../messages/forward só aceita {to, text} — o
    // izapia não guarda histórico (stateless por design, ver docs/providers/izapia.md), então não
    // há como resolver o texto original a partir de só `messageId`/`fromChatId` (ForwardMessageInput
    // do contrato canônico não carrega o texto). Limitação real do provider, não gap de pesquisa.
  };

  const groups: GroupsApi = {
    create: (input) => createGroup(http, sid, input),
    getInfo: (groupId) => getGroupInfo(http, sid, groupId),
    list: () => listGroups(http, sid),
    addParticipants: (input) => updateGroupParticipants(http, sid, input, 'add'),
    removeParticipants: (input) => updateGroupParticipants(http, sid, input, 'remove'),
    promoteParticipants: (input) => updateGroupParticipants(http, sid, input, 'promote'),
    demoteParticipants: (input) => updateGroupParticipants(http, sid, input, 'demote'),
    updateSubject: (input) => updateGroupSubject(http, sid, input),
    updateDescription: (input) => updateGroupDescription(http, sid, input),
    updatePicture: (input) => updateGroupPicture(http, sid, input),
    getInviteLink: (groupId) => getGroupInviteLink(http, sid, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, sid, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, sid, input),
    leaveGroup: (groupId) => leaveGroup(http, sid, groupId),
  };

  const contacts: ContactsApi = {
    list: () => listContacts(http, sid),
    get: (chatId) => getContact(http, sid, chatId),
    checkExists: (phone) => checkContactExists(http, sid, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, sid, chatId),
    getAbout: (chatId) => getContactAbout(http, sid, chatId),
    block: (chatId) => setContactBlocked(http, sid, chatId, true),
    unblock: (chatId) => setContactBlocked(http, sid, chatId, false),
    listBlocked: () => listBlockedContacts(http, sid),
  };

  const chats: ChatsApi = {
    archive: (chatId) => setChatArchived(http, sid, chatId, true),
    unarchive: (chatId) => setChatArchived(http, sid, chatId, false),
    mute: (chatId) => setChatMuted(http, sid, chatId, true),
    unmute: (chatId) => setChatMuted(http, sid, chatId, false),
    pin: (chatId) => setChatPinned(http, sid, chatId, true),
    unpin: (chatId) => setChatPinned(http, sid, chatId, false),
    markRead: (chatId) => setChatRead(http, sid, chatId, true),
    markUnread: (chatId) => setChatRead(http, sid, chatId, false),
  };

  return {
    provider: PROVIDER,
    capabilities: IZAPIA_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
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

/**
 * `POST .../messages/react`: body `{to, message_id, reaction?, sender?}` — `reaction` vazia/ausente
 * remove a reação anterior (já bate com a convenção canônica de `SendReactionInput.emoji`, sem
 * tradução — ver docs/providers/izapia.md). `sender` (autor original, para reagir em grupo a
 * mensagem de outro participante) não é exposto por `SendReactionInput` — não enviado.
 */
async function sendReaction(
  http: HttpClient,
  sid: string,
  input: SendReactionInput,
): Promise<SentMessage> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/react`,
    body: { to: input.to, message_id: input.messageId, reaction: input.emoji },
  });
  return mapSentMessage(body, input.to);
}

async function editMessage(
  http: HttpClient,
  sid: string,
  input: EditMessageInput,
): Promise<SentMessage> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/edit`,
    body: { to: input.to, message_id: input.messageId, text: input.text },
  });
  return mapSentMessage(body, input.to);
}

async function deleteMessage(
  http: HttpClient,
  sid: string,
  input: DeleteMessageInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/delete`,
    body: { to: input.to, message_id: input.messageId },
  });
}

/**
 * `POST .../messages/star`: body `{to, message_id, starred?, sender?, from_me?}` — toggle via
 * app-state, devolve só confirmação (`Promise<void>`). `sender`/`from_me` não são expostos por
 * `StarMessageInput` — não enviados (mesma limitação documentada para `pin`/`unpin` abaixo).
 */
async function setMessageStarred(
  http: HttpClient,
  sid: string,
  input: StarMessageInput,
  starred: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/star`,
    body: { to: input.to, message_id: input.messageId, starred },
  });
}

/**
 * `POST .../messages/pin`: body `{to, message_id, pinned?, sender?, from_me?}` — é send-type
 * (gera uma mensagem de controle real, devolve `message_id`), mas o contrato canônico
 * `MessagesApi.pin`/`unpin` retorna `Promise<void>` (mesmo padrão dos demais adapters: a resposta
 * é ignorada). `sender`/`from_me` não expostos por `PinMessageInput` — não enviados.
 */
async function setMessagePinned(
  http: HttpClient,
  sid: string,
  input: PinMessageInput,
  pinned: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/pin`,
    body: { to: input.to, message_id: input.messageId, pinned },
  });
}

/**
 * `POST .../messages/read`: body `{to, message_ids: string[], sender?}` — nível de MENSAGEM
 * (distinto de `chats.markRead`, nível de conversa). `MarkMessageReadInput` só carrega um
 * `messageId` por vez; este adapter sempre envia um array com 1 elemento.
 */
async function markMessageRead(
  http: HttpClient,
  sid: string,
  input: MarkMessageReadInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/read`,
    body: { to: input.to, message_ids: [input.messageId] },
  });
}

async function sendLocation(
  http: HttpClient,
  sid: string,
  input: SendLocationInput,
): Promise<SentMessage> {
  const requestBody: Record<string, unknown> = {
    to: input.to,
    latitude: input.latitude,
    longitude: input.longitude,
  };
  if (input.name) requestBody.name = input.name;
  if (input.address) requestBody.address = input.address;
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/location`,
    body: requestBody,
  });
  return mapSentMessage(body, input.to);
}

/**
 * `POST .../messages/contact`: body `{to, display_name, phone?, vcard?}` — aceita campos soltos
 * (`display_name`/`phone`), sem precisar montar um vCard client-side (diferente de Wuzapi/Z-API).
 * `SendContactCardInput.contactName`/`contactPhone` mapeiam direto para `display_name`/`phone`.
 */
async function sendContactCard(
  http: HttpClient,
  sid: string,
  input: SendContactCardInput,
): Promise<SentMessage> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/contact`,
    body: { to: input.to, display_name: input.contactName, phone: input.contactPhone },
  });
  return mapSentMessage(body, input.to);
}

/**
 * `POST .../messages/poll`: body `{to, name, options: string[], selectable_count?}` —
 * `selectable_count` omitido (escolha única, default do provider) quando `allowMultipleAnswers`
 * for falso/ausente; `options.length` (qualquer número de opções) quando verdadeiro.
 */
async function sendPoll(http: HttpClient, sid: string, input: SendPollInput): Promise<SentMessage> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/messages/poll`,
    body: {
      to: input.to,
      name: input.question,
      options: input.options,
      ...(input.allowMultipleAnswers ? { selectable_count: input.options.length } : {}),
    },
  });
  return mapSentMessage(body, input.to);
}

// ---------------------------------------------------------------------------
// groups.*
// ---------------------------------------------------------------------------

/**
 * Modelo canônico de grupo confirmado em `internal/session/groups.go` (`groupToCanonical`):
 * `{group_id, subject, description, owner, created, participants: [{jid, is_admin,
 * is_super_admin}]}`. `group_id` é sempre o JID (`<dígitos>@g.us`) — `GroupInfo.id` fica opaco
 * mesmo assim (não passa por `normalizeChatId`, ver ADR-0009).
 */
function mapGroupInfo(body: unknown): GroupInfo {
  const data = unwrapEnvelope(body);
  const participantsRaw = data.participants;
  const participants = Array.isArray(participantsRaw) ? participantsRaw.map(mapParticipant) : [];
  return {
    id: asString(data.group_id) ?? '',
    subject: asString(data.subject) ?? '',
    description: asString(data.description),
    owner: asString(data.owner),
    participants,
    raw: body,
  };
}

function mapParticipant(value: unknown): GroupParticipant {
  const record = asRecord(value);
  return {
    id: (record ? asString(record.jid) : undefined) ?? 'unknown',
    isAdmin: (record ? asBoolean(record.is_admin) : undefined) ?? false,
    isSuperAdmin: (record ? asBoolean(record.is_super_admin) : undefined) ?? false,
  };
}

async function createGroup(
  http: HttpClient,
  sid: string,
  input: CreateGroupInput,
): Promise<GroupInfo> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups`,
    body: { subject: input.subject, participants: input.participants },
  });
  return mapGroupInfo(body);
}

async function getGroupInfo(http: HttpClient, sid: string, groupId: string): Promise<GroupInfo> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/groups/${groupId}`,
  });
  return mapGroupInfo(body);
}

/**
 * `GET .../groups`: `data` do envelope é um ARRAY direto de grupos (`ListGroups` do provider
 * devolve `[]map[string]any`, sem wrapper `{groups: [...]}` — confirmado em
 * `internal/session/groups.go`), diferente de outros providers deste pacote.
 */
async function listGroups(http: HttpClient, sid: string): Promise<GroupInfo[]> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/groups`,
  });
  const record = asRecord(body);
  const groups = record && Array.isArray(record.data) ? record.data : [];
  return groups.map((group: unknown) => mapGroupInfo({ ok: true, data: group }));
}

/**
 * `addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` são, no izapia,
 * o MESMO endpoint (`POST .../groups/{groupId}/participants`), discriminado pelo campo `action`
 * (ver docs/providers/izapia.md). Resposta traz o resultado por-participante — ignorada, o
 * contrato exige apenas `Promise<void>`.
 */
async function updateGroupParticipants(
  http: HttpClient,
  sid: string,
  input: GroupParticipantsInput,
  action: 'add' | 'remove' | 'promote' | 'demote',
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/participants`,
    body: { action, participants: input.participants },
  });
}

async function updateGroupSubject(
  http: HttpClient,
  sid: string,
  input: UpdateGroupSubjectInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/subject`,
    body: { subject: input.subject },
  });
}

/** `description` vazia é permitida e limpa a descrição do grupo (ver docs/providers/izapia.md). */
async function updateGroupDescription(
  http: HttpClient,
  sid: string,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/description`,
    body: { description: input.description },
  });
}

/** `MediaRef` já garantida com `kind === 'image'` pelo conector — mesma regra de `sendMedia`. */
function toIzapiaImageBody(media: MediaRef): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {};
  if (media.url) requestBody.url = media.url;
  else requestBody.base64 = media.base64;
  if (media.mimeType) requestBody.mimetype = media.mimeType;
  return requestBody;
}

async function updateGroupPicture(
  http: HttpClient,
  sid: string,
  input: UpdateGroupPictureInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/picture`,
    body: toIzapiaImageBody(input.media),
  });
}

async function getGroupInviteLink(
  http: HttpClient,
  sid: string,
  groupId: string,
): Promise<GroupInviteLink> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/groups/${groupId}/invite`,
  });
  const data = unwrapEnvelope(body);
  return { link: asString(data.invite_link) ?? '', raw: body };
}

async function revokeGroupInviteLink(
  http: HttpClient,
  sid: string,
  groupId: string,
): Promise<GroupInviteLink> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/${groupId}/invite/revoke`,
  });
  const data = unwrapEnvelope(body);
  return { link: asString(data.invite_link) ?? '', raw: body };
}

/**
 * `input.link` já chega normalizado pelo conector como o link completo
 * (`https://chat.whatsapp.com/<código>`) — o izapia aceita esse campo como `link` (não extrai só o
 * código, diferente de outros providers). Ver docs/providers/izapia.md.
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  sid: string,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/join`,
    body: { link: input.invite },
  });
}

async function leaveGroup(http: HttpClient, sid: string, groupId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/groups/${groupId}/leave`,
  });
}

// ---------------------------------------------------------------------------
// contacts.*
// ---------------------------------------------------------------------------

/**
 * Modelo canônico confirmado em `internal/session/contacts.go` (`contactToCanonical`): `{jid,
 * first_name, full_name, push_name, business_name, found}`. `name` usa `full_name` (fallback
 * `push_name`, fallback `first_name`) — nenhum dos três é garantido presente.
 */
function mapContact(body: unknown): Contact {
  const data = unwrapEnvelope(body);
  return {
    id: asString(data.jid) ?? '',
    name: asString(data.full_name) ?? asString(data.push_name) ?? asString(data.first_name),
    about: asString(data.about),
    raw: body,
  };
}

/** `GET .../contacts`: `data` é um array direto (mesmo padrão de `GET .../groups`). */
async function listContacts(http: HttpClient, sid: string): Promise<Contact[]> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/contacts`,
  });
  const record = asRecord(body);
  const contacts = record && Array.isArray(record.data) ? record.data : [];
  return contacts.map((contact: unknown) => mapContact({ ok: true, data: contact }));
}

/**
 * `GET .../contacts/{jid}`: resposta já enriquecida com `about`/`devices` (`GetContact`,
 * confirmado no dossiê) — usada também por `contacts.getAbout`, sem chamada extra (regra de ouro:
 * uma única chamada HTTP por operação canônica).
 */
async function getContact(http: HttpClient, sid: string, chatId: string): Promise<Contact> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/contacts/${chatId}`,
  });
  return mapContact(body);
}

async function getContactAbout(
  http: HttpClient,
  sid: string,
  chatId: string,
): Promise<ContactAbout> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/contacts/${chatId}`,
  });
  const data = unwrapEnvelope(body);
  return { about: asString(data.about), raw: body };
}

/**
 * `POST .../contacts/check`: body `{numbers: [phone]}` (array de 1 elemento, já que o contrato
 * canônico verifica um telefone por vez) → array `{query, jid, is_in_whatsapp, verified_name?}`;
 * só o primeiro (único) item é usado.
 */
async function checkContactExists(
  http: HttpClient,
  sid: string,
  phone: string,
): Promise<CheckExistsResult> {
  const body = await http.request<unknown>({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/contacts/check`,
    body: { numbers: [phone] },
  });
  const record = asRecord(body);
  const list = record && Array.isArray(record.data) ? record.data : [];
  const first = asRecord(list[0]);
  return {
    exists: (first ? asBoolean(first.is_in_whatsapp) : undefined) ?? false,
    chatId: first ? asString(first.jid) : undefined,
    raw: body,
  };
}

async function getContactProfilePicture(
  http: HttpClient,
  sid: string,
  chatId: string,
): Promise<ContactProfilePicture> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/contacts/${chatId}/picture`,
  });
  const data = unwrapEnvelope(body);
  return { url: asString(data.url), raw: body };
}

async function setContactBlocked(
  http: HttpClient,
  sid: string,
  chatId: string,
  block: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/contacts/${chatId}/${block ? 'block' : 'unblock'}`,
  });
}

/** `GET .../contacts/blocked`: `data` é um array direto de `{jid}` (mesmo padrão de listagens). */
async function listBlockedContacts(http: HttpClient, sid: string): Promise<string[]> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: `/api/v1/sessions/${sid}/contacts/blocked`,
  });
  const record = asRecord(body);
  const list = record && Array.isArray(record.data) ? record.data : [];
  return list
    .map((item: unknown) => asString(asRecord(item)?.jid))
    .filter((id): id is string => id !== undefined);
}

// ---------------------------------------------------------------------------
// chats.* (todas as 8 operações são toggles via app-state, Promise<void>)
// ---------------------------------------------------------------------------

async function setChatArchived(
  http: HttpClient,
  sid: string,
  chatId: string,
  archived: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/chats/${chatId}/archive`,
    body: { archived },
  });
}

async function setChatMuted(
  http: HttpClient,
  sid: string,
  chatId: string,
  muted: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/chats/${chatId}/mute`,
    body: { muted },
  });
}

async function setChatPinned(
  http: HttpClient,
  sid: string,
  chatId: string,
  pinned: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/chats/${chatId}/pin`,
    body: { pinned },
  });
}

/** `read: false` marca como NÃO lido — reintroduz o indicador visual (ver docs/providers/izapia.md). */
async function setChatRead(
  http: HttpClient,
  sid: string,
  chatId: string,
  read: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `/api/v1/sessions/${sid}/chats/${chatId}/read`,
    body: { read },
  });
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
