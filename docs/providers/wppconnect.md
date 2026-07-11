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
`messages.sendMedia`, `messages.sendReaction`, `groups.create`, `groups.getInfo`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`, `groups.getInviteLink`, `groups.revokeInviteLink`,
`groups.joinViaInviteLink`, `groups.leaveGroup`, `contacts.checkExists`, `contacts.block`,
`contacts.unblock`, `contacts.listBlocked`, `webhooks.parse`.

**Deliberadamente de fora nesta fase** (endpoint existe, mas faltou confirmação suficiente para
implementar sem adivinhar):

- `instance.pairingCode` — obstáculo estrutural, ver acima.
- `groups.list` — o único endpoint (`GET /all-groups`) está marcado `#swagger.deprecated` pelo
  próprio provider ("Deprecated in favor of 'list-chats'", não investigado) e a pesquisa não trouxe
  o shape de resposta.
- `contacts.list` (`GET /all-contacts`), `contacts.get` (`GET /contact/:phone`),
  `contacts.getProfilePicture` (`GET /profile-pic/:phone`), `contacts.getAbout`
  (`GET /profile-status/:phone`) — os quatro endpoints existem e a pesquisa confirma a
  transformação do LADO DO REQUEST (`contactToArray`), mas nenhum shape de RESPOSTA foi
  confirmado. `contacts.checkExists`/`block`/`unblock`/`listBlocked` foram implementadas porque,
  diferente dos quatro acima, a pesquisa confirma o shape de resposta de cada uma (a primeira via
  o objeto interno usado pelo middleware `statusConnection`, que chama o mesmo
  `checkNumberStatus`).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `POST /start-session` | Ver seção dedicada acima. |
| `instance.status` | `GET /status-session` | Ver tabela de mapeamento acima. |
| `instance.logout` | `POST /logout-session` | Hard logout. |
| `messages.sendText` | `POST /send-message` (ou `POST /send-mentioned` quando `mentions` não vazio) | Ver seção "Mensagens e mídia". |
| `messages.sendMedia` | `POST /send-file-base64` (image/video/document) \| `/send-voice-base64` (audio) \| `/send-sticker` (sticker) | Ver seção "Mensagens e mídia". |
| `messages.sendReaction` | `POST /react-message` | Ver seção "Mensagens e mídia". |

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

Confirmado como universal para operações de mensagem/grupo/contato (função `returnSucess` do
servidor): `{status: 'success'|'error', response: <conteúdo específico da operação>, mapper:
'return'}`. **Não se aplica** aos endpoints de sessão (`start-session`/`status-session`/
`logout-session`/`generate-token`), que têm shapes próprios com significado semântico no próprio
campo `status` (documentado nas seções acima). Este adapter desembrulha `response` (com fallback
defensivo para o corpo cru se a chave estiver ausente) antes de mapear qualquer operação de
mensagem/grupo/contato.

## Grupos

13 operações confirmadas com endpoint (`groups.list` de fora, ver "capabilities fora de escopo").
Todos os endpoints POST/GET, nenhum PUT/PATCH/DELETE (confirmado em `routes/index.ts`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST /create-group` | Body `{participants, name}`. **Achado crítico** — ver subseção dedicada abaixo. |
| `groups.getInfo` | `GET /group-info/:groupId` | Resposta rica: `{id, name, description, subject, ..., participants:[{id,isAdmin}]}`. `name`/`subject` coexistem (redundância aparente, não esclarecida) — prioriza `name`. `isSuperAdmin` não confirmado — sempre `false`. |
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

Só 4 das 8 operações canônicas possíveis foram implementadas — ver "capabilities fora de escopo"
para a justificativa das 4 restantes.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `contacts.checkExists` | `GET /check-number-status/:phone` | Shape do objeto interno confirmado via uso do middleware `statusConnection` (mesmo método, `checkNumberStatus`): `{numberExists: boolean, id: {..., _serialized}}`. Assumido que o controller do endpoint standalone embrulha o MESMO objeto no envelope padrão. |
| `contacts.block` | `POST /block-contact` | Body `{phone}`. Resposta ignorada, `Promise<void>`. |
| `contacts.unblock` | `POST /unblock-contact` | Body `{phone}`. Resposta ignorada, `Promise<void>`. |
| `contacts.listBlocked` | `GET /blocklist` | Resposta confirmada: `[{phone: "<dígitos, sem sufixo>"}]` (o controller descarta o JID completo antes de responder). Mapeado para `string[]` de bare digits — ainda um chatId canônico válido. |

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
8. `contacts.list`/`get`/`getProfilePicture`/`getAbout` e `groups.list` deliberadamente fora de
   escopo por falta de shape de resposta confirmado (ver seção "Capabilities implementadas nesta
   fase").
