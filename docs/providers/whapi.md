# Dossiê: Whapi.Cloud

- Docs oficiais: <https://whapi.readme.io/> (renderizada a partir do OpenAPI oficial,
  `https://github.com/Whapi-Cloud/whatsapp-api-docs/blob/main/openapi.yaml`, `info.version: 1.8.7`)
- Versão testada: OpenAPI spec (13.141 linhas) e Help Desk (`support.whapi.cloud`) consultados em
  2026-07-11. `groups.*`/`contacts.*`/`messages.sendReaction` (auditoria de gaps, 23+1
  capabilities) revalidados no MESMO arquivo `openapi.yaml` (`info.version: 1.8.7`, ainda 13.141
  linhas) em 2026-07-11 — sem deriva de spec detectada entre as duas consultas.
  `messages.edit`/`messages.delete` e as 8 operações de `chats.*` (ADR-0012) revalidados no MESMO
  arquivo (`info.version: 1.8.7`, 13.141 linhas, byte-a-byte idêntico) em 2026-07-12 — de novo, sem
  deriva de spec.
- Hospedagem: SaaS — host único `https://gate.whapi.cloud` para todos os clientes. Existe uma API
  **separada** (`manager.whapi.cloud`, "Partner API") para criar/gerenciar canais programaticamente
  — fora do escopo deste adapter, ver "Limites e particularidades".

> **Escopo**: 39/40 capabilities do core — todas exceto `instance.pairingCode` (obstáculo
> estrutural do contrato, não do provider — ver "Capabilities confirmadas mas não implementadas").
> `messages.sendReaction`, as 14 operações de `groups.*` e as 8 de `contacts.*` foram implementadas
> numa rodada posterior às capabilities núcleo (`instance.*`/`messages.sendText`/`sendMedia`/
> `webhooks.parse`) — ver "Grupos" e "Contatos" abaixo. `messages.edit`/`messages.delete` e as 8
> operações de `chats.*` (ADR-0012) foram implementadas numa terceira rodada — ver "Edição e
> exclusão de mensagem" e "Conversas (`chats.*`)" abaixo.

## Autenticação

Confirmado literalmente no OpenAPI oficial (`openapi.yaml:15-20` e `:13133-13141`):

```yaml
servers:
  - url: https://gate.whapi.cloud
security:
  - bearerAuth: []
  - tokenAuth: []
securitySchemes:
  bearerAuth:
    scheme: bearer
    type: http
  tokenAuth:
    in: query
    name: token
    type: apiKey
```

- Header **`Authorization: Bearer <token>`** (usado por este adapter) OU, alternativamente, o
  mesmo token como **query param `?token=...`** (útil só para abrir o QR direto num `<img src>`,
  já que não dá para setar header num `<img>` — não usado por este adapter).
- **Não existe token de conta separado do token de canal na API principal.** O token é **por
  canal** ("channel") — cada canal tem seu próprio Bearer token, obtido no dashboard do canal.
  Estruturalmente idêntico ao padrão Z-API (`instanceId`+`token`), só que aqui é um único Bearer
  token (sem segundo identificador no path).
- Existe um token de conta/parceiro **diferente**, usado só pela Partner API
  (`manager.whapi.cloud`, para criar/listar/gerenciar canais) — não documentado no `openapi.yaml`
  do gate, fora do escopo deste adapter (ver "Limites e particularidades").
- A doc chama a unidade de conexão consistentemente de **"channel"**, mas usa "instance" como
  sinônimo casual em pelo menos um lugar (descrição de `GET /health`: *"the whapi channel
  (instance)"*).

`WhapiOptions.token` é enviado em `secrets` do `HttpClient` para redação em mensagens de erro.

## Modelo de instância/sessão

Termo do provider: **"channel"**. Não há endpoint de criação de canal em `gate.whapi.cloud` (o
host autenticado pelo token de canal — a "galinha não pode criar o próprio ovo"): canais são
criados manualmente no dashboard ou via Partner API (`PUT manager.whapi.cloud/channels`, token de
parceiro, fora do escopo deste adapter). `WhapiOptions` assume um canal já provisionado e um token
já em mãos — mesma assunção já feita pelos adapters Z-API/Wuzapi/uazapi para o equivalente.

- **Conectar/parear**: `GET /users/login` (query opcional `wakeup`, default `true` — "If set to
  false, the channel will not launch"). Resposta (schema `QR`):
  ```jsonc
  {
    "status": "OK" | "TIMEOUT" | "WAITING" | "ERROR",
    "type": "qr" | "code" | "webauthn",
    "base64": "...",   // QR pronto para uso — formato exato (com/sem prefixo data URI) NÃO confirmado
    "rowdata": "...",
    "request_id": "...",
    "expire": 1234567890
  }
  ```
  409 se o canal já está autenticado; 422 se "Render QR failed". Existem variantes
  `GET /users/login/image` (PNG binário) e `GET /users/login/rowdata` (só o dado bruto) — não
  usadas por este adapter (`ConnectResult.qr` é sempre string).
  **Pairing code** (`GET /users/login/{PhoneNumber}`) **não é exposto**:
  `InstanceApi.connect()` não recebe telefone como parâmetro no contrato atual — mesmo obstáculo
  estrutural já documentado nos adapters Z-API/uazapi/Wuzapi (`instance.pairingCode` não
  declarada).
- **Status**: `GET /health` (query opcional `wakeup`, default `true` — **atenção**: este default
  também relança o canal se estiver parado, não é só leitura). Resposta (schema `Health`):
  ```jsonc
  {
    "channel_id": "SUPERMAN-f75",
    "status": { "code": 200, "text": "AUTH" },
    "user": { /* presente quando status=AUTH */ }
    // + start_at, uptime, version, core_version, api_version, device_id, ip
  }
  ```
  Este adapter usa `wakeup: false` em `instance.status()` para não ter o efeito colateral de
  relançar o canal numa chamada que deveria ser só leitura — decisão de implementação, não
  recomendação explícita da doc.

  > ⚠️ **Falso amigo confirmado no OpenAPI**: existe um path `PUT /status`, mas é **"Change status
  > text"** (atualiza o texto de "recado"/About da conta, `deprecated: true`) — **não** é o status
  > de conexão do canal. Este adapter usa `GET /health`, não `PUT /status`.
- **Logout**: `POST /users/logout`, sem corpo. 409 se "Channel already logged out" — não tratado
  como caso especial (vira `PROVIDER_ERROR` como qualquer outro erro HTTP, mesmo padrão dos demais
  adapters deste pacote).
- **Múltiplos canais por conta**: sim, cada canal tem token independente — gerenciamento da lista
  de canais (criar/listar/deletar/mudar trial→live) é feito pela Partner API separada
  (`manager.whapi.cloud`), fora do escopo do contrato `WaAdapter` (não há capability para "gerenciar
  múltiplos canais" no core atual).

### Mapeamento de estado (`Health.status.text` → `InstanceState` canônico)

Reaproveitado tanto por `instance.status()` (`GET /health`) quanto pelo webhook `channel`
(`health.status.text`, mesmo schema `Health`) — uma única função de mapeamento
(`mapChannelState`) no adapter.

| `status.text` (`ChannelStatus`) | Descrição oficial (`x-enum-descriptions`) | `InstanceState` canônico |
| --- | --- | --- |
| `NOT_INIT` | Not initialized | `disconnected` |
| `INIT` | Initialized | `connecting` |
| `LAUNCH` | Launched | `connecting` |
| `QR` | Scan QR code | `qr` |
| `AUTH` | Authorize — Help Desk confirma: "fully connected and operational" | `connected` |
| `ERROR` | Error | `unknown` *(decisão de implementação — não há estado canônico de erro dedicado)* |
| `SYNC_ERROR` | Synchronization error | `unknown` |
| qualquer outro/ausente | — | `unknown` (nunca lança) |

## Capabilities implementadas

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `messages.sendReaction`, `messages.edit`, `messages.delete`,
`messages.forward`, `messages.star`, `messages.unstar`, `messages.pin`, `messages.unpin`,
`messages.markRead` (ADR-0013), as 14 operações de `groups.*` (`create`, `getInfo`, `list`,
`addParticipants`, `removeParticipants`, `promoteParticipants`, `demoteParticipants`,
`updateSubject`, `updateDescription`, `updatePicture`, `getInviteLink`, `revokeInviteLink`,
`joinViaInviteLink`, `leaveGroup`), as 8 de `contacts.*` (`list`, `get`, `checkExists`,
`getProfilePicture`, `getAbout`, `block`, `unblock`, `listBlocked`), as 8 de `chats.*` (`archive`,
`unarchive`, `mute`, `unmute`, `pin`, `unpin`, `markRead`, `markUnread`) e `webhooks.parse`.

Só `instance.pairingCode` **não** foi declarada — ver "Capabilities confirmadas mas não
implementadas" ao final (obstáculo estrutural do contrato `InstanceApi.connect()`, não do
provider).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `GET /users/login?wakeup=true` | `ConnectResult.qr` = `body.base64` (formato exato — com/sem prefixo `data:` — não confirmado literalmente). |
| `instance.status` | `GET /health?wakeup=false` | Ver tabela de mapeamento acima. `wakeup=false` para evitar o efeito colateral de relançar o canal. |
| `instance.logout` | `POST /users/logout` | Sem corpo. 409 ("já desconectado") não tratado como caso especial. |
| `messages.sendText` | `POST /messages/text` | Body `{to, body, quoted?, mentions?}`. `to` aceita dígitos crus OU JID completo (schema `Sender.to`, pattern `^[\d-]{9,31}(@[\w\.]{1,})?$`) — chatId canônico do waconector já bate 1:1, sem transformação. `quoted` = `input.quotedId` (citar mensagem). `mentions` = `input.mentions` (array de números). |
| `messages.sendMedia` | `POST /messages/{image\|video\|audio\|document\|sticker}` | Um endpoint por `MediaKind` — ver seção dedicada abaixo. |

### Formato do destinatário (`to`)

Confirmado com dois schemas distintos no mesmo spec: `Sender.to` (usado em `/messages/*`) tem
pattern `^[\d-]{9,31}(@[\w\.]{1,})?$` — dígitos/traço com sufixo `@domínio` **opcional**; exemplos
literais do próprio spec usam telefone cru (`"to": "61371989950"`). `ChatID` (schema usado em
`/chats/{ChatID}` etc., **não** usado por `messages.*`) exige o sufixo. Ou seja: para envio, tanto
`normalizeChatId` (dígitos puros) quanto JID explícito (`...@s.whatsapp.net`, `...@g.us`,
`...@newsletter`) funcionam sem tratamento adicional — `toWhapiChatId` no adapter é uma função
identidade, mantida só como ponto único de mudança (mesmo padrão do `toWuzapiPhone` do Wuzapi).

### `messages.sendMedia` — endpoints e corpo

Um endpoint por tipo (`POST /messages/{tipo}`), todos aceitando o mesmo shape de corpo
`{to, media, caption?, filename?(documento), quoted?}`:

| `MediaKind` | Endpoint | `caption`? |
| --- | --- | --- |
| `image` | `/messages/image` | sim |
| `video` | `/messages/video` | sim |
| `audio` | `/messages/audio` | não (WhatsApp não permite legenda em áudio) |
| `document` | `/messages/document` | sim (+ `filename`) |
| `sticker` | `/messages/sticker` | não |

O Whapi distingue `audio` (arquivo) de `voice` (nota de voz gravada, endpoint `/messages/voice`) —
`MediaKind` do waconector não tem essa distinção; este adapter sempre usa `/messages/audio` para
`kind: 'audio'`.

**Upload de mídia** (`SendMedia.media`, `oneOf`): URL (`media.url`, repassado como está), base64
(`media.base64` — o Help Desk recomenda como data URI completa `data:mime;base64,...`; o schema
OpenAPI só diz "base64 encoded file", sem exigir o prefixo — confidence média) ou media ID
pré-upload via `POST /media` (não usado por este adapter). Mesmo padrão defensivo já usado nos
adapters Z-API/Wuzapi: se `media.base64` não vier como data URI, o adapter monta uma usando
`media.mimeType` ou um mimetype-padrão por `MediaKind` (`image/png`, `video/mp4`,
`audio/ogg; codecs=opus`, `application/octet-stream`, `image/webp`).

### Formato de resposta de envio

Resposta confirmada **por schema** (`SentMessage`/`Message` do OpenAPI), **sem payload de resposta
literal capturado** na pesquisa: `{ sent: boolean, message: { id, chat_id, timestamp, ... } }`.
Mapeado para `SentMessage`: `id` = `message.id` (fallback `whapi-<Date.now()>`), `chatId` =
`message.chat_id` (fallback no `to` requisitado), `timestamp` = `message.timestamp * 1000`
(assumido em segundos, mesma unidade confirmada por payload literal em `messages` de webhook —
**não confirmado individualmente para a resposta de envio**).

### `messages.sendReaction`

| Operação | Endpoint | Observações |
| --- | --- | --- |
| reagir (`emoji` não vazio) | `PUT /messages/{MessageID}/reaction` | Corpo `ReactToMessage {emoji}` (operationId `reactToMessage`). |
| remover (`emoji === ''`) | `DELETE /messages/{MessageID}/reaction` | Sem corpo (operationId `removeReactFromMessage`). |

Os dois endpoints e o schema do corpo estão confirmados no OpenAPI oficial. `ReactToMessage.emoji`
também aceita string vazia como sentinela alternativo de remoção ("Leave blank to remove the
reaction"), mas este adapter usa o endpoint DEDICADO de remoção quando `input.emoji === ''` (mesma
convenção canônica de `SendReactionInput.emoji`) em vez do `PUT` em branco — mais explícito, e
igualmente confirmado no spec.

Resposta de **ambos** os endpoints: `responses/Success` (`ResponseSuccess {success: boolean}`) —
sem o objeto `message` que `messages.sendText`/`sendMedia` devolvem. `SentMessage.id`/`chatId`
ecoam `input.messageId`/`to` (mesmo padrão do adapter WPPConnect para esse caso de "resposta fixa,
sem id próprio"); `timestamp` fica `undefined`.

Round-trip de recebimento (webhook `type: "action"`, `action.type: "reaction"`) continua **não**
implementado — cai em `kind: 'unknown'`, ver seção de webhooks.

## Edição e exclusão de mensagem (ADR-0012)

| Capability | Endpoint | Confiança | Observações |
| --- | --- | --- | --- |
| `messages.edit` | `POST /messages/text` (o MESMO endpoint de `messages.sendText`) | **Alta** | Ver nota dedicada abaixo — não é um endpoint próprio, é um campo do schema base `Sender`. |
| `messages.delete` | `DELETE /messages/{MessageID}` (`operationId: deleteMessage`, `openapi.yaml:2419-2453`) | **Média** | Sem corpo/query, só o `messageId` no path. Ver nota de ambiguidade local/revogação abaixo. |

### `messages.edit` — reaproveita `POST /messages/text`, não um endpoint dedicado

Achado **fora da pesquisa de gaps original** (que cobriu a seção "ações sobre mensagem já enviada/
recebida" do spec — `delete`/`forward`/`markAsRead`/`star`/`pin`/`get`/`list`/`comment` — mas não
revisitou o schema de ENVIO de texto): o schema `Sender` (`openapi.yaml:12565-12587`, base
compartilhada por TODO endpoint de envio de mensagem) tem um campo `edit`:

```yaml
edit:
  type: string
  description: Message ID of the message to be edited
  pattern: ^[A-Za-z0-9._]{4,30}-[A-Za-z0-9._]{4,30}(-[A-Za-z0-9._]{2,30})?(-[A-Za-z0-9._]{2,30})?$
```

`SenderText` (`openapi.yaml:8494-8516`, corpo de `POST /messages/text` — `operationId:
sendMessageText`, `openapi.yaml:609-676`) é `allOf: [Sender, MessagePropsText, ...]`, herdando esse
campo. Ou seja: para editar uma mensagem de texto já enviada, este adapter reenvia
`POST /messages/text` com `{to, body: <novo texto>, edit: <messageId>}` — o MESMO endpoint de
`sendText`, só com o campo `edit` preenchido. Confiança **alta**: é um campo real, tipado e com
descrição inequívoca ("Message ID of the message to be edited"), no mesmo endpoint já usado por
este adapter — não uma inferência de nome de rota ou de convenção de terceiros. Resposta reaproveita
o mesmo mapeamento de `sendText` (`mapSentMessage`), já que é o mesmo endpoint/schema de resposta.

Como o campo `edit` está no schema BASE `Sender` (não só em `SenderText`), em tese os demais
endpoints de envio (`/messages/image`, `/messages/video`, etc.) também aceitariam editar a legenda
de uma mídia já enviada — **não implementado nesta fase**: `EditMessageInput` do contrato canônico
só modela texto (ver ADR-0012), então este adapter só usa `/messages/text`.

### `messages.delete` — ambiguidade local vs. revogação

`DELETE /messages/{MessageID}` descreve literalmente: *"Method used to delete a text sent in a
chat. You will be able to delete a message that you sent as well as a message that was sent by a
contact. To use this resource you will only need the messageId of the message that you want to
delete."* (`openapi.yaml:2450-2453`).

No protocolo WhatsApp real, apagar a mensagem de **outra pessoa** "para todos" não é possível — só
localmente (soft-delete no próprio dispositivo). O fato de a doc afirmar explicitamente que dá para
apagar "a message that was sent by a contact" é indício de que este endpoint pode ser **"delete for
me" (local)**, não "revoke for everyone" — mas **não há campo explícito**
(`for_everyone`/`revoke`/`scope`) no request para confirmar nenhuma das duas leituras; é inferência
da descrição, não citação literal de um flag. `DeleteMessageInput` (ADR-0012) não expõe escopo — a
semântica assumida por todo o pacote, na ausência de um campo que permita escolher, é sempre
revogação; esta nota existe para não perder essa ambiguidade específica do Whapi caso uma instância
real revele o comportamento oposto (ver "Gaps conhecidos" ao final). Resposta `Success`, ignorada.

## Grupos (`groups.*`)

`GroupID` é opaco (ADR-0009) e, no Whapi, sempre o JID `<dígitos>@g.us` (pattern confirmado no
OpenAPI: `^[\d-]{10,31}@g\.us$`) — repassado intacto no path de todo endpoint, nunca por
`normalizeChatId`.

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `create` | `POST /groups` | Corpo `CreateGroupRequest {subject, participants}` (ambos obrigatórios). Resposta `GroupCreate` (`{id, name, participants: Participant[], created_by, unprocessed_participants?}`) — `unprocessed_participants` (contatos rejeitados pela política anti-spam ao criar o grupo) não tem campo correspondente em `GroupInfo`, perdido deliberadamente. |
| `getInfo` | `GET /groups/{GroupID}` | Resposta `Group` (schema completo: `id`/`name`/`description`/`participants`/`created_by`). |
| `list` | `GET /groups` | Paginado (`count`/`offset`, default `count=100`, máx. 500) — este adapter só devolve a primeira página (a assinatura canônica `list(): Promise<GroupInfo[]>` não expõe cursor). Resposta `GroupsList` `{groups: Group[], count, total, offset}`. |
| `addParticipants` | `POST /groups/{GroupID}/participants` | Corpo `ListParticipantsRequest {participants: [wa-id,...]}` — array em UMA ÚNICA chamada (o batch é o formato oficial do request, confirmado no schema — diferente do WPPConnect, que não confirma lote). |
| `removeParticipants` | `DELETE /groups/{GroupID}/participants` | Mesmo corpo do `addParticipants`. |
| `promoteParticipants` | `PATCH /groups/{GroupID}/admins` | Mesmo corpo (`ListParticipantsRequest`). |
| `demoteParticipants` | `DELETE /groups/{GroupID}/admins` | Mesmo corpo. |
| `updateSubject` | `PUT /groups/{GroupID}` | Corpo `UpdateGroupInfoRequest {subject?, description?}` — **MESMO endpoint** que `updateDescription` (operationId `updateGroupInfo`). Cada operação canônica envia SÓ o campo que lhe corresponde, nunca os dois juntos — para não sobrescrever silenciosamente o campo que não foi pedido. Não confundir com `PATCH /groups/{GroupID}` (operationId `updateGroupSetting`), que é uma operação DIFERENTE (privacidade/permissões do grupo). |
| `updateDescription` | `PUT /groups/{GroupID}` | Idem acima, envia só `description`. |
| `updatePicture` | `PUT /groups/{GroupID}/icon` | Corpo JSON `{media}` (variante `application/json` do requestBody `UploadImage` — as variantes binárias `image/jpeg`/`image/png` não são usadas). `media` aceita URL, base64 ou media ID pré-upload, mesmos três formatos de `messages.sendMedia` (reaproveita `resolveMediaValue`). |
| `getInviteLink` | `GET /groups/{GroupID}/invite` | Resposta `GroupInvite {invite_code}` — só o CÓDIGO, normalizado para link completo via `normalizeInviteLink`. |
| `revokeInviteLink` | `DELETE /groups/{GroupID}/invite` + `GET /groups/{GroupID}/invite` | Ver nota dedicada abaixo — duas chamadas HTTP. |
| `joinViaInviteLink` | `PUT /groups` | operationId `acceptGroupInvite`, corpo `GroupInvite {invite_code}` — só o CÓDIGO. `input.invite` já chega como link completo (normalizado pelo conector); o adapter extrai o código com `extractInviteCode`. Resposta `NewGroup {group_id}` ignorada (contrato retorna `void`). |
| `leaveGroup` | `DELETE /groups/{GroupID}` | Resposta `Success`, ignorada. |

### `revokeInviteLink` — exceção deliberada a "uma única chamada por operação"

`DELETE /groups/{GroupID}/invite` (operationId `revokeGroupInvite`) responde só `Success`
(`{success: boolean}`) — **sem** o novo `invite_code` (diferente de outros adapters deste pacote,
cujo endpoint de revogação já devolve o link direto). Como o contrato canônico
(`revokeInviteLink -> Promise<GroupInviteLink>`) exige devolver o NOVO link, este adapter encadeia
`DELETE` (revoga o código atual) + `GET` (busca o código recém-girado) — duas chamadas HTTP,
exceção deliberada ao padrão de "uma única chamada por operação" (que em ADR-0010 é uma regra
específica de `contacts.get`, não uma regra geral de `GroupsApi`).

**Assunção não confirmada empiricamente**: depende da convenção do protocolo WhatsApp de que
revogar sempre gera um código novo — o OpenAPI só documenta que o `DELETE` "revokes" (invalida) o
link atual, sem afirmar explicitamente que uma chamada `GET` subsequente devolve um código
diferente.

### Participantes — `rank`, não `isAdmin` booleano

`Participant {id, rank}` — `rank` é o enum confirmado no OpenAPI: `'admin' | 'member' | 'creator'`
(diferente do booleano `isAdmin` cru usado por outros providers deste pacote). Mapeamento para
`GroupParticipant`: `creator` → `isAdmin: true` E `isSuperAdmin: true`; `admin` → só `isAdmin`;
`member` → nenhum dos dois.

## Contatos (`contacts.*`)

`chatId`/`phone` já chegam normalizados pelo conector (`normalizeChatId`, ADR-0010) — não são
opacos como `groupId`.

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `list` | `GET /contacts` | Paginado (`count`/`offset`, default 100) — só a primeira página, mesma decisão de `groups.list`. Resposta `ContactsList {contacts: Contact[], count, total, offset}`. |
| `get` | `GET /contacts/{ContactID}` | Resposta `Contact` direta: `{id, phone, name, pushname, is_business, profile_pic, profile_pic_full, status, phonebook}`. Sem `about` (endpoint dedicado) nem booleano de "tem WhatsApp"/"bloqueado" — ADR-0010: cada adapter mapeia a partir de UMA ÚNICA chamada, campos sem correspondência ficam `undefined`. `name` prioriza o nome do catálogo (`name`), cai para `pushname` quando ausente; `profilePictureUrl` prioriza `profile_pic_full` sobre `profile_pic`. |
| `checkExists` | `HEAD /contacts/{ContactID}` | Ver nota dedicada abaixo — único método deste adapter cujo resultado vem só do STATUS HTTP. |
| `getProfilePicture` | `GET /contacts/{ContactID}/profile` | Resposta `UserProfile {name, push_name, verified_name, about, icon, icon_full}` — `icon_full` ("Profile avatar url") preferido sobre `icon` ("Profile preview icon url", resolução menor). |
| `getAbout` | `GET /contacts/{ContactID}/about` | Resposta `ContactAbout {about}`. |
| `block` | `PUT /blacklist/{ContactIdOrLid}` | Ver nota de `ContactIdOrLid` abaixo. |
| `unblock` | `DELETE /blacklist/{ContactIdOrLid}` | Idem. |
| `listBlocked` | `GET /blacklist` | Resposta `ContactIDList` — array de strings (`ContactID`: dígitos crus ou com sufixo `@lid`/`@s.whatsapp.net`), já no formato canônico, sem transformação. |

### `checkExists` — resultado vem só do status HTTP

`HEAD /contacts/{ContactID}` (operationId `checkExist`, "individually checks for a number in
WhatsApp") não devolve corpo em nenhuma resposta — o único sinal é o **status**: `200`
(`Success`) = existe, `404` ("Specified contact not registered") = não existe. Diferente de todo
outro método deste adapter, aqui um status não-2xx **esperado** precisa ser capturado e traduzido
para um resultado de domínio válido, não relançado: `HttpClient` sempre lança `WaConnectorError`
para não-2xx; o adapter intercepta especificamente `error.status === 404` (qualquer outro
status/erro continua propagando normalmente). `raw` no caminho "não existe" carrega o próprio erro
capturado — uma requisição `HEAD` nunca tem corpo real para expor.

### `ContactIdOrLid` — pattern diferente de `ContactID` nos endpoints de blacklist

O path param dos endpoints `/blacklist/*` (`ContactIdOrLid`) usa um schema DIFERENTE do resto de
`contacts.*` (`ContactID`): pattern `^\d{7,15}(@lid)?$`, confirmado no OpenAPI — só dígitos crus ou
`<dígitos>@lid`, **sem** o sufixo `@s.whatsapp.net` que `ContactID` aceita nos demais endpoints
(`get`/`getProfilePicture`/`getAbout`/`checkExists`, pattern
`^([\d]{7,15})?(@lid|@s.whatsapp.net)?$`). `block`/`unblock` removem esse sufixo quando presente
antes de montar o path; `@lid` (já aceito pelo pattern) e dígitos crus passam intactos.

## Ações sobre mensagem (`messages.forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`, ADR-0013)

Continuação da pesquisa de `messages.edit`/`delete` acima. Todas as 6 confiança **Alta**, mesmas
fontes (`openapi.yaml` oficial).

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `messages.forward` | `POST /messages/{MessageID}` (`operationId: forwardMessage`, `openapi.yaml:2334-2387`) | Corpo `ForwardMessage` (`:8865-8877`): `to` obrigatório (destino) + `force` opcional (boolean, não exposto pelo contrato canônico). `ForwardMessageInput.fromChatId` nunca é enviado — o `messageId` no path já identifica a origem. **401 dedicado** "Need channel authorization for forward message" — sugere que forward pode exigir plano/permissão extra. Resposta reaproveita o mesmo shape de `sendText`/`edit`. |
| `messages.star` / `messages.unstar` | `PUT /messages/{MessageID}/star` (`operationId: starMessage`, `:2541-2579`) | Corpo `Star {starred: boolean}` (`:8885-8892`) — permanente (favoritar), sem duração, ao contrário do pin. Um único endpoint com flag booleana cobre as duas direções. Resposta ignorada, `Promise<void>`. |
| `messages.pin` / `messages.unpin` | `POST` / `DELETE /messages/{MessageID}/pin` (`operationId: pinMessage`/`unpinMessage`, `:2580-2649`) | Corpo `Pin {time}` só no `POST` (`:8893-8904`) — enum `day`\|`week`\|`month` (fixação COM prazo, diferente do star permanente). Nota de spec: o `example` do campo (`2592000`, segundos) é inconsistente com o próprio enum de strings — possível erro de doc do provider. `PinMessageInput` não expõe duração (ADR-0013); este adapter usa **`'day'`** como default para `pin` (decisão própria, valor mais conservador do enum). `unpin` é `DELETE`, sem corpo. |
| `messages.markRead` | `PUT /messages/{MessageID}` (`operationId: markMessageAsRead`, `:2388-2418`) | Sem corpo. Marca UMA mensagem específica (e, por extensão de protocolo, a conversa até ali) como lida — distinto de `chats.markRead` (`PATCH /chats/{ChatID}` com `mark_unread: false`, ADR-0012), que atua no nível do chat inteiro. |

## Conteúdo estruturado (`messages.sendLocation`/`sendContactCard`/`sendPoll`, ADR-0014)

Cobertura 3/3, confiança **Alta** para as 3, mesma fonte (`openapi.yaml` oficial).

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `messages.sendLocation` | `POST /messages/location` (`operationId: sendMessageLocation`, `openapi.yaml:1299`) | Corpo `SenderLocation`/`MessageContentLocation` (`:11362-11406`): `latitude`/`longitude` obrigatórios; `address`/`name` mapeados de `SendLocationInput` (opcionais no schema); `url`/`preview`/`accuracy`/`speed`/`degrees`/`comment` (demais opcionais do schema) sem campo equivalente no contrato canônico, não enviados. Sem "hasWhatsApp" nem verificação de coordenada — conteúdo livre. |
| `messages.sendContactCard` | `POST /messages/contact` (`operationId: sendMessageContact`, `:1417`) | Corpo `SenderContact`/`VCard`: `name`/`vcard` obrigatórios — cartão de contato único em vCard CRU, sem normalização de telefone pelo Whapi. **Este provider não monta o vCard a partir de campos soltos** (diferente de Evolution/uazapi/Z-API); `SendContactCardInput` só expõe `contactName`/`contactPhone` — este adapter monta a string vCard mínima localmente (`buildVcard`: `FN:{name}` + `TEL;type=CELL;type=VOICE;waid={phone}:+{phone}`, mesmo formato que a Evolution confirma gerar server-side). |
| `messages.sendPoll` | `POST /messages/poll` (`operationId: sendMessagePoll`, `:1560`) | Corpo `MessagePropsPoll` (`:12652-12674`): `title`/`options` (2-12 itens) obrigatórios; `count` **inverte a convenção intuitiva** — `0` permite múltipla escolha, `1` restringe a uma só. `SendPollInput.allowMultipleAnswers` mapeia para `count: 0`/`count: 1`. |

## Presença (`presence.*`, ADR-0015)

Cobertura 3/3, confiança **Alta** para as 3 — a MELHOR cobertura da fila junto com WAHA/Wuzapi.

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `presence.setTyping` | `PUT /presences/{EntryID}` (`operationId: sendPresence`, `openapi.yaml:3484-3523`) | Corpo `SendPresenceRequest` (`:9079-9095`): `presence` enum `typing`\|`recording`\|`pause` (**singular**, não `paused` — único desalinhamento de nome com `TypingState`) + `delay` (segundos, default `0`, não exposto por `SetTypingInput` — omitido). Simula "digitando…"/"gravando áudio…" por N segundos; `pause` encerra manualmente antes do delay expirar. |
| `presence.set` | `PUT /presences/me` (`operationId: sendMePresence`, `:3366-3404`) | Corpo `SendMePresenceRequest` (`:9068-9078`): `{presence: 'online'\|'offline'}` — mapeia direto de `PresenceState`. Presença GLOBAL da conta, distinta da presença por-chat acima. |
| `presence.subscribe` | `POST /presences/{EntryID}` (`operationId: subscribePresence`, `:3437-3483`) | Sem body. 409 dedicado "already subscribed", 404 "not found in whatsapp" — inscreve-se para receber updates de presença (online/last-seen) de um contato via webhook. |

**`presence.get` deliberadamente NÃO implementado nesta fase** (ver ADR-0015): existe
`GET /presences/{EntryID}` (`operationId: getPresence`, `:3405-3436`, confiança Alta, schema
`Presence` em `:10725`), mas cobertura cross-provider insuficiente (só 2/8) para unificar um shape
de resposta com confiança — candidata para rodada futura.

## Etiquetas (`labels.*`, ADR-0016)

Cobertura 6/6, confiança Alta — schema completo (`Label`/`CreateLabel`/`RenameLabel`) confirmado no
`openapi.yaml`.

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `labels.list` | `GET /labels` (`operationId: getLabels`) | Resposta é um array cru de `Label {id, name, color, count?}`. Descrição explícita: "retrieve all your registered labels in your **WhatsApp Business**" — capability condicionada ao tipo de conta, não disponível em WhatsApp pessoal. |
| `labels.create` | `POST /labels` (`operationId: createLabel`) | Schema `CreateLabel {id, name, color}` — **os TRÊS campos são obrigatórios**, diferente de todo outro provider desta ADR. `id` (schema `LabelID`) segue um formato ESTRITO — `pattern: ^([\d]{1,2})?$` (1-2 dígitos) — mesmo espaço de 0-19 do enum de 20 cores fixas (`salmon`...`rebeccapurple`); não pode ser um UUID/valor livre. Este adapter lista os labels existentes (`GET /labels`) para achar o menor id numérico livre em 0-19, então cria com esse id (2 chamadas HTTP). `color` (obrigatório no schema, opcional no contrato canônico) usa `salmon` como default deste adapter quando ausente. |
| `labels.update` | `PATCH /labels/{LabelID}` (`operationId: renameLabel`) | Schema `RenameLabel {name}` — **sem campo `color`**: o Whapi só permite RENOMEAR um label, não recolorir depois de criado. `UpdateLabelInput.color`, se fornecido, é ignorado silenciosamente. |
| `labels.delete` | `DELETE /labels/{LabelID}` (`operationId: deleteLabel`) | Sem body. |
| `labels.addToChat` | `POST /labels/{LabelID}/{AssociationID}` (`operationId: addLabelAssociation`) | `AssociationID` usa o schema `ChatID` — a doc também aceita um MessageID ali ("Specified chat **or message** not found"), mas `LabelChatInput` só modela chat. 409 documentado "Label association already exists" numa associação repetida. |
| `labels.removeFromChat` | `DELETE /labels/{LabelID}/{AssociationID}` (`operationId: deleteLabelAssociation`) | Mesmo endpoint/schema de `addToChat`, método `DELETE`. |

**Caveat documentado (não resolvido, por design, mesmo padrão do `color`-erasure do QuePasa)**: o
diff feito por `labels.create` (listar antes de escolher um id) tem uma condição de corrida
inerente — se dois processos criarem labels simultaneamente, ambos podem escolher o mesmo id
"livre" e um dos dois sobrescreveria o outro (o schema não documenta um 409 de "id já em uso" para
`POST /labels`, diferente do 409 real de `addToChat`). Não há como eliminar esse risco do lado do
cliente sem uma operação atômica no servidor.

## Conversas (`chats.*`, ADR-0012)

Namespace novo de gestão de ESTADO da conversa (distinto de `messages.*`, que age sobre UMA
mensagem, e de `groups.*`/`contacts.*`, que são metadados/participantes/perfil). `chatId` não é
opaco — já chega normalizado pelo conector (mesmo tratamento de `contacts.*`); `toWhapiChatId`
(função identidade) é reaproveitada de `messages.*`.

> **Nuance de formato**: diferente de `ContactID` (`^([\d]{7,15})?(@lid|@s.whatsapp.net)?$` — sufixo
> `@domínio` **opcional**), o schema `ChatID` usado por `/chats/{ChatID}` exige o sufixo:
> `^(?:0@(?:c\.us|s\.whatsapp\.net)|[\d-]{10,31}@[\w\.]{1,})$` (`openapi.yaml:9753-9756`). Como
> `normalizeChatId` (core) devolve dígitos crus quando o chamador passa só um telefone (sem `@`),
> chamar `chats.*` com um chatId de dígitos puros passaria a validação do conector mas poderia
> falhar contra uma instância real do Whapi — **não confirmado empiricamente** (a pesquisa não
> exercitou uma chamada real com dígitos puros contra `/chats/{ChatID}`). Consumidores devem
> preferir um JID explícito (`<dígitos>@s.whatsapp.net` ou `...@g.us`) ao chamar `chats.*` neste
> adapter.

| Capability | Endpoint | Confiança | Observações |
| --- | --- | --- | --- |
| `archive` | `POST /chats/{ChatID}` (`operationId: archiveChat`, `openapi.yaml:2833-2870`) | Alta | Corpo `ArchiveChatRequest {archive: true}` (`openapi.yaml:8968-8975`). |
| `unarchive` | `POST /chats/{ChatID}` (MESMO endpoint) | Alta | Corpo `{archive: false}` — toggle único, sem endpoint dedicado de "desarquivar". |
| `pin` | `PATCH /chats/{ChatID}` (`operationId: patchChat`, `openapi.yaml:2871-2910`) | Alta | Corpo `PatchChatRequest {pin: true}` (`openapi.yaml:8980-8983`) — fixa a CONVERSA no topo, sem prazo. |
| `unpin` | `PATCH /chats/{ChatID}` (MESMO endpoint) | Alta | Corpo `{pin: false}`. |
| `markRead` | `PATCH /chats/{ChatID}` (MESMO endpoint) | Alta | Corpo `{mark_unread: false}` (campo `PatchChatRequest.mark_unread`, `openapi.yaml:8989-8992`) — marca a CONVERSA inteira, sem precisar dos ids das mensagens. |
| `markUnread` | `PATCH /chats/{ChatID}` (MESMO endpoint) | Alta | Corpo `{mark_unread: true}`. |
| `mute` | `PATCH /chats/{ChatID}` (MESMO endpoint) | Alta | Corpo `{mute_until: <timestamp ms>}` (campo `PatchChatRequest.mute_until`, `openapi.yaml:8984-8988`) — ver nota de duração abaixo. |
| `unmute` | `PATCH /chats/{ChatID}` (MESMO endpoint) | Alta | Corpo `{mute_until: 0}` — "Use 0 to unmute the chat", citação literal do spec. |

### `pin`/`markRead`/`mute` compartilham um único endpoint (`PATCH /chats/{ChatID}`)

`PatchChatRequest` tem **quatro** sub-ações no mesmo corpo: `pin`, `mute_until`, `mark_unread` e
`ephemeral` (mensagens temporárias — fora do escopo desta fase, sem capability canônica
correspondente). Cada operação canônica deste adapter envia SÓ o campo que lhe corresponde, nunca
os demais — mesmo padrão de `groups.updateSubject`/`updateDescription` (que compartilham `PUT
/groups/{GroupID}`), para não sobrescrever silenciosamente um ajuste que não foi pedido.

### `mute`/`unmute` — sem duração no contrato canônico, `mute_until` é um timestamp

`ChatsApi.mute`/`unmute` do contrato canônico (ADR-0012) não recebem duração — nenhum formato de
duração converge entre os providers pesquisados (uazapi usa um enum de horas, WPPConnect usa
`time`+`type` com um bug confirmado). O Whapi usa um timestamp Unix em **milissegundos**
(`mute_until`), sem nenhum valor sentinela documentado para "silenciar para sempre" — só `0` para
desmutar está confirmado em prosa. Este adapter escolhe **1º de janeiro de 2099 (UTC)** como
"silenciar por muito tempo" para `mute(chatId)` — uma DECISÃO deste adapter (mesmo espírito do
`muteEndTime: -1` do adapter uazapi, que usa o enum nativo do provider para o equivalente), não um
default do provider. Consumidores que precisem de uma duração específica (ex.: "silenciar por 8
horas") só têm essa granularidade via chamada direta ao provider, fora do contrato canônico.

## Webhooks

Configurado por canal via `PATCH /settings` (campo `webhooks`, array — um canal pode ter múltiplos
endpoints de webhook) ou pelo dashboard. Exemplo de corpo confirmado:

```json
{
  "webhooks": [
    {
      "mode": "body",
      "events": [{ "type": "messages", "method": "post" }],
      "url": "https://webhook.site/11ab0eeb-dc98-4ccd-a2d3-be2b182b9de0"
    }
  ]
}
```

Existe também `POST /settings/webhook_test` para disparar um callback de teste.

### Envelope (modo `body`, o padrão — assumido por este adapter)

```json
{
  "messages": [ { "...": "..." } ],
  "event": { "type": "messages", "event": "post" },
  "channel_id": "MANTIS-M72HC"
}
```

`event.type` (categoria: `messages`/`statuses`/`channel`/`users`/...) é o discriminador principal;
`event.event` (`post`/`put`/`patch`/`delete`) discrimina o verbo dentro da categoria. Nomes de
evento legados (`message`/`ack`/`chat`/`status`, deprecated segundo o dossiê de pesquisa) **não**
são reconhecidos nesta fase.

Existem também os modos de entrega `path` (sufixo por evento na URL) e `method` (verbo HTTP muda
por evento) — mudam a FORMA do request HTTP, não o conteúdo; como `WebhookInput.body` já chega
parseado pelo framework do consumidor independente do modo, este adapter não precisa distinguir
entre eles.

`channel_id` mapeia para `CanonicalEvent.instanceId` em todos os eventos.

### `message.received` / `message.sent` (`event.type: "messages"`)

Fixture: `src/adapters/whapi/fixtures/webhook-message-received.json` (texto, `from_me: false`,
literal) e `webhook-message-sent.json` (eco `from_me: true`, literal).

Campos comuns: `id`, `from_me`, `type` (discriminador de conteúdo), `chat_id` (JID completo),
`timestamp` (epoch em **segundos** — convertido para ms via `toEpochMs`), `source`
(`"mobile"`/`"api"`), `from`, `from_name`, `context` (reply/quote: `context.quoted_id`).

Mapeamento de conteúdo por `record.type` (confiança documentada por tipo):

- **`text`** (confiança **alta**, payload literal): `kind: 'text'`, `text: record.text.body`.
- **`document`** (confiança **alta**, payload literal completo confirmado, incluindo envelope):
  `text: record.document.caption` ("This is text with file" no exemplo literal), `MediaRef`
  montado a partir de `record.document.link`/`mime_type`/`file_name`. Fixture literal:
  `webhook-message-document.json` (mensagem inteira, envelope incluso, id
  `tGZmYoiXecvbKahzwpwKmg-gEcTwl0rVw`).
- **`image`/`video`** (confiança **média**: campos comuns — `link`/`mime_type`/`file_name` —
  confirmados por analogia com `document`; `caption` também extraído para `text` por simetria com
  `messages.sendMedia` (que confirma `caption` como campo suportado para estes dois tipos), mas sem
  exemplo literal dedicado de **recebimento** de imagem/vídeo com legenda no dossiê).
- **`sticker`/`audio` (`voice`)** (confiança **baixa**, sem exemplo literal capturado): mesmo shape
  assumido por analogia com `document` (`link`/`mime_type`/`file_name`, sem `caption` — WhatsApp
  não permite legenda em áudio/sticker) — mesmo grau de risco já documentado nos adapters Z-API/
  Wuzapi para casos equivalentes. `voice` mapeia para `kind: 'audio'` (não há kind dedicado a nota
  de voz no core).
- **`location`/`contact`/`poll`**: reconhecidos só pelo `kind` (sem `MediaRef` — `MediaKind` não
  cobre estes três), mesmo padrão dos demais adapters deste pacote.
- **`action`** (reação/voto — `action.type: "reaction"|"vote"`): **deliberadamente NÃO
  implementado nesta fase**, mesma decisão de escopo de `messages.sendReaction` (ver seção final) —
  cai em `kind: 'unknown'`.

`quotedId` = `context.quoted_id` quando presente.

### `message.ack` (`event.type: "statuses"`)

Fixture: `src/adapters/whapi/fixtures/webhook-ack.json` (literal, `status: "delivered"`,
`code: 3`).

```json
{
  "statuses": [{
    "id": "YhNqCveDWW90_t8lzrW25w-wO4Twl0rVw",
    "code": 3,
    "status": "delivered",
    "recipient_id": "919984351847@s.whatsapp.net",
    "timestamp": "1712995378"
  }],
  "event": { "type": "statuses", "event": "post" },
  "channel_id": "MANTIS-M72HC"
}
```

Nota: `timestamp` aqui vem como **string** (diferente do `timestamp` numérico de `messages`) — não
usado por `MessageAckEvent` (o contrato canônico não carrega timestamp nesse evento).

Valores de `status` confirmados textualmente (dois artigos oficiais independentes):
`pending`/`sent`/`delivered`/`read`/`played`/`failed`/`deleted`. Mapeamento por **string**, nunca
pelo `code` numérico (só `delivered=3` está confirmado; os demais códigos seriam reconstrução de
terceiros):

| `status` | `MessageAck` canônico |
| --- | --- |
| `pending` | `pending` |
| `sent` | `sent` |
| `delivered` | `delivered` |
| `read` | `read` |
| `played` | `played` |
| `failed` | `error` |
| `deleted` | **sem equivalente** — vira evento `unknown` (não inventa um ack) |
| qualquer outro | **sem equivalente** — vira evento `unknown` |

### `connection.update` — dois eventos distintos e complementares

**a) `event.type: "channel"`** — status de saúde/conexão do canal (mesmo schema `Health` de
`GET /health`, reaproveitando `mapChannelState`). Fixture literal:
`webhook-connection-update-qr.json` (`status.text: "QR"`, `code: 3`):

```json
{
  "health": {
    "start_at": 1713774883,
    "uptime": 78,
    "status": { "code": 3, "text": "QR" },
    "version": "1.8.3-74-gf7df472"
  },
  "event": { "type": "channel", "event": "post" },
  "channel_id": "MANTIS-M72HC"
}
```

`INIT`/`LAUNCH`/`ERROR` também têm exemplo literal no dossiê de pesquisa (`code` 1/2/5
respectivamente). `AUTH`/`SYNC_ERROR` são citados só em prosa — fixture
`webhook-connection-update-auth.json` é **RECONSTRUÍDA** (estrutura extrapolada do exemplo `QR`;
`code: 4` não é confirmado, só uma reconstrução de terceiros).

O envelope também pode carregar um campo `qr` opcional (schema `QR`, mesmo shape de
`GET /users/login`) quando o tipo de evento "channel" está habilitado — **não visto em nenhum
exemplo literal capturado**; extraído defensivamente de `qr.base64` quando presente
(`ConnectionUpdateEvent.qr`).

**b) `event.type: "users"`** (`users.post`/`users.delete`) — conta WhatsApp vinculada/desvinculada
do canal (usuário escaneou o QR, ou o celular desconectou) — distinto do status de saúde do canal
em si, mas igualmente dentro do escopo de `connection.update`. Fixtures literais:
`webhook-user-connected.json` (`event.event: "post"` → `state: 'connected'`) e
`webhook-user-disconnected.json` (`event.event: "delete"` → `state: 'disconnected'`):

```json
{
  "user": { "id": "61371989950", "name": "Jonathan" },
  "event": { "type": "users", "event": "post" },
  "channel_id": "MANTIS-M72HC"
}
```

### Verificação de assinatura/HMAC

**Não existe HMAC/assinatura criptográfica sobre o corpo do webhook no Whapi.Cloud** (busca
dedicada nas docs oficiais não encontrou nenhuma menção). O que existe é um mecanismo mais fraco:
**headers customizados** configuráveis via `PATCH /settings` (campo `headers`, máx. 5, só via API
— "the panel UI does not support this setting"), enviados em toda chamada de webhook — um segredo
compartilhado comparado por igualdade simples de string, não uma assinatura HMAC calculada sobre o
corpo. **Não implementado neste adapter** — `WebhookInput.rawBody` não é necessário aqui (diferente
do WAHA, que usa HMAC real sobre o corpo bruto).

## Limites e particularidades

- **Trial/sandbox automático**: toda conta nova ganha um canal trial sem passo extra. Limites:
  5 chats/mês, 150 mensagens/dia, 30 checagens de número/dia, 1000 chamadas de API/mês
  (`GET /limits` devolve o consumo detalhado, incluindo os `chatId`s liberados no trial).
- **402 dedicado para limite de trial excedido** (`"Trial version limit exceeded"`) em todos os
  endpoints de envio — diferente do 429 usual de rate limit. `statusToErrorCode` do core mapeia
  qualquer status não-401/403/429 para `PROVIDER_ERROR` (inclui 402) — nenhum tratamento especial
  adicional feito por este adapter.
- **403 dedicado**: `"It is forbidden to send to this group/recipient"` — sinal de restrição de
  destinatário do trial.
- **429** existe em todos os endpoints de envio, sem `Retry-After` documentado no spec (o
  `HttpClient` ainda assim tenta ler o header, defensivamente, e cai no backoff calculado se
  ausente). Em plano pago, não há limite rígido de requisições da própria API documentado
  oficialmente (fonte de terceiros, confidence baixa) — só os limites naturais do
  anti-spam do WhatsApp.
- **Manutenção de sessão**: é preciso abrir o WhatsApp no celular ao menos a cada 14 dias para o
  canal continuar operacional — relevante para `instance.status()` cair de `AUTH` ao longo do tempo
  sem uso do celular.
- **Múltiplos canais/Partner API**: criar/listar/deletar canais e converter trial→"live" é feito
  por uma API totalmente separada (`manager.whapi.cloud`, "Partner API", token de conta/parceiro
  diferente do token de canal) — fora do escopo deste adapter e do contrato `WaAdapter` (não há
  capability para "gerenciar canais" no core atual).
- Grupos usam `GroupID` (`...@g.us`); ver seção "Grupos (`groups.*`)" para os 14 endpoints
  implementados.

## Capabilities confirmadas mas não implementadas

- **`instance.pairingCode`** — `GET /users/login/{PhoneNumber}` existe e devolve
  `{"code": "123-456"}`, mas `InstanceApi.connect()` não recebe telefone como parâmetro no contrato
  atual — exigiria estender o contrato central, fora do escopo deste adapter. Mesmo obstáculo
  estrutural já documentado nos adapters Z-API/uazapi/Wuzapi.

## Gaps conhecidos (a validar contra uma instância real)

| Ponto | Gap |
| --- | --- |
| `ConnectResult.qr` (`GET /users/login` → `base64`) | Formato exato (com/sem prefixo `data:image/png;base64,`) não confirmado literalmente. |
| Resposta de `messages.send*` | Estrutura confirmada só por schema (`SentMessage`/`Message`), sem payload de resposta real capturado; unidade de `timestamp` (segundos) assumida por analogia com webhooks, não confirmada para a resposta de envio especificamente. |
| `groups.revokeInviteLink` | Assume que revogar (`DELETE .../invite`) sempre gera um código novo, consultado logo em seguida via `GET .../invite` — convenção do protocolo WhatsApp, não afirmada explicitamente pelo OpenAPI (que só documenta o `DELETE` como "revokes"). |
| Round-trip de `messages.sendReaction` no webhook | Recebimento de reação (`type: "action"`, `action.type: "reaction"`) continua caindo em `kind: 'unknown'` — não implementado neste incremento (só o envio via `messages.sendReaction` foi escopado). |
| Legenda em `image`/`video` recebidos via webhook | `caption` extraído para `WaMessage.text` por simetria com `messages.sendMedia`, mas sem exemplo literal dedicado de recebimento com legenda (confiança média — `document` já tem exemplo literal confirmado). |
| `video`/`sticker`/`audio` (`voice`) recebidos via webhook | Shape de `MediaRef` assumido por analogia com `document`, sem exemplo literal capturado. |
| `AUTH`/`SYNC_ERROR` no webhook `channel` | Citados só em prosa; fixture `webhook-connection-update-auth.json` é reconstruída, `code` não confirmado. |
| `qr` no envelope do webhook `channel` | Campo existe no schema `WebhookPayload`, mas nenhum exemplo literal capturado com QR de fato embutido. |
| Rate limit numérico em plano pago | Nenhuma fonte oficial com número; só qualitativo (terceiros). |
| `messages.delete` — local vs. revogação | A descrição do endpoint (`DELETE /messages/{MessageID}`) afirma que dá para apagar mensagem de um contato, o que sugeriria "delete for me" (local) em vez de "revoke for everyone" — mas não há campo explícito de escopo para confirmar. Ver seção "Edição e exclusão de mensagem". |
| `chats.mute` — sentinela de "silenciar para sempre" | `mute_until` (timestamp ms) não documenta nenhum valor especial para "permanente" — este adapter usa 1º/jan/2099 (UTC) como decisão própria, não um default do provider. Ver seção "Conversas (`chats.*`)". |
| `messages.edit` via campo `Sender.edit` | Campo confirmado no OpenAPI oficial (schema + descrição), mas sem exemplo de payload/resposta real capturado para uma edição de fato — mesmo nível de confiança "por schema" já aplicado ao resto deste dossiê para endpoints sem payload literal. |
