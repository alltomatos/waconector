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
import { extractInviteCode, normalizeInviteLink } from '../../core/chat-id';
import { isWaConnectorError, WaConnectorError } from '../../core/errors';
import type { CanonicalEvent, UnknownEvent } from '../../core/events';
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
  ForwardMessageInput,
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
  MessageKind,
  PinMessageInput,
  SendMediaInput,
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
 * Todas as capabilities com endpoint confirmado no OpenAPI oficial (ver docs/providers/whapi.md),
 * exceto `instance.pairingCode`: `InstanceApi.connect()` não recebe telefone como parâmetro, e o
 * pairing code do Whapi (`GET /users/login/{PhoneNumber}`) exige o telefone no path — mesmo
 * obstáculo estrutural já documentado nos adapters Z-API/uazapi/Wuzapi.
 *
 * `messages.edit`/`messages.delete` e as 8 operações de `chats.*` (ADR-0012) foram confirmadas
 * numa auditoria de gaps dedicada — ver docs/providers/whapi.md, seções "Edição e exclusão de
 * mensagem" e "Conversas (chats.*)", para o endpoint/confiança de cada uma.
 */
const WHAPI_CAPABILITIES: CapabilitySet = [
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
  'messages.pin',
  'messages.unpin',
  'messages.markRead',
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
    sendReaction: (input) => sendReaction(http, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    forward: (input) => forwardMessage(http, input),
    star: (input) => setMessageStarred(http, input, true),
    unstar: (input) => setMessageStarred(http, input, false),
    pin: (input) => setMessagePinned(http, input, true),
    unpin: (input) => setMessagePinned(http, input, false),
    markRead: (input) => markMessageRead(http, input),
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
    leaveGroup: (groupId) => leaveGroupCall(http, groupId),
  };

  const contacts: ContactsApi = {
    list: () => listContacts(http),
    get: (chatId) => getContact(http, chatId),
    checkExists: (chatId) => checkContactExists(http, chatId),
    getProfilePicture: (chatId) => getContactProfilePicture(http, chatId),
    getAbout: (chatId) => getContactAbout(http, chatId),
    block: (chatId) => blockContact(http, chatId),
    unblock: (chatId) => unblockContact(http, chatId),
    listBlocked: () => listBlockedContacts(http),
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

  return {
    provider: PROVIDER,
    capabilities: WHAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
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

/**
 * `PUT /messages/{MessageID}/reaction` (corpo `ReactToMessage {emoji}`, operationId
 * `reactToMessage`) para reagir; `DELETE /messages/{MessageID}/reaction` (sem corpo, operationId
 * `removeReactFromMessage`) para remover — os dois endpoints e o schema do corpo confirmados no
 * OpenAPI oficial (`openapi.yaml`, v1.8.7). `ReactToMessage.emoji` também aceita string vazia como
 * sentinela alternativo de remoção ("Leave blank to remove the reaction"), mas este adapter usa o
 * endpoint DEDICADO de remoção quando `input.emoji === ''` (mesma convenção canônica de
 * `SendReactionInput.emoji`) — mais explícito, e igualmente confirmado no spec.
 *
 * Resposta de AMBOS os endpoints: `responses/Success` (`ResponseSuccess {success: boolean}`) —
 * **sem** o objeto `message` que `messages.sendText`/`sendMedia` devolvem (schema confirmado,
 * `reactToMessage`/`removeReactFromMessage` não referenciam `SentMessage`). Por isso `SentMessage.id`/
 * `chatId` aqui ecoam `input.messageId`/`to` (mesmo padrão do adapter WPPConnect para o mesmo caso
 * de "resposta fixa, sem id próprio") em vez de tentar extrair de `mapSentMessage`; `timestamp`
 * fica `undefined` (nenhum valor real disponível para popular).
 */
async function sendReaction(http: HttpClient, input: SendReactionInput): Promise<SentMessage> {
  const to = toWhapiChatId(input.to);
  const path = `/messages/${encodeURIComponent(input.messageId)}/reaction`;
  const response =
    input.emoji === ''
      ? await http.request<unknown>({ method: 'DELETE', path })
      : await http.request<unknown>({ method: 'PUT', path, body: { emoji: input.emoji } });
  return { id: input.messageId, chatId: to, raw: response };
}

/**
 * `messages.edit` (ADR-0012) **não** é um endpoint dedicado — é o mesmo `POST /messages/text`
 * (`operationId: sendMessageText`, `openapi.yaml:609-676`) usado por `sendText`, reenviado com o
 * campo `edit` (schema `Sender.edit`, `openapi.yaml:12584-12587`: *"Message ID of the message to
 * be edited"*) preenchido com `input.messageId`. Este campo faz parte do schema base `Sender`
 * (`openapi.yaml:12565-12587`), herdado por `SenderText` (`openapi.yaml:8494-8516`,
 * `allOf: [Sender, MessagePropsText]`) — não é citado em nenhum outro lugar da doc renderizada em
 * prosa, só no OpenAPI oficial; por isso este achado não está na pesquisa de gaps original
 * (dedicada à seção "ações sobre mensagem já enviada", que cobre `delete`/`forward`/`markAsRead`/
 * etc. mas não revisitou o schema de ENVIO). Confiança **alta** mesmo assim: é um campo real,
 * tipado e com descrição inequívoca, no MESMO endpoint já usado por este adapter — não uma
 * inferência de nome de rota. Resposta reaproveita `mapSentMessage` (mesmo schema de resposta de
 * `sendText`, já que é o mesmo endpoint).
 */
async function editMessage(http: HttpClient, input: EditMessageInput): Promise<SentMessage> {
  const to = toWhapiChatId(input.to);
  const body: Record<string, unknown> = { to, body: input.text, edit: input.messageId };
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/messages/text',
    body,
  });
  return mapSentMessage(response, to);
}

/**
 * `DELETE /messages/{MessageID}` (`operationId: deleteMessage`, `openapi.yaml:2419-2453`). Sem
 * corpo nem query — só o `messageId` no path (`input.to` não é enviado; existe em
 * `DeleteMessageInput` só por simetria com o restante de `messages.*`).
 *
 * **Confiança média, não alta** (nuance que a pesquisa de gaps aponta explicitamente): a descrição
 * literal do endpoint diz *"you will be able to delete a message that you sent as well as a
 * message that was sent by a contact"* — no protocolo WhatsApp real, apagar a mensagem de OUTRA
 * pessoa "para todos" não é possível, só localmente. Isso é indício de que este endpoint pode ser
 * "delete for me" (local), não "revoke for everyone" — mas **não há campo explícito**
 * (`for_everyone`/`revoke`) no request para confirmar nenhuma das duas leituras; é inferência da
 * descrição, não citação literal de um flag. `DeleteMessageInput` do contrato canônico (ADR-0012)
 * não expõe escopo — a semântica assumida por todo o pacote é sempre revogação, na ausência de um
 * campo que permita escolher; esta nota existe para não perder essa ambiguidade específica do
 * Whapi caso uma instância real revele o comportamento oposto. Resposta `Success`, ignorada
 * (contrato exige só `Promise<void>`).
 */
async function deleteMessage(http: HttpClient, input: DeleteMessageInput): Promise<void> {
  await http.request({
    method: 'DELETE',
    path: `/messages/${encodeURIComponent(input.messageId)}`,
  });
}

/**
 * `POST /messages/{MessageID}` (ADR-0013; `operationId: forwardMessage`, `openapi.yaml:2334-2387`,
 * confiança Alta). Corpo `ForwardMessage` (`openapi.yaml:8865-8877`): `to` obrigatório (destino,
 * `ForwardMessageInput.to`) + `force` opcional (booleano, "Force forward message" — não exposto
 * pelo contrato canônico, nunca enviado). `ForwardMessageInput.fromChatId` (ADR-0013) não é
 * necessário: o `messageId` no path já identifica a mensagem/origem. **401 dedicado** "Need
 * channel authorization for forward message" documentado no spec — sugere que forward pode exigir
 * plano/permissão extra além do básico; propagado como `WaConnectorError` normal. Resposta:
 * reaproveita `mapSentMessage` (mesmo shape base de `sendText`/`edit`).
 */
async function forwardMessage(http: HttpClient, input: ForwardMessageInput): Promise<SentMessage> {
  const to = toWhapiChatId(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: `/messages/${encodeURIComponent(input.messageId)}`,
    body: { to },
  });
  return mapSentMessage(response, to);
}

/**
 * `PUT /messages/{MessageID}/star` (ADR-0013; `operationId: starMessage`, `openapi.yaml:2541-2579`,
 * confiança Alta). Corpo `Star` (`openapi.yaml:8885-8892`): `{starred: boolean}` — permanente
 * (favoritar), sem duração, ao contrário do pin (ver `setMessagePinned`). As 2 capabilities
 * canônicas (`messages.star`/`unstar`, ADR-0013) mapeiam para `starred: true`/`false` no mesmo
 * endpoint. Resposta ignorada — contrato retorna `Promise<void>`.
 */
async function setMessageStarred(
  http: HttpClient,
  input: StarMessageInput,
  starred: boolean,
): Promise<void> {
  await http.request({
    method: 'PUT',
    path: `/messages/${encodeURIComponent(input.messageId)}/star`,
    body: { starred },
  });
}

/**
 * `POST` / `DELETE /messages/{MessageID}/pin` (ADR-0013; `operationId: pinMessage`/`unpinMessage`,
 * `openapi.yaml:2580-2649`, confiança Alta). Corpo `Pin` (`openapi.yaml:8893-8904`) só no `POST`:
 * `{time}` — enum `day`\|`week`\|`month` (fixação COM prazo, diferente do `star` permanente). Nota
 * de spec: o `example` do campo (`2592000`, um número de segundos) é inconsistente com o próprio
 * enum de strings — possível erro de documentação do provider. `PinMessageInput` do contrato
 * canônico não expõe duração (ADR-0013 — nenhum formato converge entre providers); este adapter
 * usa **`'day'`** como default para `pin` — decisão própria, o valor mais conservador do enum.
 * `unpin` é `DELETE`, sem corpo.
 */
async function setMessagePinned(
  http: HttpClient,
  input: PinMessageInput,
  pinned: boolean,
): Promise<void> {
  const path = `/messages/${encodeURIComponent(input.messageId)}/pin`;
  if (pinned) {
    await http.request({ method: 'POST', path, body: { time: 'day' } });
    return;
  }
  await http.request({ method: 'DELETE', path });
}

/**
 * `PUT /messages/{MessageID}` (ADR-0013; `operationId: markMessageAsRead`,
 * `openapi.yaml:2388-2418`, confiança Alta). Sem corpo. Marca UMA mensagem específica (e, por
 * extensão de protocolo, a conversa até ali) como lida — distinto de `chats.markRead` (ADR-0012,
 * `PATCH /chats/{ChatID}` com `mark_unread: false`), que atua no nível do chat inteiro.
 */
async function markMessageRead(http: HttpClient, input: MarkMessageReadInput): Promise<void> {
  await http.request({
    method: 'PUT',
    path: `/messages/${encodeURIComponent(input.messageId)}`,
  });
}

// ---------------------------------------------------------------------------
// groups.*
// ---------------------------------------------------------------------------

/**
 * `GroupID` é opaco (ADR-0009) e, no Whapi, sempre o JID `<dígitos>@g.us` (pattern confirmado no
 * OpenAPI: `^[\d-]{10,31}@g\.us$`) — repassado intacto no path em todo endpoint de `groups.*`,
 * nunca por `normalizeChatId`.
 */
function groupPath(groupId: string, suffix = ''): string {
  return `/groups/${encodeURIComponent(groupId)}${suffix}`;
}

/**
 * `POST /groups`, corpo `CreateGroupRequest {subject, participants}` (ambos obrigatórios,
 * confirmado no OpenAPI). Resposta `GroupCreate`: `{id, name, type, participants: Participant[],
 * created_by, unprocessed_participants?}` — reaproveita `mapGroupInfo` (mesmos campos usados que o
 * schema `Group` de `getInfo`, exceto `description`, ausente em `GroupCreate`).
 * `unprocessed_participants` (contatos rejeitados pela política anti-spam do WhatsApp ao criar o
 * grupo, confirmado na descrição do endpoint) não tem campo correspondente em `GroupInfo` — perdido
 * deliberadamente (core não modela "criação parcial"), não um bug.
 */
async function createGroup(http: HttpClient, input: CreateGroupInput): Promise<GroupInfo> {
  const response = await http.request<unknown>({
    method: 'POST',
    path: '/groups',
    body: { subject: input.subject, participants: input.participants },
  });
  return mapGroupInfo(response);
}

/** `GET /groups/{GroupID}`, resposta `Group` (schema completo: id/name/description/participants/created_by). */
async function getGroupInfo(http: HttpClient, groupId: string): Promise<GroupInfo> {
  const response = await http.request<unknown>({ method: 'GET', path: groupPath(groupId) });
  return mapGroupInfo(response, groupId);
}

/**
 * `GET /groups`, paginado (`count`/`offset`, default `count=100`, máx. 500, confirmado no OpenAPI)
 * — este adapter não pagina, devolve só a primeira página (a assinatura canônica
 * `list(): Promise<GroupInfo[]>` não expõe cursor, mesmo padrão de "sem paginação" já usado por
 * outros adapters deste pacote, ex.: WAHA). Resposta `GroupsList`: `{groups: Group[], count, total,
 * offset}`.
 */
async function listGroups(http: HttpClient): Promise<GroupInfo[]> {
  const response = await http.request<unknown>({ method: 'GET', path: '/groups' });
  const record = asRecord(response);
  return asRecordArray(record?.groups).map((item) => mapGroupInfo(item));
}

type GroupParticipantsAction = 'add' | 'remove' | 'promote' | 'demote';

interface GroupParticipantsEndpoint {
  method: 'POST' | 'DELETE' | 'PATCH';
  suffix: string;
}

/**
 * Quatro operações, endpoints distintos (confirmado no OpenAPI): `add` -> `POST
 * /groups/{GroupID}/participants` (operationId `addGroupParticipant`); `remove` -> `DELETE` no
 * MESMO path (`removeGroupParticipant`); `promote` -> `PATCH /groups/{GroupID}/admins`
 * (`promoteToGroupAdmin`); `demote` -> `DELETE` no MESMO path de admins (`demoteGroupAdmin`).
 * Corpo idêntico nas quatro: `ListParticipantsRequest {participants: [wa-id,...]}` — um array em
 * UMA ÚNICA chamada (diferente do WPPConnect, que não confirma suporte a lote e chama uma vez por
 * participante; aqui o batch é o formato oficial do request body, confirmado no schema).
 */
const PARTICIPANT_ENDPOINTS: Record<GroupParticipantsAction, GroupParticipantsEndpoint> = {
  add: { method: 'POST', suffix: '/participants' },
  remove: { method: 'DELETE', suffix: '/participants' },
  promote: { method: 'PATCH', suffix: '/admins' },
  demote: { method: 'DELETE', suffix: '/admins' },
};

/**
 * Resposta (`{success, failed: ContactID[], processed: ContactID[]}`) é ignorada — contrato
 * retorna `Promise<void>` e não distingue sucesso parcial por participante (mesmo padrão de
 * "descartar detalhe não modelado" já usado no resto do pacote).
 */
async function updateGroupParticipants(
  http: HttpClient,
  input: GroupParticipantsInput,
  action: GroupParticipantsAction,
): Promise<void> {
  const endpoint = PARTICIPANT_ENDPOINTS[action];
  await http.request({
    method: endpoint.method,
    path: groupPath(input.groupId, endpoint.suffix),
    body: { participants: input.participants },
  });
}

/**
 * `PUT /groups/{GroupID}`, corpo `UpdateGroupInfoRequest {subject?, description?}` — MESMO
 * endpoint para os dois campos (confirmado no OpenAPI: operationId `updateGroupInfo`, "changing the
 * name and description of a group"; não confundir com `PATCH /groups/{GroupID}`, operationId
 * `updateGroupSetting`, que é uma operação DIFERENTE — privacidade/permissões do grupo, fora do
 * escopo de `updateSubject`/`updateDescription`). Cada operação canônica envia SÓ o campo que lhe
 * corresponde, nunca os dois juntos nem o outro como `undefined` explícito — para não sobrescrever
 * silenciosamente o campo que não foi pedido (ex.: `updateSubject` não deve apagar a descrição
 * existente). Resposta: `Success`, ignorada.
 */
async function updateGroupSubject(http: HttpClient, input: UpdateGroupSubjectInput): Promise<void> {
  await http.request({
    method: 'PUT',
    path: groupPath(input.groupId),
    body: { subject: input.subject },
  });
}

/** Ver `updateGroupSubject` — MESMO endpoint `PUT /groups/{GroupID}`, envia só `description`. */
async function updateGroupDescription(
  http: HttpClient,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  await http.request({
    method: 'PUT',
    path: groupPath(input.groupId),
    body: { description: input.description },
  });
}

/**
 * `PUT /groups/{GroupID}/icon`, corpo JSON `{media, mime_type?}` (variante `application/json` do
 * requestBody `UploadImage` — as outras duas variantes, `image/jpeg`/`image/png` binário puro, não
 * são usadas por este adapter, mesmo padrão de "nunca multipart" já usado em `messages.sendMedia`).
 * `media` aceita URL, base64 ou media ID pré-upload (os mesmos três formatos de
 * `messages.sendMedia`, confirmado no OpenAPI: `MediaWithUploadFromUrl`/`FromBase64`/
 * `WithoutUpload` são todos `type: string`) — reaproveita `resolveMediaValue`. Resposta: `Success`,
 * ignorada.
 */
async function updateGroupPicture(http: HttpClient, input: UpdateGroupPictureInput): Promise<void> {
  await http.request({
    method: 'PUT',
    path: groupPath(input.groupId, '/icon'),
    body: { media: resolveMediaValue(input.media) },
  });
}

/**
 * `GET /groups/{GroupID}/invite`, resposta `GroupInvite {invite_code}` — só o CÓDIGO, não a URL
 * completa (confirmado no OpenAPI) — normalizado para link completo via `normalizeInviteLink`
 * (`core/chat-id.ts`), mesmo padrão dos demais adapters deste pacote.
 */
async function getGroupInviteLink(http: HttpClient, groupId: string): Promise<GroupInviteLink> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: groupPath(groupId, '/invite'),
  });
  const record = asRecord(response);
  const code = record ? asString(record.invite_code) : undefined;
  return { link: normalizeInviteLink(code ?? ''), raw: response };
}

/**
 * `DELETE /groups/{GroupID}/invite`, operationId `revokeGroupInvite` — resposta confirmada no
 * OpenAPI é só `Success` (`{success: boolean}`), **sem** o novo `invite_code` (diferente do
 * endpoint GET, e diferente de outros adapters deste pacote cujo endpoint de revogação já devolve
 * o link direto). Como o contrato canônico (`revokeInviteLink -> Promise<GroupInviteLink>`) exige
 * devolver o NOVO link, este adapter encadeia DELETE (revoga o código atual) + GET (busca o código
 * recém-girado) — duas chamadas HTTP, exceção deliberada ao padrão de "uma única chamada por
 * operação" (que em ADR-0010 é uma regra específica de `contacts.get`, não uma regra geral de
 * `GroupsApi`). **Assunção não confirmada empiricamente**: depende da convenção do protocolo
 * WhatsApp de que revogar sempre gera um código novo — o OpenAPI só documenta que o DELETE
 * "revokes" (invalida) o link atual, sem afirmar explicitamente que uma chamada GET subsequente
 * devolve um código diferente. Ver docs/providers/whapi.md.
 */
async function revokeGroupInviteLink(http: HttpClient, groupId: string): Promise<GroupInviteLink> {
  await http.request({ method: 'DELETE', path: groupPath(groupId, '/invite') });
  return getGroupInviteLink(http, groupId);
}

/**
 * `PUT /groups`, operationId `acceptGroupInvite`, corpo `GroupInvite {invite_code}` — só o CÓDIGO
 * (confirmado no OpenAPI, exemplo `invite_code: <invite code>`), não a URL completa.
 * `input.invite` já chega normalizado como link completo (o conector garante isso — ver
 * `WaConnector.prepareJoinViaInviteLink`), então este adapter extrai o código com
 * `extractInviteCode` antes de montar o corpo. Resposta `NewGroup {group_id}` ignorada — contrato
 * retorna `Promise<void>`.
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'PUT',
    path: '/groups',
    body: { invite_code: extractInviteCode(input.invite) },
  });
}

/** `DELETE /groups/{GroupID}`, operationId `leaveGroup`. Resposta `Success`, ignorada. */
async function leaveGroupCall(http: HttpClient, groupId: string): Promise<void> {
  await http.request({ method: 'DELETE', path: groupPath(groupId) });
}

/**
 * Reaproveitado por `createGroup` (resposta `GroupCreate`), `getInfo` (resposta `Group`) e `list`
 * (itens de `GroupsList.groups`, também `Group[]`) — os três schemas compartilham os campos usados
 * aqui (`id`, `name`, `description?`, `participants`, `created_by`), confirmado no OpenAPI.
 * `fallbackId` cobre o caso defensivo (não confirmado na pesquisa) de `id` vir ausente na resposta
 * de `getInfo` — usa o `groupId` já conhecido pelo chamador em vez de devolver string vazia.
 */
function mapGroupInfo(body: unknown, fallbackId?: string): GroupInfo {
  const record = asRecord(body);
  const participants = asRecordArray(record?.participants).map(mapGroupParticipant);
  return {
    id: (record ? asString(record.id) : undefined) ?? fallbackId ?? '',
    subject: (record ? asString(record.name) : undefined) ?? '',
    description: record ? asString(record.description) : undefined,
    owner: record ? asString(record.created_by) : undefined,
    participants,
    raw: body,
  };
}

/**
 * `Participant {id, rank}` — `rank` é o enum confirmado no OpenAPI: `'admin' | 'member' |
 * 'creator'` (diferente do booleano `isAdmin` cru usado por outros providers deste pacote).
 * `creator` mapeia para `isAdmin: true` E `isSuperAdmin: true`; `admin` só `isAdmin`; `member`
 * nenhum dos dois.
 */
function mapGroupParticipant(record: Record<string, unknown>): GroupParticipant {
  const rank = asString(record.rank);
  return {
    id: asString(record.id) ?? '',
    isAdmin: rank === 'admin' || rank === 'creator',
    isSuperAdmin: rank === 'creator',
  };
}

// ---------------------------------------------------------------------------
// contacts.*
// ---------------------------------------------------------------------------

/**
 * `GET /contacts`, paginado (`count`/`offset`, default 100) — mesma decisão de "só a primeira
 * página" de `groups.list` (a assinatura canônica `list(): Promise<Contact[]>` não expõe cursor).
 * Resposta `ContactsList`: `{contacts: Contact[], count, total, offset}`.
 */
async function listContacts(http: HttpClient): Promise<Contact[]> {
  const response = await http.request<unknown>({ method: 'GET', path: '/contacts' });
  const record = asRecord(response);
  return asRecordArray(record?.contacts).map(mapContact);
}

/** `GET /contacts/{ContactID}`, resposta `Contact` (schema completo) direto, sem envelope. */
async function getContact(http: HttpClient, chatId: string): Promise<Contact> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}`,
  });
  return mapContact(response);
}

/**
 * `Contact` schema confirmado no OpenAPI: `{id, phone, name, pushname, is_business, profile_pic,
 * profile_pic_full, status, phonebook}` — sem `about` (endpoint dedicado, ver `getContactAbout`)
 * nem um booleano de "tem WhatsApp"/"está bloqueado" (ADR-0010: cada adapter mapeia `getContact` a
 * partir de UMA ÚNICA chamada; campos sem correspondência ficam `undefined`, nunca inventados).
 * `name` prioriza o nome do catálogo de contatos (`name`); cai para `pushname` (nome definido pelo
 * próprio usuário no WhatsApp) quando ausente.
 */
function mapContact(body: unknown): Contact {
  const record = asRecord(body);
  const name = record ? (asString(record.name) ?? asString(record.pushname)) : undefined;
  const profilePictureUrl = record
    ? (asString(record.profile_pic_full) ?? asString(record.profile_pic))
    : undefined;
  return {
    id: (record ? asString(record.id) : undefined) ?? '',
    name,
    profilePictureUrl,
    raw: body,
  };
}

/**
 * `HEAD /contacts/{ContactID}`, operationId `checkExist` — "individually checks for a number in
 * WhatsApp", bate 1:1 com a assinatura single deste método (não batch). Sem corpo em nenhuma
 * resposta (é `HEAD`): o único sinal é o STATUS HTTP — `200` (`Success`) = existe, `404`
 * ("Specified contact not registered") = não existe. Diferente de todo outro método deste adapter,
 * aqui um status não-2xx ESPERADO precisa ser capturado e traduzido para um resultado de domínio
 * válido, não relançado — `HttpClient` sempre lança `WaConnectorError` para não-2xx; só o `404` é
 * interceptado aqui (qualquer outro status/erro continua propagando normalmente). `raw` no caminho
 * de "não existe" carrega o próprio erro capturado (não há corpo de resposta real para expor — uma
 * requisição `HEAD` nunca tem um).
 */
async function checkContactExists(http: HttpClient, chatId: string): Promise<CheckExistsResult> {
  const contactId = toWhapiChatId(chatId);
  try {
    const response = await http.request<unknown>({
      method: 'HEAD',
      path: `/contacts/${encodeURIComponent(contactId)}`,
    });
    return { exists: true, chatId: contactId, raw: response };
  } catch (error) {
    if (isWaConnectorError(error) && error.status === 404) {
      return { exists: false, raw: error };
    }
    throw error;
  }
}

/**
 * `GET /contacts/{ContactID}/profile`, resposta `UserProfile {name, push_name, verified_name,
 * about, icon, icon_full}` — `icon_full` é o "Profile avatar url" (confirmado na descrição do
 * schema no OpenAPI), preferido sobre `icon` ("Profile preview icon url", resolução menor).
 */
async function getContactProfilePicture(
  http: HttpClient,
  chatId: string,
): Promise<ContactProfilePicture> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}/profile`,
  });
  const record = asRecord(response);
  const url = record ? (asString(record.icon_full) ?? asString(record.icon)) : undefined;
  return { url, raw: response };
}

/** `GET /contacts/{ContactID}/about`, resposta `ContactAbout {about}` — confirmado no OpenAPI. */
async function getContactAbout(http: HttpClient, chatId: string): Promise<ContactAbout> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}/about`,
  });
  const record = asRecord(response);
  return { about: record ? asString(record.about) : undefined, raw: response };
}

const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net';

/**
 * O path param dos endpoints `/blacklist/*` (`ContactIdOrLid`) usa um schema DIFERENTE do resto de
 * `contacts.*` (`ContactID`): pattern `^\d{7,15}(@lid)?$`, confirmado no OpenAPI — só dígitos crus
 * ou `<dígitos>@lid`, SEM o sufixo `@s.whatsapp.net` que `ContactID` aceita nos demais endpoints.
 * Remove esse sufixo quando presente antes de montar o path; `@lid` (já aceito pelo pattern) e
 * dígitos crus passam intactos.
 */
function toWhapiBlacklistId(chatId: string): string {
  return chatId.endsWith(WHATSAPP_JID_SUFFIX)
    ? chatId.slice(0, chatId.length - WHATSAPP_JID_SUFFIX.length)
    : chatId;
}

/** `PUT /blacklist/{ContactIdOrLid}`, operationId `blacklistAdd`. Sem corpo. Resposta `Success`, ignorada. */
async function blockContact(http: HttpClient, chatId: string): Promise<void> {
  await http.request({
    method: 'PUT',
    path: `/blacklist/${encodeURIComponent(toWhapiBlacklistId(chatId))}`,
  });
}

/** `DELETE /blacklist/{ContactIdOrLid}`, operationId `blacklistRemove` — mesmo tratamento de path que `blockContact`. */
async function unblockContact(http: HttpClient, chatId: string): Promise<void> {
  await http.request({
    method: 'DELETE',
    path: `/blacklist/${encodeURIComponent(toWhapiBlacklistId(chatId))}`,
  });
}

/**
 * `GET /blacklist`, operationId `getBlackList`, resposta `ContactIDList` — array de strings
 * (`ContactID`: dígitos crus ou com sufixo `@lid`/`@s.whatsapp.net`), já no formato canônico do
 * waconector, sem transformação necessária.
 */
async function listBlockedContacts(http: HttpClient): Promise<string[]> {
  const response = await http.request<unknown>({ method: 'GET', path: '/blacklist' });
  return asStringArray(response);
}

// ---------------------------------------------------------------------------
// chats.*
// ---------------------------------------------------------------------------

/**
 * `chatId` de `chats.*` não é opaco (ADR-0012, mesmo tratamento de `contacts.*`) — já chega
 * normalizado pelo conector. `ChatID` no OpenAPI Whapi é o MESMO schema usado por `GroupID`/
 * `ContactID` (JID completo com sufixo `@s.whatsapp.net`/`@g.us`/etc.) — `toWhapiChatId` é a mesma
 * função identidade reaproveitada de `messages.*`.
 */
function chatPath(chatId: string): string {
  return `/chats/${encodeURIComponent(toWhapiChatId(chatId))}`;
}

/**
 * `chats.archive`/`chats.unarchive` via `POST /chats/{ChatID}` (`operationId: archiveChat`,
 * `openapi.yaml:2833-2870`), corpo `ArchiveChatRequest {archive: boolean}`
 * (`openapi.yaml:8968-8975`) — toggle único no MESMO endpoint, confirmado no OpenAPI oficial.
 * Resposta `Success`, ignorada (contrato exige só `Promise<void>`).
 */
async function setChatArchived(http: HttpClient, chatId: string, archive: boolean): Promise<void> {
  await http.request({ method: 'POST', path: chatPath(chatId), body: { archive } });
}

async function archiveChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatArchived(http, chatId, true);
}

async function unarchiveChat(http: HttpClient, chatId: string): Promise<void> {
  await setChatArchived(http, chatId, false);
}

/**
 * `PATCH /chats/{ChatID}` (`operationId: patchChat`, `openapi.yaml:2871-2910`), corpo
 * `PatchChatRequest` (`openapi.yaml:8976-9002`) — **um único endpoint compartilhado** por
 * `pin`/`unpin`, `mute`/`unmute` e `markRead`/`markUnread` (mais `ephemeral`, fora do escopo desta
 * fase). Cada operação canônica envia SÓ o campo que lhe corresponde (nunca os outros, nem como
 * `undefined` explícito) — mesmo padrão de `updateGroupSubject`/`updateGroupDescription` (que
 * também compartilham um único `PUT /groups/{GroupID}`), para não sobrescrever silenciosamente um
 * ajuste que não foi pedido.
 */
async function patchChat(
  http: HttpClient,
  chatId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await http.request({ method: 'PATCH', path: chatPath(chatId), body });
}

/**
 * `chats.pin`/`chats.unpin` via `PatchChatRequest.pin` (boolean, `openapi.yaml:8980-8983`) — fixa/
 * desafixa a CONVERSA inteira no topo da lista, sem prazo (diferente de `messages.pin`, que fixa
 * uma MENSAGEM com uma janela de tempo — `day`/`week`/`month` — e está fora do escopo desta fase,
 * ver ADR-0012).
 */
async function pinChat(http: HttpClient, chatId: string): Promise<void> {
  await patchChat(http, chatId, { pin: true });
}

async function unpinChat(http: HttpClient, chatId: string): Promise<void> {
  await patchChat(http, chatId, { pin: false });
}

/**
 * `chats.markRead`/`chats.markUnread` via `PatchChatRequest.mark_unread` (boolean,
 * `openapi.yaml:8989-8992`) — marca a CONVERSA inteira como lida/não lida de uma vez, sem precisar
 * dos ids das mensagens (diferente de `messages.markAsRead`, que atua numa mensagem específica via
 * `PUT /messages/{MessageID}` e está fora do escopo desta fase, ver ADR-0012). `markRead` envia
 * `mark_unread: false`; `markUnread` envia `mark_unread: true` — mapeamento invertido do nome do
 * campo, deliberado (o provider modela o booleano como "está não-lido?", não "está lido?").
 */
async function markChatRead(http: HttpClient, chatId: string): Promise<void> {
  await patchChat(http, chatId, { mark_unread: false });
}

async function markChatUnread(http: HttpClient, chatId: string): Promise<void> {
  await patchChat(http, chatId, { mark_unread: true });
}

/**
 * Sentinela de "silenciar por muito tempo" usada por `muteChat` — 1º de janeiro de 2099 (UTC), em
 * ms. `ChatsApi.mute`/`unmute` do contrato canônico não recebem duração (ADR-0012: nenhum formato
 * de duração converge entre os providers pesquisados), mas `PatchChatRequest.mute_until`
 * (`openapi.yaml:8984-8988`) do Whapi É um timestamp Unix em ms — "Use 0 to unmute the chat", sem
 * nenhum valor sentinela documentado para "permanente". Esta constante é uma DECISÃO deste
 * adapter (mesmo espírito do `muteEndTime: -1` do adapter uazapi, que usa o enum nativo do
 * provider para o equivalente), não um default do provider — escolhida por ser uma data distante o
 * bastante para ser, na prática, indistinguível de "para sempre", mas ainda um `integer` de 64 bits
 * válido dentro da faixa seguramente representável por um `number` do JavaScript (`Number.
 * MAX_SAFE_INTEGER`). **Nota**: este valor NÃO cabe num inteiro de 32 bits (nem em ms, nem
 * convertido para segundos) — se o backend do Whapi armazenar `mute_until` como um inteiro de 32
 * bits em algum ponto (não confirmado), esta sentinela poderia dar overflow lá; não há evidência
 * disso na doc, mas fica registrado para quem for revisar. Consumidores que precisem de uma
 * duração específica (ex.: "8 horas") só têm essa granularidade via chamada direta ao provider,
 * fora do contrato canônico.
 */
const WHAPI_MUTE_FOREVER_MS = Date.UTC(2099, 0, 1);

async function muteChat(http: HttpClient, chatId: string): Promise<void> {
  await patchChat(http, chatId, { mute_until: WHAPI_MUTE_FOREVER_MS });
}

async function unmuteChat(http: HttpClient, chatId: string): Promise<void> {
  await patchChat(http, chatId, { mute_until: 0 });
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
