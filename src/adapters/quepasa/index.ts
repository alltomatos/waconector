import type {
  ContactsApi,
  GroupsApi,
  InstanceApi,
  MessagesApi,
  WaAdapter,
  WebhookInput,
} from '../../core/adapter';
import type { CapabilitySet } from '../../core/capabilities';
import { normalizeInviteLink } from '../../core/chat-id';
import { WaConnectorError } from '../../core/errors';
import type { CanonicalEvent, UnknownEvent } from '../../core/events';
import { HttpClient } from '../../core/http';
import type {
  ConnectResult,
  ContactProfilePicture,
  GroupInviteLink,
  InstanceState,
  InstanceStatus,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  SendMediaInput,
  SendTextInput,
  SentMessage,
  WaMessage,
} from '../../core/types';

/**
 * Opções do adapter QuePasa (self-hosted via Docker, `nocodeleaks/quepasa` — construído sobre
 * `tulir/whatsmeow`, mesma base do Wuzapi).
 *
 * ⚠️ **Fonte da pesquisa**: o repositório canônico `github.com/nocodeleaks/quepasa` está bloqueado
 * no GitHub por um aviso de DMCA (não relacionado a mensagens/webhooks — o aviso é sobre um módulo
 * de VoIP, `src/voip/calls`). A pesquisa usada para este adapter foi feita em dois forks/mirrors
 * (`botarenaweb/Quepasa-api`, snapshot ~2023-04-20, e `deivisonrpg/quepasa`, snapshot 2026-07-07 —
 * o mais recente disponível; note-se que o GitHub reporta `fork: false` para este último, sem
 * repositório-pai registrado — é tratado aqui como snapshot/mirror independente, não um "fork"
 * formal), não no repo oficial. Ver docs/providers/quepasa.md para a discussão completa de
 * confiança/gaps por seção.
 *
 * @see docs/providers/quepasa.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
export interface QuepasaOptions {
  /**
   * URL base da instância QuePasa self-hosted (ex.: `http://localhost:31000`). Sem padrão — cada
   * implantação Docker define seu próprio host/porta, mesmo padrão dos demais adapters self-hosted
   * deste pacote (WAHA/Evolution GO/uazapi/Wuzapi).
   */
  baseUrl: string;
  /**
   * Token da instância ("server"/"bot"), uma string ARBITRÁRIA escolhida pelo cliente — não é uma
   * API key emitida pelo servidor. Não existe passo explícito de "criar instância": o registro só é
   * persistido quando o pareamento via QR é confirmado (`OnPaired`). Ver
   * docs/providers/quepasa.md#autenticação.
   */
  token: string;
  /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
  retries?: number;
  /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
  fetch?: typeof globalThis.fetch;
}

const PROVIDER = 'quepasa';

/**
 * Capabilities desta fase — deliberadamente MENORES que o "conjunto núcleo" dos demais adapters
 * (que sempre inclui os 3 `instance.*`). Ver docs/providers/quepasa.md para a justificativa
 * detalhada de cada exclusão; resumo:
 *
 * - `instance.connect` **NÃO declarada**: `GET /scan` devolve a imagem PNG *crua* do QR code
 *   (`Content-Type: image/png`), não JSON com base64 como todo outro provider deste pacote. O
 *   `HttpClient` do core decodifica toda resposta não-JSON via `response.text()` (UTF-8), o que
 *   CORROMPE IRREVERSIVELMENTE bytes binários de PNG (sequências inválidas viram U+FFFD). Não há,
 *   com o `HttpClient` atual, como entregar um `ConnectResult.qr` utilizável — declarar a
 *   capability mesmo assim seria "arredondar para cima" um recurso que não funciona de fato. Exige
 *   estender o core para um modo de resposta binária (ArrayBuffer), fora do escopo desta fase (não
 *   modificamos `src/core/http.ts` sem uma necessidade genuinamente nova documentada num ADR
 *   dedicado). `connectInstance` abaixo ainda é implementada (obrigatória por `InstanceApi`) para
 *   quem quiser chamar `adapter.instance.connect()` diretamente sabendo da limitação.
 * - `instance.pairingCode` **NÃO declarada**: a interface de conexão do QuePasa
 *   (`IWhatsappConnection`) só expõe métodos de QR (`GetWhatsAppQRChannel`/`GetWhatsAppQRCode`) —
 *   sem pareamento por telefone, mesmo obstáculo estrutural já documentado nos demais adapters.
 * - `instance.logout` **declarada, mas documentada como soft-stop**: o único endpoint acessível
 *   via token de instância (`action=stop`) desconecta o socket e limpa handlers, mas PRESERVA as
 *   credenciais salvas — não é um logout de verdade (que exigiria `POST /form/delete`, autenticado
 *   por cookie JWT de usuário/senha, fora do modelo de token deste contrato). Ver
 *   `logoutInstance` abaixo.
 * - `groups.*`/`contacts.*` (além de `getInviteLink`/`getProfilePicture`) e `messages.sendReaction`:
 *   NÃO é "zero resultados no provider" — o snapshot mais recente pesquisado (`deivisonrpg/quepasa`,
 *   2026-07-07) TEM uma API v5 "canônica" completa para os três: reações (`SendReaction` em
 *   `src/whatsmeow/whatsmeow_extensions+reactions.go`, exposta via `POST/DELETE /messages/react`),
 *   grupos (`src/api/api_routes_groups.go`: list/create/get/leave/patch/name/description/
 *   participants/photo/requests/invite/revoke-invite) e contatos (`src/api/api_routes_contacts.go`:
 *   list/identifier/search/get/availability/block/unblock/save). O que bloqueia esta fase é que
 *   essas rotas exigem `jwtauth.Verifier` + `AuthenticatedAPIHandler` (parte também
 *   `requireOwnedServerToken -> GetAuthenticatedUser`) — sessão de USUÁRIO via JWT, incompatível com
 *   o modelo de token por instância (`X-QUEPASA-TOKEN`) usado por este adapter. Se um token de
 *   instância consegue obter um JWT (e portanto se esta API v5 é alcançável a partir do modelo deste
 *   contrato) NÃO foi verificado. Ver
 *   docs/providers/quepasa.md#capabilities-confirmadas-mas-não-implementadas-nesta-fase.
 */
const QUEPASA_CAPABILITIES: CapabilitySet = [
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'groups.getInviteLink',
  'contacts.getProfilePicture',
  'webhooks.parse',
];

/** Fábrica do adapter QuePasa. */
export function quepasa(options: QuepasaOptions): WaAdapter {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    // Header confirmado no código-fonte (`GetRequestParameter`, prioridade path -> query -> form ->
    // header): `X-QUEPASA-TOKEN`. Enviado em toda requisição; para as rotas v3 (`/v3/bot/{token}/...`)
    // o token TAMBÉM precisa estar embutido no path (ver `botPath`) — o roteador `chi` exige um
    // segmento naquela posição para casar a rota, e ele tem precedência sobre qualquer header/query.
    headers: { 'X-QUEPASA-TOKEN': options.token },
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
    sendText: (input) => sendText(http, options.token, input),
    sendMedia: (input) => sendMedia(http, options.token, input),
  };

  // Só o único endpoint de grupo confirmado pela pesquisa (ver QUEPASA_CAPABILITIES acima).
  const groups: GroupsApi = {
    getInviteLink: (groupId) => getGroupInviteLink(http, options.token, groupId),
  };

  // Só o único endpoint de contato confirmado pela pesquisa (ver QUEPASA_CAPABILITIES acima).
  const contacts: ContactsApi = {
    getProfilePicture: (chatId) => getContactProfilePicture(http, options.token, chatId),
  };

  return {
    provider: PROVIDER,
    capabilities: QUEPASA_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    parseWebhook: (input) => parseWebhook(input),
  };
}

// ---------------------------------------------------------------------------
// map-out: canônico -> QuePasa
// ---------------------------------------------------------------------------

/**
 * `FormatEndpoint` (código-fonte) aceita, para o destinatário: telefone com `+`, dígitos E.164
 * puros, JID completo (`...@s.whatsapp.net`/`...@g.us`) ou o formato legado de grupo
 * `numero-timestamp` sem `@` (vira `@g.us`) — o chatId canônico do waconector (dígitos crus OU JID
 * explícito, ver `normalizeChatId`) já bate 1:1 sem transformação. Função identidade mantida como
 * ponto único de mudança, mesmo padrão do `toWhapiChatId`/`toWuzapiPhone` dos demais adapters.
 */
function toQuepasaChatId(chatId: string): string {
  return chatId;
}

/** Monta o path `/v3/bot/{token}/<sufixo>` — o token PRECISA estar no path para estas rotas (ver factory acima). */
function botPath(token: string, suffix: string): string {
  return `/v3/bot/${encodeURIComponent(token)}${suffix}`;
}

// ---------------------------------------------------------------------------
// instance.*
// ---------------------------------------------------------------------------

/**
 * `GET /scan` (aliases confirmados no código: `""`, `/current`, `/v4` — usamos a raiz). Chamada
 * bloqueante: aguarda o whatsmeow emitir o primeiro evento "code" do canal de pareamento antes de
 * responder — side effect real e confirmado (dispara a geração do QR no servidor), mesmo que este
 * adapter não consiga relatar um `qr` utilizável (ver justificativa longa em
 * `QUEPASA_CAPABILITIES` e docs/providers/quepasa.md#instanceconnect). `qr` fica SEMPRE
 * `undefined` — nunca inventamos uma string corrompida como se fosse um QR válido. `raw` carrega o
 * que o `HttpClient` conseguiu extrair do corpo (texto potencialmente corrompido pela decodificação
 * UTF-8 de bytes binários de PNG — útil no máximo para confirmar que a chamada teve efeito, não
 * para reconstituir a imagem).
 */
async function connectInstance(http: HttpClient): Promise<ConnectResult> {
  const body = await http.request<unknown>({ method: 'GET', path: '/scan' });
  return { qr: undefined, raw: body };
}

/**
 * `GET /command?action=status`. Resposta reconstruída a partir de `ParseSuccess`/`QpResponse`
 * (não é uma captura de tráfego real — struct confirmada, não payload literal):
 * `{"success": true, "status": "<WhatsappConnectionState>"}`.
 */
async function statusInstance(http: HttpClient): Promise<InstanceStatus> {
  const body = await http.request<unknown>({
    method: 'GET',
    path: '/command',
    query: { action: 'status' },
  });
  const record = asRecord(body);
  return { state: mapConnectionState(record ? asString(record.status) : undefined), raw: body };
}

/**
 * Mapeamento de `WhatsappConnectionState` (string, via `MarshalJSON` customizado — confirmado na
 * pesquisa mais recente, snapshot 2026-07-07) para `InstanceState` canônico. Estados efetivamente
 * emitidos hoje segundo `docs/CONNECTION_STATES.md` do fork: `Unknown, UnPrepared, UnVerified,
 * Connecting, Stopping, Stopped, Connected, Ready, Disconnected, Failed` — os demais (`Starting`,
 * `Restarting`, `Reconnecting`, `Fetching`, `Halting`) estão reservados no enum mas não observados
 * em uso; tratados aqui como transitórios por analogia com `Connecting`/`Stopping`.
 *
 * `Connected` é AMBÍGUO por design do próprio provider: representa "socket conectado, ainda não
 * logado" — a janela em que um QR pode estar pendente de leitura, mas não há garantia disso no
 * momento exato da consulta (não existe um estado "QR pronto" dedicado no enum). Mapeado para
 * `'connecting'` (não `'qr'`) por ser a leitura mais conservadora — não afirmamos que um QR está
 * disponível quando não temos como confirmar isso neste endpoint. Decisão de implementação, não
 * fato documentado — ver docs/providers/quepasa.md#mapeamento-de-estado.
 */
function mapConnectionState(status: string | undefined): InstanceState {
  switch (status) {
    case 'Ready':
      return 'connected';
    case 'Disconnected':
    case 'Stopped':
    case 'UnVerified':
    case 'UnPrepared':
      return 'disconnected';
    case 'Connected':
    case 'Connecting':
    case 'Starting':
    case 'Stopping':
    case 'Restarting':
    case 'Reconnecting':
    case 'Fetching':
    case 'Halting':
      return 'connecting';
    default:
      // Inclui 'Failed' e 'Unknown' — nenhum estado canônico de erro dedicado nesta fase.
      return 'unknown';
  }
}

/**
 * `GET /command?action=stop` — **soft-stop, não logout de verdade** (ver justificativa completa em
 * `QUEPASA_CAPABILITIES`). Desconecta o socket e limpa handlers (`Dispose()`), mas preserva as
 * credenciais salvas — um `instance.connect()` seguinte tende a reconectar SEM gerar um novo QR.
 * O "hard logout" (desvincular do WhatsApp + apagar credenciais, `Delete()`) só existe via
 * `POST /form/delete`, autenticado por cookie JWT de usuário/senha — fora do modelo de token por
 * instância deste contrato, portanto inacessível a este adapter.
 */
async function logoutInstance(http: HttpClient): Promise<void> {
  await http.request({ method: 'GET', path: '/command', query: { action: 'stop' } });
}

// ---------------------------------------------------------------------------
// messages.*
// ---------------------------------------------------------------------------

/**
 * `POST /v3/bot/{token}/sendtext`. Corpo confirmado (`QpSendRequest`): `{chatId, text}`.
 * `quotedId`/`mentions` do `SendTextInput` canônico NÃO têm equivalente no QuePasa — busca de
 * código por "quoted"/"mention" no repo inteiro: zero resultados em ambos (confiança alta,
 * pesquisa dedicada). Silenciosamente ignorados aqui (não lançamos por um campo opcional sem
 * suporte), mesma postura adotada quando um provider não cobre um campo opcional do contrato
 * central.
 */
async function sendText(
  http: HttpClient,
  token: string,
  input: SendTextInput,
): Promise<SentMessage> {
  const chatId = toQuepasaChatId(input.to);
  const body = { chatId, text: input.text };
  const response = await http.request<unknown>({
    method: 'POST',
    path: botPath(token, '/sendtext'),
    body,
  });
  return mapSendResponse(response, chatId);
}

/**
 * Remove o prefixo de data URI (`data:mime;base64,`) quando presente. O campo `content` do QuePasa
 * mapeia para `[]byte` no lado do servidor (`QpSendRequest`/structs de envio de mídia) — o padrão
 * `encoding/json` do Go decodifica uma string base64 PURA automaticamente; um prefixo de data URI
 * quebraria essa decodificação. **Assunção documentada, não confirmada literalmente** (nenhum
 * exemplo de requisição de mídia real foi capturado na pesquisa) — tratamento defensivo simétrico
 * ao inverso já usado pelos adapters Whapi/Wuzapi/Z-API (que aceitam base64 cru OU data URI do lado
 * do CONSUMIDOR e normalizam para o formato que o provider espera).
 */
function stripDataUriPrefix(base64: string): string {
  const commaIndex = base64.indexOf(',');
  return base64.startsWith('data:') && commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
}

/**
 * O QuePasa NÃO tem um endpoint por tipo de mídia — o tipo real da mensagem (imagem/vídeo/áudio/
 * documento) é auto-detectado no SERVIDOR pelo mimetype do conteúdo (`GetMessageType`), não pelo
 * endpoint escolhido nem por nenhum campo "kind" enviado pelo cliente. Este adapter escolhe entre
 * dois endpoints de ENTREGA (não de tipo) conforme o que `MediaRef` fornece:
 * - `POST /v3/bot/{token}/sendurl` (`{chatId, url, fileName?, text?}`) quando `media.url` está
 *   presente — o servidor baixa a URL.
 * - `POST /v3/bot/{token}/sendencoded` (`{chatId, content, fileName?, text?}`) quando só
 *   `media.base64` está presente.
 *
 * **Caption** (`text`) é tratado de forma bem diferente por tipo, mas inteiramente no SERVIDOR (o
 * cliente sempre manda o mesmo campo `text`, confirmado lendo `SendMessage` por completo):
 * imagem/vídeo → o servidor sobrescreve `Attachment.FileName` com o texto (o nome de arquivo
 * original é perdido como efeito colateral); documento/áudio → o servidor envia o texto como uma
 * MENSAGEM DE TEXTO SEPARADA, enviada ANTES do anexo (não é um caption inline de verdade). Este
 * adapter não precisa replicar essa lógica — só repassa `text`/`fileName` e deixa o servidor
 * decidir.
 *
 * **Sticker**: o enum `WhatsappMessageType` DO INCLUI um `StickerMessageType` real (confirmado
 * lendo `whatsapp_message_type.go` no snapshot mais recente, `deivisonrpg/quepasa` — serializa como
 * a string literal `"sticker"`, o mesmo tipo que este adapter já reconhece na RECEPÇÃO de webhooks,
 * ver `KIND_BY_TYPE`/`parseWebhookUnsafe`). O que de fato falta, e é a razão real do `INVALID_INPUT`
 * abaixo, é um caminho de auto-detecção por mimetype no ENVIO: `GetMessageType`
 * (`whatsapp_extensions.go`) não tem nenhum case para `image/webp` — um `kind: 'sticker'` enviado
 * via `/sendurl`/`/sendencoded` seria classificado pelo servidor como `DocumentMessageType` comum,
 * não como figurinha de verdade no WhatsApp. Em vez de mandar silenciosamente algo diferente do que
 * o chamador pediu, este adapter lança `INVALID_INPUT` para `kind: 'sticker'` — mas por ausência de
 * rota de envio, não por ausência do tipo no modelo (correção de um erro deste dossiê: a versão
 * anterior afirmava que o tipo não existia).
 */
async function sendMedia(
  http: HttpClient,
  token: string,
  input: SendMediaInput,
): Promise<SentMessage> {
  if (input.media.kind === 'sticker') {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'QuePasa: não tem caminho de ENVIO para figurinha (sticker) — o servidor auto-detecta o ' +
        'tipo da mensagem pelo mimetype e não reconhece image/webp, então trataria o envio como ' +
        'um documento genérico, não como uma figurinha de verdade no WhatsApp (o tipo de ' +
        'figurinha em si existe no modelo do provider e é reconhecido na recepção; ver ' +
        'docs/providers/quepasa.md#messagessendmedia).',
      { provider: PROVIDER },
    );
  }

  const chatId = toQuepasaChatId(input.to);
  const body: Record<string, unknown> = { chatId };

  if (input.media.url !== undefined) {
    body.url = input.media.url;
  } else if (input.media.base64 !== undefined) {
    body.content = stripDataUriPrefix(input.media.base64);
  } else {
    throw new WaConnectorError(
      'INVALID_INPUT',
      'QuePasa: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER },
    );
  }

  if (input.caption) {
    body.text = input.caption;
  }
  if (input.media.filename) {
    body.fileName = input.media.filename;
  }

  const path = input.media.url !== undefined ? '/sendurl' : '/sendencoded';
  const response = await http.request<unknown>({
    method: 'POST',
    path: botPath(token, path),
    body,
  });
  return mapSendResponse(response, chatId);
}

/**
 * Resposta v3 confirmada por struct (`QpSendResponse`/`QpSendResponseMessage`), sem payload de
 * resposta literal capturado: `{success, status, message: {id, wid, chatId, trackId}}`. **Sem
 * timestamp** — diferente de outros adapters deste pacote, o QuePasa não devolve o instante do
 * envio na resposta v3 (`SentMessage.timestamp` fica `undefined`). Fallback em
 * `requestedChatId`/id sintético quando o campo aninhado `message` não vem (nunca lança).
 */
function mapSendResponse(body: unknown, requestedChatId: string): SentMessage {
  const record = asRecord(body);
  const message = record ? asRecord(record.message) : undefined;
  const id = (message ? asString(message.id) : undefined) ?? `quepasa-${Date.now()}`;
  const chatId = (message ? asString(message.chatId) : undefined) ?? requestedChatId;
  return { id, chatId, timestamp: undefined, raw: body };
}

// ---------------------------------------------------------------------------
// groups.* (só o endpoint confirmado)
// ---------------------------------------------------------------------------

/**
 * `GET /v3/bot/{token}/invite/{chatid}` — único endpoint de grupo encontrado em todo o código
 * (busca exaustiva por create/list/getInfo/participantes/config/revokeInvite/joinViaInvite/
 * leaveGroup: zero resultados). Resposta confirmada literalmente (`QpInviteResponse`):
 * `{"success": true, "url": "https://chat.whatsapp.com/..."}` — já vem como link completo, mas
 * ainda passa por `normalizeInviteLink` por segurança (operação idempotente quando já é o link
 * completo), mesmo padrão do adapter Wuzapi.
 */
async function getGroupInviteLink(
  http: HttpClient,
  token: string,
  groupId: string,
): Promise<GroupInviteLink> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: botPath(token, `/invite/${encodeURIComponent(groupId)}`),
  });
  const record = asRecord(response);
  const url = record ? asString(record.url) : undefined;
  return { link: normalizeInviteLink(url ?? ''), raw: response };
}

// ---------------------------------------------------------------------------
// contacts.* (só o endpoint confirmado)
// ---------------------------------------------------------------------------

/**
 * `GET /v3/bot/{token}/picinfo/{chatid}` — único endpoint de contato encontrado (busca exaustiva
 * por isOnWhatsApp/listagem/getAbout/block/unblock: zero resultados). Envelope de resposta
 * CONFIRMADO por código-fonte (não mais por analogia): `PictureController`
 * (`botarenaweb/Quepasa-api`, `src/controllers/api_handlers+PictureController.go`) faz
 * `response.Info = info` sobre um `*models.QpPictureResponse`, cujo struct
 * (`qp_picture_response.go`) é `type QpPictureResponse struct { QpResponse; Info
 * *whatsapp.WhatsappProfilePicture \`json:"info,omitempty"\` }` — ou seja, o corpo real é
 * `{success, status, info: {id, type, url, chatid, wid}}`, com `url` ANINHADO sob `info`, NÃO solto
 * no nível raiz. (A suposição anterior, por analogia com `QpInviteResponse`/`QpSendResponse`,
 * estava incorreta — corrigida após verificação direta do controller citado acima.) `url` fica
 * `undefined` quando o contato não tem foto OU quando `info` está ausente do corpo (mesmo padrão de
 * todo `ContactProfilePicture` deste pacote) — nunca lança.
 */
async function getContactProfilePicture(
  http: HttpClient,
  token: string,
  chatId: string,
): Promise<ContactProfilePicture> {
  const response = await http.request<unknown>({
    method: 'GET',
    path: botPath(token, `/picinfo/${encodeURIComponent(chatId)}`),
  });
  const record = asRecord(response);
  const info = record ? asRecord(record.info) : undefined;
  return { url: info ? asString(info.url) : undefined, raw: response };
}

// ---------------------------------------------------------------------------
// webhooks.parse
// ---------------------------------------------------------------------------

/**
 * Traduz um webhook QuePasa para eventos canônicos. Nunca lança: qualquer formato inesperado
 * (incluindo exceções internas) vira um evento `unknown` com `reason`.
 */
function parseWebhook(input: WebhookInput): CanonicalEvent[] {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook QuePasa: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    ];
  }
}

/**
 * Envelope confirmado por struct (`QpWebhookPayload{ *whatsapp.WhatsappMessage, Extra }`): os
 * campos de `WhatsappMessage` são promovidos (embedding anônimo do Go) para o nível raiz do JSON —
 * não há wrapper por categoria de evento como no Whapi. O discriminador é o campo `type` da própria
 * mensagem (string, via `MarshalJSON` customizado): `image, document, audio, video, text, location,
 * contact, call, system, group, revoke, poll, sticker, view_once, unhandled`. `wid` (corpo) e o
 * header `X-QUEPASA-WID` carregam o mesmo valor (número de telefone sem sufixo) — mapeado para
 * `CanonicalEvent.instanceId`.
 *
 * Nenhum payload literal de exemplo foi capturado na pesquisa para NENHUM destes eventos (só a
 * definição de struct Go, confirmada por código-fonte) — todas as fixtures deste adapter são
 * portanto RECONSTRUÍDAS a partir dos nomes/tipos de campo confirmados, não capturas de tráfego
 * real. Ver docs/providers/quepasa.md#webhooks para o detalhamento por evento.
 */
function parseWebhookUnsafe(input: WebhookInput): CanonicalEvent[] {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, 'Corpo do webhook QuePasa não é um objeto JSON.')];
  }

  const instanceId = asString(record.wid) || firstHeaderValue(input.headers, 'x-quepasa-wid');
  const type = asString(record.type);

  switch (type) {
    case 'text':
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
    case 'poll':
    case 'location':
    case 'contact':
      return [mapMessageEvent(record, type, instanceId, body)];
    case 'view_once':
      // Confiança baixa: o wrapper "ver uma vez" existe no enum mas a pesquisa não confirmou como
      // distinguir o tipo de mídia subjacente (imagem vs. vídeo) neste payload — reportado com
      // `kind: 'unknown'` em vez de adivinhar.
      return [mapMessageEvent(record, type, instanceId, body)];
    case 'system':
      return [mapSystemEvent(record, instanceId, body)];
    case 'group':
      return [mapGroupEvent(record, instanceId, body)];
    case 'call':
      return [
        unknownEvent(
          body,
          'Evento "call" do QuePasa não tem CanonicalEvent equivalente nesta fase (o contrato central não modela chamadas de voz/vídeo).',
          instanceId,
        ),
      ];
    case 'revoke':
      return [
        unknownEvent(
          body,
          'Evento "revoke" do QuePasa (mensagem apagada) não tem CanonicalEvent equivalente nesta fase.',
          instanceId,
        ),
      ];
    case 'unhandled':
      return [
        unknownEvent(
          body,
          'QuePasa reportou "unhandled" para este evento (não classificado nem pelo próprio provider).',
          instanceId,
        ),
      ];
    default:
      return [
        unknownEvent(
          body,
          `Payload de webhook QuePasa não reconhecido nesta fase (type="${type ?? 'ausente'}").`,
          instanceId,
        ),
      ];
  }
}

/** `type` (string) do QuePasa -> `MessageKind` canônico. Tipos sem entrada aqui caem em `'unknown'`. */
const KIND_BY_TYPE: Partial<Record<string, MessageKind>> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
  poll: 'poll',
  location: 'location',
  contact: 'contact',
};

/**
 * Mapeia uma mensagem "de conteúdo" comum (texto/mídia/localização/contato/poll/view_once) para
 * `message.received`/`message.sent` (`fromme` distingue). `media` É populado para tipos de mídia
 * (image/video/audio/document/sticker) a partir de `record.attachment` — o SHAPE INTERNO de
 * `WhatsappAttachment` FOI confirmado por código-fonte (`whatsapp_attachment.go`, snapshot mais
 * recente `deivisonrpg/quepasa`, citado por completo): `Mimetype string \`json:"mime"\``, `FileName
 * string \`json:"filename,omitempty"\`` e `Url string \`json:"url,omitempty"\`` (entre outros
 * campos não usados por este adapter — tamanho do arquivo, thumbnail, duração de áudio,
 * coordenadas de localização). (Correção de um erro deste dossiê: uma versão anterior descrevia
 * este shape como "não confirmado" e sempre deixava `media` `undefined` — ver
 * docs/providers/quepasa.md#webhooks.) `media` fica `undefined` quando `attachment` está ausente do
 * payload (mensagens de texto/localização/contato/poll) — nunca lança.
 */
function mapMessageEvent(
  record: Record<string, unknown>,
  type: string,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const fromMe = asBoolean(record.fromme) ?? false;
  const chat = asRecord(record.chat);
  const participant = asRecord(record.participant);
  const kind = KIND_BY_TYPE[type] ?? 'unknown';
  const attachment = asRecord(record.attachment);

  const message: WaMessage = {
    id: asString(record.id) ?? `quepasa-unknown-${Date.now()}`,
    chatId: (chat ? asString(chat.id) : undefined) ?? 'unknown',
    from: participant ? asString(participant.id) : undefined,
    fromMe,
    // `timestamp` é RFC3339 (time.Time nativo do Go, sem MarshalJSON customizado no próprio campo)
    // — diferente da maioria dos providers deste pacote, que usam epoch em segundos ou ms.
    timestamp: parseIsoTimestamp(record.timestamp),
    kind,
    text: asString(record.text),
    media: attachment && isMediaKind(kind) ? buildMediaRef(kind, attachment) : undefined,
    quotedId: asString(record.inreply),
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

const MEDIA_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>([
  'image',
  'video',
  'audio',
  'document',
  'sticker',
]);

function isMediaKind(kind: MessageKind): kind is MediaKind {
  return MEDIA_KINDS.has(kind);
}

/**
 * `record.attachment` -> `MediaRef`, campos confirmados em `WhatsappAttachment` (ver comentário de
 * `mapMessageEvent` acima): `mime` -> `mimeType`, `filename` -> `filename`, `url` -> `url`. Sem
 * `base64` — o attachment recebido só carrega URL/metadados, não o conteúdo embutido.
 */
function buildMediaRef(kind: MediaKind, attachment: Record<string, unknown>): MediaRef {
  return {
    kind,
    url: asString(attachment.url),
    mimeType: asString(attachment.mime),
    filename: asString(attachment.filename),
  };
}

/**
 * `type: "system"` cobre DOIS achados bem distintos no QuePasa, discriminados aqui:
 *
 * 1. **Recibo de entrega/leitura (ack), forma sintética e atípica** (confiança alta — código
 *    citado por completo): o `id` do payload é literalmente a string `"deliveryreceipt"` ou
 *    `"readreceipt"` (NÃO o id da mensagem original); o id REAL da mensagem confirmada vem em
 *    `text`. Detectado aqui pelo sentinel de `id` antes de qualquer outra coisa.
 * 2. **Notificação de ciclo de vida da conexão** (conectado/desconectado/logout/QR/pareamento/
 *    blocklist), discriminada por `info.event` — ver `mapSystemEventToState`.
 */
function mapSystemEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const id = asString(record.id);
  if (id === 'deliveryreceipt' || id === 'readreceipt') {
    const chat = asRecord(record.chat);
    const messageId = asString(record.text);
    if (!messageId) {
      return unknownEvent(
        rawBody,
        `Recibo QuePasa ("${id}") sem o id real da mensagem no campo "text".`,
        instanceId,
      );
    }
    const ack: MessageAck = id === 'readreceipt' ? 'read' : 'delivered';
    return {
      type: 'message.ack',
      provider: PROVIDER,
      instanceId,
      messageId,
      chatId: chat ? asString(chat.id) : undefined,
      ack,
      raw: rawBody,
    };
  }

  const info = asRecord(record.info);
  const event = info ? asString(info.event) : undefined;
  const state = mapSystemEventToState(event);
  if (!state) {
    return unknownEvent(
      rawBody,
      `Evento "system" do QuePasa com info.event="${event ?? 'ausente'}" sem InstanceState equivalente nesta fase.`,
      instanceId,
    );
  }
  return { type: 'connection.update', provider: PROVIDER, instanceId, state, raw: rawBody };
}

/**
 * `info.event` -> `InstanceState`. `qr_scan` tem **confiança MÉDIA** (não alta): o handler de QR do
 * fork examinado (`OnQREvent`) tenta ler campos por reflection (`Event`/`Code`) que a struct real
 * `whatsmeow/types/events.QR` não possui (só `Codes []string`) — plausível que, na prática, esse
 * caminho sempre caia num fallback genérico em vez de disparar `info.event: "qr_scan"` como
 * desenhado. Mapeado aqui pelo design PRETENDIDO do código (é o melhor sinal disponível), com esta
 * ressalva documentada — ver docs/providers/quepasa.md#connectionupdate.
 */
function mapSystemEventToState(event: string | undefined): InstanceState | undefined {
  switch (event) {
    case 'connected':
    case 'pair_success':
      return 'connected';
    case 'disconnected':
    case 'stopped':
    case 'deleted':
    case 'logged_out':
      return 'disconnected';
    case 'qr_scan':
      return 'qr';
    default:
      // Inclui "blocklist" (atualização da lista de bloqueio — não é mudança de estado de conexão)
      // e qualquer verbo futuro não coberto pela pesquisa.
      return undefined;
  }
}

/**
 * `type: "group"` — o ÚNICO evento de grupo despachado pelo QuePasa nesta versão é a entrada do
 * próprio bot num grupo (`events.JoinedGroup`; mudanças em grupos JÁ existentes — assunto,
 * descrição, participantes — não são despachadas via webhook, `events.GroupInfo` cai num handler
 * "não implementado"). Por isso `action` fica sempre `undefined`: nenhuma das convenções de
 * `GroupUpdateEvent.action` (`participants.add/remove/promote/demote`, `subject`, `description`)
 * descreve "eu entrei neste grupo" — `raw` carrega o payload completo (incl. `info.Participants`,
 * a CONTAGEM de membros no momento da entrada, não a lista).
 */
function mapGroupEvent(
  record: Record<string, unknown>,
  instanceId: string | undefined,
  rawBody: unknown,
): CanonicalEvent {
  const chat = asRecord(record.chat);
  const groupId = chat ? asString(chat.id) : undefined;
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "group" do QuePasa sem "chat.id".', instanceId);
  }
  return { type: 'group.update', provider: PROVIDER, instanceId, groupId, raw: rawBody };
}

function unknownEvent(raw: unknown, reason: string, instanceId?: string): UnknownEvent {
  return { type: 'unknown', provider: PROVIDER, instanceId, raw, reason };
}

/** `timestamp` do webhook é RFC3339 (string) — `Date.parse` nativo, com fallback defensivo (nunca lança). */
function parseIsoTimestamp(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function firstHeaderValue(headers: WebhookInput['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
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
