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
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
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
  'messages.sendReaction',
  'messages.edit',
  'messages.delete',
  'messages.forward',
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
    sendReaction: (input) => sendReaction(http, prefix, input),
    edit: (input) => editMessage(http, prefix, input),
    delete: (input) => deleteMessage(http, prefix, input),
    forward: (input) => forwardMessage(http, prefix, input),
    pin: (input) => setMessagePinned(http, prefix, input, 'pin'),
    unpin: (input) => setMessagePinned(http, prefix, input, 'unpin'),
    markRead: (input) => markMessageRead(http, prefix, input),
  };

  const groups: GroupsApi = {
    create: (input) => createGroup(http, prefix, input),
    getInfo: (groupId) => getGroupInfo(http, prefix, groupId),
    list: () => listGroups(http, prefix),
    addParticipants: (input) => addGroupParticipants(http, prefix, input),
    removeParticipants: (input) => removeGroupParticipants(http, prefix, input),
    promoteParticipants: (input) => promoteGroupParticipants(http, prefix, input),
    demoteParticipants: (input) => demoteGroupParticipants(http, prefix, input),
    updateSubject: (input) => updateGroupSubject(http, prefix, input),
    updateDescription: (input) => updateGroupDescription(http, prefix, input),
    updatePicture: (input) => updateGroupPicture(http, prefix, input),
    getInviteLink: (groupId) => getGroupInviteLink(http, prefix, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, prefix, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, prefix, input),
    leaveGroup: (groupId) => leaveGroupCall(http, prefix, groupId),
  };

  const contacts: ContactsApi = {
    list: () => listContacts(http, prefix),
    get: (chatId) => getContact(http, prefix, chatId),
    checkExists: (phone) => checkContactExists(http, prefix, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, prefix, chatId),
    getAbout: (chatId) => getContactAbout(http, prefix, chatId),
    block: (chatId) => blockContact(http, prefix, chatId),
    unblock: (chatId) => unblockContact(http, prefix, chatId),
    // `listBlocked` deliberadamente NÃO implementado nem declarado em capabilities: busca
    // exaustiva nas 273 páginas do índice completo da doc oficial (contacts/*, chats/*,
    // privacy/*, etc.) não achou endpoint de listagem de contatos bloqueados. NÃO confundir com
    // `GET /privacy/get-disallowed-contacts` — essa é uma blacklist de PRIVACIDADE por capability
    // (quem fica de fora de "visto por último"/foto/descrição), uma feature adjacente porém
    // diferente da lista de contatos efetivamente bloqueados. Ver docs/providers/zapi.md#contatos.
  };

  const chats: ChatsApi = {
    archive: (chatId) => modifyChat(http, prefix, chatId, 'archive'),
    unarchive: (chatId) => modifyChat(http, prefix, chatId, 'unarchive'),
    mute: (chatId) => modifyChat(http, prefix, chatId, 'mute'),
    unmute: (chatId) => modifyChat(http, prefix, chatId, 'unmute'),
    pin: (chatId) => modifyChat(http, prefix, chatId, 'pin'),
    unpin: (chatId) => modifyChat(http, prefix, chatId, 'unpin'),
    // `markRead`/`markUnread`: mesmo endpoint `/modify-chat`, ação `read`/`unread` — confirmado na
    // doc oficial (`developer.z-api.io/chats/read-chat`, "Ler chats": "responsável por realizar a
    // ação de ler um chat como um todo, ou também marcar um chat como não lido"), mesmo shape
    // `{ phone, action }` -> `{ value: true }` dos outros 6 verbos deste endpoint. Achado corrigido
    // na verificação adversarial de 2026-07-12 (o relatório de pesquisa original não tinha
    // encontrado esta página, que fica no mesmo diretório `docs/chats/` já citado acima).
    markRead: (chatId) => modifyChat(http, prefix, chatId, 'read'),
    markUnread: (chatId) => modifyChat(http, prefix, chatId, 'unread'),
  };

  return {
    provider: PROVIDER,
    capabilities: ZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
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
 *
 * **Uso restrito a `to`/participantes individuais.** NUNCA rode o `groupId` (opaco, ver
 * `GroupInfo.id` e ADR-0009) por esta função: a Z-API usa um ID sintético de grupo SEM "@"
 * (`"{idNumerico}-group"` ou o formato legado `"{telefoneCriador}-{timestampUnix}"`) — como
 * `isJid()` checa só a presença de "@", esse ID cairia no ramo `digitsOnly()` e perderia o sufixo
 * `-group` ou os hífens. As funções de `groups.*` abaixo tratam `groupId` como string opaca,
 * repassada verbatim (path ou corpo, conforme o endpoint) — nunca via `toZapiPhone`.
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
 * A Z-API expõe DOIS endpoints distintos para reação, confirmados na doc oficial
 * (`developer.z-api.io/message/send-message-reaction` e `.../send-remove-reaction`):
 * `POST /send-reaction` (`{ phone, reaction, messageId, delayMessage? }`) para enviar, e
 * `POST /send-remove-reaction` (`{ phone, messageId, delayMessage? }` — SEM o campo `reaction`)
 * para remover. A doc não documenta "enviar `reaction` vazia" em `/send-reaction` como forma de
 * remoção — por isso este adapter respeita a convenção do contrato (ADR-0008: `emoji === ''`
 * remove uma reação anterior) roteando explicitamente para `/send-remove-reaction` nesse caso, em
 * vez de mandar `reaction: ''` para o endpoint de envio. Resposta confirmada idêntica nos dois
 * endpoints: `{ zaapId, messageId, id }` — mesmo shape de `mapSentMessage`. A doc confirma
 * explicitamente que dá para reagir tanto a mensagens enviadas quanto recebidas.
 */
async function sendReaction(
  http: HttpClient,
  prefix: string,
  input: SendReactionInput,
): Promise<SentMessage> {
  const phone = toZapiPhone(input.to);
  const isRemoval = input.emoji === '';
  const body: Record<string, unknown> = { phone, messageId: input.messageId };
  if (!isRemoval) {
    body.reaction = input.emoji;
  }
  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}${isRemoval ? '/send-remove-reaction' : '/send-reaction'}`,
    body,
  });
  return mapSentMessage(response, phone);
}

/**
 * `messages.edit` — MESMO endpoint de `messages.sendText` (`POST /send-text`), com o campo opcional
 * `editMessageId` no corpo (candidata confiança Alta no relatório de pesquisa dedicada de
 * capabilities novas, 2026-07-12 — já citado en passant no dossiê original como campo "não exposto
 * pelo contrato atual", ver docs/providers/zapi.md#operações-core). Body: `{ phone, message,
 * editMessageId }` — reaproveita 100% o mecanismo/resposta de `sendText` (`mapSentMessage`, mesmo
 * shape `{ zaapId, messageId, id }`).
 *
 * **Pré-requisito documentado explicitamente pela Z-API**: "É necessário configurar o webhook antes
 * de editar" — sem um webhook de recebimento configurado na instância, a doc afirma que a edição
 * não é aplicada. O adapter não valida isso (não há como checar de dentro de uma chamada HTTP
 * isolada); se a instância não tiver webhook configurado, a chamada provavelmente é aceita (200) mas
 * sem efeito real no WhatsApp — **não confirmado contra uma instância real** nesta pesquisa. Também
 * não confirmado se a Z-API preserva o `messageId` original (comportamento do WhatsApp oficial) ou
 * gera um novo, nem se há janela de tempo para editar. Ver docs/providers/zapi.md#edição-e-exclusão-
 * de-mensagem.
 */
async function editMessage(
  http: HttpClient,
  prefix: string,
  input: EditMessageInput,
): Promise<SentMessage> {
  const phone = toZapiPhone(input.to);
  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}/send-text`,
    body: { phone, message: input.text, editMessageId: input.messageId },
  });
  return mapSentMessage(response, phone);
}

/**
 * `messages.delete` — `DELETE /messages` (confiança Média no relatório de pesquisa dedicada,
 * 2026-07-12: único endpoint `DELETE` de toda a superfície Z-API pesquisada, com os parâmetros em
 * QUERY STRING em vez de corpo — incomum para um verbo que permite body). Query: `{ messageId,
 * phone, owner }`. Resposta `204` sem corpo — contrato retorna `void`.
 *
 * **Decisão de mapeamento não óbvia**: `owner` (booleano) indica se a mensagem original foi enviada
 * PELA própria instância (`true`) ou recebida (`false`) — a doc não expõe esse dado como algo
 * derivável de `DeleteMessageInput` (que só carrega `to`/`messageId`, sem indicar quem enviou a
 * mensagem original — ver ADR-0012, que também não modela escopo/`onlyLocal` no contrato canônico).
 * Este adapter sempre envia `owner: true`: a semântica assumida por `messages.delete` no contrato é
 * "sempre revogação" (apagar para todos, ADR-0012), e no protocolo real do WhatsApp só é possível
 * revogar/apagar-para-todos uma mensagem que a própria conta enviou (apagar uma mensagem recebida só
 * teria efeito "local", fora do que este contrato modela). **Não validado contra uma instância
 * real**: a doc não esclarece se `owner` de fato controla o escopo da exclusão ou se é só metadado —
 * se uma chamada real mostrar comportamento diferente para mensagens com `fromMe: false`, revisitar.
 */
async function deleteMessage(
  http: HttpClient,
  prefix: string,
  input: DeleteMessageInput,
): Promise<void> {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: 'DELETE',
    path: `${prefix}/messages`,
    query: { messageId: input.messageId, phone, owner: true },
  });
}

/**
 * `messages.forward` (ADR-0013) — `POST /forward-message`, confiança Média-Alta no relatório de
 * pesquisa dedicada. Body: `{phone, messageId, messagePhone}` — `phone` é o DESTINO
 * (`input.to`), `messagePhone` é a ORIGEM da mensagem (`ForwardMessageInput.fromChatId`,
 * obrigatório para este provider especificamente: diferente de outros adapters, a Z-API não
 * resolve a origem sozinha a partir do `messageId`). Quando `fromChatId` está ausente, este
 * adapter usa `phone` (destino) também como origem — best-effort, **não confirmado contra
 * instância real**; o chamador deve sempre informar `fromChatId` para encaminhar de um chat
 * diferente do destino. Resposta: `{zaapId}` só — **não** o trio completo `{zaapId, messageId, id}`
 * de `send-text`/`send-media` (um shape a menos); `mapSentMessage` cai no fallback de id sintético.
 */
async function forwardMessage(
  http: HttpClient,
  prefix: string,
  input: ForwardMessageInput,
): Promise<SentMessage> {
  const phone = toZapiPhone(input.to);
  const messagePhone = input.fromChatId ? toZapiPhone(input.fromChatId) : phone;
  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}/forward-message`,
    body: { phone, messageId: input.messageId, messagePhone },
  });
  return mapSentMessage(response, phone);
}

type ZapiPinAction = 'pin' | 'unpin';

/**
 * `messages.pin`/`unpin` (ADR-0013) — `POST /pin-message`, confiança Média-Alta. Body:
 * `{phone, messageId, messageAction: "pin"|"unpin", pinMessageDuration}` — a doc afirma
 * explicitamente que `pinMessageDuration` **"does not have effect in the case of unfixing a
 * message"**, então é enviado sempre, mesmo em `unpin` (ignorado pelo provider nesse caso).
 * Valores documentados: `"24_hours"`, `"7_days"`, `"30_days"` — `PinMessageInput` do contrato
 * canônico não expõe duração (ADR-0013); este adapter usa **`"24_hours"`** como default, decisão
 * própria. Resposta: `{zaapId, messageId, id}` (mesmo shape de `mapSentMessage`) — ignorada,
 * contrato retorna `Promise<void>`.
 */
async function setMessagePinned(
  http: HttpClient,
  prefix: string,
  input: PinMessageInput,
  action: ZapiPinAction,
): Promise<void> {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: 'POST',
    path: `${prefix}/pin-message`,
    body: {
      phone,
      messageId: input.messageId,
      messageAction: action,
      pinMessageDuration: '24_hours',
    },
  });
}

/**
 * `messages.markRead` (ADR-0013, nível de MENSAGEM) — `POST /read-message`, confiança Alta.
 * Body: `{phone, messageId}`. Resposta `204` vazia. Distinto de `chats.markRead` (nível de
 * conversa, `POST /modify-chat` com `action: "read"`, ADR-0012).
 */
async function markMessageRead(
  http: HttpClient,
  prefix: string,
  input: MarkMessageReadInput,
): Promise<void> {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: 'POST',
    path: `${prefix}/read-message`,
    body: { phone, messageId: input.messageId },
  });
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
// groups.*
// ---------------------------------------------------------------------------
//
// NOTA CRÍTICA (ver docs/providers/zapi.md#grupos-núcleo): o `groupId` da Z-API NÃO é um JID — é
// um identificador sintético sem "@" (`"{idNumerico}-group"` atual, ou o formato legado
// `"{telefoneCriador}-{timestampUnix}"`). Ele é tratado como string OPACA em toda função abaixo:
// repassado verbatim no path ou no corpo, NUNCA convertido por `toZapiPhone`/`digitsOnly` (que o
// corromperiam removendo o sufixo `-group` ou os hífens). Participantes individuais (dentro de
// `input.participants`), ao contrário, JÁ chegam normalizados pelo conector e se comportam como um
// `to` de mensagem comum — por isso reaproveitam `toZapiPhone`.

/**
 * `POST /create-group`. Corpo confirmado: `{ autoInvite, groupName, phones }` — `autoInvite: false`
 * é o default seguro adotado aqui (a doc não detalha o comportamento quando `true`, e
 * `CreateGroupInput` não expõe esse flag). A resposta (`{ phone, phonesNotAdded, invitationLink }`)
 * NÃO ecoa nome nem participantes — `phone` é o novo ID do grupo. `GroupInfo` é montado com
 * fallback nos valores de entrada (`subject`/`participants`) para os campos que a resposta não
 * traz, mesmo padrão de fallback já usado em `mapSentMessage`.
 */
async function createGroup(
  http: HttpClient,
  prefix: string,
  input: CreateGroupInput,
): Promise<GroupInfo> {
  const phones = input.participants.map(toZapiPhone);
  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}/create-group`,
    body: { autoInvite: false, groupName: input.subject, phones },
  });
  const record = asRecord(response);
  const id = (record ? asString(record.phone) : undefined) ?? `zapi-group-${Date.now()}`;
  return {
    id,
    subject: input.subject,
    participants: input.participants.map((participant) => ({
      id: participant,
      isAdmin: false,
      isSuperAdmin: false,
    })),
    raw: response,
  };
}

/**
 * `GET /group-metadata/{groupId}` — `groupId` vai NO PATH, verbatim (nunca convertido, ver nota
 * acima). Resposta confirmada: `{ phone, description, owner, subject, creation, invitationLink,
 * participants: [{ phone, isAdmin, isSuperAdmin, short?, name? }] }`.
 */
async function getGroupInfo(http: HttpClient, prefix: string, groupId: string): Promise<GroupInfo> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `${prefix}/group-metadata/${groupId}`,
  });
  return mapGroupInfo(response, groupId);
}

function mapGroupInfo(body: unknown, requestedGroupId: string): GroupInfo {
  const record = asRecord(body);
  return {
    id: (record ? asString(record.phone) : undefined) ?? requestedGroupId,
    subject: (record ? asString(record.subject) : undefined) ?? '',
    description: record ? asString(record.description) : undefined,
    owner: record ? asString(record.owner) : undefined,
    participants: (record ? asRecordArray(record.participants) : []).map(mapGroupParticipant),
    raw: body,
  };
}

function mapGroupParticipant(record: Record<string, unknown>): GroupParticipant {
  return {
    id: asString(record.phone) ?? '',
    isAdmin: asBoolean(record.isAdmin) ?? false,
    isSuperAdmin: asBoolean(record.isSuperAdmin) ?? false,
  };
}

/**
 * `GET /groups` — exige paginação (`page`/`pageSize`) como query params; `GroupsApi.list()` não
 * expõe paginação no contrato canônico, então usamos um default único e razoável
 * (`page=1, pageSize=100`). A resposta é uma lista de objetos LEVES (`{ isGroup: true, name,
 * phone }`), SEM `description`/`owner`/`participants` — por isso cada `GroupInfo` desta lista vem
 * com `participants: []` (limitação documentada; para os participantes de um grupo específico, use
 * `groups.getInfo`).
 */
async function listGroups(http: HttpClient, prefix: string): Promise<GroupInfo[]> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `${prefix}/groups`,
    query: { page: 1, pageSize: 100 },
  });
  return asRecordArray(response).map((item) => ({
    id: asString(item.phone) ?? '',
    subject: asString(item.name) ?? '',
    participants: [],
    raw: item,
  }));
}

/**
 * `POST /add-participant` (SINGULAR — não "participants", desvio de nome confirmado na pesquisa).
 * Corpo `{ autoInvite, groupId, phones }`: `groupId` vai NO CORPO (não no path) e verbatim
 * (opaco); `phones` reaproveita `toZapiPhone` sobre cada participante (já normalizado pelo
 * conector). Retorna `void` — o contrato de `GroupsApi.addParticipants` não pede o grupo
 * atualizado de volta.
 */
async function addGroupParticipants(
  http: HttpClient,
  prefix: string,
  input: GroupParticipantsInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/add-participant`,
    body: {
      autoInvite: false,
      groupId: input.groupId,
      phones: input.participants.map(toZapiPhone),
    },
  });
}

/**
 * `POST /remove-participant` (singular). Corpo `{ groupId, phones }` — sem `autoInvite` (não se
 * aplica a uma remoção).
 */
async function removeGroupParticipants(
  http: HttpClient,
  prefix: string,
  input: GroupParticipantsInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/remove-participant`,
    body: { groupId: input.groupId, phones: input.participants.map(toZapiPhone) },
  });
}

/**
 * `POST /add-admin` — nome do endpoint NÃO é "promote" (desvio de nome confirmado na pesquisa).
 * Corpo `{ groupId, phones }`, mesmo shape de `removeGroupParticipants`.
 */
async function promoteGroupParticipants(
  http: HttpClient,
  prefix: string,
  input: GroupParticipantsInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/add-admin`,
    body: { groupId: input.groupId, phones: input.participants.map(toZapiPhone) },
  });
}

/**
 * `POST /remove-admin` — nome do endpoint NÃO é "demote" (desvio de nome confirmado na pesquisa).
 * Corpo `{ groupId, phones }`, mesmo shape de `promoteGroupParticipants`.
 */
async function demoteGroupParticipants(
  http: HttpClient,
  prefix: string,
  input: GroupParticipantsInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/remove-admin`,
    body: { groupId: input.groupId, phones: input.participants.map(toZapiPhone) },
  });
}

/**
 * `POST /update-group-name`. Corpo `{ groupId, groupName }` — `groupId` no corpo, verbatim (opaco,
 * ver nota acima); `subject` (não vazio, já validado pelo conector) mapeado para `groupName`.
 * Resposta confirmada `{ value: true }` — sem informação adicional a extrair, por isso `void`.
 */
async function updateGroupSubject(
  http: HttpClient,
  prefix: string,
  input: UpdateGroupSubjectInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/update-group-name`,
    body: { groupId: input.groupId, groupName: input.subject },
  });
}

/**
 * `POST /update-group-description`. Corpo `{ groupId, groupDescription }` — `groupDescription`
 * vazia é permitida (o conector já valida que `description` é string, inclusive vazia, para
 * limpar a descrição do grupo). Resposta confirmada `{ value: true }` — `void`.
 */
async function updateGroupDescription(
  http: HttpClient,
  prefix: string,
  input: UpdateGroupDescriptionInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/update-group-description`,
    body: { groupId: input.groupId, groupDescription: input.description },
  });
}

/**
 * `POST /update-group-photo`. Corpo `{ groupId, groupPhoto }` — `groupPhoto` aceita URL OU data URI
 * base64, mesma convenção já usada por `messages.sendMedia` (`resolveMediaValue`, reaproveitada
 * aqui): se `media.url` estiver presente, é usado como está; senão `media.base64` é embrulhado numa
 * data URI (usando `media.mimeType` ou o mimetype-padrão de imagem, se ausente). `media.kind` já
 * chega garantido como `'image'` pelo conector. Resposta confirmada `{ value: true }` — `void`.
 */
async function updateGroupPicture(
  http: HttpClient,
  prefix: string,
  input: UpdateGroupPictureInput,
): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/update-group-photo`,
    body: { groupId: input.groupId, groupPhoto: resolveMediaValue(input.media) },
  });
}

/**
 * `GET /group-invitation-link/{groupId}` — `groupId` no PATH, verbatim (opaco, ver nota acima).
 * Resposta confirmada: `{ phone, invitationLink }` — `invitationLink` já vem como link completo
 * (`https://chat.whatsapp.com/<código>`). Passa por `normalizeInviteLink` mesmo assim, como camada
 * defensiva e idempotente (mesmo padrão adotado pelos adapters Evolution GO/Wuzapi para este mesmo
 * campo) — não deveria alterar o valor na prática, mas protege contra alguma variação de resposta
 * que devolva só o código bare.
 */
async function getGroupInviteLink(
  http: HttpClient,
  prefix: string,
  groupId: string,
): Promise<GroupInviteLink> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `${prefix}/group-invitation-link/${groupId}`,
  });
  return mapGroupInviteLink(response);
}

/**
 * `POST /redefine-invitation-link/{groupId}` — `groupId` no PATH, verbatim; SEM corpo (nenhum
 * campo de corpo documentado para esta operação). Resposta confirmada: `{ invitationLink }` — o
 * NOVO link completo do grupo (o link anterior deixa de funcionar a partir desta chamada). Mesmo
 * mapeamento de `getGroupInviteLink`.
 */
async function revokeGroupInviteLink(
  http: HttpClient,
  prefix: string,
  groupId: string,
): Promise<GroupInviteLink> {
  const response = await http.request<unknown>({
    method: 'POST',
    path: `${prefix}/redefine-invitation-link/${groupId}`,
  });
  return mapGroupInviteLink(response);
}

function mapGroupInviteLink(body: unknown): GroupInviteLink {
  const record = asRecord(body);
  const invitationLink = (record ? asString(record.invitationLink) : undefined) ?? '';
  return { link: normalizeInviteLink(invitationLink), raw: body };
}

/**
 * `GET /accept-invite-group` — query param `url` recebe a URL COMPLETA do convite (a doc não
 * confirma que o endpoint aceita só o código bare, então `input.invite` — já normalizado como link
 * completo pelo conector, ver `WaConnector.prepareJoinViaInviteLink` — é usado diretamente, SEM
 * `extractInviteCode`). Resposta confirmada `{ success: true }` — ignorada, a operação canônica
 * retorna `Promise<void>`. **Quirk de método**: é GET apesar do efeito colateral, mesma
 * particularidade já documentada para `/disconnect` (ver `logoutInstance`).
 */
async function joinGroupViaInviteLink(
  http: HttpClient,
  prefix: string,
  input: JoinGroupInviteInput,
): Promise<void> {
  await http.request({
    method: 'GET',
    path: `${prefix}/accept-invite-group`,
    query: { url: input.invite },
  });
}

/**
 * `POST /leave-group`. Corpo `{ groupId }` — `groupId` no CORPO (diferente de
 * `getGroupInviteLink`/`revokeGroupInviteLink`, que levam o groupId no path), verbatim (opaco, ver
 * nota acima). Resposta confirmada `{ value: true }` — `void`.
 */
async function leaveGroupCall(http: HttpClient, prefix: string, groupId: string): Promise<void> {
  await http.request({
    method: 'POST',
    path: `${prefix}/leave-group`,
    body: { groupId },
  });
}

// ---------------------------------------------------------------------------
// contacts.* (ver ADR-0010)
// ---------------------------------------------------------------------------
//
// NOTA CRÍTICA: diferente de `groupId` (opaco, ver seção groups.* acima), o chatId de contato NÃO
// é opaco — é o MESMO chatId canônico usado por `messages.*`. Este bloco reaproveita `toZapiPhone`
// (definida em "map-out" acima) nos DOIS sentidos: canônico → Z-API (para montar path/query) E
// Z-API → canônico (para mapear o "phone"/"lid" de uma resposta de volta para `Contact.id`/
// `CheckExistsResult.chatId`). Isso é seguro porque a regra de `toZapiPhone` é simétrica: um JID
// explícito (qualquer string com "@") sempre passa intacto, e qualquer outra string sempre vira
// dígitos puros — não importa se ela já veio em dígitos puros (idempotente) ou como um "@lid"
// opaco (contato com privacidade ativada, tratado como JID pela mesma checagem `isJid`).
//
// Regra de ouro desta capability (ADR-0010): cada operação mapeia para UMA ÚNICA chamada HTTP ao
// provider — nunca duas chamadas compostas atrás de uma única operação canônica. `getAbout`
// reaproveita a mesma função interna de `get` (`fetchContactDetail`) porque ambas apontam para o
// MESMO endpoint (`GET /contacts/{phone}`), não porque uma chama a outra.

/**
 * `GET /contacts` — exige paginação (`page`, `pageSize`) como query params; `ContactsApi.list()`
 * não expõe paginação no contrato canônico, então usamos o mesmo default fixo já adotado por
 * `groups.list` (`page=1, pageSize=100`). Resposta: array de `{ name?, short?, notify?, vname?,
 * phone }`. **Limitação documentada**: este endpoint NÃO devolve `about`/`imgUrl`/confirmação de
 * "tem WhatsApp" — por isso todo `Contact` desta lista vem com `about`/`profilePictureUrl`/
 * `hasWhatsApp` indefinidos (use `contacts.get`/`getProfilePicture`/`checkExists` para esses
 * campos, um contato por vez).
 */
async function listContacts(http: HttpClient, prefix: string): Promise<Contact[]> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: `${prefix}/contacts`,
    query: { page: 1, pageSize: 100 },
  });
  return asRecordArray(response).map(mapContactListItem);
}

function mapContactListItem(record: Record<string, unknown>): Contact {
  const phone = asString(record.phone) ?? '';
  return {
    id: toZapiPhone(phone),
    name: asString(record.name) ?? asString(record.notify) ?? asString(record.short),
    raw: record,
  };
}

/**
 * `GET /contacts/{phone}` — `phone` no PATH, convertido do chatId canônico via `toZapiPhone`. É a
 * resposta MAIS RICA entre os providers pesquisados para esta capability: `{ name, phone, notify,
 * short, imgUrl, about }` num único endpoint. Reaproveitada também por `getContactAbout` (mesmo
 * endpoint, ver nota acima) — por isso a chamada HTTP em si vive em `fetchContactDetail`.
 */
async function fetchContactDetail(http: HttpClient, prefix: string, chatId: string) {
  const phone = toZapiPhone(chatId);
  return http.request<unknown>({ method: 'GET', path: `${prefix}/contacts/${phone}` });
}

async function getContact(http: HttpClient, prefix: string, chatId: string): Promise<Contact> {
  const response = await fetchContactDetail(http, prefix, chatId);
  return mapContact(response, chatId);
}

/**
 * SEM `hasWhatsApp` explícito nesta resposta (é isso que `contacts.checkExists` confirma) —
 * mapeamento direto: `name` (fallback `notify`) → `name`, `imgUrl` → `profilePictureUrl`, `about`
 * → `about`. `id` cai de volta no `phone` da resposta (convertido de volta ao formato canônico via
 * `toZapiPhone`, ver nota do bloco), com fallback no chatId requisitado (mesmo padrão de fallback
 * já usado em `mapGroupInfo`/`mapSentMessage`).
 */
function mapContact(body: unknown, requestedChatId: string): Contact {
  const record = asRecord(body);
  const responsePhone = record ? asString(record.phone) : undefined;
  return {
    id: responsePhone ? toZapiPhone(responsePhone) : requestedChatId,
    name:
      (record ? asString(record.name) : undefined) ??
      (record ? asString(record.notify) : undefined),
    about: record ? asString(record.about) : undefined,
    profilePictureUrl: record ? asString(record.imgUrl) : undefined,
    raw: body,
  };
}

/**
 * `GET /phone-exists/{phone}` — `phone` no PATH (a doc oficial rotula a seção como "Query
 * Parameters", mas o exemplo `curl` real confirma path — o adapter segue o `curl`, não o cabeçalho
 * de prosa). Resposta: ARRAY com um único item, `[{ exists, phone, lid }]` (`lid` é `string |
 * null`). Pega o primeiro item; mapeia `exists` → `exists`, e `lid` (quando presente, contato com
 * privacidade ativada) OU `phone` → `chatId` — ambos passam por `toZapiPhone` (reverso) para
 * garantir o formato canônico (JID intacto se `lid` vier como `"...@lid"`, dígitos puros senão).
 */
async function checkContactExists(
  http: HttpClient,
  prefix: string,
  phone: string,
): Promise<CheckExistsResult> {
  const zapiPhone = toZapiPhone(phone);
  const response = await http.request<unknown>({
    method: 'GET',
    path: `${prefix}/phone-exists/${zapiPhone}`,
  });
  const items = asRecordArray(response);
  const item = items[0];
  if (!item) {
    return { exists: false, raw: response };
  }
  const resolvedId = asString(item.lid) ?? asString(item.phone);
  return {
    exists: asBoolean(item.exists) ?? false,
    chatId: resolvedId ? toZapiPhone(resolvedId) : undefined,
    raw: response,
  };
}

/**
 * `GET /profile-picture` — `phone` como QUERY param (não path, diferente de `get`/`checkExists`).
 * Resposta: `{ link: string }` → `ContactProfilePicture.url`. `link` ausente/vazio (contato sem
 * foto ou privacidade que bloqueia) vira `url: undefined`, nunca lança.
 */
async function getContactProfilePicture(
  http: HttpClient,
  prefix: string,
  chatId: string,
): Promise<ContactProfilePicture> {
  const phone = toZapiPhone(chatId);
  const response = await http.request<unknown>({
    method: 'GET',
    path: `${prefix}/profile-picture`,
    query: { phone },
  });
  const record = asRecord(response);
  return { url: record ? asString(record.link) : undefined, raw: response };
}

/**
 * MESMO endpoint de `getContact` (`GET /contacts/{phone}`) — reaproveita `fetchContactDetail` em
 * vez de compor uma segunda chamada (ADR-0010: uma operação canônica, uma chamada HTTP). O campo
 * `about` já vem embutido nessa resposta.
 */
async function getContactAbout(
  http: HttpClient,
  prefix: string,
  chatId: string,
): Promise<ContactAbout> {
  const response = await fetchContactDetail(http, prefix, chatId);
  const record = asRecord(response);
  return { about: record ? asString(record.about) : undefined, raw: response };
}

/**
 * `contacts.block`/`contacts.unblock` usam o MESMO endpoint (`POST /contacts/modify-blocked`),
 * discriminado pelo campo `action: 'block' | 'unblock'` — mesmo padrão de "um endpoint, vários
 * verbos canônicos" já usado por `messages.sendReaction`/`send-remove-reaction` (só que ali são
 * dois endpoints; aqui é um endpoint com dois valores de `action`). `phone` recebe o chatId
 * canônico via `toZapiPhone` (a mesma função usada pelo restante de `contacts.*`/`messages.*`) —
 * chatId de contato NÃO é opaco (ver ADR-0010). Resposta confirmada `{ value: true }` — ignorada,
 * o contrato exige apenas `Promise<void>`.
 */
async function setContactBlocked(
  http: HttpClient,
  prefix: string,
  chatId: string,
  action: 'block' | 'unblock',
): Promise<void> {
  const phone = toZapiPhone(chatId);
  await http.request({
    method: 'POST',
    path: `${prefix}/contacts/modify-blocked`,
    body: { phone, action },
  });
}

async function blockContact(http: HttpClient, prefix: string, chatId: string): Promise<void> {
  await setContactBlocked(http, prefix, chatId, 'block');
}

async function unblockContact(http: HttpClient, prefix: string, chatId: string): Promise<void> {
  await setContactBlocked(http, prefix, chatId, 'unblock');
}

// ---------------------------------------------------------------------------
// chats.* (ver ADR-0012)
// ---------------------------------------------------------------------------
//
// Oito operações de "modificar conversa" dividem o MESMO endpoint (`POST /modify-chat`),
// discriminadas só pelo campo `action` — candidatas confiança Média-Alta no relatório de pesquisa
// dedicada de capabilities novas (2026-07-12), mesmo padrão "um endpoint, N verbos" já usado por
// `contacts.block`/`unblock` acima. `chatId` NÃO é opaco (diferente de `groupId`, ver seção
// groups.* acima) — mesmo chatId canônico de `messages.*`/`contacts.*`, por isso reaproveita
// `toZapiPhone` (ADR-0012, ponto 4). Resposta confirmada `{ value: true }` em todos os 8 casos —
// ignorada, contrato exige apenas `Promise<void>`.

type ZapiChatAction =
  | 'archive'
  | 'unarchive'
  | 'mute'
  | 'unmute'
  | 'pin'
  | 'unpin'
  | 'read'
  | 'unread';

async function modifyChat(
  http: HttpClient,
  prefix: string,
  chatId: string,
  action: ZapiChatAction,
): Promise<void> {
  const phone = toZapiPhone(chatId);
  await http.request({
    method: 'POST',
    path: `${prefix}/modify-chat`,
    body: { phone, action },
  });
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
      // Notificações de grupo NÃO têm webhook dedicado — chegam pelo MESMO "type" de mensagem,
      // discriminadas pelo campo adicional `record.notification`. Checagem ANTES do dispatch de
      // mensagem normal: ver `mapGroupNotification` para o que é/não é reconhecido.
      const groupEvents = mapGroupNotification(record, body, instanceId);
      if (groupEvents) return groupEvents;

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
 * Notificações de grupo (entrada/saída/promoção/demoção de participante) chegam pelo MESMO `type`
 * "ReceivedCallback" das mensagens — não há webhook de configuração dedicado para elas. São
 * discriminadas pelo campo adicional `record.notification` (string, enum), presente no mesmo
 * envelope de sempre. Payload confirmado (schema comum a TODAS as notificações, exemplificado
 * literalmente para `MEMBERSHIP_APPROVAL_REQUEST`/`REVOKED_MEMBERSHIP_REQUESTS`): `{ isGroup: true,
 * ..., phone: string (= groupId), notification: string, notificationParameters: string[] }`.
 *
 * A doc confirma POR NOME um enum de 10 valores `GROUP_*`, mas só os 2 exemplos acima (adjacentes,
 * porém DIFERENTES dos 10) têm payload literal — nenhum valor `GROUP_*` tem exemplo próprio
 * capturado na pesquisa. Por isso, só as 5 variantes de PARTICIPANTE são reconhecidas aqui
 * (confiança razoável, por analogia estrutural forte com o envelope confirmado — mesmo formato de
 * `phone`/`notificationParameters`):
 *
 * - `GROUP_PARTICIPANT_ADD` → `action: 'participants.add'`
 * - `GROUP_PARTICIPANT_REMOVE` → `action: 'participants.remove'`
 * - `GROUP_PARTICIPANT_LEAVE` → `action: 'participants.remove'` (MESMA action de REMOVE: do ponto
 *   de vista canônico, ambos resultam em "não é mais participante do grupo", e
 *   `GroupUpdateEvent.action` não distingue "saiu por conta própria" de "foi removido" — decisão
 *   documentada em docs/providers/zapi.md)
 * - `GROUP_PARTICIPANT_PROMOTE` → `action: 'participants.promote'`
 * - `GROUP_PARTICIPANT_DEMOTE` → `action: 'participants.demote'`
 *
 * Deliberadamente FORA desta fase (zero exemplo de payload — implementar seria adivinhar o formato
 * do "novo valor"): `GROUP_CREATE`, `GROUP_CHANGE_SUBJECT`, `GROUP_CHANGE_DESCRIPTION`,
 * `GROUP_CHANGE_ICON`, `GROUP_PARTICIPANT_INVITE`. Para esses (e qualquer `notification`
 * desconhecido), retorna `undefined` — o record segue para `mapZapiMessage`, que trata como
 * mensagem comum (cai em `MessageKind: 'unknown'` se não bater com nenhuma chave de conteúdo
 * reconhecida). Nunca lança, nunca inventa campo (ADR-0002/ADR-0003).
 *
 * `groupId` reaproveita a mesma convenção de fallback de `mapZapiMessage.chatId` (`'unknown'` se
 * `phone` ausente, nunca lança). Devolve sempre array de 1 evento nesta fase (nenhum exemplo real de
 * múltiplas mudanças simultâneas neste provider) — a assinatura já retorna array por consistência
 * com o restante de `parseWebhookUnsafe`.
 */
function mapGroupNotification(
  record: Record<string, unknown>,
  rawBody: unknown,
  instanceId: string | undefined,
): CanonicalEvent[] | undefined {
  const action = mapGroupNotificationAction(asString(record.notification));
  if (!action) return undefined;

  return [
    {
      type: 'group.update',
      provider: PROVIDER,
      instanceId,
      groupId: asString(record.phone) ?? 'unknown',
      action,
      participants: asStringArray(record.notificationParameters),
      raw: rawBody,
    },
  ];
}

/** Ver `mapGroupNotification` para a fonte/confiança de cada mapeamento. */
function mapGroupNotificationAction(notification: string | undefined): string | undefined {
  switch (notification) {
    case 'GROUP_PARTICIPANT_ADD':
      return 'participants.add';
    case 'GROUP_PARTICIPANT_REMOVE':
    case 'GROUP_PARTICIPANT_LEAVE':
      return 'participants.remove';
    case 'GROUP_PARTICIPANT_PROMOTE':
      return 'participants.promote';
    case 'GROUP_PARTICIPANT_DEMOTE':
      return 'participants.demote';
    default:
      return undefined;
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

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : [];
}
