# Dossiê: Whapi.Cloud

- Docs oficiais: <https://whapi.readme.io/> (renderizada a partir do OpenAPI oficial,
  `https://github.com/Whapi-Cloud/whatsapp-api-docs/blob/main/openapi.yaml`, `info.version: 1.8.7`)
- Versão testada: OpenAPI spec (13.141 linhas) e Help Desk (`support.whapi.cloud`) consultados em
  2026-07-11. `groups.*`/`contacts.*`/`messages.sendReaction` (auditoria de gaps, 23+1
  capabilities) revalidados no MESMO arquivo `openapi.yaml` (`info.version: 1.8.7`, ainda 13.141
  linhas) em 2026-07-11 — sem deriva de spec detectada entre as duas consultas.
- Hospedagem: SaaS — host único `https://gate.whapi.cloud` para todos os clientes. Existe uma API
  **separada** (`manager.whapi.cloud`, "Partner API") para criar/gerenciar canais programaticamente
  — fora do escopo deste adapter, ver "Limites e particularidades".

> **Escopo**: 29/30 capabilities do core — todas exceto `instance.pairingCode` (obstáculo
> estrutural do contrato, não do provider — ver "Capabilities confirmadas mas não implementadas").
> `messages.sendReaction`, as 14 operações de `groups.*` e as 8 de `contacts.*` foram implementadas
> numa rodada posterior às capabilities núcleo (`instance.*`/`messages.sendText`/`sendMedia`/
> `webhooks.parse`) — ver "Grupos" e "Contatos" abaixo.

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
`messages.sendMedia`, `messages.sendReaction`, as 14 operações de `groups.*` (`create`, `getInfo`,
`list`, `addParticipants`, `removeParticipants`, `promoteParticipants`, `demoteParticipants`,
`updateSubject`, `updateDescription`, `updatePicture`, `getInviteLink`, `revokeInviteLink`,
`joinViaInviteLink`, `leaveGroup`), as 8 de `contacts.*` (`list`, `get`, `checkExists`,
`getProfilePicture`, `getAbout`, `block`, `unblock`, `listBlocked`) e `webhooks.parse`.

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
