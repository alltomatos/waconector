import type {
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
import { digitsOnly, isJid, normalizeInviteLink } from '../../core/chat-id';
import { WaConnectorError } from '../../core/errors';
import type { CanonicalEvent, ConnectionUpdateEvent, UnknownEvent } from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  CheckExistsResult,
  ConnectResult,
  Contact,
  ContactProfilePicture,
  CreateGroupInput,
  CreateLabelInput,
  DeleteMessageInput,
  EditMessageInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipant,
  GroupParticipantsInput,
  InstanceState,
  InstanceStatus,
  JoinGroupInviteInput,
  LabelChatInput,
  LabelInfo,
  MarkMessageReadInput,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  PinMessageInput,
  PresenceState,
  SendContactCardInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  SetTypingInput,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
  UpdateLabelInput,
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
  'messages.edit',
  'messages.delete',
  'messages.pin',
  'messages.unpin',
  'messages.markRead',
  'messages.sendLocation',
  'messages.sendContactCard',
  'messages.sendPoll',
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
  'contacts.block',
  'contacts.unblock',
  'contacts.listBlocked',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.addToChat',
  'labels.removeFromChat',
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
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    pin: (input) => setMessagePinned(http, input, true),
    unpin: (input) => setMessagePinned(http, input, false),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, input),
    sendContactCard: (input) => sendContactCard(http, input),
    sendPoll: (input) => sendPoll(http, input),
  };

  const chats: ChatsApi = {
    archive: (chatId) => archiveChat(http, chatId),
    unarchive: (chatId) => unarchiveChat(http, chatId),
    mute: (chatId) => muteChat(http, chatId),
    unmute: (chatId) => unmuteChat(http, chatId),
    pin: (chatId) => pinChat(http, chatId),
    unpin: (chatId) => unpinChat(http, chatId),
    markRead: (chatId) => markChatRead(http, chatId),
    markUnread: (chatId) => markChatUnread(http, chatId),
  };

  const presence: PresenceApi = {
    setTyping: (input) => setTyping(http, input),
    set: (state) => setPresence(http, state),
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
    getInviteLink: (groupId) => getGroupInviteLink(http, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroup(http, groupId),
  };

  const contacts: ContactsApi = {
    list: () => listContacts(http),
    get: (chatId) => getContact(http, chatId),
    checkExists: (phone) => checkContactExists(http, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, chatId),
    block: (chatId) => blockContact(http, chatId),
    unblock: (chatId) => unblockContact(http, chatId),
    listBlocked: () => listBlockedContacts(http),
    // `getAbout` deliberadamente NÃO implementado nem declarado em capabilities: busca exaustiva
    // nas ~132 rotas do OpenAPI bundled não achou nenhum campo/endpoint para o recado pessoal de
    // um contato na uazapi. Ver docs/providers/uazapi.md#contatos.
  };

  const labels: LabelsApi = {
    list: () => listLabels(http),
    create: (input) => createLabel(http, input),
    update: (input) => updateLabel(http, input),
    delete: (labelId) => deleteLabel(http, labelId),
    addToChat: (input) => setChatLabel(http, input, 'add'),
    removeFromChat: (input) => setChatLabel(http, input, 'remove'),
  };

  return {
    provider: PROVIDER,
    capabilities: UAZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
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

/**
 * `POST /message/edit`: body `{ id, text }`, ambos obrigatórios — **sem** `number`/`to`: o `id` já
 * identifica a mensagem (e seu chat/dono) sozinho, então `input.to` não é enviado no request (só é
 * usado como fallback de `chatId` no mapeamento da resposta, mesmo padrão de `mapSentMessage`).
 * Resposta 200 documentada segue o schema `Message` completo (`id` no formato `owner:messageid`,
 * `messageid`, `content`, `messageTimestamp`, `messageType: "text"`, `status: "Pending"`, `owner`) —
 * reaproveita `mapSentMessage` (mesmo shape genérico dos demais endpoints de `/message/*` já usado
 * por `sendReaction`), sem campo `chatid` explícito, daí o fallback para `input.to`.
 *
 * **Limitações documentadas pelo próprio endpoint** (não impostas pelo adapter): só é possível
 * editar mensagens enviadas pela própria instância; "a mensagem deve estar dentro do prazo
 * permitido pelo WhatsApp para edição" — a doc não especifica o valor exato desse prazo (o
 * WhatsApp real aplica ~15min no app oficial, mas isso não está no spec da uazapi, então não é
 * validado localmente por este adapter). Gera um **novo ID** para a mensagem editada — refletido
 * no `id` devolvido por `mapSentMessage`, que pode diferir de `input.messageId`. Ver
 * docs/providers/uazapi.md#edição-e-exclusão-de-mensagem.
 */
async function editMessage(http: HttpClient, input: EditMessageInput): Promise<SentMessage> {
  const body = { id: input.messageId, text: input.text };
  const response = await http.request<unknown>({ method: 'POST', path: '/message/edit', body });
  return mapSentMessage(response, toUazapiNumber(input.to));
}

/**
 * `POST /message/delete`: body `{ id }`, único campo, obrigatório — igual a `editMessage`, **sem**
 * `number`/`to` (`input.to` não é enviado no request; existe em `DeleteMessageInput` só para
 * simetria com o restante de `messages.*` e por eventual uso futuro). A doc descreve o endpoint
 * como "apaga uma mensagem **para todos** os participantes da conversa" — é sempre revogação
 * ("delete for everyone"), nunca um soft-delete local (compatível com a decisão de
 * `DeleteMessageInput` do ADR-0012, sem campo de escopo). Resposta 200 (`{ timestamp, id }`) é
 * ignorada: o contrato exige apenas `Promise<void>`. Sem janela de tempo documentada para o limite
 * de exclusão (diferente de `sendReaction`, que documenta um limite de 7 dias). Ver
 * docs/providers/uazapi.md#edição-e-exclusão-de-mensagem.
 */
async function deleteMessage(http: HttpClient, input: DeleteMessageInput): Promise<void> {
  await http.request({ method: 'POST', path: '/message/delete', body: { id: input.messageId } });
}

/**
 * `POST /message/pin` (ADR-0013, confiança Alta): body `{id, pin?: boolean (default true),
 * duration?: integer (default 30)}`. **Nuance documentada explicitamente**: `duration` só aceita
 * `1`, `7` ou `30` (dias) — qualquer outro valor cai silenciosamente para 30
 * (`pinMessageFallback30Days`, exemplo dedicado no spec com `duration: 99` → 30). `PinMessageInput`
 * do contrato canônico não expõe duração (ADR-0013 — nenhum formato converge entre providers);
 * este adapter usa o **default do próprio provider** (omite `duration`, que já vale 30). Em
 * grupos, a permissão depende da config do WhatsApp do grupo — "o backend não valida localmente
 * se a instância é admin; a decisão final é do WhatsApp". Resposta rica (`messageType:
 * "PinInChatMessage"`, `pinned: boolean`) — ignorada, contrato retorna `Promise<void>`.
 */
async function setMessagePinned(
  http: HttpClient,
  input: PinMessageInput,
  pin: boolean,
): Promise<void> {
  await http.request({ method: 'POST', path: '/message/pin', body: { id: input.messageId, pin } });
}

/**
 * `POST /message/markread` (ADR-0013, nível de MENSAGEM, confiança Alta): body `{id: string[]}` —
 * lista de IDs, marca várias mensagens de uma vez; este adapter sempre envia um array com 1
 * elemento. Resposta `{results: [{message_id, status, error?}]}` (por item, não all-or-nothing) —
 * ignorada, contrato retorna `Promise<void>`. Distinto de `chats.markRead` (`/chat/read`, nível de
 * conversa, ADR-0012).
 */
async function markMessageRead(http: HttpClient, input: MarkMessageReadInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/message/markread',
    body: { id: [input.messageId] },
  });
}

/**
 * `POST /send/location` (ADR-0014, confiança Alta): body mínimo `{number, latitude, longitude}`
 * (obrigatórios); `name`/`address` opcionais para um pin nomeado. Campos comuns de envio
 * (`replyid`/`mentions`/`delay`/`forward`/`track_source`/`track_id`/`async`) já são ignorados
 * deliberadamente hoje por `sendText`/`sendMedia` — mesmo critério aplicado aqui.
 */
async function sendLocation(http: HttpClient, input: SendLocationInput): Promise<SentMessage> {
  const number = toUazapiNumber(input.to);
  const body: Record<string, unknown> = {
    number,
    latitude: input.latitude,
    longitude: input.longitude,
  };
  if (input.name) body.name = input.name;
  if (input.address) body.address = input.address;
  const response = await http.request<unknown>({ method: 'POST', path: '/send/location', body });
  return mapSentMessage(response, number);
}

/**
 * `POST /send/contact` (ADR-0014, confiança Alta): body mínimo `{number, fullName, phoneNumber}`
 * (obrigatórios) — campos soltos, o provider monta um vCard completo clicável no servidor.
 * `phoneNumber` aceita múltiplos números separados por vírgula segundo a doc, mas
 * `SendContactCardInput` só modela um contato/telefone — este adapter sempre envia um único
 * valor. `organization`/`email`/`url` (opcionais no schema) não têm de onde vir no contrato
 * canônico e são omitidos.
 */
async function sendContactCard(
  http: HttpClient,
  input: SendContactCardInput,
): Promise<SentMessage> {
  const number = toUazapiNumber(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/send/contact',
    body: { number, fullName: input.contactName, phoneNumber: input.contactPhone },
  });
  return mapSentMessage(response, number);
}

/**
 * `POST /send/menu` (ADR-0014, confiança Alta): interface UNIFICADA para botões/lista/enquete/
 * carrossel, discriminada por `type`. Para enquete: `{number, type: "poll", text, choices:
 * string[], selectableCount?}` — `question`/`options` mapeiam direto para `text`/`choices`;
 * `selectableCount` só se aplica a enquetes (permite múltipla escolha) — `1` (escolha única, valor
 * explícito para não depender de um default não documentado) quando `allowMultipleAnswers` é
 * falso/ausente, `options.length` (qualquer número de opções) quando verdadeiro.
 */
async function sendPoll(http: HttpClient, input: SendPollInput): Promise<SentMessage> {
  const number = toUazapiNumber(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/send/menu',
    body: {
      number,
      type: 'poll',
      text: input.question,
      choices: input.options,
      selectableCount: input.allowMultipleAnswers ? input.options.length : 1,
    },
  });
  return mapSentMessage(response, number);
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
 * `POST /group/info`: body `{ groupjid }` (mais `extra`, ver `requestGroupInfo`). Resposta = schema
 * `Group` verbatim na doc: `{ JID, Name, Topic (descrição), OwnerJID`/`OwnerPN (dono), GroupCreated,
 * Participants: [{ JID, IsAdmin, IsSuperAdmin }] }`.
 */
async function getGroupInfo(http: HttpClient, groupId: string): Promise<GroupInfo> {
  const response = await requestGroupInfo(http, groupId);
  return mapGroupInfo(response, { id: groupId });
}

/**
 * `POST /group/info` cru, reaproveitado por `getGroupInfo` (sem `extra`) e por `getGroupInviteLink`
 * (com `{ getInviteLink: true }`) — não há rota dedicada para obter o link de convite: o campo
 * `invite_link` do schema `Group` só é populado quando esse flag é passado no body. Ver
 * docs/providers/uazapi.md#grupos-convite-e-saída.
 */
async function requestGroupInfo(
  http: HttpClient,
  groupId: string,
  extra?: Record<string, unknown>,
): Promise<unknown> {
  const groupjid = toUazapiGroupJid(groupId);
  return http.request<unknown>({
    method: 'POST',
    path: '/group/info',
    body: { groupjid, ...extra },
  });
}

/**
 * `POST /group/info` com `{ groupjid, getInviteLink: true }` — o link vem em `invite_link`
 * (snake_case, já COMPLETO segundo a doc). `normalizeInviteLink` é aplicada mesmo assim (idempotente
 * quando o valor já é um link completo) como defesa contra o provider devolver só o código bare,
 * mesmo padrão de outros adapters que só devolvem o código. Ver
 * docs/providers/uazapi.md#grupos-convite-e-saída.
 */
async function getGroupInviteLink(http: HttpClient, groupId: string): Promise<GroupInviteLink> {
  const response = await requestGroupInfo(http, groupId, { getInviteLink: true });
  const record = asRecord(response);
  const link = (record ? asString(record.invite_link) : undefined) ?? '';
  return { link: normalizeInviteLink(link), raw: response };
}

/**
 * `POST /group/resetInviteCode`: body `{ groupjid }`. Resposta: `{ InviteLink, group,
 * needs_refresh }` — atenção ao campo `InviteLink` em PascalCase, diferente de `invite_link`
 * (snake_case) devolvido por `POST /group/info`/`getGroupInviteLink` acima. Já é o NOVO link
 * completo (o código antigo é invalidado). Ver docs/providers/uazapi.md#grupos-convite-e-saída.
 */
async function revokeGroupInviteLink(http: HttpClient, groupId: string): Promise<GroupInviteLink> {
  const groupjid = toUazapiGroupJid(groupId);
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/group/resetInviteCode',
    body: { groupjid },
  });
  const record = asRecord(response);
  const link = (record ? asString(record.InviteLink) : undefined) ?? '';
  return { link: normalizeInviteLink(link), raw: response };
}

/**
 * `POST /group/join`: body `{ invitecode }` (10-50 caracteres) — o provider aceita tanto o código
 * curto quanto a URL completa nesse mesmo campo, então `input.invite` (já normalizado pelo conector
 * para o link completo — ver `WaConnector.prepareJoinViaInviteLink`) é repassado direto, sem
 * `extractInviteCode`. Resposta (`{ response: "Group join successful", group, needs_refresh }`)
 * ignorada: o contrato exige apenas `Promise<void>`. Ver docs/providers/uazapi.md#grupos-convite-e-saída.
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/join',
    body: { invitecode: input.invite },
  });
}

/**
 * `POST /group/leave`: body `{ groupjid }` (padrão documentado `^\d+@g\.us$`, mesmo formato de
 * `GroupInfo.id`/`toUazapiGroupJid`). Resposta (`{ response: "Group leave successful" }`) ignorada:
 * o contrato exige apenas `Promise<void>`. Ver docs/providers/uazapi.md#grupos-convite-e-saída.
 */
async function leaveGroup(http: HttpClient, groupId: string): Promise<void> {
  const groupjid = toUazapiGroupJid(groupId);
  await http.request({ method: 'POST', path: '/group/leave', body: { groupjid } });
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
// contacts.*
// ---------------------------------------------------------------------------

/**
 * `GET /contacts`: lista completa, sem paginação — usado em vez do `POST /contacts/list`
 * paginado, já que o contrato canônico `ContactsApi.list()` não recebe parâmetros (sem cursor para
 * repassar). Query `contactScope: 'all'` é enviada explicitamente (o default do provider é
 * `address_book`, que cobriria só os contatos salvos na agenda) para bater melhor com a semântica
 * de "conhecidos" que `list()` sugere — inclui também contatos "fora da agenda" com quem a
 * instância já trocou mensagem. Resposta: array de `{ jid, contact_name, contact_FirstName }`. Ver
 * docs/providers/uazapi.md#contatos.
 */
async function listContacts(http: HttpClient): Promise<Contact[]> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: '/contacts',
    query: { contactScope: 'all' },
  });
  if (!Array.isArray(response)) return [];
  return response.map(mapContactListItem);
}

function mapContactListItem(value: unknown): Contact {
  const record = asRecord(value);
  const id = (record ? asString(record.jid) : undefined) ?? '';
  const name = record
    ? (asString(record.contact_name) ?? asString(record.contact_FirstName))
    : undefined;
  return { id, name, raw: value };
}

/**
 * `contacts.get` e `contacts.getProfilePicture` reaproveitam o MESMO endpoint
 * (`POST /chat/details`, body `{ number, preview: false }`) — regra de ouro do ADR-0010: nunca
 * compor múltiplas chamadas HTTP atrás de uma única operação canônica. `preview: false` pede o
 * campo `image` (foto completa) em vez de `imagePreview` (miniatura). `number` recebe o chatId
 * canônico via `toUazapiNumber` (identidade), a mesma função usada para o `to` de mensagens — o
 * chatId de contato NÃO é opaco (ver ADR-0010), diferente de `groupId`.
 */
async function requestChatDetails(http: HttpClient, chatId: string): Promise<unknown> {
  const number = toUazapiNumber(chatId);
  return http.request<unknown>({
    method: 'POST',
    path: '/chat/details',
    body: { number, preview: false },
  });
}

/**
 * Resposta = schema `Chat`: `{ name, phone, wa_chatid, wa_name, wa_contactName, wa_isBlocked,
 * image, imagePreview, ... }`. Mapeamento: `wa_contactName` (fallback `wa_name`, fallback `name`)
 * -> `name`; `wa_isBlocked` -> `isBlocked`; `image` -> `profilePictureUrl` (o endpoint já devolve
 * isso de graça, então preenchido aqui mesmo sem uma segunda chamada — ver `Contact.profilePictureUrl`
 * em `src/core/types.ts`). SEM `about`: a uazapi não expõe esse campo em endpoint nenhum — capability
 * `contacts.getAbout` deliberadamente não declarada nem implementada (ver
 * docs/providers/uazapi.md#contactsgetabout--não-suportado-pela-uazapi). `id` recebe `wa_chatid`
 * quando presente, com fallback para o chatId requisitado (mesmo padrão de
 * `mapSentMessage`/`chatId ?? requestedNumber`).
 */
function mapContactFromChatDetails(body: unknown, requestedChatId: string): Contact {
  const record = asRecord(body);
  const id = (record ? asString(record.wa_chatid) : undefined) ?? requestedChatId;
  const name = record
    ? (asString(record.wa_contactName) ?? asString(record.wa_name) ?? asString(record.name))
    : undefined;
  const isBlocked = record ? asBoolean(record.wa_isBlocked) : undefined;
  const profilePictureUrl = record ? asString(record.image) : undefined;
  return { id, name, isBlocked, profilePictureUrl, raw: body };
}

async function getContact(http: HttpClient, chatId: string): Promise<Contact> {
  const response = await requestChatDetails(http, chatId);
  return mapContactFromChatDetails(response, chatId);
}

async function getContactProfilePicture(
  http: HttpClient,
  chatId: string,
): Promise<ContactProfilePicture> {
  const response = await requestChatDetails(http, chatId);
  const record = asRecord(response);
  return { url: record ? asString(record.image) : undefined, raw: response };
}

/**
 * `POST /chat/check`: body `{ numbers: [phone] }` — array de um único elemento, já que o contrato
 * canônico `checkExists(phone)` verifica um telefone por vez. Resposta: array de `{ query, jid,
 * lid, isInWhatsapp, verifiedName?, groupName?, error? }`, um item por número consultado; só o
 * primeiro (único, nesta chamada) é usado. Mapeamento: `isInWhatsapp` -> `exists` (fallback
 * `false` quando ausente/resposta vazia, nunca lança); `jid` -> `chatId` (ausente quando o
 * provider não resolve um JID para números que não têm WhatsApp). Ver docs/providers/uazapi.md#contatos.
 */
async function checkContactExists(http: HttpClient, phone: string): Promise<CheckExistsResult> {
  const number = toUazapiNumber(phone);
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/chat/check',
    body: { numbers: [number] },
  });
  return mapCheckExistsResult(response);
}

function mapCheckExistsResult(body: unknown): CheckExistsResult {
  const first = Array.isArray(body) ? asRecord(body[0]) : undefined;
  const exists = (first ? asBoolean(first.isInWhatsapp) : undefined) ?? false;
  const chatId = first ? asString(first.jid) : undefined;
  return { exists, chatId, raw: body };
}

/**
 * `contacts.block`/`contacts.unblock` usam o MESMO endpoint (`POST /chat/block`), discriminado
 * pelo campo `block: boolean` — mesmo padrão de "um endpoint, vários verbos canônicos" já usado
 * por `updateGroupParticipants` (`action`). `number` recebe o chatId canônico via `toUazapiNumber`
 * (identidade), a mesma função usada pelo restante de `contacts.*`/`messages.*` — chatId de
 * contato NÃO é opaco (ver ADR-0010). Resposta (`{ response, blockList }`, lista atualizada de
 * bloqueados) é ignorada: o contrato exige apenas `Promise<void>`. Ver
 * docs/providers/uazapi.md#contatos.
 */
async function setContactBlocked(http: HttpClient, chatId: string, block: boolean): Promise<void> {
  const number = toUazapiNumber(chatId);
  await http.request({ method: 'POST', path: '/chat/block', body: { number, block } });
}

async function blockContact(http: HttpClient, chatId: string): Promise<void> {
  await setContactBlocked(http, chatId, true);
}

async function unblockContact(http: HttpClient, chatId: string): Promise<void> {
  await setContactBlocked(http, chatId, false);
}

/**
 * `GET /chat/blocklist`: sem body/params. Resposta: `{ blockList: string[] }` — array de JIDs dos
 * contatos bloqueados, já no mesmo formato canônico de chatId usado em `Contact.id`. Repassado sem
 * transformação (mesmo padrão de identidade de `toUazapiNumber`); entradas que não sejam string são
 * descartadas defensivamente via `asString` (nunca lança), mesmo padrão dos demais mapeamentos deste
 * adapter.
 */
async function listBlockedContacts(http: HttpClient): Promise<string[]> {
  const response = await http.request<unknown>({ method: 'GET', path: '/chat/blocklist' });
  const record = asRecord(response);
  const blockList = record?.blockList;
  if (!Array.isArray(blockList)) return [];
  return blockList.map(asString).filter((id): id is string => id !== undefined);
}

// ---------------------------------------------------------------------------
// chats.*
// ---------------------------------------------------------------------------

/**
 * `POST /chat/archive`: body `{ number, archive: boolean }`, ambos obrigatórios — mesmo padrão de
 * "um endpoint, dois verbos canônicos" já usado por `contacts.block`/`unblock`
 * (`setContactBlocked`). `number` recebe o chatId canônico via `toUazapiNumber` (identidade) — a
 * doc documenta o campo como aceitando telefone E.164 OU ID de grupo, mesmo campo polimórfico já
 * usado por `messages.*`/`contacts.*`. Resposta (`{ response: "Chat updated successfully" }`) é
 * ignorada: o contrato exige apenas `Promise<void>`. Nuance documentada: "não afeta as mensagens ou
 * o conteúdo do chat" — puramente cosmético/organizacional. Ver
 * docs/providers/uazapi.md#chats-gestão-de-estado-da-conversa.
 */
async function setChatArchived(http: HttpClient, chatId: string, archive: boolean): Promise<void> {
  const number = toUazapiNumber(chatId);
  await http.request({ method: 'POST', path: '/chat/archive', body: { number, archive } });
}

async function archiveChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatArchived(http, chatId, true);
}

async function unarchiveChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatArchived(http, chatId, false);
}

/**
 * `POST /chat/mute`: body `{ number, muteEndTime }`, ambos obrigatórios — `muteEndTime` é um ENUM
 * fechado de 4 valores (`0 | 8 | 168 | -1`), não um timestamp Unix arbitrário: `0` remove o
 * silenciamento, `8`/`168` são horas (8h/1 semana), `-1` é permanente. `ChatsApi.mute`/`unmute` do
 * contrato canônico não recebem duração (ver ADR-0012 — nenhum formato de duração converge entre
 * providers) — mapeamento de decisão do adapter, não um default do provider: `mute(chatId)` sempre
 * envia `muteEndTime: -1` (permanente); `unmute(chatId)` sempre envia `muteEndTime: 0` (remove).
 * Consumidores que precisem de um silenciamento por horas/semana só têm essa granularidade via
 * `raw`/chamada direta ao provider, fora do contrato canônico. Ver
 * docs/providers/uazapi.md#chats-gestão-de-estado-da-conversa.
 */
async function setChatMuted(http: HttpClient, chatId: string, muted: boolean): Promise<void> {
  const number = toUazapiNumber(chatId);
  const muteEndTime = muted ? -1 : 0;
  await http.request({ method: 'POST', path: '/chat/mute', body: { number, muteEndTime } });
}

async function muteChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatMuted(http, chatId, true);
}

async function unmuteChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatMuted(http, chatId, false);
}

/**
 * `POST /chat/pin`: body `{ number, pin: boolean }`, ambos obrigatórios. Resposta
 * (`{ response: "Chat pinned" }`) é ignorada: o contrato exige apenas `Promise<void>`. Nuance:
 * distinto de fixar uma MENSAGEM dentro do chat (`messages.pin`, fora de escopo desta fase — ver
 * ADR-0012) — este fixa a CONVERSA inteira no topo da lista (mesmo recurso de "conversas fixadas"
 * do app oficial). Ver docs/providers/uazapi.md#chats-gestão-de-estado-da-conversa.
 */
async function setChatPinned(http: HttpClient, chatId: string, pin: boolean): Promise<void> {
  const number = toUazapiNumber(chatId);
  await http.request({ method: 'POST', path: '/chat/pin', body: { number, pin } });
}

async function pinChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatPinned(http, chatId, true);
}

async function unpinChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatPinned(http, chatId, false);
}

/**
 * `POST /chat/read`: body `{ number, read: boolean }`, ambos obrigatórios — `read: false` marca
 * como **não lido** (reintroduz o indicador visual de pendência, não é um simples "desfazer
 * lido"). Distinto de `messages.markRead` (mensagem-a-mensagem por id, não implementado nesta fase
 * — ver ADR-0012): este marca o chat INTEIRO de uma vez, sem precisar dos IDs das mensagens.
 * Ver docs/providers/uazapi.md#chats-gestão-de-estado-da-conversa.
 */
async function setChatRead(http: HttpClient, chatId: string, read: boolean): Promise<void> {
  const number = toUazapiNumber(chatId);
  await http.request({ method: 'POST', path: '/chat/read', body: { number, read } });
}

async function markChatRead(http: HttpClient, chatId: string): Promise<void> {
  await setChatRead(http, chatId, true);
}

async function markChatUnread(http: HttpClient, chatId: string): Promise<void> {
  await setChatRead(http, chatId, false);
}

// ---------------------------------------------------------------------------
// presence.*
// ---------------------------------------------------------------------------

/**
 * `presence.setTyping` (ADR-0015): `POST /message/presence` — confiança Alta. Body: `{number,
 * presence: "composing"|"recording"|"paused", delay?}` — `TypingState` mapeia 1:1 com o enum do
 * provider, sem tradução. `delay` (ms, máx. 300000) não é exposto por `SetTypingInput` — omitido,
 * o provider reenvia o indicador a cada 10s até seu próprio limite de 5 minutos. **Assíncrono**:
 * é cancelado automaticamente ao enviar uma mensagem real para o mesmo chat (comportamento do
 * provider, não deste adapter).
 */
async function setTyping(http: HttpClient, input: SetTypingInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/message/presence',
    body: { number: toUazapiNumber(input.to), presence: input.state },
  });
}

/**
 * `presence.set` (ADR-0015): `POST /instance/presence` — confiança Alta. Body: `{presence:
 * "available"|"unavailable"}` — presença GLOBAL da conta, distinta da presença por-chat acima.
 * `PresenceState` mapeia `online` -> `available`, `offline` -> `unavailable`. **Efeito colateral
 * documentado**: quando a API é o único dispositivo ativo e a presença é `unavailable`,
 * confirmações de entrega/leitura não são enviadas nem recebidas — o provider também pode reverter
 * para `available` "em algumas situações internas", não controlável por este adapter.
 * **Sem `presence.subscribe`**: nenhum endpoint equivalente confirmado na pesquisa.
 */
async function setPresence(http: HttpClient, state: PresenceState): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/instance/presence',
    body: { presence: state === 'online' ? 'available' : 'unavailable' },
  });
}

// ---------------------------------------------------------------------------
// labels.* (ver ADR-0016)
// ---------------------------------------------------------------------------

/**
 * `GET /labels` — confiança Média (schema `Label` tipado no OpenAPI bundled, mas a doc avisa que a
 * resposta 200 é um array "sem schema tipado" nas versões mais antigas; erro 500 documentado
 * "Failed to fetch labels from database" sugere que a lista serve de um cache local, populado por
 * `POST /labels/refresh` — não usado por este adapter). O schema `Label` tem DOIS campos de id:
 * `id` (UUID interno do banco) e `labelid` (o id de fato usado pelo WhatsApp, o mesmo esperado por
 * `/label/edit` e `/chat/labels`) — `LabelInfo.id` mapeia para `labelid` (não `id`), já que é esse
 * o valor que o chamador precisa para `update`/`delete`/`addToChat`/`removeFromChat`.
 */
async function listLabels(http: HttpClient): Promise<LabelInfo[]> {
  const body = await http.request<unknown>({ method: 'GET', path: '/labels' });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapUazapiLabel(item));
}

/**
 * `POST /label/edit` é o ÚNICO endpoint de escrita de label (criar/editar/deletar, discriminado
 * por convenção de valor — sem campo `action` dedicado). Body: `{labelid, name?, color? (0-19),
 * delete?}`. `color` é opaco no contrato canônico (ADR-0016), mas o provider exige um inteiro
 * 0-19 — `toUazapiLabelColor` converte.
 */
async function editLabel(
  http: HttpClient,
  labelId: string,
  name: string | undefined,
  color: string | undefined,
  deleted: boolean,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/label/edit',
    body: { labelid: labelId, name, color: toUazapiLabelColor(color), delete: deleted },
  });
}

/**
 * `labels.create`: a convenção do provider para criar é enviar o literal `labelid: "new"` — o
 * backend "gera o próximo labelid numérico disponível" (não necessariamente sequencial: reaproveita
 * ids liberados por labels deletados), mas **a resposta de `/label/edit` não devolve esse id** (só
 * a string enum `"Label created"`/`"Label edited"`). A doc recomenda consultar `GET /labels` depois
 * para descobrir o id final. Este adapter faz exatamente isso, mas por DIFF (lista antes + lista
 * depois, `labelid` presente só na segunda) em vez de assumir "o maior número" — como o id pode ser
 * um número reaproveitado (não necessariamente o maior), o diff é a única forma confiável de
 * identificar QUAL entrada é a nova, mesmo às custas de uma chamada HTTP extra (3 chamadas no
 * total: list antes, create, list depois). Lança `PROVIDER_ERROR` se nenhum `labelid` novo aparecer
 * (ex.: condição de corrida com outra criação concorrente no mesmo instante).
 */
async function createLabel(http: HttpClient, input: CreateLabelInput): Promise<LabelInfo> {
  const before = new Set((await listLabels(http)).map((label) => label.id));
  await editLabel(http, 'new', input.name, input.color, false);
  const after = await listLabels(http);
  const created = after.find((label) => !before.has(label.id));
  if (!created) {
    throw new WaConnectorError(
      'PROVIDER_ERROR',
      'uazapi: não foi possível determinar o labelid criado por /label/edit (labelid:"new") — ' +
        'GET /labels não trouxe nenhum id novo em relação à listagem anterior.',
      { provider: PROVIDER },
    );
  }
  return created;
}

/** `labels.update`: envia o `labelId` real do chamador (diferente de `create`, que usa o literal `"new"`). */
async function updateLabel(http: HttpClient, input: UpdateLabelInput): Promise<void> {
  await editLabel(http, input.labelId, input.name, input.color, false);
}

/**
 * `labels.delete`: diferente do Evolution GO, o exemplo oficial de deleção do uazapi mostra
 * `name: ""` explicitamente — `name`/`color` NÃO são obrigatórios para `delete: true` (só `labelid`
 * é `required` no schema de `/label/edit`), então este adapter não precisa buscar o `name`/`color`
 * atuais antes de deletar (sem round-trip extra, diferente do Evolution GO).
 */
async function deleteLabel(http: HttpClient, labelId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/label/edit',
    body: { labelid: labelId, delete: true },
  });
}

/**
 * `labels.addToChat`/`removeFromChat`: `POST /chat/labels`, um dos 3 modos mutuamente exclusivos
 * do schema (`labelids`/`add_labelid`/`remove_labelid` — "Use apenas um dos três parâmetros por
 * requisição"). Este adapter sempre usa os modos de UM label (`add_labelid`/`remove_labelid`),
 * nunca o modo bulk-replace `labelids` — mesma chamada única, sem round-trip.
 */
async function setChatLabel(
  http: HttpClient,
  input: LabelChatInput,
  direction: 'add' | 'remove',
): Promise<void> {
  const field = direction === 'add' ? 'add_labelid' : 'remove_labelid';
  await http.request({
    method: 'POST',
    path: '/chat/labels',
    body: { number: toUazapiNumber(input.chatId), [field]: input.labelId },
  });
}

/**
 * `LabelInfo.color` é opaco (ADR-0016), mas o provider exige um inteiro 0-19 em `/label/edit` —
 * converte a string opaca para número; ausente ou não numérico vira `0` (default, sem paleta
 * documentada para esse caso).
 */
function toUazapiLabelColor(color: string | undefined): number {
  if (color === undefined) return 0;
  const parsed = Number(color);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Mapeia um item de `GET /labels` (schema `Label`) para `LabelInfo`. `labelid` (id de fato do
 * WhatsApp) é preferido a `id` (UUID interno do banco) — ver docstring de `listLabels`.
 */
function mapUazapiLabel(body: unknown): LabelInfo {
  const record = asRecord(body);
  const id =
    (record ? asString(record.labelid) : undefined) ?? (record ? asString(record.id) : undefined);
  const color = record ? asNumber(record.color) : undefined;
  return {
    id: id ?? '',
    name: (record ? asString(record.name) : undefined) ?? '',
    color: color === undefined ? undefined : String(color),
    raw: body,
  };
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
