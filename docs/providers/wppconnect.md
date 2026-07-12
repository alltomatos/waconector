# Dossiê: WPPConnect Server

- Docs oficiais: <https://wppconnect.io/swagger/wppconnect-server/>
- Repositório: <https://github.com/wppconnect-team/wppconnect-server> (branch `main`, tag `v2.10.0`,
  commit `f09e2fed`, release 2026-05-16)
- Versão testada: código-fonte lido em 2026-07-11 (véspera do último push do repositório) — Swagger
  consultado apenas como referência secundária (é gerado a partir de anotações JSDoc no próprio
  controller, então diverge do código-fonte em pelo menos os pontos sinalizados abaixo).
- Hospedagem: self-hosted (Docker; `docker-compose.yml` no repo).

> **Achado inicial da pesquisa (verificação prévia, diferente do precedente QuePasa deste
> projeto)**: nenhum bloqueio de sourcing encontrado. As duas URLs de referência são reais e
> acessíveis, o repositório existe, não está arquivado (1043 stars, último push na véspera da
> pesquisa). Toda a pesquisa abaixo vem de leitura direta do código-fonte real
> (`wppconnect-server@f09e2fed`: `src/middleware/`, `src/controller/`, `src/util/`, `src/config.ts`,
> `src/routes/index.ts`; e da lib subjacente `wppconnect-team/wppconnect@e153ff72`:
> `src/api/model/`, `src/api/layers/`), não apenas do Swagger renderizado.

> **Revisão de 2026-07-12**: reauditoria de `groups.list`/`contacts.list`/`contacts.get`/
> `contacts.getProfilePicture`/`contacts.getAbout` (mesmos commits acima, `wppconnect-server@f09e2fed`
> e `wppconnect@e153ff72`) descendo à LIB (`retriever.layer.ts`, `src/api/model/*.ts`,
> `src/lib/wapi/functions/*.js`) em vez de só ao controller fino do server — as 5 capabilities antes
> descartadas por "shape de resposta não confirmado" na verdade têm shape tipado ou visível no
> script injetado. Nenhuma é limitação real do provider; todas implementadas nesta revisão (ver
> "Capabilities implementadas nesta fase" abaixo).

> **Retrofit ADR-0012 (pesquisa dedicada de 2026-07-12)**: `messages.edit`/`messages.delete` e as 8
> operações do novo namespace `chats.*` (`archive`/`unarchive`/`mute`/`unmute`/`pin`/`unpin`/
> `markRead`/`markUnread`) — TODAS confirmadas com endpoint E delegação até a lib (confiança Alta),
> lendo `wppconnect-server@f09e2fed` (`src/controller/messageController.ts`,
> `src/controller/deviceController.ts`) + `wppconnect@e153ff72` (`src/api/layers/controls.layer.ts`,
> `src/lib/wapi/functions/send-mute.js`) + `wa-js@a4c57173` (HEAD, dependência de terceiro nível não
> pinada pelo dossiê, citada com essa ressalva onde usada). Ver seções "Edição e exclusão de
> mensagem" e "Conversas (`chats.*`)" abaixo.

> **Arquitetura**: WPPConnect Server é um wrapper REST (Express) em cima da lib
> `@wppconnect-team/wppconnect`, que controla o WhatsApp Web via Puppeteer (automação de browser,
> não uma lib de protocolo standalone tipo whatsmeow/wa-js). O termo de domínio usado pela API
> pública é **"session"** (`SessionController`, path param `:session`) — `client`/`req.client` é só
> um alias de código interno, não vaza para fora.

## Autenticação

Modelo de duas camadas, mais estranho que "Bearer token simples":

1. **`secretKey`** — segredo GLOBAL do servidor (`src/config.ts`, default
   `'THISISMYSECURETOKEN'`), **não é env var**: só muda editando/montando um `config.ts` customizado
   no volume Docker (`README.md`/`docker-compose.yml` confirmam isso; `src/server.ts` lê o arquivo
   direto, sem `process.env`). Qualquer um que souber o `secretKey` do servidor consegue gerar um
   token válido para QUALQUER nome de sessão.
2. **Token de sessão** — gerado via `POST /api/{session}/{secretkey}/generate-token`
   (`src/controller/encryptController.ts`): `bcrypt.hash(session + secretKey)`, com `/`/`+` do hash
   trocados por `_`/`-` (esquema DIY, não é base64url padrão completo). Resposta:
   `{status:'success', session, token, full: "<session>:<token>"}`. **Não existe um segundo
   segredo independente** — o "token" é só o `secretKey` derivado por sessão, determinístico.

Duas formas válidas de autenticar chamadas operacionais (`src/middleware/auth.ts`, `verifyToken`):

- **(a)** embutir `"{session}:{token}"` (o campo `full` acima) no PRÓPRIO path param `:session`,
  sem header `Authorization`;
- **(b)** path com o nome puro da sessão + header `Authorization: Bearer <token>`.

Este adapter usa a forma **(b)** — encaixa naturalmente no `HttpClient` do core (header fixo).
`WppconnectOptions.token` é o token de sessão já gerado (provisionamento via `generate-token` é
responsabilidade do operador do servidor, que precisa saber o `secretKey` — fora do escopo deste
adapter, mesmo padrão de "token pré-provisionado" já usado em `WuzapiOptions.token`).

> ⚠️ **Achado que só aparece lendo o código-fonte (ausente do Swagger)**: os 3 endpoints "admin"
> (`generate-token`, `show-all-sessions`, `start-all`) usam uma auth DIFERENTE e inline — comparam o
> `secretkey` (do path OU do header, `token.split(' ')[0]`, **índice 0** não 1) em TEXTO PURO contra
> o `secretKey` do servidor, sem bcrypt. Ou seja: para esses 3 endpoints (nenhum implementado por
> este adapter), um header `Authorization: Bearer <secretKey>` FALHA (compara a string `"Bearer"`
> contra o secretKey) — o header correto ali seria `Authorization: <secretKey>` cru, sem prefixo.
> Não afeta este adapter (não usa nenhum dos 3), citado aqui só para quem for provisionar sessões
> manualmente.

## Modelo de instância/sessão

| Ação | Método + Path | Usado por este adapter |
| --- | --- | --- |
| Gerar token | `POST /api/{session}/{secretkey}/generate-token` | Não (provisionamento externo) |
| Iniciar sessão | `POST /api/{session}/start-session` | `instance.connect` |
| Status completo (inclui QR) | `GET /api/{session}/status-session` | `instance.status` |
| Checar conexão (booleano, mais pobre) | `GET /api/{session}/check-connection-session` | Não |
| QR (imagem PNG binária) | `GET /api/{session}/qrcode-session` | Não (`HttpClient` decodifica não-JSON como texto, corromperia bytes binários — mesmo obstáculo já documentado no dossiê QuePasa) |
| Logout (hard, apaga credenciais) | `POST /api/{session}/logout-session` | `instance.logout` |
| Close (soft, preserva credenciais) | `POST /api/{session}/close-session` | Não — sem equivalente no contrato atual (`InstanceApi` só tem `logout()`), mesmo gap já documentado nos dossiês Wuzapi/QuePasa |
| Listar sessões / iniciar todas | `GET/POST /api/{secretkey}/show-all-sessions` \| `/start-all` | Não (admin, `secretkey` cru) |

### `instance.connect` — `POST /start-session`

Body: `{waitQrCode: true, webhook?}`. `waitQrCode: true` (padrão deste adapter, configurável via
`WppconnectOptions.waitQrCode`) é a ÚNICA forma de obter o QR (ou pairing code) de volta na própria
resposta HTTP síncrona — sem ela, a resposta imediata é o que `status-session` retornaria NAQUELE
instante (tipicamente `{status:'CLOSED', qrcode:null}` para sessão nova), e a conexão real continua
em background (exigiria polling em `instance.status()`).

Quando `waitQrCode:true` e a sessão é nova, a resposta fica pendurada até o QR ou pairing code
chegar, respondendo com um destes shapes (citações literais de `createSessionUtil.ts`):

```json
{"status": "qrcode", "qrcode": "<base64 SEM prefixo data:image/png;base64,>", "urlcode": "...", "session": "..."}
{"status": "phoneCode", "phone": "...", "phoneCode": "...", "session": "..."}
```

Este adapter só usa o primeiro shape: nunca envia `phone` no body (ver "capabilities fora de
escopo" abaixo), então `status:"phoneCode"` nunca deveria ocorrer para sessões criadas por ESTE
adapter. `qr` é extraído de `record.qrcode` só quando `status === 'qrcode'`, repassado **verbatim,
sem adicionar o prefixo de data URI** (mesma convenção de "nunca reformatar o QR" já usada nos
demais adapters deste pacote).

> ⚠️ **`status` aqui é um vocabulário DIFERENTE do usado por `GET /status-session`**: o literal
> `"qrcode"`/`"phoneCode"` (minúsculo) desta resposta síncrona não é o mesmo enum `client.status`
> (`QRCODE`/`PHONECODE`, maiúsculo) usado por `status-session` — mesmo nome de campo (`status`),
> dois vocabulários distintos, confirmado no código-fonte.

> ⚠️ **Risco reavaliado (verificação adversarial), ainda não confirmado empiricamente**: a versão
> anterior deste aviso postulava que uma sessão já conectada faria `POST /start-session` pendurar
> até o `timeoutMs`. Lendo `src/controller/sessionController.ts`: `startSession` chama
> `await getSessionState(req, res)` incondicionalmente ANTES de qualquer fluxo de espera por QR, e
> `getSessionState` responde de imediato (`res.status(200).json({status: client.status, ...})`)
> sempre que `req.client` (== `clientsArray[session]`) for truthy — ou seja, para QUALQUER sessão
> já iniciada alguma vez, em QUALQUER estado (`CONNECTED`, `INITIALIZING`, etc.), não só quando já
> conectada. O fluxo de "pendurar até o QR chegar" (`catchQR`/`catchLinkCode`) só é alcançado quando
> `clientsArray[session]` genuinamente não existe (sessão nova, ou removida após logout) — o
> comportamento pretendido de "esperar QR", não um travamento acidental em reconexão. Ainda não
> validado contra uma instância Docker real; se confirmado, o cenário de travamento pode não
> ocorrer na prática para sessões já vistas antes. Consumidores cautelosos podem checar
> `instance.status()` primeiro, ou configurar `WppconnectOptions.waitQrCode: false` e fazer polling
> via `instance.status()` em vez de depender da resposta síncrona de `connect()`.

### `instance.status` — `GET /status-session`

Resposta: `{status, qrcode (data URI COMPLETA, recalculada a cada chamada), urlcode, version}`.
`InstanceStatus` só usa `status` (`qrcode`/`urlcode` não têm campo equivalente em `InstanceStatus`,
ficam só em `raw`). Mapeamento (`client.status`, string solta sem enum declarado no servidor):

| `status` | `InstanceState` |
| --- | --- |
| `null` | `disconnected` |
| `'CLOSED'` | `disconnected` |
| `'INITIALIZING'` | `connecting` |
| `'QRCODE'` | `qr` |
| `'PHONECODE'` | `qr` *(decisão de implementação — sem estado canônico dedicado a pairing code; ver seção "Gaps" abaixo)* |
| `'CONNECTED'` | `connected` |
| ausente / tipo inesperado / qualquer outra string | `unknown` (nunca lança) |

### `instance.logout` — `POST /logout-session`

Hard logout: invalida o dispositivo vinculado no WhatsApp e apaga credenciais persistidas + arquivo
de token — exige novo QR/pairing na próxima conexão. Distinto de `POST /close-session` (soft, só
fecha o Puppeteer em memória, preserva credenciais) — sem equivalente no contrato atual.

### Pairing code — sem endpoint dedicado, gap real de design

Não existe endpoint dedicado a pairing code. É obtido só passando `phone` no body de
`start-session`; `status-session` **nunca** expõe `phoneCode` (seu shape de resposta confirmado é
só `{status, qrcode, urlcode, version}`). `instance.pairingCode` não é declarada nesta fase — mesmo
obstáculo estrutural de todo adapter deste pacote: `InstanceApi.connect()` não recebe telefone como
parâmetro, e o WPPConnect só produz pairing code no momento de CRIAÇÃO da sessão (`start-session`
com `phone`), não em um "connect" de uma sessão já existente.

## Capabilities implementadas nesta fase

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `messages.sendReaction`, `messages.edit`, `messages.delete`,
`messages.forward`, `messages.star`, `messages.unstar` (ADR-0013),
`messages.sendLocation`, `messages.sendContactCard`, `messages.sendPoll` (ADR-0014),
`groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`, `groups.getInviteLink`, `groups.revokeInviteLink`,
`groups.joinViaInviteLink`, `groups.leaveGroup`, `contacts.list`, `contacts.get`,
`contacts.checkExists`, `contacts.getProfilePicture`, `contacts.getAbout`, `contacts.block`,
`contacts.unblock`, `contacts.listBlocked`, `chats.archive`, `chats.unarchive`, `chats.mute`,
`chats.unmute`, `chats.pin`, `chats.unpin`, `chats.markRead`, `chats.markUnread`,
`webhooks.parse` — 42 de 46 capabilities. **Sem `messages.pin`/`unpin`/`markRead`** (nível de
MENSAGEM) — busca em `src/routes/index.ts` só encontra `/pin-chat` (nível de conversa, já
implementado) e `unread-messages`/`all-unread-messages` (consulta, não ação de marcar) — nenhum
endpoint de nível de mensagem equivalente. Limitação real confirmada, não gap de pesquisa.

**Deliberadamente de fora** (obstáculo estrutural, não falta de pesquisa):

- `instance.pairingCode` — `InstanceApi.connect()` não recebe telefone como parâmetro, e o
  WPPConnect só produz pairing code quando `phone` é enviado no body de `start-session` (momento de
  criação da sessão, distinto de um "connect" de sessão já existente).

**Gap fechado nesta revisão** — `groups.list` e as 4 operações de `contacts.*` abaixo eram
listadas como fora de escopo por "shape de resposta não confirmado" numa versão anterior deste
dossiê, que olhou só o controller fino do `wppconnect-server`. Descendo à LIB subjacente
(`wppconnect-team/wppconnect@e153ff72`, `src/api/model/*.ts`, `src/lib/wapi/functions/*.js`,
`src/api/layers/retriever.layer.ts`), o shape de resposta de todas está tipado ou visível no script
injetado — nenhuma é limitação real do provider:

- `groups.list` — `GET /all-groups` (`GroupController.getAllGroups`) segue `#swagger.deprecated`
  ("Deprecated in favor of 'list-chats'") e não é usado. Substituto: `POST /list-chats`
  (`DeviceController.listChats` → lib `listChats(options?: ChatListOptions): Promise<Chat[]>`),
  com `{onlyGroups: true}` no body filtrando só grupos. Resposta tipada em
  `src/api/model/chat.ts` (`Chat`): `{id: Wid, name, isGroup, archive, pin, unreadCount,
  ephemeralDuration, ...}` — sem `participants` (ver subseção dedicada abaixo).
- `contacts.list` (`GET /all-contacts`) e `contacts.get` (`GET /contact/:phone`) — o script
  injetado real confirma o shape de resposta: `get-all-contacts.js` faz
  `WPP.whatsapp.ContactStore.map(c => WAPI._serializeContactObj(c))`; `get-contact.js` faz
  `return window.WAPI._serializeContactObj(found)` — mesmo shape nos dois, consistente com a
  interface `Contact` da lib (`src/api/model/contact.ts`: `id, name, pushname, shortName, type`).
  **Confiança média-alta** (script injetado, não a interface TS tipada diretamente).
- `contacts.getProfilePicture` (`GET /profile-pic/:phone`) — `DeviceController.getProfilePicFromServer`
  → lib `getProfilePicFromServer(chatId): Promise<ProfilePicThumbObj>` (assinatura TIPADA).
  `ProfilePicThumbObj` (`src/api/model/profile-pic-thumb.ts`): `{eurl, id, img, imgFull, raw: null,
  tag}`. Confiança alta.
- `contacts.getAbout` (`GET /profile-status/:phone`) — `DeviceController.getStatus` → lib
  `getStatus(contactId): Promise<ContactStatus>`, com a montagem do retorno visível no
  código-fonte: `return {id: contactId, status: (status as any)?.status || status}`.
  `ContactStatus` (`src/api/model/contact-status.ts`): `{id, status, stale?}`. Confiança alta.

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `POST /start-session` | Ver seção dedicada acima. |
| `instance.status` | `GET /status-session` | Ver tabela de mapeamento acima. |
| `instance.logout` | `POST /logout-session` | Hard logout. |
| `messages.sendText` | `POST /send-message` (ou `POST /send-mentioned` quando `mentions` não vazio) | Ver seção "Mensagens e mídia". |
| `messages.sendMedia` | `POST /send-file-base64` (image/video/document) \| `/send-voice-base64` (audio) \| `/send-sticker` (sticker) | Ver seção "Mensagens e mídia". |
| `messages.sendReaction` | `POST /react-message` | Ver seção "Mensagens e mídia". |
| `messages.edit` | `POST /edit-message` | Ver seção "Edição e exclusão de mensagem". |
| `messages.delete` | `POST /delete-message` | Ver seção "Edição e exclusão de mensagem". |

### Identificação do destinatário — extração da parte local do JID

**Achado importante confirmado por leitura cruzada de dois arquivos**: o middleware
`statusConnection` (aplicado a `send-message`/`send-image`/`send-file`/`send-file-base64`/
`send-voice`/`send-voice-base64`/`send-sticker`, confirmado pela lista de rotas) reconstrói o JID
a partir de `req.body.phone` + flags via `contactToArray` (`src/util/functions.ts`):

```js
if (isGroup) push(`${contact}@g.us`);
else if (isNewsletter) push(`${contact}@newsletter`);
else if (isLid || contact.length > 14) push(`${contact}@lid`);
else push(`${contact}@c.us`);
```

Isso SEMPRE concatena um sufixo ao valor de `phone`, **mesmo que ele já contenha `@`** — ou seja,
se o chatId canônico do waconector já chegar como JID explícito (com sufixo), enviá-lo cru
produziria um sufixo duplicado no servidor (`...@s.whatsapp.net@c.us`). Por isso este adapter
(`toWppconnectRecipient`) sempre extrai só a parte local (antes do `@`) para o campo `phone`, e
deriva `isGroup`/`isNewsletter`/`isLid` a partir do sufixo original do JID quando presente — nunca
repassa um JID completo no campo `phone`. Para o middleware, `contact.length > 14` também ativa
`@lid` automaticamente (não usado por este adapter, que sempre deriva `isLid` explicitamente do
sufixo `@lid` do chatId de entrada, quando presente).

`phone` também aceita string CSV de vários números ou array (confirmado no `requests.http` do
repo) — não relevante aqui, já que `SendTextInput.to`/`SendMediaInput.to` sempre carregam um único
destinatário por chamada.

E para contatos individuais (não grupo/newsletter), o middleware ainda VALIDA a existência real no
WhatsApp via `checkNumberStatus` e substitui pelo JID confirmado antes de enviar — comportamento
100% do lado do servidor, transparente para este adapter.

## Mensagens e mídia

### Texto — `POST /send-message`

Body: `{phone, isGroup, isNewsletter, isLid, message, options?: {quotedMsg}}` — os quatro
booleanos são sempre enviados explicitamente (mesmo quando `false`), espelhando o exemplo literal
do próprio JSDoc do controller (`{"phone":..., "isGroup":false, "isNewsletter":false,
"isLid":false, "message":...}`). `options.quotedMsg` é enviado só quando `input.quotedId` está
presente.

Resposta (dentro do envelope padrão — ver seção própria abaixo): **corrigido na verificação
adversarial** — o handler `sendMessage` do controller sempre reescreve `req.body.phone` para um
ARRAY (via middleware `statusConnection`) e monta `results.push(await client.sendText(...))` dentro
de um loop, então `response` é um ARRAY DE UM ELEMENTO contendo o objeto `Message` COMPLETO da lib
(`sendText` retorna `Promise<Message>`, buscado via `getMessageById` depois de enviar), não o
objeto bare que uma leitura superficial do controller sugeriria — nem apenas `{ack,id}` (esse
shape mais pobre é só de `sendFile`/mídia, ver abaixo). Este adapter (`unwrapArrayResponse`)
desembrulha esse array antes de mapear. `SentMessage.timestamp` assume SEGUNDOS por analogia com o
comentário explícito `"Epoch timestamp (seconds)"` em `IncomingCall.offerTime` (mesmo arquivo de
tipos da lib) — **não confirmado literalmente para este campo específico**
(`Message.t`/`Message.timestamp`).

### Menções — endpoint dedicado `POST /send-mentioned`

Não é uma opção de `send-message` — é outro endpoint, `POST /send-mentioned`, body
`{phone, isGroup, message, mentioned: string[]}` (`mentioned` = array de JIDs completos, exemplo
literal do dossiê: `["556593077171@c.us"]`). Este adapter usa este endpoint automaticamente sempre
que `SendTextInput.mentions` não está vazio, normalizando cada item (`toWppconnectMentionJid`):
JIDs passam intactos, o resto vira `<dígitos>@c.us` (`SendTextInput.mentions` não é normalizado
pelo conector antes de chegar ao adapter — só `to` passa por `normalizeChatId`). **Limitação
assumida**: `options.quotedMsg`/`isNewsletter`/`isLid` não são enviados neste caminho (não
confirmados para este endpoint específico — o dossiê só documenta o shape mínimo acima).

### Mídia — um único endpoint genérico para imagem/vídeo/documento, dois endpoints dedicados

**Achado central**: imagem, vídeo e documento passam pelo MESMO handler do servidor
(`MessageController.sendFile`), que monta `pathFile = path || base64 || req.file?.path` e detecta o
tipo real pelo mimetype do conteúdo (`type: 'auto-detect'` na lib) — não pela rota chamada. Este
adapter usa `POST /send-file-base64` (campo `base64`, aceita URL `http(s)` OU data URI, com ou sem
prefixo `data:`) para os três `MediaKind`s (`image`/`video`/`document`), reaproveitando
`resolveMediaValue` (mesmo padrão de Wuzapi/Whapi).

Áudio e sticker têm endpoints DEDICADOS e distintos do genérico:

| `MediaKind` | Endpoint | Campo do body | Caption |
| --- | --- | --- | --- |
| `image`/`video`/`document` | `POST /send-file-base64` | `base64` | sim (`caption`, exemplo literal) |
| `audio` | `POST /send-voice-base64` | `base64` *(nome do campo não confirmado individualmente para esta rota — assumido por analogia com o padrão dos demais endpoints `-base64`)* | não — WhatsApp não renderiza legenda em nota de voz |
| `sticker` | `POST /send-sticker` | **`path`** (confirmado — controller só lê `{phone, path}`, sem campo de legenda) | não |

`document` também envia `filename` quando `media.filename` está presente (não enforced como
obrigatório — diferente do Wuzapi, a pesquisa não confirma que este provider exige o campo).
`quotedId`, quando presente, é enviado como `quotedMessageId` (campo assumido por analogia com o
parâmetro posicional visto no snippet do controller — `sendFile(contact, pathFile, {...,
quotedMsg: quotedMessageId})` — o NOME exato do campo do body de ENTRADA não foi confirmado por um
exemplo JSON literal, diferente do `options.quotedMsg` aninhado de `send-message`).

`send-sticker-gif` (sticker ANIMADO) não é usado — `MediaKind` não distingue sticker estático de
animado.

Resposta de `sendFile`/`sendImageFromBase64`/`sendPttFromBase64` (dentro do envelope): mesmo padrão
de `sendMessage` — um ARRAY DE UM ELEMENTO (o handler também faz `results.push(...)` num loop sobre
o `phone` já reescrito como array pelo middleware) contendo apenas `{ack, id}` — **sem `chatId` nem
`timestamp`**, shape mais pobre que o `Message` completo de `sendText`. `unwrapArrayResponse`
desembrulha o array antes de mapear. `SentMessage.chatId` cai no `to` requisitado; `timestamp` fica
`undefined` (nenhum valor real disponível, não inventado).

### Reação — `POST /react-message`

Body `{msgId, reaction}` — `reaction` é o emoji (não usa `phone`, o `msgId` já carrega o chat).
Resposta **FIXA** (`{message: 'Reaction sended'}`, dentro do envelope) — sem `id`/`chatId`/
`timestamp` da reação em si. `SentMessage.id` ecoa `input.messageId` (a mensagem-alvo, mesmo padrão
já usado pelo adapter Wuzapi para o mesmo caso de resposta pobre), `chatId` ecoa o `to` requisitado.

**Remoção de reação**: a convenção canônica usa `emoji === ''`. A assinatura da lib subjacente
(`sendReactionToMessage(msgId, reaction: string | false)`) confirma que o valor booleano `false`
(não string) é o sentinela real de remoção — este adapter traduz `emoji === ''` para o literal
JSON `false` no campo `reaction`. **Confiança média-alta**: o schema Swagger só declara
`reaction: {type: "string"}` (não documenta `false`), mas a assinatura da função chamada
internamente confirma o comportamento — não testado contra uma instância real.

### Envelope de resposta — `{status, response, mapper}`

Confirmado como praticamente universal para operações de mensagem/grupo/contato (função
`returnSucess` do servidor): `{status: 'success'|'error', response: <conteúdo específico da
operação>, mapper: 'return'}`. **Não se aplica** aos endpoints de sessão (`start-session`/
`status-session`/`logout-session`/`generate-token`), que têm shapes próprios com significado
semântico no próprio campo `status` (documentado nas seções acima). Este adapter desembrulha
`response` (com fallback defensivo para o corpo cru se a chave estiver ausente) antes de mapear
qualquer operação de mensagem/grupo/contato.

**Segunda exceção confirmada, isolada** (verificação adversarial desta revisão): `POST /list-chats`
(`groups.list`) TAMBÉM foge do envelope. `DeviceController.listChats` (`f09e2fed`,
`src/controller/deviceController.ts`) termina com `res.status(200).json(response)` — SEM
`{status, response, mapper}` ao redor —, diferente de literalmente todos os outros handlers
verificados neste mesmo arquivo (`getGroupInfo`, `getAllContacts`, `getContact`,
`getProfilePicFromServer`, `getStatus`, `getBlockList`, `blockContact`, `unblockContact`,
`checkNumberStatus`, `createGroup`, todos fazem `res.json({status: 'success', response})`).
Confirmado tanto no commit pinado quanto em HEAD do branch `main` — não é drift de branch. Ver
subseção `groups.list` abaixo para o detalhe e para por que isso não quebra o adapter hoje
(`unwrapResponse`/`asRecord` acertam "por acidente").

**Terceira exceção, confirmada na pesquisa de retrofit ADR-0012**: `POST /send-seen`
(`chats.markRead`) usa ainda um OUTRO envelope, com `status` em maiúsculo e o payload aninhado dois
níveis abaixo — ver seção "Conversas (`chats.*`)" abaixo para o detalhe.

## Edição e exclusão de mensagem (`messages.edit`/`messages.delete`, retrofit ADR-0012)

Pesquisa dedicada de 2026-07-12 (`wppconnect-server@f09e2fed`: `src/controller/messageController.ts`,
`src/controller/deviceController.ts`; `wppconnect@e153ff72`: `src/api/layers/controls.layer.ts`).
Confiança **Alta** para os dois — endpoint, body e delegação até a lib confirmados por leitura
direta, sem inferência.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.edit` | `POST /edit-message` | `MessageController.editMessage`. Body `{id, newText, options?}` — **sem** `phone`/`isGroup`: o `id` da mensagem já identifica o chat sozinho. `input.to` não é enviado no request, só usado como fallback de `chatId` no mapeamento da resposta (mesmo padrão do adapter uazapi para o mesmo tipo de endpoint). |
| `messages.delete` | `POST /delete-message` | `DeviceController.deleteMessage`. Body `{phone, isGroup, messageId, onlyLocal, deleteMediaInDevice}`. **Único provider pesquisado nesta rodada que confirma em código um parâmetro real de escopo** (`onlyLocal`) — ver subseção dedicada abaixo. |

### `messages.edit` — resposta BARE, sem janela de tempo verificável, sem webhook de entrada

**Delegação confirmada** (`controls.layer.ts:190-213`, lib `e153ff72`):

```ts
public async editMessage(msgId, newText, options: EditMessageOptions = {}) {
  const editResult = await evaluateAndReturn(this.page, ({msgId,newText,options}) =>
    WPP.chat.editMessage(msgId, newText, options), {msgId, newText, options});
  const result = await evaluateAndReturn(this.page, async ({messageId}) =>
    JSON.parse(JSON.stringify(await WAPI.getMessageById(messageId))), {messageId: editResult.id}) as Message;
  if (result.body !== newText) throw editResult;
  return result;
}
```

Edita, RE-BUSCA a mensagem completa via `getMessageById` e valida `result.body === newText` —
lançando o próprio resultado bruto do `WPP.chat.editMessage` (não um `Error` padrão) se a checagem
falhar. A resposta HTTP segue o envelope padrão (`returnSucess`, `messageController.ts:30-32`):
`response` é o objeto `Message` completo, **BARE** (diferente de `sendText`/`sendMedia` — este
endpoint não passa pelo middleware `statusConnection`, que é quem produz o array de um elemento
tratado por `unwrapArrayResponse` no restante do arquivo; `editMessage` usa `unwrapResponse` puro).

**Sem janela de tempo verificável no código aberto**: a checagem "pode editar" (`canEditMsg`/
`canEditCaption`, `wa-js@a4c57173`, `src/whatsapp/functions/canEditMsg.ts`) é apenas um re-export de
símbolo interno do bundle fechado do próprio cliente web do WhatsApp (`canEditText`/`canEditMsg`,
versionado por `@whatsapp 755707 >= 2.2307.10`) — a lógica real (janela de tempo, só remetente, só
texto) não está em código aberto de nenhum provider pesquisado (ver ADR-0012). Se a checagem falhar,
`WPP.chat.editMessage` lança `WPPError('edit_message_error', ...)` ANTES de qualquer chamada de
rede — isso propaga pelo `page.evaluate` do Puppeteer até o catch do controller, que devolve uma
mensagem **genérica e fixa** (`'Erro ao enviar a mensagem.'`, `messageController.ts:21-28`), com o
erro real só dentro da chave `error` do corpo HTTP.

**Sem webhook de entrada correspondente**: o controller emite a edição só via Socket.IO
(`req.io.emit('edited-message', edited)`), não via `callWebHook` — busca exaustiva em todos os
registros de hook (`src/util/createSessionUtil.ts`: `onMessage`, `onAnyMessage`, `onAck`,
`onReactionMessage`, `onRevokedMessage`, `onPollResponse`, `onUpdateLabel`,
`onParticipantsChanged`, `onPresenceChanged`, `onIncomingCall`) não encontra um
`onEditMessage`/equivalente. Ou seja: mesmo implementando `messages.edit` como capability de saída,
não há hoje um evento canônico de entrada para "mensagem editada por outra parte" — situação análoga
(mas pior) à de `onrevokedmessage`, que ao menos dispara webhook (mapeado para `unknown` por falta
de shape confirmado, ver seção "Webhooks").

### `messages.delete` — comportamento PADRÃO é revogação, e um erro de documentação do próprio provider

**Delegação confirmada** (`controls.layer.ts:150-175`, lib `e153ff72`):

```ts
public async deleteMessage(chatId, messageId, onlyLocal = false, deleteMediaInDevice = true) {
  await evaluateAndReturn(this.page, ({chatId, messageId, onlyLocal, deleteMediaInDevice}) =>
    WPP.chat.deleteMessage(chatId, messageId, deleteMediaInDevice, !onlyLocal),
    {chatId, messageId, onlyLocal, deleteMediaInDevice});
  return true;
}
```

`onlyLocal` tem default `false`, e o valor repassado a `WPP.chat.deleteMessage` é `!onlyLocal` — ou
seja, **o comportamento PADRÃO é revogar para todos** ("delete for everyone"); para apagar só
localmente seria preciso enviar `onlyLocal: true` explicitamente. `DeleteMessageInput` do contrato
canônico não expõe esse campo de escopo (ver ADR-0012 — semântica assumida é sempre revogação), e
esse default do provider já bate exatamente com essa semântica — este adapter envia
`onlyLocal: false` EXPLICITAMENTE (em vez de confiar num default silencioso que poderia mudar numa
versão futura do provider). `deleteMediaInDevice` (default `true` na lib, não enviado por este
adapter) só controla se o arquivo de mídia em cache local também é removido — não afeta o alcance
da revogação.

**Achado extra (bug de documentação do próprio provider, não suposição)**: os dois exemplos literais
do JSDoc do controller são:

```json
"Delete message to all": {"phone":"...", "isGroup":false, "messageId":"<messageId>", "deleteMediaInDevice": true}
"Delete message only me": {"phone":"...", "isGroup":false, "messageId":"<messageId>"}
```

O segundo exemplo (rotulado "only me") **não envia `onlyLocal: true`** — dado o default
`onlyLocal=false` da lib, esse payload exatamente como documentado produziria o MESMO comportamento
do primeiro (revoga para todos), não uma exclusão só local. Divergência real entre o exemplo do
próprio Swagger/JSDoc e o comportamento do código, confirmada lendo os dois trechos — não é
suposição.

Resposta é mensagem FIXA (`{message: 'Message deleted'}`, sem `id`/`chatId`/`timestamp`) — ignorada
pelo adapter, contrato retorna `Promise<void>`. Achado colateral de robustez, sem efeito prático: no
sucesso, o controller faz `res.status(200).json(...)` e, **sem `return`**, cai na linha seguinte
`res.status(401).json({...})` no mesmo `res` — como `client.deleteMessage` sempre retorna `true`, o
segundo `.json()` sempre é alcançado e dispararia erro do Express por headers já enviados; não afeta
o adapter (o primeiro response de 200 já foi totalmente escrito antes do erro), mas é um cheiro de
código real do provider, não hipotético.

## Ações sobre mensagem (`messages.forward`/`star`/`unstar`, ADR-0013)

Continuação da pesquisa de `messages.edit`/`delete` acima (`wppconnect-server@f09e2fed`,
`DeviceController.forwardMessages`/`starMessage`). Confiança **Alta** para os dois. **Sem
`messages.pin`/`unpin`/`markRead`** (nível de MENSAGEM) — ver nota no resumo de capabilities
acima.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.forward` | `POST /forward-messages` | `DeviceController.forwardMessages`. Body confirmado pelo Swagger real: `{phone, isGroup, messageId}` — o handler faz `phone[0]` (reescrito para array pelo middleware `statusConnection`, mesmo mecanismo de `sendText`/`sendMedia`) e chama `forwardMessagesV2(phone[0], messageId)` da lib. `ForwardMessageInput.fromChatId` nunca é enviado — a implementação usa só o `messageId` da mensagem original. **Bug real confirmado**: o `if (!isGroup) {...} else {...}` do controller (`deviceController.ts:968-1021`) tem os DOIS ramos chamando exatamente a mesma linha — `isGroup` não tem efeito real no comportamento, apesar de aceito no schema. Resposta segue o envelope padrão (`{status:'success', response}`) — diferente de `list-chats`, este endpoint passa pelo `returnSucess` normal. |
| `messages.star` / `messages.unstar` | `POST /star-message` | `DeviceController.starMessage`. Body: `{messageId, star: boolean}` — SEM `phone`/`isGroup`: o `messageId` sozinho identifica a mensagem (`client.starMessage(messageId, star)` da lib). Um único endpoint com flag booleana cobre as duas direções. Resposta segue o envelope padrão. |

## Conteúdo estruturado (`messages.sendLocation`/`sendContactCard`/`sendPoll`, ADR-0014)

Não coberto pelo relatório de pesquisa original desta rodada (que era focado no escopo do
ADR-0012/0013, e só tinha uma nota rasa sobre `contacts.sendVcard`) — as 3 capabilities foram
confirmadas via `gh api` direto contra o mesmo commit já usado como referência para este adapter
(`wppconnect-team/wppconnect-server`, `f09e2fed`, tag `v2.10.0`), lendo `routes.ts`,
`messageController.ts` e `deviceController.ts`. Confiança **Alta** para as 3.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.sendLocation` | `POST /send-location` | `MessageController.sendLocation`. Body confirmado pelo Swagger real: `{phone, isGroup, lat, lng, title, address}` — **`lat`/`lng` são STRINGS no schema, não números** (exemplo literal: `{"lat":"-89898322","lng":"-545454",...}`). `phone` reescrito para array pelo middleware `statusConnection` (mesmo mecanismo de `sendText`/`forwardMessage`); o handler faz `for (const contato of phone) { results.push(await client.sendLocation(contato, {lat, lng, address, name: title})) }` — resposta é um ARRAY de 1 elemento para este adapter (sempre 1 destinatário). `SendLocationInput.name` mapeia para `title`. |
| `messages.sendContactCard` | `POST /contact-vcard` | `DeviceController.sendContactVcard` (não `MessageController` — vive num controller diferente). Body confirmado pelo Swagger real: `{phone, isGroup, name, contactsId}` — `contactsId` é um ARRAY de contatos (permite múltiplos contatos numa única mensagem: exemplo literal `contactsId: ['5521999999999']`), diferente da maioria dos outros adapters (que só aceitam um contato solto); `SendContactCardInput` só modela um telefone — este adapter sempre envia um array de 1 elemento. **Divergência de envelope confirmada no controller**: diferente de `sendLocation`/`sendPollMessage` (`results.push(...)`, array), este handler faz `response = await client.sendContactVcard(...)` dentro do loop SEM `push` — resposta BARE, não array (`unwrapArrayResponse` cobre os dois casos sem alteração). |
| `messages.sendPoll` | `POST /send-poll-message` | `MessageController.sendPollMessage`. Body confirmado pelo Swagger real: `{phone, isGroup, name, choices, options: {selectableCount}}` — exemplo literal do schema usa `selectableCount: 1` (escolha única). `SendPollInput.allowMultipleAnswers` mapeia para `selectableCount: options.length` quando `true`, `1` quando `false`/ausente. Mesmo padrão de array de `sendLocation`. |

Resposta das 3: reaproveita `mapSentMessageFromMessage` (mesma função de `sendText`/`forwardMessage`
— fallback de id sintético se a resposta não ecoar `id`/`chatId`, robusto o suficiente para cobrir
tanto o caso array quanto o bare confirmados acima).

## Presença (`presence.*`, ADR-0015)

Cobertura 3/3, confiança Alta — **segunda melhor cobertura da fila**, atrás só de WAHA/Wuzapi/Whapi
(3/3 também, mas WPPConnect tem uma arquitetura de endpoint mais fragmentada — ver abaixo). Não
coberto pelo relatório de pesquisa original (que só tinha encontrado o webhook `onPresenceChanged`,
sem endpoint de ENVIO) — confirmado via `gh api` contra `wppconnect-server@f09e2fed`, lendo
`routes.ts`/`sessionController.ts`/`deviceController.ts`.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `presence.setTyping` | `POST /typing` (`DeviceController.setTyping`) ou `POST /recording` (`DeviceController.setRecording`) | **Único adapter da ADR-0015 que usa DOIS endpoints separados** em vez de um único endpoint com enum de estado. `/typing` body `{phone, isGroup, value}` (`value: true` → `startTyping`, `false` → `stopTyping`); `/recording` body `{phone, isGroup, duration?, value}` (idem para `startRecording`/`stopRecording`, `duration` não exposto por `SetTypingInput`). Mapeamento: `composing` → `/typing {value: true}`; `recording` → `/recording {value: true}`; **`paused`** (decisão própria, não há um terceiro endpoint "parar qualquer indicador") → `/typing {value: false}` — `stopTyping` como o par semântico mais direto de "encerrar o indicador". |
| `presence.set` | `POST /set-online-presence` (`SessionController.setOnlinePresence`) | Body: `{isOnline: boolean}` — `PresenceState` mapeia direto (`online` → `true`, `offline` → `false`). Presença GLOBAL da conta. |
| `presence.subscribe` | `POST /subscribe-presence` (`SessionController.subscribePresence`) | Body: `{phone, isGroup, all}` — este adapter sempre envia `all: false` (inscrição num contato específico); `all: true` inscreveria em todos os contatos/grupos (resolvido internamente via `getAllContacts`/`getAllGroups`), fora do escopo de `chatId` único do contrato canônico. |

## Etiquetas (`labels.*`, ADR-0016)

Cobertura 5/6 — **sem `labels.update`**: busca exaustiva nas rotas registradas (`routes.ts`) só
encontrou `add-new-label`/`get-all-labels`/`delete-label`/`delete-all-labels`/`add-or-remove-label`
— nenhuma rota edita um label existente (renomear/recolorir).

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `labels.list` | `GET /api/{session}/get-all-labels` (`LabelsController.getAllLabels`) | Resposta `{status, response: Label[]}` — `Label {id, name, color, count, hexColor}` (interface da lib `@wppconnect/wa-js`, reaproveitada pelo server). `LabelInfo.color` mapeia do campo numérico `color` (convertido para string); `hexColor` (cor computada) não é usado. |
| `labels.create` | `POST /api/{session}/add-new-label` (`LabelsController.addNewLabel`) | Body `{name, options?: {labelColor}}` — `options` omitido quando `CreateLabelInput.color` está ausente (não é `required` de fato, apesar do schema do swagger dizer o contrário: o controller só valida `name`). **A resposta não devolve o label criado com confiabilidade**: o wrapper `client.addNewLabel` (`labels.layer.ts` da lib `@wppconnect/wa-js`) chama `WPP.labels.addNewLabel(name, options)` dentro de uma função avaliada no browser SEM `return` — confirmado ao vivo via `gh api` — então `response` na resposta HTTP fica `undefined`. Este adapter, como a uazapi (ADR-0016), descobre o `id` atribuído por DIFF (lista antes + lista depois da criação, `id` presente só na segunda) — 3 chamadas HTTP no total. |
| `labels.delete` | `PUT /api/{session}/delete-label/{id}` (`LabelsController.deleteLabel`) | **Método PUT, não DELETE** — confirmado na rota registrada em `routes.ts` (quirk do próprio provider, não deste adapter). Sem body. |
| `labels.addToChat` | `POST /api/{session}/add-or-remove-label` (`LabelsController.addOrRemoveLabels`) | Endpoint BULK: `{chatIds: string[], options: [{labelId, type: 'add'\|'remove'}]}` (exemplo literal do dossiê original) — este adapter usa arrays de 1 elemento, mesma chamada única. `chatIds` exige JID completo (`"[number]@c.us"`) — reaproveita `toWppconnectMentionJid` (mesma conversão já usada para `mentions` de `messages.sendText`). |
| `labels.removeFromChat` | `POST /api/{session}/add-or-remove-label` | Mesmo endpoint de `addToChat`, variando só `type: 'remove'` no array `options`. |

**Não confirmado nesta pesquisa** (a validar contra uma instância real): se `GET /get-all-labels`
tem alguma paginação/limite que afetaria o diff usado por `labels.create` em contas com muitos
labels; e se o bug de `return` ausente em `client.addNewLabel` já foi corrigido em versões mais
recentes da lib `@wppconnect/wa-js` (o commit pinado usado nesta pesquisa é `f09e2fed`,
tag `v2.10.0`).

## Canais (`channels.create`/`delete`, ADR-0017)

Cobertura 2/6 — achado ao vivo que corrige o relatório original (que não tinha encontrado NADA
sobre canais/newsletters neste provider).

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `channels.create` | `POST /api/{session}/newsletter` (`NewsletterController.createNewsletter`) | Body `{name, options?: {description?, picture?}}` — `options.picture` (base64) não exposto pelo contrato canônico. Diferente do bug confirmado em `client.addNewLabel` (ADR-0016, sem `return` na função avaliada no browser), `client.createNewsletter` do wa-js FAZ `return` corretamente (`(name, options) => WPP.newsletter.create(name, options)`, confirmado ao vivo via `gh api` contra `wppconnect-team/wa-js`) — a resposta é confiável. Shape `ResultCreateNewsletter {idJid, inviteCode, inviteLink, name, state, subscribersCount, description, timestamp}` — `idJid` (não `id`) é o campo do identificador. A resposta HTTP não usa o envelope `{status, response}` comum ao resto do adapter — o controller faz `res.status(201).json(await req.client.createNewsletter(...))` diretamente. |
| `channels.delete` | `DELETE /api/{session}/newsletter/{id}` (`NewsletterController.destroyNewsletter`) | Sem body. Mesma ausência de envelope na resposta. |

**Sem `channels.list`/`getInfo`/`follow`/`unfollow`** — `routes.ts` só registra 4 rotas de
newsletter no total: `POST /newsletter` (create), `PUT /newsletter/{id}` (editar — fora do escopo
desta ADR), `DELETE /newsletter/{id}` (delete), `POST /mute-newsletter/{id}` (silenciar — fora do
escopo). **Achado relevante**: a lib `@wppconnect/wa-js` subjacente TEM `follow.ts`/`unfollow.ts`/
`getSubscribers.ts` internamente (confirmado ao vivo em `wa-js/src/newsletter/functions/`), mas o
`wppconnect-server` não expõe rota HTTP para nenhum deles — uma limitação real da SUPERFÍCIE HTTP
do servidor, não da biblioteca subjacente nem deste adapter (que só pode chamar o que o servidor
expõe via REST).

## Grupos

14 operações confirmadas com endpoint. Todos POST/GET, nenhum PUT/PATCH/DELETE (confirmado em
`routes/index.ts`) — exceto `groups.list`, que usa `POST /list-chats` em vez de um endpoint
dedicado a grupos (ver subseção abaixo).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST /create-group` | Body `{participants, name}`. **Achado crítico** — ver subseção dedicada abaixo. |
| `groups.getInfo` | `GET /group-info/:groupId` | Resposta rica: `{id, name, description, subject, ..., participants:[{id,isAdmin}]}`. `name`/`subject` coexistem (redundância aparente, não esclarecida) — prioriza `name`. `isSuperAdmin` não confirmado — sempre `false`. |
| `groups.list` | `POST /list-chats`, body `{onlyGroups: true}` | Substitui o `GET /all-groups` deprecated. **Resposta SEM envelope** (único endpoint deste provider assim) — ver subseção dedicada abaixo. |
| `groups.addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` | `POST /add-participant-group` \| `/remove-participant-group` \| `/promote-participant-group` \| `/demote-participant-group` | Quatro endpoints DISTINTOS (diferente do Wuzapi, que reaproveita um único com `Action`), todos `{groupId, phone}`. Não confirmado se `phone` aceita array — este adapter chama uma vez POR PARTICIPANTE (`Promise.all`). |
| `groups.updateSubject` | `POST /group-subject` | Body `{groupId, title}` — campo é `title`, não `subject`/`name`. |
| `groups.updateDescription` | `POST /group-description` | Body `{groupId, description}`. |
| `groups.updatePicture` | `POST /group-pic` | Body `{groupId, path}` — mesmo campo `path` (não `base64`) do sticker; sem restrição de formato confirmada (diferente do Wuzapi, que só aceita JPEG de fato). |
| `groups.getInviteLink` / `groups.revokeInviteLink` | `GET /group-invite-link/:groupId` / `GET /group-revoke-link/:groupId` | Endpoints SEPARADOS (diferente do Wuzapi, que reaproveita um único com `reset`). Retornam a URL completa — ver subseção abaixo sobre a chave exata não confirmada. |
| `groups.joinViaInviteLink` | `POST /join-code` | Body `{inviteCode}`. **Confirmado aceitar código bare OU URL completa** (a lib remove o prefixo internamente) — diferente do Wuzapi, onde isso era só suposição. |
| `groups.leaveGroup` | `POST /leave-group` | Body `{groupId}`. |

### `groups.create` — achado crítico: `id` fica ANINHADO em `groupInfo[0]`, e não é o JID completo

**Corrigido na verificação adversarial** (a descrição original estava errada quanto ao nível de
aninhamento): o controller monta `infoGroup.push({name: group, id: response.gid.user,
participants: response.participants})` e responde `{message, group: name, groupInfo: infoGroup}` —
ou seja, `id`/`name`/`participants` ficam dentro de `data.groupInfo[0]`, NÃO diretamente em `data`
(diferente do que uma leitura superficial do controller sugeria). Além disso, `id` ali é só a parte
"user" do JID do grupo (dígitos crus), **não** o JID completo `<dígitos>@g.us` que
`GET /group-info/:groupId` e todo o resto de `groups.*` espera como `:groupId`. Sem o sufixo, o
`id` devolvido por `create()` seria inútil para operações subsequentes no MESMO grupo (parece uma
falha do próprio controller — na mesma classe de achado já documentada no dossiê Wuzapi para o
código morto de `showAllSessions`). Este adapter lê `data.groupInfo[0]` e corrige o `id`
reconstruindo o JID completo (`toWppconnectGroupId`: acrescenta `@g.us` sempre que o valor
devolvido não contém `@`) — decisão deliberada para manter `GroupInfo.id` de fato opaco e
reutilizável (ADR-0009), não uma tentativa de adivinhar um campo ausente (o formato
`<dígitos>@g.us` é uma constante universal do protocolo WhatsApp, não uma suposição sobre este
provider específico).

`groupInfo[0].participants` da resposta de `create-group` não tem shape confirmado (array de string
vs. de objeto) — este adapter não tenta parseá-lo; cai sempre nos participantes requisitados
(`isAdmin`/`isSuperAdmin` assumidos `false`), mesmo padrão de fallback já usado pelo adapter
Wuzapi quando a resposta não ecoa todos os campos.

### `groups.list` — via `POST /list-chats`, sem participantes na resposta

`GET /all-groups` (`GroupController.getAllGroups`) está `#swagger.deprecated` ("Deprecated in favor
of 'list-chats'") — não usado. O substituto confirmado na lib é `listChats(options?:
ChatListOptions): Promise<Chat[]>` (`DeviceController.listChats` no server), que aceita
`{id?, count?, direction?, onlyGroups?, onlyUsers?, onlyWithUnreadMessage?, withLabels?}`. Este
adapter sempre envia `{onlyGroups: true}`, filtrando a listagem para só grupos.

**Resposta SEM envelope — anomalia confirmada e isolada deste único endpoint** (verificação
adversarial desta revisão, corrigindo uma afirmação anterior errada deste dossiê): o corpo HTTP É o
array `Chat[]` (`src/api/model/chat.ts`) BRUTO — `{id: Wid, name, isGroup, archive, pin,
unreadCount, ephemeralDuration, ...}` —, nunca `{status, response, mapper}`.
`DeviceController.listChats` (`f09e2fed`, `src/controller/deviceController.ts`) responde com
`res.status(200).json(response)`, diferente de todos os ~10 outros handlers verificados no mesmo
arquivo, que embrulham com `res.json({status: 'success', response})`. Ver "Envelope de resposta"
acima. `id` segue o mesmo padrão `Wid` (`{..., _serialized}`) já tratado por `extractChatId` no
resto do arquivo. **Limitação confirmada**: `Chat` não expõe a lista de participantes — só
`GET /group-info/:groupId` (`groups.getInfo`) traz isso. Este adapter mapeia
`GroupInfo.participants: []` para todo item de `groups.list()` (vazio de propósito, nunca
inventado); consumidores que precisem da lista completa devem encadear `groups.getInfo(id)` por
grupo depois de listar.

Nota de implementação: `unwrapResponse` (usada por todo o resto do arquivo para desembrulhar o
envelope padrão) é reaproveitada aqui e "funciona" só por acidente — `asRecord` rejeita arrays e
cai no `return body` bruto, que por coincidência já é o array cru esperado. Não simplificar essa
função assumindo que todo endpoint segue `{status, response}` sem revalidar `groups.list`
especificamente.

### `groups.getInviteLink`/`revokeInviteLink` — resolvido: `response` é sempre string bare

Resolvido na verificação adversarial: `group.layer.ts` da lib subjacente mostra que
`getGroupInviteLink(chatId)` sempre retorna uma string bare (`https://chat.whatsapp.com/${code}`),
nunca um objeto — logo `response` do envelope para `GET /group-invite-link/:groupId` (e, pelo
mesmo padrão, `GET /group-revoke-link/:groupId`) é sempre a URL completa como string direta, nunca
`{link}`/`{inviteLink}`/`{url}`. Este adapter (`extractInviteLinkValue`) trata o caso string
primeiro; o ramo de fallback para objeto com uma dessas chaves é defensividade extra que, na
prática, é código morto para este par de endpoints — mantido por segurança (custo zero, sem
suposição arriscada) e documentado como tal em vez de "chave não confirmada". `normalizeInviteLink`
garante o formato completo de qualquer forma.

### Participantes de grupo — formato de `phone` não confirmado, identity passthrough

Os quatro endpoints de participante (`add`/`remove`/`promote`/`demote-participant-group`) só têm
`{groupId, phone}` confirmado no dossiê, sem exemplo de valor para `phone` (dígitos crus? JID?).
Este adapter repassa o chatId canônico do participante sem transformação — mesmo padrão de
"identity passthrough, ponto único de mudança" já usado pelos demais adapters deste pacote quando
não há evidência de necessidade de transformação.

## Contatos

Todas as 8 operações canônicas possíveis estão implementadas.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `contacts.list` | `GET /all-contacts` | `DeviceController.getAllContacts` → script injetado `get-all-contacts.js`: `WPP.whatsapp.ContactStore.map(c => WAPI._serializeContactObj(c))`. Mesmo shape de `contacts.get` — ver subseção dedicada abaixo. |
| `contacts.get` | `GET /contact/:phone` | `DeviceController.getContact` → script injetado `get-contact.js`: `return window.WAPI._serializeContactObj(found)`. Confiança média-alta (script injetado, não interface TS tipada diretamente) — ver subseção dedicada abaixo. |
| `contacts.checkExists` | `GET /check-number-status/:phone` | Shape do objeto interno confirmado via uso do middleware `statusConnection` (mesmo método, `checkNumberStatus`): `{numberExists: boolean, id: {..., _serialized}}`. Assumido que o controller do endpoint standalone embrulha o MESMO objeto no envelope padrão. |
| `contacts.getProfilePicture` | `GET /profile-pic/:phone` | `DeviceController.getProfilePicFromServer` → lib `getProfilePicFromServer(chatId): Promise<ProfilePicThumbObj>` (assinatura tipada). Resposta: `{eurl, id, img, imgFull, raw: null, tag}` — prioriza `imgFull` sobre `img`. |
| `contacts.getAbout` | `GET /profile-status/:phone` | `DeviceController.getStatus` → lib `getStatus(contactId): Promise<ContactStatus>`, retorno `{id, status, stale?}`. `status` mapeia para `about`; string vazia vira `undefined`. |
| `contacts.block` | `POST /block-contact` | Body `{phone}`. Resposta ignorada, `Promise<void>`. |
| `contacts.unblock` | `POST /unblock-contact` | Body `{phone}`. Resposta ignorada, `Promise<void>`. |
| `contacts.listBlocked` | `GET /blocklist` | Resposta confirmada: `[{phone: "<dígitos, sem sufixo>"}]` (o controller descarta o JID completo antes de responder). Mapeado para `string[]` de bare digits — ainda um chatId canônico válido. |

### `contacts.list`/`contacts.get` — shape confirmado via script injetado, não a interface TS

Os dois endpoints devolvem o objeto montado por `WAPI._serializeContactObj` (visível nos scripts
`get-all-contacts.js`/`get-contact.js` da lib): `{...serializeRawObj(obj), formattedName,
isHighLevelVerified, isMe, isMyContact, isPSA, isUser, isVerified, isWAContact,
profilePicThumbObj, statusMute, msgs: null}` — consistente com (mas mais rico que) a interface
`Contact` tipada da lib (`src/api/model/contact.ts`: `id, name, pushname, shortName, type`).

Mapeamento para o `Contact` canônico deste pacote:

- `id` — `Wid._serialized` (mesmo padrão `extractChatId` do resto do arquivo).
- `name` — prioriza `name` (nome salvo na agenda), caindo para `pushname`/`formattedName`/
  `shortName` quando ausente.
- `hasWhatsApp` — `isWAContact`.
- `profilePictureUrl` — só quando `profilePicThumbObj` vem embutido no próprio objeto de contato;
  prioriza `imgFull` sobre `img` (mesmo padrão "prefira a versão full" usado por outros adapters
  deste pacote, ex.: Whapi `profile_pic_full`/`profile_pic`).
- `about`/`isBlocked` — sempre `undefined` neste payload (endpoints dedicados:
  `contacts.getAbout`/`contacts.listBlocked` cobrem os dois).

## Conversas (`chats.*`, retrofit ADR-0012)

Namespace novo (ADR-0012) de gestão de estado de conversa. Pesquisa dedicada de 2026-07-12 confirma
as 8 operações candidatas COM endpoint (confiança Alta para todas — controller + delegação até a
lib, incluindo o script injetado `send-mute.js` para `chats.mute`/`unmute`) — cobertura completa,
diferente de outros adapters deste pacote onde o namespace é parcial.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `chats.archive` / `chats.unarchive` | `POST /archive-chat` | Toggle único: `{phone, isGroup, value}`, o MESMO endpoint arquiva/desarquiva conforme `value` (booleano de verdade, sem o bug de `chats.pin` abaixo). Ver subseção dedicada. |
| `chats.pin` / `chats.unpin` | `POST /pin-chat` | `{phone, isGroup, state}`. **Bug confirmado no controller**: `state === 'true'` compara com STRING, não booleano — ver subseção dedicada (achado mais acionável desta pesquisa). |
| `chats.mute` / `chats.unmute` | `POST /send-mute` | `{phone, isGroup, time, type}`. Duração escolhida pelo ADAPTER (canônico não expõe duração, ver ADR-0012) — ver subseção dedicada. |
| `chats.markRead` | `POST /send-seen` | `{phone, isGroup}`. Endpoint de nível de CHAT (distinto de `messages.markRead`, fora de escopo — ver ADR-0012). Terceira exceção de envelope do provider — ver subseção dedicada. |
| `chats.markUnread` | `POST /mark-unseen` | `{phone, isGroup}`. NÃO é o mesmo endpoint de `markRead` com um parâmetro invertido — dois endpoints totalmente distintos. |

Todas as 8 operações reaproveitam `toWppconnectRecipient` (mesma extração da parte local do JID já
usada por `messages.*` — ver "Identificação do destinatário" acima) para popular `phone`/`isGroup`,
evitando o mesmo risco de sufixo duplicado no servidor.

### `chats.archive`/`chats.unarchive` — toggle único, e um achado de não-idempotência

Chamada única confirmada no controller (sem loop): `await req.client.archiveChat(`${phone}`,
value)` (`DeviceController.archiveChat`, `deviceController.ts:689-736`). Delegação
(`controls.layer.ts:93-106`): `WPP.chat.archive(chatId, option=true)`. Resposta é um objeto REAL
(`{wid, archive}`, confirmado em `wa-js@a4c57173`, `src/chat/functions/archive.ts:60-63`) —
ignorada por este adapter, contrato retorna `Promise<void>`.

**Nuance de comportamento (`wa-js` HEAD, dependência ativa não pinada pelo dossiê original —
confiança média-alta, não o commit `e153ff72` do restante da pesquisa)**: o provider LANÇA erro se
o chat já estiver no estado pedido:

```ts
if (chat.archive === archive) {
  throw new WPPError(`${archive?'archive':'unarchive'}_error`,
    `The chat ${wid} is already ${archive?'archived':'unarchived'}`, {wid, archive});
}
```

Ou seja, arquivar um chat já arquivado (ou desarquivar um já desarquivado) é **erro**, não um no-op
idempotente — comportamento que qualquer consumidor precisa tratar (checar o estado antes, ou
tolerar um 500). Este adapter não tenta mascarar isso.

A rota também tem `statusConnection` no meio (confirmado em `routes/index.ts`), que reescreve
`req.body.phone` para um array de JIDs validados antes do handler rodar — mas o handler interpola
esse valor direto num template string (`${phone}`) em vez de iterar. Funciona por acidente só
porque um array de 1 elemento vira string igual ao próprio elemento (`String([x]) === String(x)`);
não afeta este adapter (que só envia um destinatário por chamada).

### `chats.pin`/`chats.unpin` — bug confirmado: `state === 'true'` compara STRING, não booleano

**Bug crítico confirmado no código real** (`deviceController.ts:1167-1227`,
`DeviceController.pinChat`):

```ts
const { phone, state } = req.body;
for (const contato of phone) {
  await req.client.pinChat(contato, state === 'true', false);
}
```

O schema Swagger declara `state: {type:"boolean"}`, mas o controller compara com a STRING literal
`'true'`, não o booleano. Se o chamador enviar JSON `state: true` (exatamente como o próprio schema
pede), a comparação dá `false` — o chat seria **sempre desafixado**, independente da intenção, a
menos que o chamador contorne o bug enviando a string literal `"true"`. **Este é o achado mais
acionável de toda a pesquisa desta rodada**: este adapter (`setChatPinned`) sempre envia `state`
como a STRING `"true"`/`"false"` (nunca o booleano JSON) para funcionar como documentado.

Delegação (`controls.layer.ts:108-130`): `pinChat(chatId, option, nonExistent=false)` →
`WPP.chat.pin(chatId, option)` — mesmo padrão "lança se já no estado pedido" de `archive` (confiança
média-alta, confirmado em `wa-js@a4c57173`, `src/chat/functions/pin.ts:38-44`). Resposta é mensagem
FIXA (`{message: 'Chat fixed'}` — usada tanto para pin quanto unpin, rótulo enganoso no caso de
unpin) — ignorada, contrato retorna `Promise<void>`.

### `chats.mute`/`chats.unmute` — `time`+`type` obrigatórios, bug de nomenclatura em `'year'`, e uma duração inventada pelo adapter

**Endpoint**: `POST /send-mute` (`DeviceController.sendMute`, `deviceController.ts:1516-1568`).
Body `{phone, isGroup, time: number, type: string}`. Delegação até o script injetado
(`src/lib/wapi/functions/send-mute.js`, lib `e153ff72`):

```js
switch (type) {
  case 'hours':   TimeInt = ...setHours(getHours()+time)... ; break;
  case 'minutes': TimeInt = ...setMinutes(getMinutes()+time)...; break;
  case 'year':    TimeInt = ...setDate(getDate()+time)...; break;   // soma DIAS, não anos
}
window.Store.SendMute.sendConversationMute(chat.id, TimeInt, 0)
```

**Nuances confirmadas**:

- Só 3 valores de `type` acionam o mute de fato: `'hours'`, `'minutes'`, `'year'`. Qualquer outro
  valor cai no branch de REMOÇÃO do mute — não há um `type: 'forever'`/`'always'` dedicado.
- **`type: 'year'` tem nome enganoso**: o código usa `setDate(getDate() + time)`, ou seja, soma
  `time` em DIAS, não anos — bug de nomenclatura confirmado no próprio provider, não suposição.
- **"Desmutar" não é um `time`/`type` explícito**: é obtido enviando qualquer coisa que não seja o
  par `{number, string}` esperado (ex.: omitir os campos) — cai no branch `remove=true`, que
  restaura usando a expiração já registrada no chat (`isMute.__x_expiration`), não zera
  incondicionalmente.
- Resposta NÃO é fixa: `response` é o objeto retornado por `WAPI.sendMute` (mesclado com
  `{type:'sendMute', time, timeType}`) — ignorada por este adapter mesmo assim, contrato retorna
  `Promise<void>`.

`ChatsApi.mute`/`ChatsApi.unmute` do contrato canônico não recebem duração (ver ADR-0012 — nenhum
formato de duração converge entre os 8 providers pesquisados: uazapi usa enum de horas
`0|8|168|-1`, Whapi usa timestamp Unix em ms, WPPConnect usa este `time`+`type` com o bug do
`'year'`). Este adapter (`setChatMuted`, constante `MUTE_DURATION`) precisa escolher uma duração
mesmo assim, já que o endpoint EXIGE `time`+`type` juntos para de fato silenciar — decisão do
ADAPTER, não um default do provider: `mute(chatId)` usa `type: 'hours', time: 87600` (10 anos em
horas), evitando tanto o `type: 'year'` confirmado-bugado (que somaria só 87600 DIAS, um valor
absurdo) quanto um número pequeno de `'year'` (que somaria só alguns DIAS, muito curto para
representar "silenciar indefinidamente"). `unmute(chatId)` OMITE `time`/`type` de propósito, para
cair no branch de remoção confirmado acima. Consumidores que precisem de uma duração específica só
têm essa granularidade via chamada direta ao provider, fora do contrato canônico.

### `chats.markRead`/`chats.markUnread` — mecanismos assimétricos, e uma terceira exceção de envelope

**Marcar como não lida**: `POST /mark-unseen` (`DeviceController.markUnseenMessage`,
`deviceController.ts:1023-1069`). Body `{phone, isGroup}` (sem toggle booleano — só liga o estado
"não lida", nunca desliga). Delega para `req.client.markUnseenMessage(phone)` →
`WPP.chat.markIsUnread(chatId)` (`controls.layer.ts:65-76`). Resposta: envelope **padrão**
(`status: 'success'` minúsculo), mensagem fixa `{message: 'unseen checked'}`.

**Marcar como lida ("seen")**: `POST /send-seen` (`DeviceController.sendSeen`,
`deviceController.ts:1570-1615`). Body `{phone, isGroup}`. **Não é o mesmo endpoint com um
parâmetro invertido** — é outro endpoint, sem toggle, delegando a `req.client.sendSeen(phone)`.

**Achado central — terceira exceção de envelope do provider**: `sendSeen` (e também
`deleteChat`/`clearChat`/`getMessageById`, não usados por este adapter) usam um SEGUNDO
`returnSucess`/`returnError` local, definido só em `deviceController.ts:22-44` — DIFERENTE do usado
por `mark-unseen` e por todo o resto do arquivo padrão da lib (o `{status:'success', response,
mapper:'return'}` já documentado na seção "Envelope de resposta"):

```ts
function returnSucess(res, session, phone, data) {
  res.status(201).json({
    status: 'Success',              // <- capital "S", diferente de 'success'
    response: { message: '...', contact: phone, session: session, data: data },
  });
}
```

Ou seja, para `send-seen` (e `delete-chat`/`clear-chat`) o `status` vem com **S maiúsculo** e o
payload real fica **dois níveis abaixo** (`response.data`), não em `response` diretamente — igual em
espírito à exceção de `/list-chats` (seção "Envelope de resposta"), mas de um jeito diferente (aqui
o envelope existe, só que com uma chave a mais e casing diferente). Relevante especificamente
porque `mark-unseen` (a metade "unread" do par) usa o envelope padrão normal, e `send-seen` (a
metade "read") usa este terceiro formato. Não afeta este adapter: a resposta inteira é ignorada em
`markChatRead`/`markChatUnread` (contrato retorna `Promise<void>`) — citado aqui só para não ser
redescoberto por engano como um bug de parsing numa manutenção futura.

## Webhooks

### Configuração

**Não existe env var** para o webhook — `src/config.ts` não lê `process.env` em nenhum ponto.
Duas formas, ambas confirmadas no código-fonte:

- **Global**: `config.ts` (montado como volume Docker), `webhook.url` + flags de gating por tipo
  de evento (`onPresenceChanged`, `onParticipantsChanged`, `onReactionMessage`, `onPollResponse`,
  `onRevokedMessage`, `onLabelUpdated`, `onSelfMessage` — default `false`, os demais default
  `true`) + `ignore: ['status@broadcast']`.
- **Por sessão**: campo `webhook` (string) no body de `POST /start-session` — sobrepõe o global só
  para aquela sessão. Este adapter expõe isso via `WppconnectOptions.webhook`.

Sem mecanismo de assinatura/HMAC nativo (`api.post(webhook, data)` sem headers de segurança extras)
— `WebhookInput.rawBody` está disponível no contrato para isso, mas verificar assinatura é
responsabilidade do consumidor (mesma decisão já tomada nos demais adapters deste pacote).

### Envelope — objeto PLANO, sem aninhamento

Confirmado literalmente (`callWebHook`, `src/util/functions.ts`):
`data = Object.assign({event, session}, data)`. Ou seja: `event` (string, nome do evento) e
`session` (nome da sessão, popula `instanceId`) ficam no MESMO NÍVEL que todos os campos do evento
original — **sem** uma chave aninhada tipo `data`/objeto de evento. Diferente de Wuzapi
(`{type, event: {...}}` aninhado) e Whapi (`{event:{type,event}, messages:[...]}`).

### Eventos mapeados

| `event` | Canônico | Confiança |
| --- | --- | --- |
| `onmessage` / `unreadmessages` | `message.received` | Alta (shape `Message` citado literalmente na interface da lib) |
| `onselfmessage` | `message.sent` (`fromMe` sempre `true` quando disparado) | Alta |
| `onack` | `message.ack` | Alta para o shape; média para `chatId` (sem campo próprio, usa `to`) |
| `qrcode` | `connection.update` (`state: 'qr'`) | Alta — `qrcode` SEM prefixo de data URI (removido explicitamente pelo servidor antes do webhook) |
| `phoneCode` | `connection.update` (`state: 'qr'`) | Decisão de implementação — sem campo canônico para pairing code (`ConnectionUpdateEvent` só tem `qr`); nunca disparado por sessões criadas por ESTE adapter |
| `status-find` | `connection.update` | Ver tabela `StatusFind` abaixo |
| `onparticipantschanged` | `group.update` | Alta (interface `ParticipantEvent` citada literalmente) |
| `onpresencechanged` / `location` / `incomingcall` | `unknown` (reconhecido, sem equivalente canônico) | Shape confirmado na pesquisa, mas o core não modela presença/localização ao vivo/chamada recebida — `reason` explica o motivo em vez de um "evento não reconhecido" genérico |
| `onreactionmessage` / `onrevokedmessage` / `onpollresponse` / `onupdatelabel` | `unknown` (reconhecido, sem shape confirmado) | A lib tipa esses callbacks como `any` — não reconstruído |
| qualquer outro | `unknown` | — |

### `onack` — `id` é OBJETO, sem `chatId` próprio

`Ack` (`src/api/model/ack.ts`): `{id: Id, body, type, t, from, to, self, ack}`. `id` é um objeto
`Id` (`{server, user, _serialized, fromMe, remote}`), não uma string — `messageId` extraído de
`id._serialized` (fallback `id.id`). `Ack` não tem campo `chatId` — `to` é usado como melhor
aproximação (confiança média, não testado contra instância real).

`ack` é o enum numérico `AckType` (`src/api/model/enum/ack-type.ts`): `CLOCK=0, SENT=1,
RECEIVED=2, READ=3, PLAYED=4, PEER=5`, e vários negativos de falha (`FAILED=-1` até
`MD_DOWNGRADE=-7`). Mapeamento: `0→pending, 1→sent, 2→delivered, 3→read, 4→played`, qualquer
negativo `→error`. `PEER` (sincronização entre dispositivos próprios, não um estado de entrega) e
qualquer valor fora da enumeração ficam **sem equivalente** — o evento inteiro vira `unknown` em
vez de inventar um `MessageAck`.

### `status-find` — enum `StatusFind`

Mapeamento proposto pela pesquisa (interpretação, não fato documentado pelo provider):
`inChat`/`isLogged → connected`; `notLogged → qr`; `qrReadSuccess → connecting`;
`autocloseCalled`/`browserClose`/`disconnectedMobile`/`phoneNotConnected`/`serverClose →
disconnected`; `qrReadError`/`qrReadFail → unknown`.

### `onmessage`/`onselfmessage`/`unreadmessages` — sem campo de URL de mídia confirmado

`Message` (interface confirmada, `src/api/model/message.ts`) tem `mediaKey`/`mimetype`/`caption`,
mas **não** expõe um campo de URL de mídia (`mediaKey` é a chave de criptografia do WhatsApp, não
uma URL de download — bibliotecas no estilo whatsapp-web.js tipicamente exigem um método de
download separado, não um campo de URL simples). Este adapter deixa `MediaRef.url`/`base64`
`undefined` para mensagens recebidas via webhook — só `mimeType` é populado quando presente. `type`
(enum `MessageType`: `chat`/`image`/`video`/`audio`/`ptt`/`sticker`/`document`/`location`/`vcard`/
`gp2`/...) mapeia para `MessageKind`; `ptt` (nota de voz) cai em `'audio'` (mesmo `MediaKind`,
`MessageKind` não distingue os dois). `chatId`/`Message.id` tipados `string | Wid` no dossiê —
aceita string direta ou objeto com `_serialized`.

### `onparticipantschanged` — `operation` como campo mais limpo

`ParticipantEvent` (interface confirmada): `{by?, byPushName?, groupId, action, operation, who}`.
`operation` tem só 4 valores (`add`/`remove`/`demote`/`promote`) — mais limpo que `action` (6
valores com sinônimos `join`≈`add`/`leaver`≈`remove`). Este adapter mapeia por `operation`.

### Timestamps — segundos vs. milissegundos

`Message.t`/`Message.timestamp` e `Ack.t` são assumidos em SEGUNDOS, por analogia com o comentário
explícito `"Epoch timestamp (seconds)"` em `IncomingCall.offerTime` (mesmo arquivo de tipos da
lib) — **não confirmado literalmente** para estes dois campos específicos (nenhum comentário
explícito de unidade neles). `PresenceEvent.t` (não usado, evento sem equivalente canônico) É
confirmado em MILISSEGUNDOS por comentário literal (`Date.now()`) — citado aqui só para registrar
que a convenção NÃO é uniforme entre todos os eventos deste provider.

## Limites e particularidades

- Todo endpoint operacional exige o nome da sessão no PATH (`/api/{session}/...`) — diferente de
  Wuzapi/uazapi (sessão resolvida pelo header de auth), aqui é obrigatório em `WppconnectOptions`.
- Nenhum payload de webhook/resposta de envio citado no dossiê é um exemplo JSON literal com
  valores reais capturado de uma instância — todos vêm de interfaces TypeScript da lib
  (`@wppconnect-team/wppconnect`) ou de trechos de código do controller do servidor. Recomenda-se
  validar contra uma instância Docker real antes de depender deste adapter em produção (mesmo
  cuidado já registrado nos dossiês Whapi/Wuzapi/QuePasa).
- `GET /qrcode-session` (imagem PNG binária) não é usado por nenhum caminho deste adapter — mesmo
  obstáculo do `HttpClient` (decodifica resposta não-JSON como texto UTF-8, corrompendo bytes
  binários) já documentado no dossiê QuePasa para `GET /scan`.
- `GET /check-connection-session` (booleano simples) também não é usado — `status-session` é
  estritamente mais rico e já cobre `instance.status()`.

## Gaps/decisões documentadas (resumo)

1. **`PHONECODE`/`phoneCode`** não tem estado canônico dedicado — mapeado para `'qr'` em ambos os
   pontos onde aparece (`instance.status()` e o evento de webhook `phoneCode`), decisão de
   implementação, não fato documentado.
2. **Risco de `instance.connect()` travar** se a sessão já estiver conectada e
   `waitQrCode:true` — reavaliado: a leitura de `sessionController.ts` sugere que isso só ocorreria
   para sessões genuinamente novas (não para reconexão de uma sessão já vista), cenário mais
   estreito do que se pensava; ainda não confirmado empiricamente. Ver
   `WppconnectOptions.waitQrCode`.
3. **`groups.create`'s `id`** precisa ser corrigido (sufixo `@g.us` reconstruído) porque a resposta
   confirmada do provider devolve só a parte "user" do JID.
4. **Chave exata da URL** em `groups.getInviteLink`/`revokeInviteLink` não confirmada — extração
   defensiva de múltiplos formatos possíveis.
5. **Nome do campo `quotedMessageId`** em `messages.sendMedia` e **nome do campo `base64`** em
   `send-voice-base64` são assumidos por analogia, não confirmados por exemplo JSON literal.
6. **Formato de `phone`** nos 4 endpoints de participante de grupo não confirmado — identity
   passthrough, sem transformação.
7. **Batch de participantes** não confirmado nos 4 endpoints de grupo — este adapter chama uma vez
   por participante.
8. **`groups.list` não devolve participantes** — `Chat` (`POST /list-chats`) não tem esse campo;
   `GroupInfo.participants` fica `[]` para todo item da listagem, consumidor precisa encadear
   `groups.getInfo` por grupo se precisar da lista completa.
9. **`contacts.list`/`contacts.get`** têm confiança média-alta (shape confirmado via script
   injetado da lib, não via interface TS tipada diretamente) — ver subseção dedicada em
   "Contatos".
10. **`groups.list` (`POST /list-chats`) responde SEM o envelope `{status, response, mapper}`** —
    único endpoint deste provider assim, confirmado no código-fonte real (`f09e2fed`,
    `DeviceController.listChats`). `unwrapResponse` só acerta por acidente (`asRecord` rejeita
    arrays) — ver "Envelope de resposta" e a subseção `groups.list` acima.
11. **`chats.pin`/`chats.unpin` (retrofit ADR-0012) precisam do workaround `state` como STRING**
    (`"true"`/`"false"`, nunca booleano) — bug confirmado no controller (`state === 'true'`), o
    achado mais acionável de toda a pesquisa desta rodada. Ver "Conversas (`chats.*`)".
12. **`chats.mute`/`chats.unmute` (retrofit ADR-0012) usam uma duração INVENTADA pelo adapter**
    (`type: 'hours', time: 87600` para `mute`, ausência deliberada de `time`/`type` para `unmute`)
    — `ChatsApi.mute`/`unmute` não recebem duração no contrato canônico (nenhum formato converge
    entre providers, ver ADR-0012), e o endpoint deste provider exige `time`+`type` juntos para de
    fato silenciar. Ver "Conversas (`chats.*`)".
13. **`send-seen` (`chats.markRead`, retrofit ADR-0012) usa uma TERCEIRA variação de envelope** —
    `status` com "S" maiúsculo e payload dois níveis abaixo (`response.data`) — sem efeito prático
    porque a resposta é ignorada (`Promise<void>`), mas citado para não ser redescoberto como bug de
    parsing. Ver "Conversas (`chats.*`)".
14. **`messages.edit` não tem janela de tempo verificável em código aberto** — a checagem real vive
    no bundle fechado do próprio WhatsApp Web; **sem webhook de entrada** para edição feita por
    outra parte (busca exaustiva nos registros de hook não encontra `onEditMessage`/equivalente).
    Ver "Edição e exclusão de mensagem".
15. **`messages.delete` é revogação por padrão** (`onlyLocal` default `false` na lib) — coerente com
    `DeleteMessageInput` (sem campo de escopo). O próprio exemplo de documentação do provider erra
    esse default (rotula "only me" um payload que na verdade revoga para todos). Ver "Edição e
    exclusão de mensagem".
