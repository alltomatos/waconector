import type {
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
  MessageAckEvent,
  UnknownEvent,
} from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ConnectResult,
  CreateGroupInput,
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

  return {
    provider: PROVIDER,
    capabilities: EVOLUTION_CAPABILITIES,
    instance,
    messages,
    groups,
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
