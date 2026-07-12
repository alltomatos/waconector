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
import { digitsOnly, isJid, normalizeInviteLink } from '../../core/chat-id';
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
 * Opções do adapter Evolution GO.
 *
 * @see docs/providers/evolution.md para o dossiê completo (auth, endpoints, payloads).
 */
export interface EvolutionOptions {
  /** URL base do servidor Evolution GO self-hosted (ex.: `https://evolution.exemplo.com`). */
  baseUrl: string;
  /**
   * Valor enviado no header `apikey`. Todas as capabilities implementadas por este adapter usam
   * rotas OPERACIONAIS do Evolution GO (connect/status/logout/send/*), que são resolvidas pelo
   * TOKEN DA INSTÂNCIA — não pelo `GLOBAL_API_KEY` (usado só nas rotas admin, fora do escopo).
   */
  apiKey: string;
  /**
   * Nome/identificador da instância. Atualmente não utilizado pelo adapter (as rotas
   * operacionais resolvem a instância a partir do `apiKey`, e este adapter não faz logging) —
   * reservado para uso futuro em telemetria/diagnóstico.
   */
  instance?: string;
  /** `webhookUrl` enviado em `POST /instance/connect` (opcional; o provider também suporta um webhook global via env var no servidor). */
  webhookUrl?: string;
  /** Categorias de evento (`MESSAGE`, `CONNECTION`, `ALL`, ...) enviadas em `POST /instance/connect`. */
  subscribe?: string[];
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'evolution';

const EVOLUTION_CAPABILITIES: CapabilitySet = [
  'instance.connect',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'messages.sendReaction',
  'messages.edit',
  'messages.delete',
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
  'chats.mute',
  'chats.pin',
  'chats.unpin',
  'webhooks.parse',
];

/** Fábrica do adapter Evolution GO. */
export function evolution(options: EvolutionOptions): WaAdapter {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { apikey: options.apiKey },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.apiKey],
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
    sendReaction: (input) => sendReaction(http, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
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
    getInviteLink: (groupId) => getGroupInviteLink(http, groupId, false),
    revokeInviteLink: (groupId) => getGroupInviteLink(http, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroupById(http, groupId),
  };

  const contacts: ContactsApi = {
    list: () => listContacts(http),
    get: (chatId) => getContact(http, chatId),
    checkExists: (phone) => checkContactExists(http, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, chatId),
    getAbout: (chatId) => getContactAbout(http, chatId),
    block: (chatId) => blockContact(http, chatId),
    unblock: (chatId) => unblockContact(http, chatId),
    listBlocked: () => listBlockedContacts(http),
  };

  /**
   * `chats.unarchive`/`chats.mute`/`chats.markRead`/`chats.markUnread` deliberadamente ausentes:
   * a pesquisa dedicada (`evo-go-chat.yaml`) confirma `POST /chat/archive`/`/chat/mute` mas NÃO
   * encontra `/chat/unarchive` nem `/chat/unmute` no OpenAPI oficial do provider — declarar essas
   * duas capabilities seria mentir sobre um suporte não confirmado (mesmo critério já usado para
   * `contacts.block`/`unblock` — aqui só metade do par existe). `chats.markRead`/`markUnread`
   * (nível de CHAT, ver ADR-0012) também não têm endpoint confirmado: o único endpoint de
   * "marcar como lida" encontrado (`POST /message/markread`) opera por lista de `messageId`, é o
   * `messages.markRead` fora de escopo desta ADR — ver docs/providers/evolution.md, seção
   * "Conversas (chats.*)".
   */
  const chats: ChatsApi = {
    archive: (chatId) => archiveChat(http, chatId),
    mute: (chatId) => muteChat(http, chatId),
    pin: (chatId) => pinChat(http, chatId),
    unpin: (chatId) => unpinChat(http, chatId),
  };

  return {
    provider: PROVIDER,
    capabilities: EVOLUTION_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    parseWebhook: (input) => parseWebhook(input),
  };
}

/**
 * Mapeia o chatId canônico do waconector (dígitos crus OU JID explícito — ver
 * `normalizeChatId`) para o campo `number` esperado pelo Evolution GO.
 *
 * O provider aceita exatamente os dois mesmos formatos (dígitos crus, que ele normaliza
 * server-side via `formatJid`, ou um JID completo já formado com `@s.whatsapp.net`/`@g.us`/
 * `@lid`/`@broadcast`/`@newsletter`), então o chatId canônico já chega pronto — repassamos
 * sem transformação. Função existe para dar um ponto único de mudança caso isso deixe de
 * valer (ex.: se precisarmos forçar `formatJid:false`).
 */
function toProviderNumber(chatId: string): string {
  return chatId;
}

/**
 * Constrói o JID completo exigido pelo campo `mentionedJid` do Evolution GO.
 *
 * Diferente do campo `number` (que o servidor normaliza via `utils.CreateJID` independente do
 * formato recebido), `pkg/sendMessage/service/send_service.go` copia `data.MentionedJID` VERBATIM
 * para `ContextInfo.MentionedJID` no protobuf de saída — sem nenhuma chamada de
 * normalização/CreateJID no caminho de menções. A renderização de @menção do WhatsApp exige um
 * JID totalmente qualificado ali (`5511999999999@s.whatsapp.net`); um chatId canônico em dígitos
 * crus produziria uma menção muda (envia sem erro, mas não destaca o participante). Por isso,
 * diferente de `toProviderNumber`, aqui adicionamos o sufixo quando o valor ainda não é um JID.
 */
function toMentionJid(chatId: string): string {
  if (isJid(chatId)) return chatId;
  return `${digitsOnly(chatId)}@s.whatsapp.net`;
}

/**
 * Mapeia o `groupId` canônico (opaco — ver ADR-0009) para o campo `groupJid` esperado pelas
 * rotas `/group/*` do Evolution GO.
 *
 * Diferente da Z-API, o Evolution GO não tem um ID sintético de grupo: o `GroupInfo.id` deste
 * adapter já É o JID whatsmeow (`data.JID`/`data.jid` das respostas de `/group/info`,
 * `/group/list` e `/group/create` — sempre no formato `<dígitos>@g.us` ou variante `-` legado),
 * que é exatamente o que `groupJid` espera de volta. Função existe separada de
 * `toProviderNumber` (idêntica hoje) para não acoplar acidentalmente as duas decisões: uma cobre
 * o campo `number` de mensagens 1:1/grupo, a outra cobre especificamente o identificador opaco
 * de grupo — se um dos dois formatos mudar no futuro, cada um evolui de forma independente.
 */
function toProviderGroupJid(groupId: string): string {
  return groupId;
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

interface EvolutionEnvelope {
  message?: string;
  data?: unknown;
}

async function connectInstance(
  http: HttpClient,
  options: EvolutionOptions,
): Promise<ConnectResult> {
  const body: Record<string, unknown> = {};
  if (options.webhookUrl) body.webhookUrl = options.webhookUrl;
  if (options.subscribe) body.subscribe = options.subscribe;

  const connectResponse = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/instance/connect',
    body,
  });

  // GET /instance/qr é best-effort: o QR é gerado de forma assíncrona pelo servidor logo após o
  // connect, então pode não estar pronto ainda (ou a conta pode não precisar de QR, ex.: fluxo de
  // passkey). Uma falha aqui não deve impedir connect() de retornar.
  let qrResponse: EvolutionEnvelope | undefined;
  try {
    qrResponse = await http.request<EvolutionEnvelope>({ method: 'GET', path: '/instance/qr' });
  } catch {
    qrResponse = undefined;
  }

  const qrData = asRecord(qrResponse?.data);
  const qr = asString(qrData?.qrcode) ?? asString(qrData?.code);

  return {
    qr,
    raw: { connect: connectResponse, qr: qrResponse },
  };
}

async function statusInstance(http: HttpClient): Promise<InstanceStatus> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'GET',
    path: '/instance/status',
  });
  const data = asRecord(response.data);
  return { state: mapInstanceState(data), raw: response };
}

async function logoutInstance(http: HttpClient): Promise<void> {
  await http.request({ method: 'DELETE', path: '/instance/logout' });
}

function mapInstanceState(data: Record<string, unknown> | undefined): InstanceState {
  if (!data) return 'unknown';
  const connected = asBoolean(data.Connected);
  const loggedIn = asBoolean(data.LoggedIn);
  if (connected === undefined || loggedIn === undefined) return 'unknown';
  if (!connected && !loggedIn) return 'disconnected';
  if (connected && !loggedIn) return 'qr';
  if (connected && loggedIn) return 'connected';
  // connected === false && loggedIn === true: credenciais existem, socket caiu temporariamente
  // (o provider recomenda POST /instance/reconnect). Ver docs/providers/evolution.md ("suposição").
  return 'connecting';
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

async function sendText(http: HttpClient, input: SendTextInput): Promise<SentMessage> {
  const body: Record<string, unknown> = {
    number: toProviderNumber(input.to),
    text: input.text,
  };
  if (input.quotedId) {
    body.quoted = { messageId: input.quotedId };
  }
  if (input.mentions && input.mentions.length > 0) {
    body.mentionedJid = input.mentions.map(toMentionJid);
  }

  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/send/text',
    body,
  });
  return toSentMessage(input.to, response);
}

async function sendMedia(http: HttpClient, input: SendMediaInput): Promise<SentMessage> {
  // Checagem de último recurso (o conector já valida isso) para quem instancia o adapter sem
  // createConnector — ver CONTRIBUTING.md, seção "Convenções inegociáveis".
  // pkg/sendMessage/handler/send_handler.go (variante JSON de POST /send/media): quando
  // `data.Url` NÃO começa com "http://"/"https://", o servidor faz
  // `base64.StdEncoding.DecodeString(data.Url)` e envia via SendMediaFile — ou seja, o mesmo
  // campo `url` é overloaded para aceitar uma string base64 crua. Isso contradiz tanto o dossiê
  // original quanto a doc oficial (docs.evolutionfoundation.com.br), que afirmam que base64 via
  // JSON não é suportado; só o código-fonte revela o comportamento real. Ver
  // docs/providers/evolution.md.
  const url = input.media.url ?? input.media.base64;
  if (!url) {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'Evolution GO (adapter F1): sendMedia requer "media.url" ou "media.base64".',
      { provider: PROVIDER },
    );
  }

  const body: Record<string, unknown> = {
    number: toProviderNumber(input.to),
    type: input.media.kind,
    url,
  };
  if (input.caption) body.caption = input.caption;
  if (input.media.filename) body.filename = input.media.filename;
  if (input.quotedId) body.quoted = { messageId: input.quotedId };

  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/send/media',
    body,
  });
  return toSentMessage(input.to, response);
}

/**
 * `POST /message/react` (`pkg/message/service/message_service.go`, `ReactStruct`) — endpoint
 * separado de `/send/*` (não fica em `pkg/sendMessage/*`). Corpo: `{number, reaction, id, fromMe,
 * participant?}`. Ver docs/providers/evolution.md ("Reações").
 */
async function sendReaction(http: HttpClient, input: SendReactionInput): Promise<SentMessage> {
  const body: Record<string, unknown> = {
    number: toProviderNumber(input.to),
    // O provider rejeita `reaction: ""` com 400 ("message reaction is required") — a remoção usa o
    // sentinel literal "remove" (que o serviço traduz internamente para texto vazio no protocolo
    // whatsmeow). O modelo canônico usa `emoji: ''` para remoção (ADR-0008); traduzimos aqui.
    reaction: input.emoji === '' ? 'remove' : input.emoji,
    id: input.messageId,
    // `SendReactionInput` (contrato canônico) não carrega se a mensagem-alvo foi enviada pela
    // própria instância nem o `participant` (autor, em grupos) — mesma limitação já documentada
    // para `quotedId` em sendText/sendMedia. `false` é o valor seguro para o caso mais comum
    // (reagir a uma mensagem recebida); ver "Limites e particularidades" no dossiê.
    fromMe: false,
  };

  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/message/react',
    body,
  });
  return toSentMessage(input.to, response);
}

/**
 * `POST /message/edit` (confirmado via OpenAPI oficial `evo-go-message.yaml`, schema `EditMessage`
 * — confiança Alta, ver relatório de pesquisa dedicada de capabilities novas, 2026-07-12). Corpo:
 * `{chat, message, messageId}` — **atenção de nomenclatura**: o novo texto vai no campo `message`,
 * não `text`(diferente de `/send/text`) nem `caption`. Resposta:
 * `{"message":"success","data":{"messageId":"...","timestamp":"..."}}` — um envelope **próprio**,
 * diferente do `{data:{Info:{...}}}` usado por `/send/text`/`/send/media`/`/message/react` (ver
 * `toSentMessage`), por isso este adapter usa um mapeamento dedicado em vez de reaproveitar aquela
 * função. Sem janela de tempo documentada para editar (o spec não valida um prazo — um eventual
 * limite de ~15min do WhatsApp real, se existir, só se manifestaria como erro HTTP em runtime). Ver
 * docs/providers/evolution.md, seção "Edição e exclusão de mensagem".
 */
async function editMessage(http: HttpClient, input: EditMessageInput): Promise<SentMessage> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/message/edit',
    body: {
      chat: toProviderNumber(input.to),
      message: input.text,
      messageId: input.messageId,
    },
  });

  const data = asRecord(response.data);
  return {
    id: asString(data?.messageId) ?? input.messageId,
    chatId: input.to,
    timestamp: toEpochMs(data?.timestamp),
    raw: response,
  };
}

/**
 * `POST /message/delete` (confirmado via OpenAPI oficial `evo-go-message.yaml`, schema `Message:
 * {chat, messageId}` — confiança Alta). A própria descrição do endpoint no spec é literalmente
 * "Delete a message for everyone" — ou seja, **sempre** revogação para todos os participantes,
 * nunca um "apagar só localmente" (coerente com `DeleteMessageInput` do contrato canônico, que não
 * carrega nenhum campo de escopo — ver ADR-0012). Resposta `{"message":"success"}`, sem `data`; a
 * operação canônica retorna `Promise<void>`, então basta disparar a chamada.
 */
async function deleteMessage(http: HttpClient, input: DeleteMessageInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/message/delete',
    body: {
      chat: toProviderNumber(input.to),
      messageId: input.messageId,
    },
  });
}

function toSentMessage(to: string, response: EvolutionEnvelope): SentMessage {
  const data = asRecord(response.data);
  const info = asRecord(data?.Info);
  return {
    // `Info.ID` é sempre populado pelo provider com o id de mensagem real (string) na construção
    // da resposta de envio (send_service.go) — o fallback para `ServerID` é só defensivo.
    // `types.MessageServerID` é `int` no whatsmeow (serializa como número JSON), então o fallback
    // faz a coerção número→string explicitamente (senão `asString` nunca aceitaria o valor).
    id: asString(info?.ID) ?? asIdString(info?.ServerID) ?? '',
    chatId: to,
    timestamp: toEpochMs(info?.Timestamp),
    raw: response,
  };
}

// ---------------------------------------------------------------------------
// groups.*
// ---------------------------------------------------------------------------

/**
 * `POST /group/create` (confirmado só via código-fonte Go — `pkg/group/handler` +
 * `pkg/group/service`, não documentado no site oficial). Corpo: `{groupName, participants}` —
 * atenção: o campo é `groupName`, **não** `name` (diverge do resto do provider, que costuma usar
 * `name`/`number`). `participants` aceita dígitos crus ou JID completo (mesmo formato de
 * `toProviderNumber`), e já chega normalizado pelo conector.
 *
 * Resposta: `{message:"success", data:{jid, name, owner, added: string[], failed: string[]}}` —
 * um envelope **diferente** do whatsmeow `GroupInfo` usado por `getGroupInfo`/`listGroups`
 * (chaves minúsculas aqui, capitalizadas lá). Sem lista detalhada de participantes (com
 * isAdmin/isSuperAdmin) na resposta — construímos `GroupInfo.participants` a partir do array
 * `added` (todos entram como membros comuns, `isAdmin:false`); se `added` vier vazio (formato
 * inesperado), caímos de volta na lista de entrada, mesmo padrão de fallback de `toSentMessage`.
 */
async function createGroup(http: HttpClient, input: CreateGroupInput): Promise<GroupInfo> {
  const body = {
    groupName: input.subject,
    participants: input.participants.map(toProviderNumber),
  };

  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/group/create',
    body,
  });

  const data = asRecord(response.data);
  const added = asStringArray(data?.added);
  const participants: GroupParticipant[] = (added.length > 0 ? added : input.participants).map(
    (id) => ({ id, isAdmin: false, isSuperAdmin: false }),
  );

  return {
    id: asString(data?.jid) ?? '',
    subject: asString(data?.name) ?? input.subject,
    owner: asString(data?.owner),
    participants,
    raw: response,
  };
}

/**
 * `POST /group/info` — POST mesmo sendo uma leitura (mesmo padrão do provider para as demais
 * rotas de grupo). Corpo: `{groupJid}`. `data` é o `GroupInfo` do whatsmeow serializado
 * verbatim (struct Go sem json tags, chaves capitalizadas): `{JID, OwnerJID, Name, Topic
 * (=descrição), IsLocked, GroupCreated, Participants: [...]}` — ver `mapGroupInfo`.
 */
async function getGroupInfo(http: HttpClient, groupId: string): Promise<GroupInfo> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/group/info',
    body: { groupJid: toProviderGroupJid(groupId) },
  });

  return mapGroupInfo(asRecord(response.data), { id: groupId }, response);
}

/**
 * `GET /group/list` — resposta `{message:"success", data: GroupInfo[]}`, um array do mesmo
 * shape whatsmeow usado por `getGroupInfo` (um item por grupo). Diferente de `getGroupInfo`/
 * `createGroup`, cada item carrega seu próprio `raw` (o registro individual, não o envelope
 * inteiro) — mais útil para depurar um grupo específico dentro da lista.
 */
async function listGroups(http: HttpClient): Promise<GroupInfo[]> {
  const response = await http.request<EvolutionEnvelope>({ method: 'GET', path: '/group/list' });
  const items = Array.isArray(response.data) ? response.data : [];

  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((data) => mapGroupInfo(data, {}, data));
}

type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';

/**
 * `POST /group/participant` — endpoint ÚNICO compartilhado pelas 4 operações de participantes
 * (`addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants`); só o
 * campo `action` muda (`"add"|"remove"|"promote"|"demote"`). Corpo:
 * `{groupJid, participants, action}`. Resposta `{message:"success"}`, sem detalhe por
 * participante — o provider descarta essa informação internamente (não é um bug deste adapter).
 * As 4 operações canônicas retornam `Promise<void>`, então basta disparar a chamada.
 */
async function updateGroupParticipants(
  http: HttpClient,
  input: GroupParticipantsInput,
  action: GroupParticipantAction,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/participant',
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      participants: input.participants.map(toProviderNumber),
      action,
    },
  });
}

/**
 * `POST /group/name` (`SetGroupNameStruct`). Corpo: `{groupJid, name}`. Resposta
 * `{message:"success"}`, sem `data` — a operação canônica retorna `Promise<void>`, então basta
 * disparar a chamada.
 */
async function updateGroupSubject(http: HttpClient, input: UpdateGroupSubjectInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/name',
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      name: input.subject,
    },
  });
}

/**
 * `POST /group/description`. Corpo: `{groupJid, description}` — `description` pode ser string
 * vazia para limpar a descrição do grupo (o handler permite explicitamente, sem validação de
 * tamanho mínimo; o conector já valida que `description` é sempre uma string — ver
 * `WaConnector.prepareUpdateGroupDescription`). Resposta `{message:"success"}`.
 */
async function updateGroupDescription(
  http: HttpClient,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/description',
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      description: input.description,
    },
  });
}

/**
 * `POST /group/photo`. Corpo: `{groupJid, image}`. Resposta `{message:"success",
 * data:<novo pictureID string>}` — ignorada (a operação canônica retorna `Promise<void>`). Ver
 * `toGroupPictureImage` para a conversão de `MediaRef` para o formato exigido pelo campo `image`.
 */
async function updateGroupPicture(http: HttpClient, input: UpdateGroupPictureInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/photo',
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      image: toGroupPictureImage(input.media),
    },
  });
}

/**
 * Constrói o valor esperado pelo campo `image` de `POST /group/photo`. **Diferente** de
 * `/send/media` (onde o mesmo servidor decodifica base64 cru sem prefixo no campo `url` — ver
 * `sendMedia`), este endpoint só aceita OU uma URL `http(s)` OU uma data-URI com prefixo EXATO
 * `data:image/jpeg;base64,`/`data:image/png;base64,`; base64 cru sem prefixo não é reconhecido.
 * Repassamos `media.url` diretamente quando presente; caso contrário montamos a data-URI a partir
 * de `media.base64`, escolhendo o prefixo por `media.mimeType`. `mimeType` ausente ou não
 * reconhecido como `image/jpeg`/`image/png` cai no default `data:image/jpeg;base64,` — suposição
 * da pesquisa deste dossiê (não validada contra uma instância real; ver
 * docs/providers/evolution.md).
 * Checagem de último recurso (o conector já garante `media.kind === 'image'` e pelo menos um
 * entre `url`/`base64`) para quem instancia o adapter sem `createConnector` — mesmo padrão de
 * `sendMedia`.
 */
function toGroupPictureImage(media: MediaRef): string {
  if (media.url) return media.url;
  if (media.base64) {
    const prefix =
      media.mimeType === 'image/png' ? 'data:image/png;base64,' : 'data:image/jpeg;base64,';
    return `${prefix}${media.base64}`;
  }
  throw new WaConnectorError(
    'INVALID_INPUT',
    'Evolution GO (adapter F2): groups.updatePicture requer "media.url" ou "media.base64".',
    { provider: PROVIDER },
  );
}

/**
 * `POST /group/invitelink` — endpoint ÚNICO compartilhado por `getInviteLink`/`revokeInviteLink`;
 * só o campo `reset` muda (`false` obtém o link atual, `true` revoga e gera um novo). Corpo:
 * `{groupJid, reset}`. Resposta: `{message:"success", data:<link completo string>}` — o provider
 * já devolve `data` como o link completo (`https://chat.whatsapp.com/<código>`), então
 * `normalizeInviteLink` aqui é só defensivo/idempotente (não deveria alterar o valor na prática).
 */
async function getGroupInviteLink(
  http: HttpClient,
  groupId: string,
  reset: boolean,
): Promise<GroupInviteLink> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/group/invitelink',
    body: {
      groupJid: toProviderGroupJid(groupId),
      reset,
    },
  });

  const link = normalizeInviteLink(asString(response.data) ?? '');
  return { link, raw: response };
}

/**
 * `POST /group/join`. Corpo: `{code: string}` — aceita tanto o código bare quanto o link
 * completo (o whatsmeow interno remove o prefixo `https://chat.whatsapp.com/` automaticamente se
 * presente), então repassamos `input.invite` (já normalizado como link completo pelo conector —
 * ver `WaConnector.prepareJoinViaInviteLink`) diretamente, sem usar `extractInviteCode`. Resposta:
 * `{message:"success"}` — sem nenhuma informação sobre qual grupo foi de fato ingressado; a
 * operação canônica retorna `Promise<void>`, então só disparamos a chamada.
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/join',
    body: { code: input.invite },
  });
}

/**
 * `POST /group/leave`. Corpo: `{groupJid}`. Resposta `{message:"success"}` — a operação canônica
 * retorna `Promise<void>`, então basta disparar a chamada.
 */
async function leaveGroupById(http: HttpClient, groupId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/leave',
    body: { groupJid: toProviderGroupJid(groupId) },
  });
}

/**
 * Mapeia o participante individual do `GroupInfo` do whatsmeow (`{JID, PhoneNumber, LID,
 * IsAdmin, IsSuperAdmin, DisplayName, Error, AddRequest}`) para o `GroupParticipant` canônico.
 * `JID` é o identificador preferido (mesmo formato de chatId/participante usado no resto do
 * adapter); `PhoneNumber` é fallback defensivo para o caso (não confirmado na pesquisa) de um
 * participante vir sem `JID` populado.
 */
function mapGroupParticipant(record: Record<string, unknown>): GroupParticipant {
  return {
    id: asString(record.JID) ?? asString(record.PhoneNumber) ?? '',
    isAdmin: asBoolean(record.IsAdmin) ?? false,
    isSuperAdmin: asBoolean(record.IsSuperAdmin) ?? false,
  };
}

function mapGroupParticipants(value: unknown): GroupParticipant[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map(mapGroupParticipant);
}

/**
 * Mapeia `data` no shape whatsmeow `GroupInfo` (`getGroupInfo`/`listGroups`) para o `GroupInfo`
 * canônico. `fallback.id`/`fallback.subject` cobrem o caso (não observado na pesquisa, mas
 * defensivo) de o provider omitir `JID`/`Name` — mesmo padrão de fallback de `toSentMessage`.
 */
function mapGroupInfo(
  data: Record<string, unknown> | undefined,
  fallback: { id?: string; subject?: string },
  raw: unknown,
): GroupInfo {
  return {
    id: asString(data?.JID) ?? fallback.id ?? '',
    subject: asString(data?.Name) ?? fallback.subject ?? '',
    description: asString(data?.Topic),
    owner: asString(data?.OwnerJID),
    participants: mapGroupParticipants(data?.Participants),
    raw,
  };
}

// ---------------------------------------------------------------------------
// contacts.* (ver ADR-0010)
// ---------------------------------------------------------------------------

/**
 * `GET /user/contacts` — o contact store local do whatsmeow (contatos já conhecidos pela sessão,
 * não uma busca "ao vivo" no WhatsApp). Sem corpo. Resposta:
 * `{message:"success", data: ContactInfo[]}`, `ContactInfo = {Jid, Found, FirstName, FullName,
 * PushName, BusinessName}`. `Jid→id`; nome escolhido pela ordem de preferência `FullName` >
 * `FirstName` > `PushName` (o campo mais completo primeiro). Sem `about`/`profilePictureUrl`/
 * `hasWhatsApp` aqui — este endpoint não confirma explicitamente "tem WhatsApp" (todo item já é um
 * contato conhecido, mas isso não é o mesmo que uma checagem positiva), então `hasWhatsApp` fica
 * `undefined` em vez de assumir `true`. Cada item carrega seu próprio `raw` (o registro individual,
 * não o envelope inteiro) — mesmo padrão de `listGroups`.
 */
async function listContacts(http: HttpClient): Promise<Contact[]> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'GET',
    path: '/user/contacts',
  });
  const items = Array.isArray(response.data) ? response.data : [];

  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((data) => mapContactInfo(data));
}

function mapContactInfo(data: Record<string, unknown>): Contact {
  return {
    id: asString(data.Jid) ?? '',
    // `FirstName`/`FullName`/`PushName` são campos string simples no struct Go do whatsmeow (sem
    // ponteiro) — o zero value `""` significa "não preenchido", não "nome vazio válido". Por isso
    // usamos `asNonEmptyString` (que trata `""` como ausente) em vez de `asString` puro: com
    // `asString`, um `FullName:""` "venceria" o `??` e nunca cairia no fallback para
    // `FirstName`/`PushName`, mesmo estando de fato vazio.
    name:
      asNonEmptyString(data.FullName) ??
      asNonEmptyString(data.FirstName) ??
      asNonEmptyString(data.PushName),
    raw: data,
  };
}

/**
 * `POST /user/info` — endpoint compartilhado por `contacts.get` e `contacts.getAbout` (regra de
 * ouro do ADR-0010: uma única chamada HTTP por operação canônica; aqui as DUAS operações mapeiam
 * para o MESMO endpoint, então a chamada em si é reaproveitada via esta função interna, sem que
 * nenhuma das duas dispare uma segunda requisição). Corpo: `{number: [chatId], formatJid: true}` —
 * `number` é array mesmo para uma única consulta. Resposta:
 * `{message:"success", data:{Users: {[jid]: {VerifiedName, Status, PictureID, Devices, LID}}}}` —
 * `Users` é um MAP indexado por JID aqui (diferente de `checkContactExists`, onde `Users` é um
 * ARRAY). Como o corpo só pede um número, extraímos a primeira (e única) entrada do mapa; a chave
 * é o JID já resolvido pelo servidor (via `formatJid`), preferido como `id` do `Contact` sobre o
 * `chatId` de entrada.
 */
async function fetchUserInfo(
  http: HttpClient,
  chatId: string,
): Promise<{
  response: EvolutionEnvelope;
  jid: string | undefined;
  user: Record<string, unknown> | undefined;
}> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/user/info',
    body: { number: [toProviderNumber(chatId)], formatJid: true },
  });

  const data = asRecord(response.data);
  const users = asRecord(data?.Users);
  const [jid, rawUser] = users ? (Object.entries(users)[0] ?? []) : [];

  return { response, jid, user: asRecord(rawUser) };
}

/**
 * `contacts.get` via `POST /user/info` (ver `fetchUserInfo`). **Não existe um endpoint único
 * "getContact" ideal no Evolution GO** — este é o melhor match disponível (ver ADR-0010,
 * "`getContact` não é uma única chamada completa em 3 dos 5 providers"). Limitações documentadas
 * (não bugs, ver docs/providers/evolution.md):
 * - `name` fica **sempre `undefined`**: a resposta não traz nenhum nome de exibição (nem
 *   `PushName`/`FullName`); quem precisar do nome deve usar `contacts.list()`.
 * - `profilePictureUrl` fica **sempre `undefined`**: `PictureID` é só um id/hash interno da foto
 *   atual, não uma URL utilizável — popular `profilePictureUrl` a partir dele seria inventar um
 *   dado que a resposta não contém. Quem precisar da URL deve chamar `contacts.getProfilePicture`.
 * - `VerifiedName` (quando presente) só é preenchido para contas Business verificadas — não é o
 *   nome comum de exibição, por isso não é usado como fallback de `name`.
 */
async function getContact(http: HttpClient, chatId: string): Promise<Contact> {
  const { response, jid, user } = await fetchUserInfo(http, chatId);
  return {
    id: jid ?? chatId,
    name: undefined,
    about: asString(user?.Status),
    profilePictureUrl: undefined,
    raw: response,
  };
}

/**
 * `contacts.getAbout` reaproveita o MESMO endpoint/chamada de `contacts.get`
 * (`POST /user/info` via `fetchUserInfo`) — `data.Users[jid].Status` é o recado (about).
 */
async function getContactAbout(http: HttpClient, chatId: string): Promise<ContactAbout> {
  const { response, user } = await fetchUserInfo(http, chatId);
  return { about: asString(user?.Status), raw: response };
}

/**
 * `contacts.checkExists` via `POST /user/check`. Corpo: `{number: [phone], formatJid: true}`.
 * Resposta: `{message:"success", data:{Users: [{Query, IsInWhatsapp, JID, RemoteJID, LID,
 * VerifiedName}]}}` — `Users` é um ARRAY aqui (diferente de `fetchUserInfo`, onde `Users` é um MAP
 * por JID). Como o corpo só pede um número, pegamos o primeiro item do array.
 * `IsInWhatsapp→exists`, `JID→chatId` (o JID resolvido pelo servidor, útil para o chamador
 * encadear `messages.sendText`/`contacts.get` sem re-normalizar o telefone).
 */
async function checkContactExists(http: HttpClient, phone: string): Promise<CheckExistsResult> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/user/check',
    body: { number: [toProviderNumber(phone)], formatJid: true },
  });

  const data = asRecord(response.data);
  const users = Array.isArray(data?.Users) ? data.Users : [];
  const first = asRecord(users[0]);

  return {
    exists: asBoolean(first?.IsInWhatsapp) ?? false,
    chatId: asString(first?.JID),
    raw: response,
  };
}

/**
 * `contacts.getProfilePicture` via `POST /user/avatar`. Corpo: `{number: chatId, preview: false}`
 * — **diferente** de `fetchUserInfo`/`checkContactExists`, aqui `number` é uma string única, não um
 * array. Resposta: `{message:"success", data:{ID, URL, Type, DirectPath, Hash}}`; `URL→url`. Se o
 * contato não tiver foto (`ErrProfilePictureNotSet` no whatsmeow) o servidor normalmente responde
 * com erro HTTP 4xx/5xx — o `HttpClient` compartilhado já lança nesse caso, e este adapter
 * deliberadamente NÃO captura/mascara esse erro (adapter é "burro", ver CLAUDE.md): ele propaga
 * como `PROVIDER_ERROR`/erro de rede comum, igual a qualquer outra chamada deste adapter.
 */
async function getContactProfilePicture(
  http: HttpClient,
  chatId: string,
): Promise<ContactProfilePicture> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'POST',
    path: '/user/avatar',
    body: { number: toProviderNumber(chatId), preview: false },
  });

  const data = asRecord(response.data);
  return { url: asString(data?.URL), raw: response };
}

/**
 * `contacts.block` via `POST /user/block`. Corpo: `{number: chatId}` — `number` é uma string
 * única (mesmo padrão de `getContactProfilePicture`, diferente do array usado por
 * `fetchUserInfo`/`checkContactExists`). Resposta: `{message:"success", data:{DHash, JIDs:
 * string[]}}` — `data.JIDs` é a lista COMPLETA e já atualizada de contatos bloqueados após esta
 * operação (não só o item recém-bloqueado), mas a operação canônica retorna `Promise<void>`, então
 * ignoramos `data` por completo; quem precisar da lista atualizada deve chamar
 * `contacts.listBlocked()` separadamente (mesmo endpoint dedicado usado por `listBlockedContacts`
 * abaixo).
 */
async function blockContact(http: HttpClient, chatId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/user/block',
    body: { number: toProviderNumber(chatId) },
  });
}

/**
 * `contacts.unblock` via `POST /user/unblock`. Mesmo shape de corpo/resposta de `blockContact`
 * (`{number: chatId}` → `{message:"success", data:{DHash, JIDs: string[]}}`), ignorado pelo mesmo
 * motivo: a operação canônica retorna `Promise<void>`.
 */
async function unblockContact(http: HttpClient, chatId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/user/unblock',
    body: { number: toProviderNumber(chatId) },
  });
}

/**
 * `contacts.listBlocked` via `GET /user/blocklist`. Sem corpo. Resposta:
 * `{message:"success", data:{DHash, JIDs: string[]}}` — `data.JIDs` já vem no formato JID
 * canônico (mesmo formato usado como `Contact.id` no resto do adapter), então repassamos o array
 * diretamente, sem remapeamento por item.
 */
async function listBlockedContacts(http: HttpClient): Promise<string[]> {
  const response = await http.request<EvolutionEnvelope>({
    method: 'GET',
    path: '/user/blocklist',
  });

  const data = asRecord(response.data);
  return asStringArray(data?.JIDs);
}

// ---------------------------------------------------------------------------
// chats.* (ver ADR-0012)
// ---------------------------------------------------------------------------

/**
 * Os 4 endpoints de `evo-go-chat.yaml` compartilham o mesmo schema `ChatBody: {number: string}` —
 * mesmo formato do campo `number` de `/send/text`/`/message/react` (dígitos crus ou JID completo),
 * então cada operação de `chats.*` é só um `POST` fino com esse corpo comum. Confirmado via OpenAPI
 * oficial (confiança Alta), pesquisa dedicada de 2026-07-12 — ver docs/providers/evolution.md,
 * seção "Conversas (chats.*)".
 */
function chatBody(chatId: string): Record<string, unknown> {
  return { number: toProviderNumber(chatId) };
}

/**
 * `chats.archive` via `POST /chat/archive`. Resposta `{"message":"success"}`. **Não existe**
 * `/chat/unarchive` no OpenAPI oficial do provider — por isso este adapter declara só
 * `chats.archive`, nunca `chats.unarchive` (ver comentário em cima de `ChatsApi` na fábrica
 * `evolution()`).
 */
async function archiveChat(http: HttpClient, chatId: string): Promise<void> {
  await http.request({ method: 'POST', path: '/chat/archive', body: chatBody(chatId) });
}

/**
 * `chats.mute` via `POST /chat/mute`. Corpo `{number}` — **sem nenhum campo de duração** (nem
 * `duration`/`until`/`hours`), diferente de outros providers do waconector que suportam mute
 * "por 8h/1 semana/sempre" — aqui o schema só identifica o chat, sugerindo mute permanente/
 * indefinido. Sem formato de duração convergente entre providers, o contrato canônico
 * (`ChatsApi.mute`) também não recebe esse parâmetro (ver ADR-0012), então isso não é uma limitação
 * própria deste adapter. **Não existe** `/chat/unmute` no OpenAPI oficial — mesma ausência de
 * `archive`/`unarchive`, por isso `chats.unmute` também não é declarado.
 */
async function muteChat(http: HttpClient, chatId: string): Promise<void> {
  await http.request({ method: 'POST', path: '/chat/mute', body: chatBody(chatId) });
}

/** `chats.pin` via `POST /chat/pin`. Corpo `{number}`. Resposta `{"message":"success"}`. */
async function pinChat(http: HttpClient, chatId: string): Promise<void> {
  await http.request({ method: 'POST', path: '/chat/pin', body: chatBody(chatId) });
}

/**
 * `chats.unpin` via `POST /chat/unpin`. Corpo `{number}`. **Diferente** de `archive`/`mute`, o par
 * pin/unpin está COMPLETO no OpenAPI oficial (os dois endpoints existem), então este é o único par
 * simétrico de `chats.*` implementado por este adapter.
 */
async function unpinChat(http: HttpClient, chatId: string): Promise<void> {
  await http.request({ method: 'POST', path: '/chat/unpin', body: chatBody(chatId) });
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook do Evolution GO para eventos canônicos. Nunca lança: qualquer formato
 * inesperado (incluindo exceções internas) vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Evolution GO: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const body = asRecord(input.body);
  if (!body) {
    return [unknownEvent(input.body, 'Payload de webhook não é um objeto JSON.')];
  }

  const eventName = asString(body.event);
  if (!eventName) {
    return [unknownEvent(input.body, 'Payload de webhook sem campo "event".')];
  }

  const instanceId = asString(body.instanceId);
  const data = asRecord(body.data);

  switch (eventName) {
    case 'Message':
      return [mapMessageEvent(instanceId, data, body)];
    case 'Receipt':
      return mapReceiptEvent(instanceId, asString(body.state), data, body);
    case 'Connected':
      return [connectionEvent(instanceId, 'connected', undefined, body)];
    case 'Disconnected':
    case 'LoggedOut':
    case 'ConnectFailure':
    case 'TemporaryBan':
      return [connectionEvent(instanceId, 'disconnected', undefined, body)];
    case 'PairSuccess':
      return [connectionEvent(instanceId, 'connected', undefined, body)];
    case 'QRCode':
      return [
        connectionEvent(instanceId, 'qr', asString(data?.qrcode) ?? asString(data?.code), body),
      ];
    case 'GroupInfo':
      return mapGroupInfoEvent(instanceId, data, body);
    case 'JoinedGroup':
      return [mapJoinedGroupEvent(instanceId, data, body)];
    default:
      return [
        unknownEvent(body, `Evento Evolution GO não reconhecido: "${eventName}".`, instanceId),
      ];
  }
}

function mapMessageEvent(
  instanceId: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "Message" sem campo "data".', instanceId);
  }
  const info = asRecord(data.Info);
  if (!info) {
    return unknownEvent(rawBody, 'Evento "Message" sem "data.Info".', instanceId);
  }

  const fromMe = asBoolean(info.IsFromMe) ?? false;
  const content = mapMessageContent(asRecord(data.Message));

  const message: WaMessage = {
    id: asString(info.ID) ?? '',
    chatId: asString(info.Chat) ?? '',
    from: asString(info.Sender),
    fromMe,
    timestamp: toEpochMs(info.Timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
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
 * Deriva `kind`/`text`/`media` a partir do objeto `Message` (encoding protobuf→JSON do whatsmeow,
 * repassado verbatim pelo Evolution GO). A forma exata para tipos não-texto não foi enumerada na
 * pesquisa original (ver docs/providers/evolution.md) — melhor esforço por nome de chave presente.
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
  const documentWithCaption = asRecord(message.documentWithCaptionMessage);
  if (documentWithCaption) {
    const inner = asRecord(asRecord(documentWithCaption.message)?.documentMessage);
    return inner
      ? { kind: 'document', text: asString(inner.caption), media: buildMediaRef('document', inner) }
      : { kind: 'document' };
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
  // O struct gerado do whatsmeow (waE2E/WAWebProtobufsE2E.pb.go) tagueia este campo como
  // `json:"URL,omitempty"` (maiúsculo) em ImageMessage/VideoMessage/AudioMessage/
  // DocumentMessage/StickerMessage — confirmado no .pb.go gerado, não em prosa de doc. O
  // Evolution GO repassa o evento whatsmeow verbatim (round-trip via json.Marshal/Unmarshal, que
  // preserva casing), então a chave real no webhook é sempre `URL`. Aceitamos `url` minúsculo só
  // como fallback defensivo caso uma versão futura do provider normalize o casing.
  const url = asString(record.URL) ?? asString(record.url);
  if (!url) return undefined;
  return {
    kind,
    url,
    mimeType: asString(record.mimetype),
    filename: asString(record.fileName),
  };
}

function mapReceiptEvent(
  instanceId: string | undefined,
  state: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent[] {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "Receipt" sem campo "data".', instanceId)];
  }
  const messageIds = asStringArray(data.MessageIDs);
  if (messageIds.length === 0) {
    return [unknownEvent(rawBody, 'Evento "Receipt" sem "data.MessageIDs".', instanceId)];
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

/** `state` desconhecido cai em `'sent'` (nunca lança) — o evento "Receipt" em si já implica que a mensagem saiu. */
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

/**
 * "GroupInfo" é o evento de DIFF de grupo do whatsmeow (`events.GroupInfo`, serializado verbatim
 * pelo Evolution GO: struct Go sem json tags, campos capitalizados). RECONSTRUÍDO diretamente do
 * código-fonte whatsmeow — nenhum payload "ao vivo" foi capturado na pesquisa (mesma metodologia já
 * usada neste dossiê para outros payloads "RECONSTRUÍDO"; ver docs/providers/evolution.md, seção
 * "Webhooks de grupo").
 *
 * Este evento pode reportar MÚLTIPLAS mudanças simultâneas no mesmo payload (ex.: adicionar
 * participantes E promover outro no mesmo evento) — por isso emitimos UM `GroupUpdateEvent` por
 * mudança identificada, nunca um único evento "resumo" (`parseWebhook` já retorna
 * `CanonicalEvent[]`, então múltiplos eventos a partir de um único payload de entrada é natural).
 *
 * Só os campos abaixo têm tradução para `GroupUpdateEvent.action` porque só eles têm confirmação
 * de formato: `Join`/`Leave`/`Promote`/`Demote` (arrays de JID) → `participants.add`/`.remove`/
 * `.promote`/`.demote` (com `participants` populado, já no formato JID usado pelo resto do
 * adapter — nenhum remapeamento via `mapGroupParticipant` é necessário aqui, pois estes campos já
 * são `[]JID`, não uma lista de objetos de participante); `Name`/`Topic` (objetos truthy quando a
 * mudança correspondente ocorreu) → `subject`/`description` (sem popular `participants`, e SEM
 * tentar extrair o novo valor do nome/descrição — não há exemplo real do formato exato de
 * `GroupName`/`GroupTopic` para confiar nessa extração; ver ADR-0002/ADR-0003). Os demais campos do
 * diff (`Locked`, `Announce`, `Ephemeral`, `MembershipApprovalMode`, `Delete`, `Link`, `Unlink`,
 * `NewInviteLink`, `Suspended`, `Unsuspended`, `UnknownChanges`, ...) ficam **fora do escopo** do
 * `GroupUpdateEvent` atual (não têm uma `action` canônica correspondente) — se nenhum dos campos
 * reconhecidos acima estiver populado, o evento cai em `unknown` em vez de inventar uma action
 * genérica.
 */
function mapGroupInfoEvent(
  instanceId: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent[] {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem campo "data".', instanceId)];
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem "data.JID".', instanceId)];
  }

  const events: GroupUpdateEvent[] = [];

  const join = asStringArray(data.Join);
  if (join.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, 'participants.add', join, rawBody));
  }
  const leave = asStringArray(data.Leave);
  if (leave.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, 'participants.remove', leave, rawBody));
  }
  const promote = asStringArray(data.Promote);
  if (promote.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, 'participants.promote', promote, rawBody));
  }
  const demote = asStringArray(data.Demote);
  if (demote.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, 'participants.demote', demote, rawBody));
  }
  if (asRecord(data.Name)) {
    events.push(groupUpdateEvent(instanceId, groupId, 'subject', undefined, rawBody));
  }
  if (asRecord(data.Topic)) {
    events.push(groupUpdateEvent(instanceId, groupId, 'description', undefined, rawBody));
  }

  if (events.length === 0) {
    return [
      unknownEvent(
        rawBody,
        'Evento "GroupInfo" sem nenhuma mudança reconhecida (Join/Leave/Promote/Demote/Name/Topic).',
        instanceId,
      ),
    ];
  }

  return events;
}

/**
 * "JoinedGroup" é emitido quando a própria sessão entra em um grupo ou é adicionada a um por
 * outro participante. RECONSTRUÍDO do código-fonte whatsmeow (sem payload real capturado) — ver
 * docs/providers/evolution.md, seção "Webhooks de grupo". `data` mistura campos específicos do
 * evento (`Reason`, `Type`, `CreateKey`, `Sender`, `SenderPN`, `Notify`) com os campos do
 * `GroupInfo` completo do grupo ingressado, achatados no mesmo nível (`JID`, `Name`,
 * `Participants`, ...). Só traduzimos `groupId` (de `data.JID`) e a `action` fixa
 * `'participants.add'` — não extraímos `Reason`/`Type` nem o `GroupInfo` embutido, pois
 * `GroupUpdateEvent` não tem campo canônico para eles.
 */
function mapJoinedGroupEvent(
  instanceId: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem campo "data".', instanceId);
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem "data.JID".', instanceId);
  }

  return groupUpdateEvent(instanceId, groupId, 'participants.add', undefined, rawBody);
}

function groupUpdateEvent(
  instanceId: string | undefined,
  groupId: string,
  action: string,
  participants: string[] | undefined,
  rawBody: unknown,
): GroupUpdateEvent {
  return {
    type: 'group.update',
    provider: PROVIDER,
    instanceId,
    groupId,
    action,
    participants,
    raw: rawBody,
  };
}

function unknownEvent(raw: unknown, reason: string, instanceId?: string): UnknownEvent {
  return { type: 'unknown', provider: PROVIDER, instanceId, raw, reason };
}

// ---------------------------------------------------------------------------
// Type guards manuais (zero deps — ADR-0004), mesmo padrão de src/testing/mock-adapter.ts
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Como `asString`, mas trata `""` como ausente — ver `mapContactInfo`. */
function asNonEmptyString(value: unknown): string | undefined {
  const str = asString(value);
  return str && str.length > 0 ? str : undefined;
}

/** Como `asString`, mas também aceita `number` (coagido para string) — ver `toSentMessage`. */
function asIdString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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
