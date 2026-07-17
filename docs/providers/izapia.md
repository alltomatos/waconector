# Dossiê: izapia

- Docs oficiais: `https://api.izapia.com/openapi.json` (OpenAPI 3.1, servido ao vivo pelo próprio
  servidor a partir de `docs/openapi.yaml`, fonte única versionada no repo). Repositório-fonte
  **privado**: `github.com/alltomatos/izapia` (produto próprio do usuário deste pacote).
- Versão testada: `v0.2.0`, confirmado ao vivo em `api.izapia.com/openapi.json` e no código-fonte
  (branch `main`) em 2026-07-16.
- Hospedagem: SaaS multi-tenant (API própria do usuário; arquitetura API + workers dedicados por
  sessão + Postgres + Redis + RabbitMQ).

> **Base técnica**: construído sobre a mesma biblioteca Go `tulir/whatsmeow` usada por Evolution GO
> e Wuzapi — mas, diferente desses dois, esta pesquisa leu o **código-fonte real** (não só a doc)
> para praticamente todo namespace, porque o repositório é acessível via `gh api` com o token deste
> ambiente. Confiança Alta na maioria das seções abaixo; onde a leitura ficou só na prosa do
> OpenAPI (rica o bastante para citar literalmente), está marcado.
>
> **Nota de proveniência**: uma pesquisa anterior (registrada em memória de agente) concluía que
> este dossiê já existia pronto numa branch remota. Essa branch **não continha o arquivo** — esta
> versão foi escrita do zero nesta sessão, direto do OpenAPI ao vivo + código-fonte.

## Autenticação

Header `Authorization: Bearer <api-key>` — a API key **crua** do tenant (schema OpenAPI
`ApiKeyAuth`, `scheme: bearer`), sem JWT/OAuth. Uma única API key por tenant autentica todas as
sessões desse tenant (o `sid` na URL escolhe qual sessão/número de WhatsApp).

Toda resposta (sucesso ou erro) usa o envelope canônico do próprio provider:
`{ok: boolean, data?, raw?, error?: {code, message, details?}}`. Códigos de erro estáveis
confirmados: `INVALID_INPUT`, `NOT_FOUND`, `AUTH_FAILED`, `PROVIDER_ERROR`, `QUOTA_EXCEEDED`,
`SESSION_NOT_READY` (503 — worker ainda não assumiu a posse da sessão), `NOT_IMPLEMENTED` (501 —
ver seção de gaps conhecidos abaixo), `ALREADY_PAIRED`, `RECORDING_NOT_FOUND`,
`EXPERIMENTAL_OPT_IN_REQUIRED`.

Mapeamento sugerido para `WaErrorCode` (`src/core/errors.ts`): `AUTH_FAILED`→`AUTH_FAILED`,
`INVALID_INPUT`→`INVALID_INPUT`, `QUOTA_EXCEEDED`→`RATE_LIMITED`,
`SESSION_NOT_READY`→`INSTANCE_DISCONNECTED`, `PROVIDER_ERROR`/`NOT_FOUND`/demais→`PROVIDER_ERROR`.

## Modelo de instância/sessão

O termo do domínio é **"session"** (não "instance"), uma sessão WhatsApp dentro de um tenant.
Fluxo de duas etapas, diferente dos demais adapters deste pacote (que combinam criar+conectar num
só passo):

1. **Criar a sessão** — `POST /api/v1/sessions/` (body opcional `{name?, city_hint?}`). Só persiste
   a linha (status inicial `"created"`, confirmado em `internal/session/repo.go`'s `Repo.Create`) —
   ainda não conecta ao WhatsApp. Sujeita a `429 QUOTA_EXCEEDED` (`max_sessions` do plano).
2. **Parear** — duas formas mutuamente exclusivas:
   - QR: `POST /api/v1/sessions/{sid}/pair` → `data: {code, qr_png_base64}` (`code` é o valor cru
     do QR; `qr_png_base64` é a imagem PNG já renderizada, pronta para exibir).
   - Código de telefone (sem QR): `POST /api/v1/sessions/{sid}/pair/phone`, body `{phone}` →
     `data: {pairing_code}`.
3. **Status**: `GET /api/v1/sessions/{sid}` → `Session` canônico do provider (confirmado em
   `internal/session/repo.go`): `{id, name, jid?, status, proxy?, connected_at?,
   last_activity_at?}`.
4. **Logout** (soft): `POST /api/v1/sessions/{sid}/logout` — manda o IQ real de
   "remove-companion-device" ao WhatsApp (`client.Logout`, `whatsmeow`) — invalida a sessão do
   lado do WhatsApp, mas a linha da sessão **não é apagada** (`sid`/`name`/`proxy` preservados); um
   novo `POST .../pair` volta a funcionar normalmente. Emite `session.logged_out`.

### `instance.connect()` — decisão de mapeamento

O contrato canônico `InstanceApi.connect(): Promise<ConnectResult>` não tem como criar Y parear em
dois HTTP calls diferentes e reportar isso como uma operação atômica ao consumidor — este adapter
deve: (a) se a `IzapiaOptions` já tiver um `sid` conhecido, chamar só `POST .../pair`; (b) senão,
criar a sessão primeiro (`POST /sessions/`) e then parear — decisão a confirmar na implementação
(issue de core do adapter), documentada aqui para não se perder.

### Mapeamento de status (`Session.status` → `InstanceState` canônico)

Enum confirmado em `internal/session/manager.go` (literais passados a `setStatus`) +
`internal/session/repo.go` (`Create` insere em `"created"`):

| `status` do izapia | Contexto | `InstanceState` canônico |
| --- | --- | --- |
| `created` | Sessão persistida, pareamento nunca iniciado | `disconnected` |
| `pairing` | QR ou pairing-code emitido, aguardando confirmação do WhatsApp | `qr` |
| `connected` | `*events.Connected`/`*events.PairSuccess` do whatsmeow — JID populado | `connected` |
| `disconnected` | `*events.Disconnected` — **JID preservado** (socket caiu, credenciais continuam válidas; `setStatus` usa `NULLIF` para não limpar o `jid`) | `connecting` (mesmo raciocínio já documentado no dossiê Wuzapi: credenciais existem, socket só caiu) |
| `logged_out` | `*events.LoggedOut` — device trocado internamente, precisa de novo `pair` | `disconnected` |
| qualquer outro/ausente | formato inesperado | `unknown` (nunca lança) |

`instance.pairingCode` **não** será declarada nesta fase, apesar do endpoint
`POST .../pair/phone` existir e funcionar — mesmo motivo estrutural de todos os outros 8 adapters:
`InstanceApi.connect()` não recebe telefone no contrato atual.

## Webhooks

Configuração via `PUT /api/v1/sessions/{sid}/webhook`, body `{url, secret, events?: string[]}`
(`events` vazio = todos os tipos). Sujeito a `429 QUOTA_EXCEEDED` (`max_webhooks` do plano, só ao
configurar um webhook **novo**). `GET` de volta nunca ecoa o `secret`.

### Envelope de evento (confirmado em `internal/events/events.go`)

```json
{
  "event_id": "evt_<hex opaco>",
  "type": "message.received",
  "session_id": "<sid>",
  "tenant_id": "<uuid>",
  "data": { "...": "..." },
  "published_at": "2026-07-16T12:00:00Z"
}
```

Este é o **corpo exato** entregue por POST ao `url` configurado — não há um envelope adicional por
cima (confirmado em `internal/webhook/dispatcher.go`, que serializa o `events.Event` recebido do
RabbitMQ diretamente como corpo HTTP).

### Assinatura HMAC (confirmado em `internal/webhook/dispatcher.go`)

Header `X-izapia-Signature: sha256=<hex(HMAC-SHA256(secret, corpo_bruto))>`. `Content-Type:
application/json`. Retries em `[0, 300ms, 2s]`; esgotadas, vai para uma dead-letter queue interna
(nada mais é entregue). Dedup por `event_id` (janela de 1h). Igual em espírito ao ADR-0006
(verificação HMAC opt-in) já usado pelo WAHA.

### Tipos de evento canônicos (confirmados em `internal/events/events.go`)

| Tipo | Mapeia para evento canônico waconector | Observação |
| --- | --- | --- |
| `session.qr` | `connection.update` | QR (re)emitido |
| `session.connected` | `connection.update` | `data` inclui `jid` (+ `connected_at`/`last_activity_at` quando presentes) |
| `session.disconnected` | `connection.update` | Socket caiu, credenciais preservadas |
| `session.logged_out` | `connection.update` | Deslogado — precisa novo pareamento |
| `message.received` | `message.received` | Mensagem comum (status/história/interativo são desviados ANTES de chegar aqui — ver abaixo) |
| `message.ack` | `message.ack` | Recibo de entrega/leitura |
| `message.interactiveReply` | fora do contrato atual | Normaliza botão legado/lista/NativeFlow em `data.selected.id` — sem evento canônico equivalente hoje |
| `message.pollVote` | fora do contrato atual | Voto de enquete já decriptado e resolvido pro texto da opção |
| `group.update` | `group.update` (ver `GroupUpdateEvent`) | Entrada/saída/promoção/mudança de nome — só os campos efetivamente alterados |
| `presence.update` | fora do contrato de webhook atual (capability `presence.*` é request-response) | Empurrado assíncrono pelo servidor após `subscribe` |
| `call.offer`/`call.accept`/`call.active`/`call.terminate` | fora do contrato atual | Ciclo de vida de chamada de voz |
| `history.sync` | fora do contrato atual | Lote de histórico sincronizado |
| `usage.message`/`usage.call.started`/`usage.call.ended` | fora do contrato atual | Telemetria de billing do tenant, não evento de mensageria |
| `status.received` | fora do contrato atual | Status (story) recebido de um contato |

`webhooks.parse` deve reconhecer, no mínimo, `session.*`/`message.received`/`message.ack`/
`group.update` — o restante (interactive reply, poll vote, presence, calls, history, usage,
status) fica como evento `unknown` nesta fase (nenhum evento canônico equivalente existe ainda no
core do waconector para eles), documentado aqui para uma expansão futura do contrato central.

## Capabilities candidatas por namespace (mapeamento OpenAPI → contrato canônico)

Cobertura ampla — na pesquisa, o izapia tem endpoint candidato para **todas** as 68 capabilities
do enum atual (`src/core/capabilities.ts`), o que o tornaria, se confirmado na implementação, o
provider mais completo do pacote. Números exatos de `X/68` só existirão de fato após a
implementação + `npm run docs:capabilities` (ver `docs/capabilities.md`, gerado do código).

### `instance.*` + `webhooks.*` (ver seções acima)

`instance.connect`, `instance.status`, `instance.logout`, `webhooks.parse`. Sem
`instance.pairingCode` (ver justificativa acima).

### `messages.*`

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.sendText` | `POST .../messages/text` | Body `{to, text}` → `{message_id}`. |
| `messages.sendMedia` | `POST .../messages/media` | Body `{to, kind, url? xor base64?, mimetype?, caption?}` → `{message_id}`. |
| `messages.sendReaction` | `POST .../messages/react` | Body `{to, message_id, reaction?, sender?}` — **reaction vazia remove a reação anterior** (confirmado em `internal/session/actions.go`'s `ReactMessage`/`BuildReaction` do whatsmeow — já bate com a convenção canônica do ADR-0008, sem tradução necessária). `sender` vazio = mensagem própria/DM. |
| `messages.edit` | `POST .../messages/edit` | Body `{to, message_id, text}` → `{message_id}` (novo id da edição, `client.BuildEdit`). |
| `messages.delete` | `POST .../messages/delete` | Body `{to, message_id, sender?}` → `{message_id}` (id da revogação, `client.BuildRevoke`). `sender` vazio revoga mensagem própria. |
| `messages.forward` | ⚠️ **NÃO implementado** | `POST .../messages/forward` existe (body `{to, text}` → `{message_id}`), mas só aceita TEXTO pronto — o servidor não guarda o conteúdo original da mensagem (stateless, confirmado em `internal/session/actions.go`'s `buildForwardedText`). O contrato canônico `ForwardMessageInput` só carrega `messageId`/`fromChatId` (nunca o texto), então não há como cumprir a operação sem inventar conteúdo. Limitação real de descasamento de forma entre contrato e provider, não gap de pesquisa. |
| `messages.star`/`unstar` | `POST .../messages/star` | Body `{to, message_id, starred?, sender?, from_me?}` — toggle via app-state (`appstate.BuildStar`), devolve só confirmação (`Promise<void>`). |
| `messages.pin`/`unpin` | `POST .../messages/pin` | Body `{to, message_id, pinned?, sender?, from_me?}` → `{message_id}` (é send-type — gera uma mensagem de controle real, diferente de star/read). |
| `messages.markRead` | `POST .../messages/read` | Body `{to, message_ids: string[], sender?}` — `client.MarkRead`, todas as mensagens do mesmo autor. |
| `messages.sendLocation` | `POST .../messages/location` | Body `{to, latitude?, longitude?, name?, address?}` → `{message_id}`. |
| `messages.sendContactCard` | `POST .../messages/contact` | Body `{to, display_name, phone?, vcard?}` → `{message_id}`. |
| `messages.sendPoll` | `POST .../messages/poll` | Body `{to, name, options: string[], selectable_count?}` → `{message_id}`. |
| `messages.download` | `POST .../messages/download` (ADR-0020) | Ver seção dedicada "Download de mídia" abaixo. |

Sujeita a `429 QUOTA_EXCEEDED` (`max_msgs_day`) em `sendText` (confirmado; os demais endpoints de
envio "ainda não estão" instrumentados com a mesma checagem segundo a própria doc — revisitar na
implementação).

**Extras além do contrato atual** (não implementar nesta fase, documentados para o futuro):
`messages/carousel` (carrossel interativo, EXPERIMENTAL, exige opt-in explícito no body),
`messages/interactive` (botões/lista).

## Download de mídia (`messages.download`, ADR-0020)

Confiança Alta quanto ao endpoint (`POST .../messages/download`, body `{kind, direct_path?,
file_enc_sha256?, file_length?, file_sha256?, media_key?, mimetype?, url?}` → envelope
`data: {mimetype, data_base64}`, confirmado no OpenAPI oficial) — izapia é **stateless** (não guarda
histórico de mensagens recebidas do lado do servidor), então este endpoint sempre exige o descritor
bruto completo, nunca só um `messageId` (é o caso de uso real do campo `DownloadMediaInput.raw`, ver
ADR-0020).

### De onde vem o descritor: `data.raw` no webhook `message.received`

Confirmado em `internal/session/message.go` (`receivedEvent`): o payload de `message.received`
inclui `data.raw`, que é literalmente `evt.RawMessage` — o `*waE2E.Message` BRUTO do whatsmeow (a
mesma dependência `go.mau.fi/whatsmeow` usada pelo Evolution GO). Isso significa que `data.raw` tem
o MESMO formato dos sub-objetos de mídia já confirmados ao vivo para o Evolution GO
(`imageMessage`/`videoMessage`/`audioMessage`/`documentMessage`/`stickerMessage`, campo `URL`
maiúsculo + resto lowerCamelCase, `fileLength` como STRING) — **confiança Média**: a origem do
campo é confirmada no código-fonte real do izapia, mas o casing exato do JSON de SAÍDA deste
provider especificamente não foi capturado ao vivo (só herdado por analogia da mesma dependência
whatsmeow, mesmo critério de risco já registrado para o Evolution GO na correção da ADR-0020).

`WaMessage.raw` deste adapter é o ENVELOPE INTEIRO do webhook (`{event_id, type, session_id,
tenant_id, data, published_at}`) — o adapter lê `raw.data.raw` para achar o sub-objeto de mídia e
monta o corpo `{kind, url, mimetype, direct_path, media_key, file_enc_sha256, file_sha256,
file_length}` esperado pelo endpoint (`kind` derivado de QUAL sub-objeto foi encontrado). Sem
sub-objeto reconhecido, a chamada segue com corpo `{}` mesmo assim — mesma postura de degradação
suave já adotada no Evolution GO (deixa o provider real reportar erro em vez de bloquear
preventivamente aqui).

Fixture `fixtures/webhook-message-image.json` (**reconstruída por analogia**, não capturada ao
vivo — mesmo status de risco das fixtures de mídia do Evolution GO) usada para testar essa
extração.

### `groups.*`

Modelo canônico de grupo confirmado em `internal/session/groups.go` (`groupToCanonical`):
`{group_id, subject, description, owner, created (unix), participants: [{jid, is_admin,
is_super_admin}]}`. `group_id` é sempre o JID (`<dígitos>@g.us`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST .../groups` | Body `{subject, participants: string[]}`. |
| `groups.getInfo` | `GET .../groups/{groupId}` | |
| `groups.list` | `GET .../groups` | Leitura ao vivo no client whatsmeow (não persiste no Postgres). |
| `groups.addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` | `POST .../groups/{groupId}/participants` | **Mesmo endpoint, 4 operações** — body `{action: add\|remove\|promote\|demote, participants: string[]}` → `{participants: [{jid, is_admin, is_super_admin, error?}]}` (resultado por-participante; `error` só aparece em falha pontual). |
| `groups.updateSubject` | `POST .../groups/{groupId}/subject` | Body `{subject}`. |
| `groups.updateDescription` | `POST .../groups/{groupId}/description` | Body `{description?}` — vazio limpa a descrição. |
| `groups.updatePicture` | `POST .../groups/{groupId}/picture` | Body `{url? xor base64?, mimetype?}` → `{ok, picture_id}`. |
| `groups.getInviteLink` | `GET .../groups/{groupId}/invite` | → `{invite_link}`. |
| `groups.revokeInviteLink` | `POST .../groups/{groupId}/invite/revoke` | → `{invite_link}` (o novo). |
| `groups.joinViaInviteLink` | `POST .../groups/join` | Body `{link}` → `{group_id}`. |
| `groups.leaveGroup` | `POST .../groups/{groupId}/leave` | |

**Extras além do contrato atual — namespace de grupo avançado**, confirmado existir de verdade
(não é gap de pesquisa, é feature real do provider que o contrato canônico ainda não modela):
`groups/preview` (consulta sem entrar), `announce` (toggle "só admin manda mensagem"), `locked`
(toggle "só admin edita metadados"), `member-add-mode` (`admin_add`\|`all_member_add`),
`join-approval-mode` (toggle aprovação de entrada) + `join-requests` (listar/aprovar/rejeitar
solicitações pendentes). Candidatos a uma futura extensão do contrato central, fora de escopo desta
Epic.

**Comunidades** (`communities.*`, namespace inteiramente novo, sem equivalente no contrato atual):
criar comunidade, listar grupos+participantes agregados, vincular/desvincular grupo — visto em
`internal/session/communities.go`. Fora de escopo.

### `contacts.*`

Modelo canônico confirmado em `internal/session/contacts.go` (`contactToCanonical`): `{jid,
first_name, full_name, push_name, business_name, found}`.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `contacts.list` | `GET .../contacts` | |
| `contacts.get` | `GET .../contacts/{jid}` | Resposta enriquecida com `about`/`devices` (`GetContact`, confirmado): `{jid, first_name, full_name, push_name, business_name, found, about, devices: string[]}` — **`about` e `devices` vêm de graça na MESMA chamada** (`client.GetUserInfo` já popula os dois; best-effort, defaults `""`/`[]` se a consulta falhar). |
| `contacts.checkExists` | `POST .../contacts/check` | Body `{numbers: string[]}` → array `{query, jid, is_in_whatsapp, verified_name?}`. |
| `contacts.getProfilePicture` | `GET .../contacts/{jid}/picture` | → `{url, id, type, direct_path}`; 404 sem foto acessível. |
| `contacts.getAbout` | **Mesmo endpoint de `contacts.get`** | O campo `about` já vem embutido — não precisa de chamada separada (ainda que exista um método interno standalone `GetAbout`, a rota HTTP pública reaproveita `GetContact`). |
| `contacts.block` | `POST .../contacts/{jid}/block` | |
| `contacts.unblock` | `POST .../contacts/{jid}/unblock` | |
| `contacts.listBlocked` | `GET .../contacts/blocked` | → array `{jid}`. |

### `chats.*`

Todas as 8 operações são **toggles via app-state** (cada uma devolve só confirmação vazia,
`Promise<void>` — confirmado pela descrição OpenAPI citando `internal/session/chats.go` linha a
linha para cada endpoint):

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `chats.archive`/`unarchive` | `POST .../chats/{jid}/archive` | Body `{archived?: boolean}` — mesmo endpoint, direção pelo booleano. |
| `chats.mute`/`unmute` | `POST .../chats/{jid}/mute` | Body `{muted?: boolean, duration_seconds?: integer}`. |
| `chats.pin`/`unpin` | `POST .../chats/{jid}/pin` | Body `{pinned?: boolean}`. |
| `chats.markRead`/`markUnread` | `POST .../chats/{jid}/read` | Body `{read?: boolean}` — nível de CHAT inteiro (diferente de `messages.markRead`, nível de mensagem). |

**Extras além do contrato atual**: `chats/{jid}/delete` (remove da lista, não apaga do servidor),
`chats/{jid}/disappearing` (timer de mensagem temporária: `0`/`86400`/`604800`/`7776000` segundos).

### `presence.*`

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `presence.setTyping` | `POST .../presence/typing` | Body `{to, state: composing\|paused, media?: text\|audio}` — `media: audio` + `state: composing` sinaliza gravação de áudio (sem enum dedicado, mesmo padrão já visto no Wuzapi). |
| `presence.set` | `POST .../presence` | Body `{state: available\|unavailable}` — presença GLOBAL da sessão. |
| `presence.subscribe` | `POST .../presence/{jid}/subscribe` | Só registra a inscrição; o resultado chega assíncrono via evento `presence.update` (webhook) — sem evento canônico equivalente hoje (ver seção de webhooks). |

**Extra**: `GET .../presence/{jid}` (consulta o último status cacheado — `{status:"unknown"}` se
nunca inscrito/expirado, senão `{unavailable, last_seen}`) — corresponde ao `getPresence`
deliberadamente fora do escopo do contrato canônico (ver `docs/CONTEXT.md`, mesma decisão de
design já tomada para os outros 8 adapters: é assíncrono/webhook por natureza).

### `labels.*`

Modelo canônico confirmado (`internal/session/labels.go`, `labelToCanonical`): `{id, name, color}`
— `color` é o índice de paleta cru do wire (`waSyncAction.LabelEditAction.Color`), sem tradução
pra nome/hex.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `labels.list` | `GET .../labels` | Requer conta WhatsApp Business pareada. |
| `labels.create` | `POST .../labels` | Body `{name, color?}` → label criada com `id` real gerado pelo servidor. |
| `labels.update` | `POST .../labels/{labelId}` | Body `{name, color?}` → confirmação vazia `{ok:true}` (não ecoa a label atualizada). |
| `labels.delete` | `POST .../labels/{labelId}/delete` | → confirmação vazia. |
| `labels.addToChat` | `POST .../labels/{labelId}/chats/{chatId}` | → confirmação vazia. |
| `labels.removeFromChat` | `POST .../labels/{labelId}/chats/{chatId}/remove` | → confirmação vazia. |

### `channels.*`

Modelo canônico confirmado (`internal/session/channels.go`, `channelToCanonical`): `{channel_id,
name, description, subscriber_count}` — `channel_id` sempre o JID (`...@newsletter`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `channels.list` | `GET .../channels` | |
| `channels.create` | `POST .../channels` | Body `{name, description?}` → canal com `channel_id` real. |
| `channels.getInfo` | `GET .../channels/{channelId}` | |
| `channels.delete` | `POST .../channels/{channelId}/delete` | ⚠️ **Hoje devolve `501 NOT_IMPLEMENTED`** — o `whatsmeow` não expõe "apagar canal" publicamente. **Não declarar esta capability.** |
| `channels.follow` | `POST .../channels/{channelId}/follow` | → confirmação vazia. |
| `channels.unfollow` | `POST .../channels/{channelId}/unfollow` | → confirmação vazia. |
| `channels.getMessages` | `GET .../channels/{channelId}/messages` (ADR-0021) | Ver seção dedicada "Mensageria de canal" abaixo. |
| `channels.markViewed` | `POST .../channels/{channelId}/messages/viewed` (ADR-0021) | Idem. |
| `channels.reactToPost` | `POST .../channels/{channelId}/messages/{serverId}/react` (ADR-0021) | Idem. |

**Extras além do contrato atual**: `GET .../message-updates` (views/reactions sem o corpo do post —
redundante com `getMessages`, que já traz `views_count`/`reaction_counts`), `POST .../mute`
(silenciar notificações sem cancelar a inscrição).

### Mensageria de canal (`channels.getMessages`/`markViewed`/`reactToPost`, ADR-0021)

Confiança Alta — os 3 endpoints e seus schemas de request/response estão documentados
explicitamente no OpenAPI oficial (`internal/session/channels.go`, `newsletterMessageToCanonical`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `channels.getMessages` | `GET .../channels/{channelId}/messages?count&before` | Resposta `data`: array já no modelo canônico `{server_id, message_id, type, timestamp, views_count, reaction_counts, text}` — `reaction_counts` já é um mapa `emoji -> contagem` (`null` quando o post não tem reação nenhuma), sem precisar de nenhuma conversão de formato (diferente de uazapi/Whapi). `before` é um CURSOR numérico (`server_id` do post mais antigo já visto, exclusive), convertido via `Number(...)`. |
| `channels.markViewed` | `POST .../channels/{channelId}/messages/viewed` | Body `{server_ids: integer[]}` — `MarkChannelMessagesViewedInput.messageIds` convertidos via `Number(...)`. Resposta: só `{ok:true}`, sem dado adicional. |
| `channels.reactToPost` | `POST .../channels/{channelId}/messages/{serverId}/react` | `serverId` no PATH é `input.messageId` (id opaco do POST-ALVO). Body `{reaction}` — `reaction` vazia remove a reação anterior (mesma convenção de `messages.sendReaction`, ADR-0008). O campo `message_id` do body (id da MENSAGEM-REAÇÃO em si, distinto do post-alvo) é opcional — "o worker gera um" quando omitido — e não é enviado por este adapter. Resposta: `{message_id}` (o id da reação efetivamente usada), ignorada — contrato retorna `Promise<void>`. |

### `business.*`

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `business.getProfile` | `GET .../business/profile/{jid}` | Funciona também para o JID da própria sessão. Resposta rica: `{jid, address, email, categories: [{id,name}], profile_options: {...}, business_hours_timezone, business_hours: [{day_of_week, mode, open_time, close_time}]}` — arrays/mapas sempre presentes (nunca `null`). |
| `business.updateProfile` | `POST .../business/profile` | ⚠️ **Hoje devolve `501 NOT_IMPLEMENTED`** — o `whatsmeow` não expõe um "set" de perfil de negócio público (namespace `w:biz`). **Não declarar esta capability** (mesmo gap documentado no dossiê Wuzapi/Evolution — limitação real da lib subjacente, não deste provider especificamente). |

**Extras além do contrato atual**: `GET .../business/catalog/{jid}` (⚠️ também `501
NOT_IMPLEMENTED`), `POST .../business/resolve-link` (resolve link curto `wa.me/message/<code>` →
JID + metadados de verificação).

### `calls.*`

⚠️ **Diferencial real deste provider**: ao contrário de todo outro adapter deste pacote (que só
originam uma "chamada vazia" — toca, sem áudio real em nenhuma direção), o izapia tem um
`CallManager` de voz genuíno (`internal/voip/call`, `internal/voip/wa`, `internal/voip/bridge`,
`internal/voip/signaling`, confirmado lendo `internal/session/calls.go`) com sinalização real via
whatsmeow, negociação WebRTC (`POST .../calls/{callId}/webrtc`) e até gravação
(`POST .../calls/{callId}/record`, `GET .../calls/{callId}/recording`). O contrato canônico atual
(`calls.make`/`calls.reject`) não modela áudio nem esses recursos extras — mas vale registrar que a
operação, aqui, é mais "real" do que nos outros 8 adapters.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `calls.make` | `POST .../calls` | Body `{to}` → `{call_id}`. Sujeita a `429 QUOTA_EXCEEDED` (`max_concurrent_calls`). |
| `calls.reject` | `POST .../calls/{callId}/reject` | Body `{reason?}` → confirmação vazia. |

**Extras além do contrato atual**: `DELETE .../calls/{callId}` (encerra chamada em andamento),
`POST .../calls/{callId}/accept` (aceita localmente), `POST .../calls/{callId}/record` +
`GET .../calls/{callId}/recording` (grava/baixa WAV — 501 se o deployment não tiver
`RecordingsDir` configurado), `POST .../calls/{callId}/webrtc` (bridge de áudio navegador↔chamada).

## Namespaces inteiramente fora do contrato canônico (documentados, não implementar)

Confirmado existir de verdade (não são gap de pesquisa): `privacy.*` (ler/alterar 10 campos de
privacidade — `group_add`/`last_seen`/`status`/`profile`/`read_receipts`/`call_add`/`online`/
`messages`/`defense`/`stickers`), `profile.*` (alterar about/push-name da própria sessão —
distinto de `business.*`, que é perfil comercial), `status.*` (publicar/ler privacidade de status/
stories — distinto de `presence.*`), `sync.history` (pedir sincronização de histórico ao
dispositivo primário — o izapia não guarda histórico, stateless por design).

## Limites e particularidades

- **Quotas por plano do tenant** (`429 QUOTA_EXCEEDED`): `max_sessions` (criar sessão),
  `max_msgs_day` (`messages.sendText`, confirmado; outros endpoints de envio ainda não
  instrumentados segundo a própria doc), `max_concurrent_calls` (`calls.make`), `max_webhooks`
  (configurar um webhook novo).
- **`503 SESSION_NOT_READY`**: a maioria das operações de sessão é encaminhada por uma réplica de
  API ao *worker* que hospeda o client whatsmeow vivo; antes de um worker assumir a posse (lease),
  a rota responde 503. Candidato a retry no conector (mesma categoria de erro transitório já usada
  para 429/5xx genéricos).
- **Formato de identificador**: `jid`/`groupId`/`channelId`/`communityId`/`chatId` são sempre JIDs
  padrão whatsmeow (`<dígitos>@s.whatsapp.net`, `@g.us`, `@newsletter`) — mesmo formato que
  `normalizeChatId` do conector já produz; nenhuma conversão extra necessária (mesmo padrão dos
  demais adapters whatsmeow-based, Evolution GO/Wuzapi).
- **3 endpoints documentados mas não funcionais hoje** (retornam `501 NOT_IMPLEMENTED` por
  limitação real da lib `whatsmeow`, não bug do izapia): `channels.delete`,
  `business.updateProfile`, `business.getProfile`'s vizinho `catalog` (não mapeado no contrato
  canônico de qualquer forma). **Não declarar** `channels.delete`/`business.updateProfile` como
  capabilities suportadas.
- **SSE como transporte alternativo**: `GET /api/v1/events` expõe os mesmos eventos canônicos via
  Server-Sent Events (fan-out Redis pub/sub) — alternativa ao webhook HTTP, fora de escopo do
  contrato `WaAdapter` atual (que só modela `parseWebhook`, não um cliente de streaming).
