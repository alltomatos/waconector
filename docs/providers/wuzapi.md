# Dossiê: Wuzapi

- Docs oficiais: <https://github.com/asternic/wuzapi/blob/main/API.md>
- Versão testada: documentação/código consultados em 2026-07-11 (branch `main` do repositório
  `asternic/wuzapi`; sem tag de release fixada pelo próprio projeto no momento da pesquisa)
- Hospedagem: self-hosted (Docker; `docker-compose.yml` e `docker-compose-swarm.yaml` no repo).
  Banco padrão é SQLite sem configuração nenhuma; PostgreSQL é opcional via
  `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_PORT`/`DB_SSLMODE`.

> **Base técnica**: assim como o Evolution GO (F1), o Wuzapi é construído sobre a mesma biblioteca
> Go `tulir/whatsmeow`. Vários mapeamentos de conteúdo de mensagem (`conversation`,
> `extendedTextMessage`, `imageMessage`, ...) e de nomes de evento de conexão
> (`Connected`/`Disconnected`/`LoggedOut`/`PairSuccess`/...) foram inferidos **por analogia** com o
> adapter Evolution GO (`src/adapters/evolution/index.ts`) quando a pesquisa original não trazia um
> exemplo literal equivalente para o Wuzapi — o dossiê de pesquisa não consultou o código-fonte da
> própria lib `whatsmeow`, então esses pontos são plausíveis, não confirmados campo-a-campo. Cada
> ocorrência está sinalizada abaixo.

## Autenticação

Dois esquemas de token distintos, **nenhum com prefixo `Bearer`** (valor cru no header):

1. **Nível usuário/sessão** — header `token` (o `http.Header.Get` do Go é case-insensitive, então
   `Token`/`token` são equivalentes), com fallback para query string `?token=` se o header vier
   vazio. É o único usado por todas as capabilities implementadas nesta fase (F2).
2. **Nível admin** (rotas `/admin/**`, ex. `POST /admin/users`) — header `Authorization` com o
   valor de `WUZAPI_ADMIN_TOKEN`, comparado por SHA-256 + `subtle.ConstantTimeCompare` (tempo
   constante). **Nenhuma capability implementada nesta fase usa `Authorization`/admin token** — a
   criação do usuário/token (`POST /admin/users`) é pré-requisito operacional (feito fora do
   waconector, por quem administra o servidor), não uma capability do contrato `WaAdapter`.

> ⚠️ **Divergência confirmada entre a prosa da doc e o código-fonte**: `API.md` (linhas 5, 11) e o
> `README.md` (linhas 238, 311) afirmam em prosa que **todas** as requisições (inclusive de
> usuário) usam o header `Authorization`. Isso é **falso** para rotas de usuário —
> `handlers.go` (func `authalice`, linha ~155) faz `token := r.Header.Get("token")` explicitamente,
> e os próprios exemplos de `curl` dentro do mesmo `API.md` usam `-H 'Token: 1234ABCD'` (ex.:
> linhas 154, 352, 389, 415, 444, 473, 501, 823 etc.) — a doc se autocontradiz entre prosa e
> exemplos, e o exemplo bate com o código. Este adapter usa o header `token`, confiando no código e
> nos exemplos de `curl`, não na prosa.

`WuzapiOptions.token` é o token de usuário (definido pelo próprio admin ao criar o usuário via
`POST /admin/users`, campo `token` no body — não é autogerado pelo servidor).
`WuzapiOptions.adminToken` existe apenas para permitir guardar os dois segredos num único lugar (e
redigi-los em erros via `secrets` do `HttpClient`) — reservado para uma fase futura que exponha
provisionamento de usuário (`POST /admin/users`, fora do contrato `WaAdapter` atual). Mesmo padrão
já usado em `UazapiOptions.adminToken`.

## Modelo de instância/sessão

**Não existe o termo "instance" no domínio do Wuzapi.** A entidade central é o **"user"** (tabela
`users`: `id`, `name`, `token`, `webhook`, `jid`, `events`, `proxy_url`, `qrcode`, `history`,
`s3_*`, `hmac_key`), gerenciado via `/admin/users`. Cada "user" abre uma **"session"** do WhatsApp
(conexão websocket via whatsmeow) através de `POST /session/connect`. Ou seja: *user* = identidade/
credencial de longo prazo (1 token = 1 número de WhatsApp); *session* = estado de conexão volátil
dessa identidade.

- **Criar usuário** (fora do escopo desta fase — exige `Authorization: WUZAPI_ADMIN_TOKEN`):
  `POST /admin/users`, body `{name, token (obrigatório, definido pelo chamador), webhook?, events?,
  expiration? (aceito mas NÃO enforced pelo sistema, segundo o próprio README), proxyConfig?/
  s3Config?/hmacKey?/history?}`. O `id` interno é autogerado (`GenerateRandomID()`). Só cria o
  registro — não conecta ao WhatsApp.
- **Conectar**: `POST /session/connect` (header `token`). Body
  `{"Subscribe":["Message","ReadReceipt",...],"Immediate":true|false}`. Dispara a conexão
  whatsmeow; se não houver sessão pareada, um QR code é gerado internamente (recuperável via
  `GET /session/qr` ou via evento de webhook `QR`). Se `Immediate` for `false`, a chamada bloqueia
  por até 10s para validar o login antes de responder — o adapter sempre envia `Immediate: true`
  por padrão (configurável via `WuzapiOptions.immediate`) para não bloquear a chamada por padrão.
- **QR code**: `GET /session/qr` (header `token`) só retorna sucesso se a sessão estiver
  `connected` **e** ainda não `loggedIn` — se já estiver logada, responde com um erro
  `"already logged in"`. O valor de `QRCode` já vem com o prefixo completo
  `data:image/png;base64,` embutido. O adapter chama esse endpoint **best-effort** logo após
  `POST /session/connect` (mesmo padrão do adapter Evolution GO): se falhar (sessão ainda não
  `connected`, ou já `loggedIn`), `ConnectResult.qr` fica `undefined` sem lançar.
- **Status**: `GET /session/status` (header `token`). O `data` do envelope inclui, no mínimo
  (confirmado em `handlers.go`, func `GetStatus`): `id`, `name`, `connected` (bool), `loggedIn`
  (bool), `token`, `jid`, `webhook`, `events`, `proxy_url`, `qrcode`, `history`, `proxy_config`,
  `s3_config`, `hmac_configured`.
  > ⚠️ **Divergência confirmada**: o exemplo minimalista do próprio `API.md` mostra apenas
  > `{"Connected":true,"LoggedIn":true}` com chaves **capitalizadas**. As chaves reais no wire são
  > `connected`/`loggedIn` **minúsculas** (confirmado no código-fonte, não só na prosa) — o adapter
  > lê as chaves minúsculas como fonte primária, com fallback defensivo para as capitalizadas do
  > exemplo da doc, caso uma versão futura do servidor volte a usá-las.
- **Logout** (hard): `POST /session/logout` — desconecta **e** invalida a sessão no WhatsApp
  (`whatsmeow Logout()`); a próxima conexão exige novo QR/pairing. É este endpoint que
  `instance.logout()` usa (semântica de "logout" = exige novo pareamento, igual ao WAHA/uazapi).
- **Disconnect** (soft, não usado por este adapter): `POST /session/disconnect` — só fecha o
  websocket preservando as credenciais da sessão (reconectar depois **não** pede novo QR); aceita
  `?clear=true` para também limpar as inscrições de eventos. Distinto de `logout` — fora do escopo
  de `InstanceApi.logout()`.
- **Pairing code**: `POST /session/pairphone`, body `{"Phone":"..."}`, resposta
  `{"LinkingCode":"..."}`. Existe no código e está registrado em `routes.go`, mas **não é
  documentado em nenhum lugar do `API.md` atual** (descoberto só lendo `handlers.go`).
  `instance.pairingCode` **não** é declarada nesta fase: `InstanceApi.connect()` não recebe
  telefone como parâmetro no contrato atual, então expor esse fluxo exigiria mudar o contrato
  central — fora do escopo desta fase (mesma decisão já tomada nos adapters WAHA/uazapi).

### Mapeamento de estado (`GET /session/status` → `InstanceState` canônico)

| `connected` | `loggedIn` | Significado do provider | `InstanceState` canônico |
| --- | --- | --- | --- |
| `false` | `false` | nunca conectada / deslogada | `disconnected` |
| `true` | `false` | websocket ativo, aguardando escanear QR | `qr` |
| `true` | `true` | conectada e autenticada (sessão ativa) | `connected` |
| `false` | `true` | credenciais existem, socket caiu temporariamente | `connecting` *(suposição, mesmo raciocínio já documentado no dossiê do Evolution GO — o provider não expõe um endpoint de "reconnect" dedicado para este adapter usar como confirmação)* |
| qualquer valor não-booleano/ausente | — | formato inesperado | `unknown` (nunca lança) |

## Capabilities implementadas nesta fase (F2)

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `messages.sendReaction`, `groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`, `webhooks.parse`.

`instance.pairingCode` **não** foi declarada (ver justificativa acima).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `POST /session/connect` + `GET /session/qr` (best-effort) | Body `{Subscribe?: string[], Immediate: boolean}`. `Subscribe` vem de `WuzapiOptions.subscribe` (se informado); `Immediate` usa `WuzapiOptions.immediate` (padrão `true`, para não bloquear a chamada por até 10s). O QR retornado é lido de `data.QRCode` (fallback `data.qrcode`, defensivo) da segunda chamada — que pode falhar de forma esperada (sessão ainda não `connected`, ou já `loggedIn`); a falha é engolida, `ConnectResult.qr` fica `undefined`. |
| `instance.status` | `GET /session/status` | Ver tabela acima. |
| `instance.logout` | `POST /session/logout` | Hard logout — exige novo QR/pairing na próxima conexão. `POST /session/disconnect` (soft) não é usado (semântica diferente, fora do escopo de `logout`). |
| `messages.sendText` | `POST /chat/send/text` | Body `{Phone, Body, Id?, LinkPreview?, ContextInfo?}`. `Phone` recebe o chatId canônico sem transformação (ver seção de mapeamento abaixo). `Id`/`LinkPreview` não são expostos por `SendTextInput` — não enviados (servidor usa os próprios defaults: gera um ID, não busca preview). `SendTextInput.mentions` **não tem campo confirmado** em `/chat/send/text` na pesquisa original — segue silenciosamente ignorado (mesmo padrão já adotado no adapter Z-API para o mesmo caso). |
| `messages.sendMedia` | `POST /chat/send/image` \| `/audio` \| `/video` \| `/document` \| `/sticker` | Um endpoint por `MediaKind`, mesma forma de corpo, trocando o nome do campo de mídia (`Image`/`Audio`/`Video`/`Document`/`Sticker`) — `document` exige também `FileName`. Ver seção dedicada abaixo. |
| `messages.sendReaction` | `POST /chat/react` | Body `{Phone, Body, Id}`. Ver seção dedicada abaixo. |

### `ContextInfo` (reply) — suposição documentada

`ContextInfo` exige `StanzaID` **e** `Participant` juntos (confirmado no dossiê de pesquisa).
`SendTextInput`/`SendMediaInput` só carregam `quotedId` (equivalente a `StanzaID`) — não há um
campo de "remetente da mensagem citada" no contrato canônico. **Suposição deste adapter**: quando
`quotedId` é informado, `Participant` recebe o mesmo valor de `Phone` (o destinatário do envio).
Isso é correto para o caso comum de responder, num chat 1:1, a uma mensagem que a própria contraparte
enviou (nesse caso `Participant` == JID da contraparte == `Phone`). Para grupos, onde o remetente
da mensagem citada pode ser um participante diferente do "chat" em si, essa suposição **pode
produzir um `Participant` incorreto** (resposta enviada, mas potencialmente sem o contexto de
citação renderizado corretamente pelo cliente do destinatário) — não validado contra uma instância
real. Mesma limitação, em espírito, à assumida no dossiê do Evolution GO para `quoted.participant`.

### `messages.sendMedia` — corpo e limitações

Body: `{Phone, <Campo>: <data URI ou URL http(s)>, Caption?, Id?, MimeType?, ContextInfo?}`.

- **Só aceita data URI (`data:image/png;base64,...`) OU URL `http(s)`** — base64 cru sem o prefixo
  `data:` é **rejeitado** pelo servidor com erro explícito (`"Image data should start with
  \"data:image/png;base64,\""`). O adapter monta a data URI automaticamente quando
  `media.base64` é informado sem esse prefixo, usando `media.mimeType` (ou um mimetype-padrão por
  `MediaKind`, best-effort) — mesmo padrão já usado no adapter Z-API (`resolveMediaValue`).
  `media.url`, quando presente, é preferido e repassado como está.
- `Caption` é enviado para qualquer `MediaKind` quando `input.caption` está presente — a pesquisa
  original descreve os endpoints irmãos como "mesma forma", sem restringir `Caption` por tipo
  (diferente do Z-API, que documenta explicitamente a ausência de `caption` para áudio/figurinha).
- `FileName` é **obrigatório** quando `kind === 'document'` — o adapter lança
  `WaConnectorError('INVALID_INPUT', ...)` se `media.filename` estiver ausente nesse caso.
- `MimeType` é opcional; quando ausente, o servidor detecta via `http.DetectContentType`.
- Proteção SSRF client-side: o servidor rejeita IPs privados/loopback ao buscar mídia de URLs
  remotas (`main.go`, transport customizado) — não é responsabilidade deste adapter, apenas
  registrado aqui para contexto.

### `messages.sendReaction` — corpo, remoção e limitações

Confirmado em três lugares independentes: `API.md` (`POST /chat/react`), `routes.go` (registro da
rota) e `handlers.go` (func `React`, que monta um `waE2E.Message{ReactionMessage:{...}}` e chama
`SendMessage` do whatsmeow — é envio real, não só parsing de webhook).

Body: `{Phone, Body, Id, Participant?}`. `Phone` = destinatário (mesmo mapeamento de
`sendText`/`sendMedia`, sem transformação). `Body` = emoji da reação (**obrigatório** — o servidor
rejeita string vazia com 400 `"missing Body in Payload"`). `Id` = id da mensagem-alvo.

- **Remover uma reação**: a convenção canônica do waconector usa `emoji === ''` (ver
  `SendReactionInput`/ADR-0008), mas o Wuzapi **não** aceita `Body` vazio para isso — em vez disso,
  usa o literal especial `Body: "remove"` (`handlers.go`: `if reaction == "remove" { reaction = ""
  }`, que então monta o `ReactionMessage` com texto vazio internamente — a convenção real do
  protocolo WhatsApp/whatsmeow para desfazer uma reação). Este adapter traduz `emoji === ''` para
  `Body: "remove"` na fronteira, para que o consumidor do waconector não precise conhecer esse
  detalhe do provider.
- **Reagir à própria mensagem enviada**: o Wuzapi espera o prefixo `"me:"` em `Id` nesse caso
  (`ID[, Participant]` — o prefixo é removido antes de usar, e ativa `FromMe: true` na chave da
  mensagem). `SendReactionInput` não carrega essa distinção (não há campo "esta mensagem é minha?")
  — **não implementado**: `Id` é sempre enviado sem prefixo. Reagir à própria mensagem pode
  portanto não funcionar corretamente via este adapter; reagir a mensagens recebidas (o caso comum)
  funciona.
- `Participant` só é usado pelo servidor quando `FromMe` é falso (reação num grupo, a uma mensagem
  de um participante diferente do "chat"). `SendReactionInput` não tem um campo equivalente ao
  "remetente da mensagem-alvo" — **não enviado**, mesma limitação, em espírito, já documentada para
  `ContextInfo.Participant` em `sendText`/`sendMedia`.
- Resposta em sucesso (dentro de `data`): `{"Details":"Sent","Timestamp":<unix seconds>,"Id":"<id
  da mensagem reagida>"}` — **atenção**: aqui `Id` é o id da mensagem-ALVO (a que recebeu a
  reação), não um novo id de "mensagem de reação" (confirmado em prosa no próprio `API.md`).
  Mapeado com a mesma `mapSentMessage` de `sendText`/`sendMedia` — `SentMessage.id` reflete esse
  eco do `Id` requisitado, não um novo identificador.

### Formato de resposta de envio

Confirmado no dossiê: resposta de `POST /chat/send/text` (dentro de `data`):
`{"Details":"Sent","Timestamp":<unix seconds>,"Id":"<msgid>"}`. Mapeado para `SentMessage`:
`id` = `data.Id` (fallback `wuzapi-<Date.now()>`), `chatId` = `Phone` requisitado (a resposta não
ecoa o destinatário), `timestamp` = `data.Timestamp * 1000` (o dossiê confirma que o valor vem em
**segundos**, não milissegundos — diferente da maioria dos outros exemplos deste pacote). O mesmo
shape é assumido para `POST /chat/send/*` (mídia), por analogia — não confirmado individualmente
por tipo de mídia na pesquisa original.

### Mapeamento de `chatId` canônico → Wuzapi

O conector já normaliza o `to` recebido do usuário (`normalizeChatId`) antes de chamar o adapter:
telefone vira só-dígitos (E.164 sem `+`), JIDs explícitos passam intactos. O campo `Phone` do
Wuzapi é documentado como polimórfico (`wmiau.go`, func `parseJID`): se a string não contém `@`,
vira `user@s.whatsapp.net`; se contém `@`, é parseada como JID literal (inclui grupos `@g.us`) —
exatamente os dois formatos que o chatId canônico já produz. O adapter repassa sem transformação
(`toWuzapiPhone`, função identidade — existe só como ponto único de mudança, mesmo padrão dos
demais adapters deste pacote).

## Grupos (núcleo)

10 operações implementadas (ADR-0009): `groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST /group/create` | Body `{name, participants}` — **atenção**: tags JSON minúsculas, diferente da maioria dos outros endpoints deste provider (PascalCase sem tag); confirmado no código-fonte, não é engano. `participants` recebe `input.participants` (já normalizado pelo conector) passado por `toWuzapiPhone` (identidade). Resposta (`data`): `{JID, Name, OwnerJID, GroupCreated, Participants: [{IsAdmin, IsSuperAdmin, JID}]}`. |
| `groups.getInfo` | `GET /group/info` | `groupJID` vai na **query string** (`?groupJID=...`), **não** no corpo. Resposta (`data`) = `types.GroupInfo`: `{JID, OwnerJID, Name, Topic (=descrição), IsLocked, GroupCreated, Participants: [{JID, IsAdmin, IsSuperAdmin}]}`. |
| `groups.list` | `GET /group/list` | Sem parâmetros. Resposta (`data`): `{Groups: [<mesmo shape de getGroupInfo>, ...]}`. |
| `groups.addParticipants` / `removeParticipants` / `promoteParticipants` / `demoteParticipants` | `POST /group/updateparticipants` (tudo minúsculo) | **As 4 operações são o mesmo endpoint**, variando só `Action` (`"add"`\|`"remove"`\|`"promote"`\|`"demote"`). Body `{GroupJID, Phone: string[], Action}` — **atenção**: o campo se chama `Phone`, não `Participants`. Resposta: `{Details: "Group Participants updated successfully"}`, sem detalhe por participante (por isso o contrato retorna `Promise<void>` para as 4). |
| `groups.updateSubject` | `POST /group/name` | Body `{GroupJID, Name}`. `Name` recebe `input.subject` (já validado não-vazio pelo conector). Resposta: `{Details: "Group Name set successfully"}` — `Promise<void>`. |
| `groups.updateDescription` | `POST /group/topic` | Body `{GroupJID, Topic}`. `Topic` **vazio é permitido** — limpa a descrição do grupo (internamente o provider passa `previousID`/`newID` vazios ao whatsmeow); não é tratado como erro. Resposta: `{Details: "Group Topic set successfully"}` — `Promise<void>`. |
| `groups.updatePicture` | `POST /group/photo` | Body `{GroupJID, Image}`. Ver subseção dedicada abaixo — **só aceita JPEG de fato**. Resposta: `{Details: "Group Photo set successfully", PictureID}` — `PictureID` é ignorado, `Promise<void>`. |

### `groups.updatePicture` — só aceita JPEG de fato (requisito rígido confirmado no código-fonte)

O handler de `POST /group/photo` confere tanto o prefixo `"data:image/"` quanto os **magic bytes
reais** (`0xFF 0xD8 0xFF`, assinatura JPEG) e rejeita com 400 qualquer outro formato — inclusive se
o prefixo textual disser `data:image/png` ou `data:image/webp`. Uma mensagem de erro do servidor
(não relacionada a este check específico) sugere que png/gif/webp também seriam aceitos — **isso é
enganoso**; confirmado lendo o código-fonte, não a prosa da mensagem de erro.

Conversão de `MediaRef` feita pelo adapter (`toWuzapiGroupPhoto`):

- **`media.base64` presente**: monta a data URI **forçando** `image/jpeg`
  (`data:image/jpeg;base64,<...>`), **ignorando** `media.mimeType` caso informado — o adapter
  assume/força que o payload já está codificado como JPEG, já que é a única coisa que o servidor
  aceita de fato. Se `media.base64` já chegar como uma data URI completa (com qualquer mimetype no
  prefixo, ex. `data:image/png;base64,...`), o adapter extrai só a porção após a vírgula antes de
  remontar com o prefixo forçado — evita produzir uma string com dois cabeçalhos concatenados.
  **Responsabilidade do chamador**: garantir que os bytes reais sejam JPEG; este pacote não
  reencoda imagens client-side (ADR-0004, zero dependências de runtime).
- **Só `media.url` presente (sem `media.base64`)**: repassada como está, sem nenhuma conversão —
  não há como baixar/reencodar a imagem localmente. **Assunção não validada contra instância
  real**: a pesquisa original confirma que `POST /group/photo` aceita uma data URI JPEG, mas **não
  há confirmação de que este endpoint específico aceite uma URL `http(s)` crua** (diferente de
  `messages.sendMedia`, cujo suporte a URL é confirmado). Se o servidor rejeitar URLs cruas neste
  endpoint, o consumidor precisa fornecer `media.base64` em vez de `media.url` para
  `groups.updatePicture`.

### ⚠️ Divergência confirmada: doc vs. código em `GET /group/info`

O `API.md` oficial mostra um exemplo de `curl` enganoso para este endpoint, com
`--data '{"GroupJID":"..."}'` sugerindo um body JSON. O handler do servidor **só lê a query
string** (`?groupJID=...`) e ignora qualquer corpo enviado — confirmado lendo o código-fonte, não
apenas a prosa da doc. Este adapter envia `groupJID` exclusivamente via `query`, sem body.

### `groupId` — identificador opaco (ver ADR-0009)

Diferente da Z-API (que usa um ID sintético sem `@`), o Wuzapi usa **JID padrão**
(`<dígitos>@g.us` para grupos, `<dígitos>@s.whatsapp.net` para indivíduos) tanto para grupos quanto
para participantes — o mesmo formato aceito por `parseJID` em qualquer campo de destinatário. Ainda
assim, `groupId` **não** passa por `normalizeChatId`/`toWuzapiPhone` no caminho de
`getInfo`/`addParticipants`/etc.: é repassado tal como chega ao adapter (o conector já trata
`groupId` como opaco para todo provider, uniformemente — ver `WaConnector.requireGroupId`), o que
funciona sem problema aqui porque o valor típico (obtido de um `GroupInfo.id` anterior) já vem no
formato `@g.us` esperado pelo servidor.

### Participantes individuais em `groups.*`

Diferente de `groupId`, os itens de `participants`/`Phone` **são** tratados como um `to` de
mensagem comum: o conector já os normaliza (telefone -> só-dígitos, JID passa intacto) antes de
chamar o adapter, e este reaproveita `toWuzapiPhone` (identidade) — mesmo helper usado por
`sendText`/`sendMedia`/`sendReaction`.

### Fallback quando a resposta não ecoa todos os campos (`groups.create`)

`POST /group/create` normalmente ecoa `Name`/`Participants` na resposta, mas quando não ecoa
(variação de versão do servidor), o adapter cai de volta em `input.subject`/nos participantes
requisitados (com `isAdmin`/`isSuperAdmin` assumidos como `false`) — mesmo padrão de fallback já
usado em `mapSentMessage` (`chatId ?? requestedNumber`).

## Webhooks

Configuração por usuário: `POST /webhook` (header `token`), body
`{"webhookurl":"https://...","events":["Message","ReadReceipt",...]}`.

> ⚠️ **Divergência confirmada**: a tag JSON real no struct Go é `webhookurl` (tudo minúsculo, uma
> palavra só) — os próprios exemplos do `API.md` usam `webhookURL`; funciona mesmo assim porque o
> `encoding/json` do Go faz match case-insensitive de fallback quando a tag exata não bate. Não
> afeta o parsing deste adapter (que só recebe webhooks, não os envia/configura), citado aqui só
> para quem for consumir o pacote e configurar o `POST /webhook` manualmente.

`GET /webhook` retorna `{"webhook":"...","subscribe":[...]}`. `DELETE /webhook` limpa
webhook+events. Existe ainda `PUT /webhook` (handler `UpdateWebhook`, não mencionado na seção
principal do `API.md`) com body diferente: `{"webhook":"...","events":[...],"active":bool}` — se
`active=false`, zera webhook e events.

### Formato de entrega (`WEBHOOK_FORMAT`, env var global do servidor — não por usuário)

- **`form`** (default): `POST application/x-www-form-urlencoded` com exatamente os campos
  `jsonData` (string contendo o JSON do evento), `userID`, `instanceName`.
- **`json`**: `POST application/json` cujo body é o objeto do evento com `userID` e
  `instanceName` **mesclados no topo**.

Como o formato é uma configuração global do servidor (não controlável por chamada), este adapter
**aceita ambos defensivamente**: se o body tiver um campo `jsonData` (string), ele é parseado como
JSON para obter o evento real; caso contrário, o body inteiro já é tratado como o objeto do evento
(modo `json`). `userID`/`instanceName` são lidos do nível que estiver disponível em cada modo.

> ⚠️ **Divergência confirmada**: o próprio `API.md` (seção "Webhook format configuration") afirma
> que ambos os formatos incluem um campo `token` com o token do usuário no payload entregue — isso
> é **falso** no código-fonte atual (`helpers.go` func `callHookWithHmac` / `wmiau.go` func
> `sendToUserWebHookWithHmac` constroem o payload só com `jsonData`/`userID`/`instanceName`, ou o
> merge de `userID`+`instanceName` no modo `json`; `token` nunca é adicionado ao payload). O parser
> deste adapter não depende de um campo `token` no payload de webhook — só usa `userID`/
> `instanceName` para popular `instanceId`, então essa divergência não afeta o adapter.

Quando HMAC está configurado (`hmac_key` do usuário), o header `x-hmac-signature` (SHA-256) é
enviado, assinando o body JSON cru (modo `json`) ou a string form-urlencoded (modo `form`). **Não
implementado neste adapter** — `WebhookInput.rawBody` está disponível no contrato para isso, mas
verificar a assinatura fica a cargo do consumidor (mesma decisão já tomada nos adapters uazapi/
Z-API, que também não implementam verificação de HMAC/assinatura).

### ⚠️ Payloads RECONSTRUÍDOS — não são exemplos literais da documentação

Nenhum dos três payloads abaixo foi copiado literalmente de uma captura real ou de um exemplo
publicado no `API.md`. O wrapper externo `{"type": "...", "event": {...}}` **é** confirmado no
código-fonte (`wmiau.go`, ~L841-1157, switch sobre eventos do whatsmeow) — o que é reconstruído é o
**conteúdo interno** de `event` para `Info`/`Message` (serialização do struct
`whatsmeow/types/events.Message`, cujo código-fonte da própria lib `whatsmeow` **não** foi
consultado na pesquisa original). Tratar como plausível, não como fato confirmado, até validação
empírica contra uma instância real.

- **`fixtures/webhook-message-received.json`** — `type: "Message"`, `event: {Info: {...}, Message:
  {...}}`. `event.Info` (`ID`, `Chat`, `Sender`, `IsFromMe`, `IsGroup`, `PushName`, `Timestamp`) e o
  conteúdo de `event.Message` (`conversation`, `extendedTextMessage`, `imageMessage`, ...) foram
  montados **por analogia direta com o adapter Evolution GO** (`mapMessageContent` em
  `src/adapters/evolution/index.ts`), já que ambos os providers envolvem eventos da mesma lib
  `whatsmeow` — mas essa analogia em si não foi validada contra uma instância Wuzapi real. Quando o
  usuário tem `media_delivery` configurado (campo por usuário: `base64` default | `s3` | `both`), o
  payload de mídia ganha `mimeType`/`base64`/`fileName` no **nível raiz** do evento (fora de
  `event`) — não dentro de `event.Message`; o adapter usa esses campos de raiz para completar
  `WaMessage.media.base64` quando presentes. `event.Info.Timestamp` é assumido como string
  ISO/RFC3339 (serialização default de `time.Time` em Go) — o adapter aceita também epoch numérico
  como fallback defensivo (mesma função `toEpochMs` usada no Evolution GO).
- **`fixtures/webhook-ack.json`** — `type: "ReadReceipt"`, `state` ∈ `Delivered`/`Read`/`ReadSelf`
  (estes três valores **são** confirmados no código-fonte, ~L1138-1157 de `wmiau.go` — outros tipos
  de `Receipt` são descartados e não geram webhook). `event.MessageIDs`/`event.Chat` seguem o
  mesmo shape do adapter Evolution GO para o evento equivalente. Mapeamento: `Delivered→delivered`,
  `Read`/`ReadSelf→read`; qualquer outro valor cai em `sent` (fallback neutro, nunca lança).
- **`fixtures/webhook-connection-update.json`** — `type: "Connected"`, `event: {}` (assumido como
  struct marcador vazio, padrão comum para `events.Connected` na lib whatsmeow — **não
  confirmado**). Outros valores de `type` confirmados no código (`wmiau.go`, mesmo switch): `
  Disconnected`, `LoggedOut`, `ConnectFailure` (carrega `error`/`attempts`/`reason` no `event`),
  `PairSuccess`, `QR`, `QRTimeout`. Mapeamento aplicado: `Connected→connected`,
  `Disconnected`/`LoggedOut`/`ConnectFailure→disconnected`, `PairSuccess→connected`, `QR→qr`,
  `QRTimeout→disconnected` *(suposição — o código confirma que o valor existe, mas não detalha a
  semântica exata; tratado como "parou de esperar o scan", análogo a uma desconexão do fluxo de
  pareamento)*. Qualquer outro `type` não reconhecido vira evento canônico `unknown`, nunca lança.
  > ⚠️ **`QR` tem shape diferente de todos os outros tipos**: confirmado em `wmiau.go`, func
  > `startClient` (loop `for evt := range qrChan` quando `evt.Event == "code"`), o servidor monta
  > `postmap["event"] = evt.Event` — uma **string literal `"code"`**, não um objeto — e
  > `postmap["qrCodeBase64"] = base64qrcode` como campo **irmão** de `type`/`event`, no **nível
  > raiz** do payload (mesmo `postmap` serializado por `sendEventWithWebHook`, sem
  > reestruturação). Ou seja, o payload de wire real é `{"type":"QR","event":"code",
  > "qrCodeBase64":"data:image/png;base64,...", ...}`. O adapter lê `qr` a partir do **nível raiz**
  > do evento (`eventRecord.qrCodeBase64`), não de dentro de `event` — mesmo padrão já usado por
  > `attachRootMedia` para mídia recebida (`base64`/`mimeType`/`fileName` também no nível raiz,
  > confirmado em `media.go`, func `processMedia`). Ver `fixtures/webhook-qr.json`.

## Limites e particularidades

- Não há rate limiting embutido no servidor (busca por `RateLimit`/`Limiter` no código-fonte
  inteiro não encontrou nada) — os únicos limites vêm do próprio WhatsApp/whatsmeow.
- Toda resposta HTTP (sucesso ou erro) é envelopada:
  `{"code":<status>,"success":bool,"data":{...}}` em sucesso ou
  `{"code":<status>,"success":false,"error":"<msg>"}` em erro (`handlers.go`, func `Respond`) — o
  adapter sempre desembrulha `data` antes de mapear para os tipos canônicos.
- Destinatário em `/chat/send/*` aceita diretamente JIDs de grupo (`...@g.us`), não só contatos
  individuais.
- Subscrição de eventos é por usuário, persistida como string separada por vírgula na coluna
  `events` (ex. `"Message,ReadReceipt"`); o valor especial `"All"` subscreve a todos os ~45 tipos
  suportados (`constants.go`), incluindo eventos de grupo, chamada, presença, newsletter/canais,
  ponte Facebook/Meta etc. — nenhum desses tipos adicionais é mapeado por este adapter nesta fase
  (cai em `unknown`, nunca lança).
- Integrações adicionais fora do escopo webhook simples: RabbitMQ global
  (`RABBITMQ_URL`/`RABBITMQ_QUEUE`) publica todos os eventos independente de subscrição, e um
  webhook global (`WUZAPI_GLOBAL_WEBHOOK`) roda em paralelo ao webhook por usuário — nenhum dos
  dois é usado/necessário por este adapter.
- Quando S3 está habilitado (`media_delivery: 's3'|'both'`), o payload de webhook ganha uma chave
  `s3` com `url`/`key`/`bucket`/`size`/`mimeType`/`fileName` (documentado com exemplo real no
  próprio `API.md`) — não consumido por este adapter nesta fase (`WaMessage.media` só usa
  `base64`/campos do protobuf quando presentes).
- `GET /session/qr` só retorna sucesso se a sessão estiver `connected` **e** ainda não `loggedIn` —
  ver seção "Modelo de instância/sessão" acima.
- O código-fonte da lib `tulir/whatsmeow` em si não foi consultado na pesquisa original — os
  shapes de `event.Info`/`event.Message` (mensagem) e do conteúdo por tipo de mídia são inferidos
  por analogia com o Evolution GO (mesma lib subjacente), não confirmados campo-a-campo para o
  Wuzapi especificamente. Ver aviso no topo do dossiê e na seção de webhooks.
- Não foi possível confirmar se `POST /admin/users` permite omitir o campo `token` para
  autogeração — o código lido exige o token no body e só checa unicidade; sem garantia de que não
  exista um branch alternativo em versão mais recente (fora do escopo deste adapter de qualquer
  forma, já que `/admin/users` não é usado por nenhuma capability implementada).
- O comportamento exato do campo `expiration` (aceito na criação do usuário) não foi confirmado
  além do que o próprio README afirma ("not enforced by the system") — fora do escopo deste
  adapter.
