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
  MarkMessageReadInput,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  SendContactCardInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
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
  'messages.sendReaction',
  'messages.edit',
  'messages.delete',
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
    sendReaction: (input) => sendReaction(http, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, input),
    sendContactCard: (input) => sendContactCard(http, input),
    sendPoll: (input) => sendPoll(http, input),
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
    getInviteLink: (groupId) => fetchGroupInviteLink(http, groupId, false),
    revokeInviteLink: (groupId) => fetchGroupInviteLink(http, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroupCall(http, groupId),
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
   * Ver ADR-0012. Cobertura real de `chats.*` no Wuzapi, verificada diretamente contra o
   * código-fonte de `asternic/wuzapi` (`routes.go`/`handlers.go`, branch `main`, 2026-07-12 — o
   * relatório de pesquisa dedicado desta rodada não estava disponível para este provider, então a
   * verificação foi feita direto no repositório público em vez de a partir desse relatório):
   *
   * - **`archive`/`unarchive`**: implementados — MESMO endpoint `POST /chat/archive`, variando só
   *   o booleano `archive` (ver `setChatArchived`). Confirma e ao mesmo tempo corrige uma leitura
   *   mais estrita do achado registrado em ADR-0012 ("Wuzapi não tem nenhuma [operação] exceto
   *   archive"): o endpoint real já cobre as duas direções via um único parâmetro, não é um
   *   `archive` sem `unarchive` (diferente do caso do Evolution GO, citado na mesma ADR).
   * - **`mute`/`unmute`/`pin`/`unpin`**: **não implementados** — busca exaustiva em `routes.go`
   *   (todas as ~90 rotas registradas em `s.router.Handle(...)`) não encontra nenhum handler
   *   equivalente a mutar/fixar uma conversa. Confirma o achado da ADR-0012 para este subconjunto.
   * - **`markRead`/`markUnread`**: **não implementados**, apesar de `POST /chat/markread` EXISTIR
   *   (`handlers.go`, func `MarkRead`) — achado que a ADR-0012 não previu para este provider. O
   *   endpoint não serve ao contrato canônico `chats.markRead(chatId)`: seu corpo exige `Id`
   *   (array de ids de MENSAGEM, `len(t.Id) < 1` rejeitado com 400), além de `ChatPhone`, não
   *   aceita marcar a conversa inteira só por `chatId`. Ou seja, é a operação de NÍVEL DE MENSAGEM
   *   que a própria ADR-0012 já reserva para um eventual `messages.markRead` futuro, distinto de
   *   `chats.markRead` (nível de chat) — implementar aqui exigiria inventar/buscar ids de mensagem
   *   não lidas (uma chamada extra a `/chat/history`), violando a regra de uma única chamada por
   *   operação canônica (mesmo critério do ADR-0010). Não existe `markUnread` nenhum no código.
   *
   * Ver docs/providers/wuzapi.md, seção "Conversas (chats.*)".
   */
  const chats: ChatsApi = {
    archive: (chatId) => setChatArchived(http, chatId, true),
    unarchive: (chatId) => setChatArchived(http, chatId, false),
  };

  return {
    provider: PROVIDER,
    capabilities: WUZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
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
 * `POST /chat/react` — confirmado em `handlers.go` (func `React`) e `API.md`. Body:
 * `{Phone, Body, Id, Participant?}`. `Body` é o emoji da reação; `Id` é o id da mensagem-alvo.
 *
 * O servidor **rejeita** `Body` vazio com 400 ("missing Body in Payload") — não aceita a
 * convenção canônica de `emoji === ''` para remover uma reação anterior. Em vez disso, o Wuzapi
 * usa o literal especial `"remove"` (`handlers.go`: `if reaction == "remove" { reaction = "" }`,
 * que então monta um `ReactionMessage` com texto vazio internamente — a convenção real do
 * protocolo WhatsApp/whatsmeow para desfazer uma reação). Este adapter traduz `emoji === ''` para
 * `Body: "remove"` nesse ponto de fronteira.
 *
 * `Participant` (só relevante ao reagir a mensagem de outro participante num grupo, quando
 * `FromMe` é falso) e o prefixo `"me:"` em `Id` (reagir à própria mensagem enviada) não têm campo
 * equivalente em `SendReactionInput` — nenhum dos dois é enviado; suposição documentada em
 * docs/providers/wuzapi.md.
 *
 * Resposta confirmada: mesmo envelope `{Details,Timestamp,Id}` de `sendText`/`sendMedia`
 * (`mapSentMessage`) — mas aqui `data.Id` é o id da MENSAGEM-ALVO (a que recebeu a reação), não um
 * novo id de "mensagem de reação" (o próprio `API.md` documenta `"Id":"<message id reacted to>"`).
 * `SentMessage.id` reflete esse eco, não uma nova mensagem enviada.
 */
async function sendReaction(http: HttpClient, input: SendReactionInput): Promise<SentMessage> {
  const phone = toWuzapiPhone(input.to);
  const reactionBody = input.emoji === '' ? 'remove' : input.emoji;
  const body: Record<string, unknown> = { Phone: phone, Body: reactionBody, Id: input.messageId };

  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/chat/react',
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

/**
 * `POST /chat/send/edit` — confirmado diretamente no código-fonte de `asternic/wuzapi` (branch
 * `main`, verificado em 2026-07-12; func `SendEditMessage`, `handlers.go`). O relatório de pesquisa
 * dedicado desta rodada não estava disponível para este provider (ver docs/providers/wuzapi.md,
 * nota no topo da seção "Edição e exclusão de mensagem"), então a verificação foi feita direto no
 * repositório público em vez de a partir desse relatório.
 *
 * Corpo: `{Phone, Body, Id}` — `Body` é o NOVO texto (mesmo nome de campo de `sendText`/
 * `sendReaction`), `Id` é o id da mensagem original a editar. O handler monta um
 * `ExtendedTextMessage` internamente e chama `BuildEdit` do whatsmeow — sem nenhuma validação de
 * janela de tempo no código (um eventual limite de ~15min do WhatsApp real, se existir, só se
 * manifestaria como erro HTTP em runtime).
 *
 * Resposta confirmada: MESMO envelope `{Details,Timestamp,Id}` de `sendText`/`sendReaction` — `Id`
 * aqui é o ECO do id requisitado (editar não gera um novo id de mensagem), por isso reaproveita
 * `mapSentMessage` sem alteração.
 */
async function editMessage(http: HttpClient, input: EditMessageInput): Promise<SentMessage> {
  const phone = toWuzapiPhone(input.to);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/chat/send/edit',
    body: { Phone: phone, Body: input.text, Id: input.messageId },
  });
  return mapSentMessage(response, phone);
}

/**
 * `POST /chat/delete` — confirmado diretamente no código-fonte (func `DeleteMessage`,
 * `handlers.go`; mesma ressalva de verificação direta citada em `editMessage`). Corpo: `{Phone,
 * Id}`. Internamente o handler chama `BuildRevoke(recipient, types.EmptyJID, msgid)` do whatsmeow
 * — o segundo parâmetro vazio (`types.EmptyJID`) é a convenção do whatsmeow para "revogar mensagem
 * própria" (só é possível revogar mensagens que a própria sessão enviou) — **sempre revogação para
 * todos os participantes**, nunca um "apagar só localmente" (coerente com `DeleteMessageInput` do
 * contrato canônico, que não carrega campo de escopo — ver ADR-0012).
 *
 * Resposta confirmada: `{Details:"Deleted",Timestamp,Id}` (`Id` = eco do id requisitado) —
 * ignorada, contrato retorna `Promise<void>`.
 */
async function deleteMessage(http: HttpClient, input: DeleteMessageInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/chat/delete',
    body: { Phone: toWuzapiPhone(input.to), Id: input.messageId },
  });
}

/**
 * `POST /chat/markread` (ADR-0013, nível de MENSAGEM; confirmado em código-fonte, func `MarkRead`,
 * `handlers.go`). Corpo: `{Id: string[], ChatPhone}` — `Id` é array, rejeitado com `400` se vazio
 * (`len(t.Id) < 1`); este adapter sempre envia um array com 1 elemento. `SenderPhone` (opcional,
 * só necessário em grupos para identificar de quem é a mensagem) não é enviado —
 * `MarkMessageReadInput` não carrega esse campo. Campos legados `Chat`/`Sender` (aceitos por
 * retrocompatibilidade) não são usados — `ChatPhone`/`SenderPhone` são os "novos campos
 * padronizados e priorizados" segundo o próprio comentário do código-fonte. Este é exatamente o
 * endpoint que a ADR-0012 já tinha identificado como "nível de mensagem, não serve a
 * `chats.markRead`" — implementado agora como `messages.markRead` (ADR-0013). Resposta ignorada,
 * `Promise<void>`.
 */
async function markMessageRead(http: HttpClient, input: MarkMessageReadInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/chat/markread',
    body: { Id: [input.messageId], ChatPhone: toWuzapiPhone(input.to) },
  });
}

/**
 * `POST /chat/send/location` (ADR-0014; documentado no `API.md` e confirmado em código-fonte,
 * `handlers.go`). Corpo: `{Phone, Name?, Latitude, Longitude}`. **Nuance documentada no próprio
 * código**: a validação de obrigatoriedade é `if t.Latitude == 0 { ... }`/`if t.Longitude == 0 {
 * ... }` — o servidor NÃO distingue "campo ausente" de "0.0 exato"; uma localização real no
 * equador/meridiano de Greenwich seria rejeitada como "faltando" (limitação real do provider, não
 * deste adapter). Resposta confirmada: mesmo envelope `{Details,Timestamp,Id}` de `sendText`.
 */
async function sendLocation(http: HttpClient, input: SendLocationInput): Promise<SentMessage> {
  const phone = toWuzapiPhone(input.to);
  const body: Record<string, unknown> = {
    Phone: phone,
    Latitude: input.latitude,
    Longitude: input.longitude,
  };
  if (input.name) body.Name = input.name;

  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/chat/send/location',
    body,
  });
  return mapSentMessage(response, phone);
}

/**
 * `POST /chat/send/contact` (ADR-0014; documentado no `API.md` e confirmado em código-fonte).
 * Corpo: `{Phone, Name (obrigatório), Vcard (obrigatório, string vCard 3.0 completa)}` — **este
 * provider não monta o vCard a partir de campos soltos** (diferente de Evolution/uazapi/Z-API);
 * `SendContactCardInput` só expõe `contactName`/`contactPhone` soltos, então este adapter monta a
 * string vCard mínima localmente (`buildVcard`, mesmo formato `FN`/`TEL;type=CELL;waid=` que a
 * Evolution confirma gerar server-side, usado aqui como formato mínimo seguro).
 */
async function sendContactCard(
  http: HttpClient,
  input: SendContactCardInput,
): Promise<SentMessage> {
  const phone = toWuzapiPhone(input.to);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/chat/send/contact',
    body: {
      Phone: phone,
      Name: input.contactName,
      Vcard: buildVcard(input.contactName, input.contactPhone),
    },
  });
  return mapSentMessage(response, phone);
}

/**
 * `POST /chat/send/poll` (ADR-0014; confiança Alta no endpoint/código-fonte, Média no formato de
 * "capability" canônica — não documentado no `API.md`). Corpo com tags JSON MINÚSCULAS (diferente
 * do padrão PascalCase-sem-tag do resto da API): `{group, header, options}` — apesar do nome do
 * campo, `group` é validado pelo mesmo parser genérico de `Phone` usado em mensagens 1:1
 * (`validateMessageFields`), então aceita qualquer JID (indivíduo ou grupo), não só `@g.us`; o
 * nome é só uma pista de uso pretendido, não uma restrição de fato. **`allowMultipleAnswers` é
 * ignorado**: `BuildPollCreation` é chamado com `selectableOptionsCount` HARDCODED em `1` no
 * código-fonte — só enquetes de escolha única são suportadas por este endpoint, sem exceção
 * (limitação real do provider, documentada aqui em vez de fingir suporte). Resposta **diferente**
 * dos demais endpoints: `{"Details":"Poll sent successfully","Id":"<msgid>"}` — sem `Timestamp`.
 */
async function sendPoll(http: HttpClient, input: SendPollInput): Promise<SentMessage> {
  const recipient = toWuzapiPhone(input.to);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/chat/send/poll',
    body: { group: recipient, header: input.question, options: input.options },
  });
  return mapSentMessage(response, recipient);
}

/** Ver `sendContactCard`: vCard 3.0 mínimo, mesmo formato que a Evolution confirma gerar server-side. */
function buildVcard(name: string, phone: string): string {
  return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\nEND:VCARD`;
}

// ---------------------------------------------------------------------------
// groups.*
// ---------------------------------------------------------------------------

/**
 * `POST /group/create` — corpo com tags JSON minúsculas (`name`/`participants`), diferente da
 * maioria dos outros endpoints deste provider (que usam PascalCase sem tag) — confirmado no
 * código-fonte, não é engano. `participants` recebe o mesmo tratamento de `Phone` em mensagens
 * (`toWuzapiPhone`, aqui identidade): o conector já entrega telefones normalizados (só-dígitos) ou
 * JIDs explícitos intactos.
 *
 * Resposta (`data`): `{JID, Name, OwnerJID, GroupCreated, Participants: [{IsAdmin, IsSuperAdmin,
 * JID}]}`. Quando o corpo da resposta não ecoa `Name`/`Participants` (variação de versão do
 * servidor), cai de volta em `input.subject`/nos participantes requisitados (mesmo padrão de
 * fallback de `mapSentMessage`, ex. `chatId ?? requestedNumber`).
 */
async function createGroup(http: HttpClient, input: CreateGroupInput): Promise<GroupInfo> {
  const participants = input.participants.map(toWuzapiPhone);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/group/create',
    body: { name: input.subject, participants },
  });
  const data = asRecord(response.data);
  return mapGroupInfo(data, response, {
    subject: input.subject,
    participants: participants.map(toFallbackParticipant),
  });
}

/**
 * `GET /group/info` — `groupJID` vai na QUERY STRING (`?groupJID=...`), NÃO no corpo, mesmo que o
 * exemplo de `curl` do próprio `API.md` mostre `--data '{"GroupJID":...}'` (o handler só lê a
 * query string; o exemplo da doc é enganoso — divergência confirmada no código-fonte). `groupId` é
 * repassado tal como chega (opaco — ver `GroupInfo.id`/ADR-0009), sem passar por `toWuzapiPhone`.
 *
 * Resposta (`data`) = `types.GroupInfo`: `{JID, OwnerJID, Name, Topic (=descrição), IsLocked,
 * GroupCreated, Participants: [{JID, IsAdmin, IsSuperAdmin}]}`.
 */
async function getGroupInfo(http: HttpClient, groupId: string): Promise<GroupInfo> {
  const response = await http.request<WuzapiEnvelope>({
    method: 'GET',
    path: '/group/info',
    query: { groupJID: groupId },
  });
  const data = asRecord(response.data);
  return mapGroupInfo(data, response, { id: groupId });
}

/** `GET /group/list`, sem parâmetros. Resposta (`data`): `{Groups: [<mesmo shape de getGroupInfo>, ...]}`. */
async function listGroups(http: HttpClient): Promise<GroupInfo[]> {
  const response = await http.request<WuzapiEnvelope>({ method: 'GET', path: '/group/list' });
  const data = asRecord(response.data);
  const groups = Array.isArray(data?.Groups) ? data.Groups : [];
  return groups.map((group) => mapGroupInfo(asRecord(group), group));
}

type GroupParticipantsAction = 'add' | 'remove' | 'promote' | 'demote';

/**
 * `addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` são o MESMO
 * endpoint `POST /group/updateparticipants` (tudo minúsculo), variando só `Action`. Corpo:
 * `{GroupJID, Phone: string[], Action}` — atenção: o campo se chama `Phone`, não `Participants`.
 * `GroupJID` é repassado intacto (opaco); `Phone` reaproveita `toWuzapiPhone` porque os
 * participantes individuais, ao contrário do `groupId`, já chegam normalizados como um `to` de
 * mensagem comum.
 *
 * Resposta: `{Details: "Group Participants updated successfully"}`, sem detalhe por participante —
 * o contrato (`GroupParticipantsInput` -> `Promise<void>`) não precisa de retorno, então a resposta
 * é apenas descartada (erros de HTTP já viram `WaConnectorError` dentro de `HttpClient`).
 */
async function updateGroupParticipants(
  http: HttpClient,
  input: GroupParticipantsInput,
  action: GroupParticipantsAction,
): Promise<void> {
  const phones = input.participants.map(toWuzapiPhone);
  await http.request({
    method: 'POST',
    path: '/group/updateparticipants',
    body: { GroupJID: input.groupId, Phone: phones, Action: action },
  });
}

/**
 * `POST /group/name` — confirmado no código-fonte. Body `{GroupJID, Name}`. `GroupJID` é
 * repassado intacto (opaco, mesmo tratamento de `updateGroupParticipants`/`getGroupInfo`);
 * `subject` (já validado não-vazio pelo conector) vai direto em `Name`. Resposta: `{Details:
 * "Group Name set successfully"}` — sem detalhe adicional, por isso `Promise<void>` (resposta
 * apenas descartada, mesmo padrão de `updateGroupParticipants`).
 */
async function updateGroupSubject(http: HttpClient, input: UpdateGroupSubjectInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/name',
    body: { GroupJID: input.groupId, Name: input.subject },
  });
}

/**
 * `POST /group/topic` — confirmado no código-fonte. Body `{GroupJID, Topic}`. `Topic` vazio é
 * permitido pelo servidor (limpa a descrição do grupo — internamente o provider passa
 * previousID/newID vazios ao whatsmeow); o conector já valida que `description` é uma string
 * (vazia ou não) antes de chamar o adapter, então nenhuma validação adicional é feita aqui.
 * Resposta: `{Details: "Group Topic set successfully"}` — `Promise<void>`, mesmo padrão de
 * `updateGroupSubject`.
 */
async function updateGroupDescription(
  http: HttpClient,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/topic',
    body: { GroupJID: input.groupId, Topic: input.description },
  });
}

/**
 * `POST /group/photo` — confirmado no código-fonte. Body `{GroupJID, Image}`. `GroupJID` é
 * repassado intacto (opaco).
 *
 * **`Image` só aceita JPEG de fato**: o handler do servidor confere tanto o prefixo
 * `"data:image/"` quanto os magic bytes reais (`0xFF 0xD8 0xFF`) e rejeita com 400 qualquer outro
 * formato — apesar de uma mensagem de erro (não relacionada a esse check específico) sugerir que
 * png/gif/webp também seriam aceitos, o que é enganoso (confirmado lendo o código-fonte, não
 * apenas a prosa da mensagem de erro). Ver `toWuzapiGroupPhoto` e docs/providers/wuzapi.md.
 *
 * Resposta: `{Details: "Group Photo set successfully", PictureID}` — `PictureID` é ignorado
 * (contrato retorna `Promise<void>`, mesmo padrão das demais operações de grupo sem retorno).
 */
async function updateGroupPicture(http: HttpClient, input: UpdateGroupPictureInput): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/photo',
    body: { GroupJID: input.groupId, Image: toWuzapiGroupPhoto(input.media) },
  });
}

/**
 * Constrói o valor do campo `Image` de `POST /group/photo`. Diferente de `resolveMediaValue`
 * (usado por `messages.sendMedia`, que aceita qualquer `MediaKind`/formato), este endpoint só
 * aceita JPEG de fato — o conector já garante `media.kind === 'image'` e `media.url`/`media.base64`
 * (`requireImageMedia`), mas não força o formato real dos bytes.
 *
 * - Se `media.base64` está presente: monta a data URI **forçando** `image/jpeg`
 *   (`data:image/jpeg;base64,<...>`), independente de `media.mimeType` — assume/força que o
 *   chamador forneça bytes JPEG, já que é a única coisa que o servidor aceita de fato (assunção
 *   documentada em docs/providers/wuzapi.md). Se `media.base64` já vier como data URI (qualquer
 *   mimetype), extrai só a porção base64 após a vírgula antes de remontar com o prefixo forçado —
 *   evita produzir uma data URI com dois cabeçalhos concatenados.
 * - Se só `media.url` está presente (sem `media.base64`): repassada como está, sem conversão — o
 *   projeto não baixa/reencoda mídia (ADR-0004, zero dependências de runtime). **Não há
 *   confirmação, na pesquisa original, de que este endpoint aceite uma URL `http(s)` crua**
 *   (diferente de `messages.sendMedia`, que confirma isso) — assunção não validada contra
 *   instância real, documentada em docs/providers/wuzapi.md.
 */
function toWuzapiGroupPhoto(media: MediaRef): string {
  if (media.base64) {
    const commaIndex = media.base64.indexOf(',');
    const raw =
      media.base64.startsWith('data:') && commaIndex >= 0
        ? media.base64.slice(commaIndex + 1)
        : media.base64;
    return `data:image/jpeg;base64,${raw}`;
  }
  if (media.url) return media.url;
  // Defensivo: o conector já garante media.url ou media.base64 presente (`requireImageMedia`)
  // antes de chegar aqui — mesmo padrão de `resolveMediaValue` (sendMedia), que também lança em
  // vez de silenciosamente aceitar um valor vazio.
  throw new WaConnectorError(
    'INVALID_INPUT',
    'Wuzapi: groups.updatePicture exige "media.url" ou "media.base64".',
    { provider: PROVIDER },
  );
}

/**
 * `getInviteLink`/`revokeInviteLink` são o MESMO endpoint `GET /group/invitelink`, variando só o
 * parâmetro `reset` (mesmo padrão de `updateGroupParticipants` para add/remove/promote/demote).
 * `groupJID` e `reset` vão na QUERY STRING, não no corpo — mesmo padrão já usado por `getGroupInfo`
 * (o exemplo de `curl` da doc oficial mostra `--data`, o que é enganoso: o handler só lê a query
 * string, confirmado no código-fonte). `reset=false` (ou omitido) busca o link atual sem invalidar
 * o anterior; `reset=true` invalida o link atual e gera um novo.
 *
 * Resposta (`data`): `{InviteLink: "https://chat.whatsapp.com/<código>"}` — já vem completo. Ainda
 * assim passa por `normalizeInviteLink` por segurança (operação idempotente quando o valor já é o
 * link completo), caso alguma versão do servidor devolva só o código bare.
 */
async function fetchGroupInviteLink(
  http: HttpClient,
  groupId: string,
  reset: boolean,
): Promise<GroupInviteLink> {
  const response = await http.request<WuzapiEnvelope>({
    method: 'GET',
    path: '/group/invitelink',
    query: { groupJID: groupId, reset },
  });
  const data = asRecord(response.data);
  const link = asString(data?.InviteLink) ?? '';
  return { link: normalizeInviteLink(link), raw: response };
}

/**
 * `POST /group/join`. Body: `{Code: string}`. **CONFIANÇA MÉDIA (não confirmado
 * empiricamente)**: a pesquisa original não confirmou se este endpoint aceita a URL completa do
 * convite ou só o código bare — tratado aqui como aceitando SÓ O CÓDIGO. `input.invite` já chega
 * normalizado como link completo (o conector garante isso — ver `prepareJoinViaInviteLink` em
 * `connector.ts`), então este adapter extrai o código com `extractInviteCode` antes de montar o
 * corpo. Ver docs/providers/wuzapi.md para a assunção não validada.
 *
 * Resposta: `{Details: "Group joined successfully"}` — ignorada, contrato retorna `Promise<void>`.
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/join',
    body: { Code: extractInviteCode(input.invite) },
  });
}

/**
 * `POST /group/leave`. Body: `{GroupJID: string}` — `groupId` é opaco, repassado intacto (mesmo
 * tratamento de `getGroupInfo`/`updateGroupSubject`/etc.). Resposta: `{Details: "Group left
 * successfully"}` — ignorada, contrato retorna `Promise<void>`.
 */
async function leaveGroupCall(http: HttpClient, groupId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/group/leave',
    body: { GroupJID: groupId },
  });
}

interface GroupInfoFallback {
  id?: string;
  subject?: string;
  participants?: GroupParticipant[];
}

/**
 * Mapeia `data` (o objeto `types.GroupInfo` do provider, já desembrulhado do envelope `{code,
 * success, data}`) para o `GroupInfo` canônico. `raw` é passado separadamente (em vez de sempre
 * usar o envelope completo) para que `listGroups` preserve, por item, só o objeto daquele grupo
 * específico — não a lista inteira.
 *
 * Quando um campo não vem na resposta (comum em `create`, que só ecoa o essencial), cai de volta
 * no valor de entrada (`fallback`) — mesmo padrão de `mapSentMessage` (`chatId ?? requestedNumber`).
 */
function mapGroupInfo(
  data: Record<string, unknown> | undefined,
  raw: unknown,
  fallback: GroupInfoFallback = {},
): GroupInfo {
  const id = asString(data?.JID) ?? fallback.id ?? '';
  const subject = asString(data?.Name) ?? fallback.subject ?? '';
  const description = asString(data?.Topic);
  const owner = asString(data?.OwnerJID);
  const participants = mapGroupParticipants(data?.Participants) ?? fallback.participants ?? [];
  return { id, subject, description, owner, participants, raw };
}

function mapGroupParticipants(value: unknown): GroupParticipant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const record = asRecord(item);
    return {
      id: asString(record?.JID) ?? '',
      isAdmin: asBoolean(record?.IsAdmin) ?? false,
      isSuperAdmin: asBoolean(record?.IsSuperAdmin) ?? false,
    };
  });
}

/** Fallback usado por `createGroup` quando a resposta não ecoa `Participants`: assume não-admin. */
function toFallbackParticipant(id: string): GroupParticipant {
  return { id, isAdmin: false, isSuperAdmin: false };
}

// ---------------------------------------------------------------------------
// contacts.*
// ---------------------------------------------------------------------------

/**
 * `GET /user/contacts` — sem corpo. Resposta (`data`): um MAPA `JID(string) -> {Found, FirstName,
 * FullName, PushName, BusinessName, RedactedPhone?}` (chaves PascalCase, sem tags JSON no struct
 * Go — confirmado na pesquisa). A chave do mapa vira `Contact.id`; `name` usa `FullName` (fallback
 * `FirstName`, fallback `PushName`) — nenhum dos três é garantido presente para todo contato.
 *
 * Igual a `listGroups`, `raw` é o objeto DAQUELE contato específico (não o mapa inteiro) — cada
 * `Contact` preserva só o payload que o descreve.
 *
 * SEM `about`/`profilePictureUrl`/`hasWhatsApp` neste endpoint (nenhum campo equivalente na
 * resposta) — ficam `undefined` (ver `contacts.getAbout`/`contacts.getProfilePicture` para isso).
 */
async function listContacts(http: HttpClient): Promise<Contact[]> {
  const response = await http.request<WuzapiEnvelope>({ method: 'GET', path: '/user/contacts' });
  const data = asRecord(response.data);
  if (!data) return [];
  return Object.entries(data).map(([jid, value]) => {
    const record = asRecord(value);
    const name =
      asString(record?.FullName) ?? asString(record?.FirstName) ?? asString(record?.PushName);
    return { id: jid, name, raw: value };
  });
}

/**
 * `POST /user/info`, body `{Phone: [chatId]}` — compartilhado por `contacts.get` e
 * `contacts.getAbout` (mesmo endpoint, mesma extração; ver pesquisa do dossiê). Cada operação
 * canônica ainda dispara SUA PRÓPRIA chamada HTTP (uma por operação, ver ADR-0010) — esta função
 * só evita duplicar a extração da resposta entre as duas.
 *
 * Resposta (`data`): `{Users: {<JID>: {VerifiedName, Status, PictureID, Devices, LID}, ...}}` — um
 * MAPA (mesmo formato de `/user/contacts`), mas como só uma `Phone` é enviada por chamada, só uma
 * entrada é esperada; a primeira (e única) é usada, na ordem de inserção do objeto.
 */
async function fetchUserInfoEntry(
  http: HttpClient,
  chatId: string,
): Promise<{ entry: Record<string, unknown> | undefined; response: WuzapiEnvelope }> {
  const phone = toWuzapiPhone(chatId);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/user/info',
    body: { Phone: [phone] },
  });
  const data = asRecord(response.data);
  const usersMap = asRecord(data?.Users);
  const entry = usersMap ? firstRecordValue(usersMap) : undefined;
  return { entry, response };
}

/**
 * Não existe um endpoint único ideal de "getContact" no Wuzapi — `POST /user/info` é o melhor
 * match disponível (única chamada, ver ADR-0010). Mapeia `Status` -> `about`.
 *
 * - `name` fica `undefined`: a resposta não traz nome de exibição (mesma limitação do adapter
 *   Evolution GO, que usa a mesma lib `whatsmeow` subjacente).
 * - `profilePictureUrl` fica `undefined`: `PictureID` é só um identificador/hash interno da foto
 *   atual, NÃO a URL — popular a partir dele exigiria uma segunda chamada (`contacts.
 *   getProfilePicture`), que este adapter não compõe (regra de ouro do ADR-0010).
 * - `id` é o próprio `chatId` requisitado (já canônico, mesmo padrão de `mapSentMessage`), não a
 *   chave do mapa `Users` — evita depender do formato exato do JID de retorno.
 */
async function getContact(http: HttpClient, chatId: string): Promise<Contact> {
  const { entry, response } = await fetchUserInfoEntry(http, chatId);
  return { id: chatId, about: asString(entry?.Status), raw: response };
}

/**
 * `POST /user/check`, body `{Phone: [phone]}`. Resposta (`data`): `{Users: [{Query,
 * IsInWhatsapp, JID, VerifiedName}, ...]}` — um ARRAY (struct diferente do mapa de `getContact`,
 * sem tags JSON). Só uma `Phone` é enviada por chamada, então o primeiro item é usado.
 *
 * `JID` vem preenchido MESMO QUANDO `IsInWhatsapp` é `false` — é o JID sintetizado a partir do
 * número consultado, não uma confirmação de existência (documentado em
 * docs/providers/wuzapi.md). Ainda assim é mapeado para `chatId` sempre que presente, seguindo o
 * contrato de `CheckExistsResult.chatId` ("nem todos [providers] devolvem isso quando `exists` é
 * `false`" — aqui o Wuzapi devolve, só que sem valor de confirmação).
 */
async function checkContactExists(http: HttpClient, phone: string): Promise<CheckExistsResult> {
  const target = toWuzapiPhone(phone);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/user/check',
    body: { Phone: [target] },
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
 * `POST /user/avatar`, body `{Phone: chatId, Preview: false}`.
 *
 * ⚠️ **Divergência confirmada entre a doc e o código-fonte**: o `API.md` documenta um exemplo de
 * resposta DIFERENTE (objeto bare em PascalCase, sem o envelope `{code,success,data}`) — o
 * código-fonte real (`handlers.go`) usa tags JSON minúsculas e sempre embrulha em
 * `{code,success,data}`, igual a todo o resto da API. Este adapter confia no código-fonte:
 * `data = {url, id, type, direct_path, hash}`, e mapeia `data.url` -> `url`.
 *
 * ⚠️ **Divergência de método HTTP confirmada**: `API.md` documenta esta rota como `GET`, mas
 * `routes.go` registra o handler em `POST` — este adapter usa `POST` (confiando no código, não na
 * prosa da doc, mesmo critério já usado em outras divergências deste dossiê).
 */
async function getContactProfilePicture(
  http: HttpClient,
  chatId: string,
): Promise<ContactProfilePicture> {
  const phone = toWuzapiPhone(chatId);
  const response = await http.request<WuzapiEnvelope>({
    method: 'POST',
    path: '/user/avatar',
    body: { Phone: phone, Preview: false },
  });
  const data = asRecord(response.data);
  return { url: asString(data?.url), raw: response };
}

/** MESMO endpoint de `contacts.get` (`POST /user/info`) — reaproveita `fetchUserInfoEntry`, campo `Status`. */
async function getContactAbout(http: HttpClient, chatId: string): Promise<ContactAbout> {
  const { entry, response } = await fetchUserInfoEntry(http, chatId);
  return { about: asString(entry?.Status), raw: response };
}

/**
 * `POST /user/block`, body `{Phone: chatId}` (o servidor também aceita `{JID: chatId}`, mas este
 * adapter usa `Phone` por consistência com o resto do adapter — reaproveita `toWuzapiPhone`, mesmo
 * helper de `messages.*`). Resposta (`data`): `{Details: "User blocked", JID, Blocklist: string[],
 * DHash, RequestedJID?}` — ignorada, contrato retorna `Promise<void>` (mesmo padrão de operações
 * sem retorno, ex. `leaveGroupCall`/`updateGroupSubject`).
 *
 * O provider resolve internamente `@lid` -> telefone antes de bloquear quando aplicável —
 * transparente para este adapter, nenhum tratamento especial necessário.
 */
async function blockContact(http: HttpClient, chatId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/user/block',
    body: { Phone: toWuzapiPhone(chatId) },
  });
}

/**
 * `POST /user/unblock` — MESMO shape de `blockContact` (body `{Phone: chatId}`). Resposta (`data`):
 * `{Details: "User unblocked", JID, Blocklist, DHash, RequestedJID?}` — ignorada, `Promise<void>`.
 */
async function unblockContact(http: HttpClient, chatId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/user/unblock',
    body: { Phone: toWuzapiPhone(chatId) },
  });
}

/**
 * `GET /user/blocklist` — sem corpo. Resposta (`data`): `{Blocklist: string[] (NUNCA null — lista
 * vazia quando ninguém está bloqueado), DHash}`. Mapeia `data.Blocklist` -> array retornado, já no
 * formato canônico de chatId (mesmo formato usado como `Contact.id`).
 */
async function listBlockedContacts(http: HttpClient): Promise<string[]> {
  const response = await http.request<WuzapiEnvelope>({ method: 'GET', path: '/user/blocklist' });
  const data = asRecord(response.data);
  return asStringArray(data?.Blocklist);
}

/**
 * Extrai o primeiro valor de um mapa (`Record`), na ordem de inserção do objeto — usado quando a
 * resposta é um mapa `JID -> objeto` e só se espera uma única entrada (uma única `Phone`
 * requisitada por chamada, ver `fetchUserInfoEntry`).
 */
function firstRecordValue(record: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const value of Object.values(record)) {
    return asRecord(value);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// chats.*
// ---------------------------------------------------------------------------

/**
 * Converte o chatId canônico para o formato exigido especificamente por `POST /chat/archive`.
 *
 * Diferente de TODO outro endpoint deste adapter — que reaproveitam, do lado do servidor, o
 * helper interno lenient `parseJID` do Wuzapi (aceita dígitos crus, completando com
 * `@s.whatsapp.net` quando a string não contém `@`) — o handler `ArchiveChat` (`handlers.go`)
 * chama `types.ParseJID` (função CRUA da lib `whatsmeow`) diretamente sobre o campo `jid`, sem
 * passar pelo wrapper lenient. `types.ParseJID` EXIGE um `@` na própria string (retorna erro "no
 * server specified" quando ausente — confirmado no código-fonte, é o mesmo texto de erro que o
 * wrapper lenient repassa quando delega para essa mesma função no ramo "com @"): ou seja, ao
 * contrário de `Phone` em `sendText`/`sendReaction`/`chat/delete`/`chat/send/edit`, um chatId em
 * dígitos crus (sem `@`) FALHARIA neste endpoint específico se repassado como está. Este adapter
 * completa o sufixo `@s.whatsapp.net` quando o chatId não contém `@`, para que
 * `chats.archive`/`chats.unarchive` aceitem o mesmo formato de entrada (dígitos ou JID explícito)
 * que todo o resto do adapter — ver docs/providers/wuzapi.md.
 */
function toWuzapiChatJid(chatId: string): string {
  return chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
}

/**
 * `POST /chat/archive` — confirmado diretamente no código-fonte de `asternic/wuzapi` (branch
 * `main`, verificado em 2026-07-12; func `ArchiveChat`, `handlers.go` — o relatório de pesquisa
 * dedicado desta rodada não estava disponível para este provider, ver nota em
 * docs/providers/wuzapi.md). Corpo: `{jid, archive}` — **atenção**: tags JSON minúsculas
 * (`jid`/`archive`), diferente da maioria dos outros endpoints deste provider (mesma exceção já
 * documentada em `groups.create`, que também usa tags minúsculas).
 *
 * `archive` é um booleano: o MESMO endpoint cobre `chats.archive` (`archive: true`) E
 * `chats.unarchive` (`archive: false`) — mesmo padrão de endpoint único reaproveitado por
 * parâmetro já usado neste adapter em `getInviteLink`/`revokeInviteLink` (parâmetro `reset`) e em
 * `addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` (parâmetro
 * `Action`).
 *
 * Resposta confirmada: `{success: true, message: "Chat archived"|"Chat unarchived"}` — ignorada,
 * contrato retorna `Promise<void>` para as duas operações.
 */
async function setChatArchived(http: HttpClient, chatId: string, archive: boolean): Promise<void> {
  await http.request({
    method: 'POST',
    path: '/chat/archive',
    body: { jid: toWuzapiChatJid(chatId), archive },
  });
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
    case 'GroupInfo':
      return mapGroupInfoEvent(instanceId, data, body);
    case 'JoinedGroup':
      return [mapJoinedGroupEvent(instanceId, data, body)];
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

/**
 * `event` = whatsmeow `events.GroupInfo` serializado **verbatim** (RECONSTRUÍDO a partir do
 * código-fonte da lib `whatsmeow` via `wmiau.go`/`constants.go` — sem exemplo real capturado para
 * o Wuzapi especificamente; mesma metodologia "reconstruído" já usada no resto deste dossiê, por
 * analogia com o Evolution GO, que usa a mesma lib subjacente). O struct completo carrega TODAS as
 * mudanças possíveis de um grupo num único evento (`JID`, `Notify`, `Sender`, `SenderPN`,
 * `Timestamp`, `Name`, `Topic`, `Locked`, `Announce`, `Ephemeral`, `MembershipApprovalMode`,
 * `Delete`, `Link`, `Unlink`, `NewInviteLink`, `PrevParticipantVersionID`, `ParticipantVersionID`,
 * `JoinReason`, `Join`, `Leave`, `Promote`, `Demote`, `Suspended`, `Unsuspended`,
 * `UnknownChanges`) — este adapter só reconhece com confiança as mudanças de participante
 * (`Join`/`Leave`/`Promote`/`Demote`) e de metadado (`Name`/`Topic`), emitindo um
 * `GroupUpdateEvent` por mudança identificada (parseWebhook já retorna um array; várias mudanças
 * no MESMO payload de entrada viram várias entradas nesse array). Ver
 * docs/providers/wuzapi.md, seção "Webhooks de grupo", para o que ficou de fora e por quê.
 *
 * `Join`/`Leave`/`Promote`/`Demote` são tratados como arrays de JID em formato STRING
 * (`"<dígitos>@<server>"`), pela mesma convenção já usada em `info.Chat`/`info.Sender`
 * (`mapMessageEvent`) e em `Participants[].JID` (`mapGroupParticipants`) — **não há confirmação
 * específica** de que a lib serializa `types.JID` como string (em vez de um objeto
 * `{User,Server,...}`) exatamente nestes 4 campos; itens que não forem string são silenciosamente
 * descartados do array via `asStringArray` (nunca lança). Campos não reconhecidos
 * (`Locked`/`Announce`/`Ephemeral`/`MembershipApprovalMode`/etc.) não têm shape/exemplo confirmado
 * e não são mapeados nesta fase — se um evento só contiver mudanças não reconhecidas, cai em
 * `unknown` (nunca inventa um `action`/valor para elas).
 */
function mapGroupInfoEvent(
  instanceId: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent[] {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem campo "event".', instanceId)];
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem "event.JID".', instanceId)];
  }

  const events: GroupUpdateEvent[] = [];
  const pushParticipantChange = (action: string, value: unknown): void => {
    const participants = asStringArray(value);
    if (participants.length > 0) {
      events.push(groupUpdateEvent(instanceId, groupId, action, participants, rawBody));
    }
  };

  pushParticipantChange('participants.add', data.Join);
  pushParticipantChange('participants.remove', data.Leave);
  pushParticipantChange('participants.promote', data.Promote);
  pushParticipantChange('participants.demote', data.Demote);

  // Name/Topic são structs aninhados (`{Name,NameSetAt,...}`/`{Topic,TopicID,...}`) presentes só
  // quando aquele metadado específico mudou neste evento — a mera PRESENÇA do objeto (não seu
  // conteúdo, que não é usado aqui) indica a mudança. Nenhum "novo valor" é extraído/inventado:
  // quem consome o evento busca o valor atual via `groups.getInfo`, se precisar.
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
        'Evento "GroupInfo" sem mudança reconhecida (Join/Leave/Promote/Demote/Name/Topic ausentes ou não populados).',
        instanceId,
      ),
    ];
  }
  return events;
}

/**
 * `event` = `{Reason, Type, CreateKey, Sender, SenderPN, Notify}` + `types.GroupInfo` embutido
 * (`JID`, `Name`, `Participants`, ...) — RECONSTRUÍDO, mesma ressalva de `mapGroupInfoEvent`
 * (evento disparado quando a própria sessão é adicionada/entra num grupo). Só `event.JID` é usado
 * com confiança; `event.Participants` aqui é a lista **completa** do grupo (todos os membros, não
 * só quem entrou) — não é usada como `participants` do `GroupUpdateEvent` para não inventar "quem
 * entrou" a partir de um campo que não representa isso. `action: 'participants.add'` sozinho, sem
 * `participants`, é o que a pesquisa confirma com segurança.
 */
function mapJoinedGroupEvent(
  instanceId: string | undefined,
  data: Record<string, unknown> | undefined,
  rawBody: unknown,
): CanonicalEvent {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem campo "event".', instanceId);
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem "event.JID".', instanceId);
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
