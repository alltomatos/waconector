# Dossiê: WAHA

- Docs oficiais: <https://waha.devlike.pro/> (Swagger: <https://waha.devlike.pro/swagger/openapi.json>)
- Versão testada: documentação consultada em 2026-07-10
- Hospedagem: self-hosted (imagem Docker; sem SaaS multi-tenant — o `servers` do OpenAPI é o
  template `{protocol}://{host}:{port}/{baseUrl}`, padrão `http://localhost:3000`)

## Autenticação

- Mecanismo: `apiKey` via header customizado, **não** `Authorization: Bearer`.
- Header: **`X-Api-Key: <chave>`** (confirmado em `components.securitySchemes` do OpenAPI real:
  `{"api_key": {"type": "apiKey", "in": "header", "name": "X-Api-Key"}}`; toda operação documentada
  declara `"security": [{"api_key": []}]`).
- Alternativa apenas para contextos sem controle de headers (ex.: `<img src>`): query param
  minúsculo `?x-api-key=<chave>` — documentação recomenda usá-la só com chaves restritas
  (escopo por sessão), nunca com a chave admin (vaza em logs/Referer).
- Chave global: variável de ambiente `WAHA_API_KEY` no servidor (gerada aleatoriamente no boot se
  omitida — checar logs do container). Pode ser desabilitada com `WAHA_API_KEY=` +
  `WAHA_NO_API_KEY=true` (não recomendado).
- **Token global vs por sessão**: existe um único par chave-servidor (admin, `isAdmin:true`,
  acesso total) e uma Keys API (`POST/GET/PUT/DELETE /api/keys`) para emitir chaves adicionais
  escopadas a uma sessão específica (`isAdmin:false`, `session:'<nome>'`) com permissões
  granulares booleanas (`read`, `send`, `control`, `setting`, `app`, `delete`, todas `true` por
  padrão se `actions` for omitido). Útil para emitir credenciais de menor privilégio a clientes de
  um deployment multi-tenant do waconector. Fase F1 do adapter usa apenas uma chave simples
  (`apiKey` em `WahaOptions`), seja ela a global ou uma escopada — o adapter não distingue.
- Inconsistência observada na spec: a operação `GET /api/sessions` lista adicionalmente um esquema
  `oauth2` em `security`, mas nenhum esquema `oauth2` é definido em `components.securitySchemes` —
  parece artefato de geração da spec. Na prática só `X-Api-Key` é utilizável.

## Modelo de instância/sessão

- Termo do provider: **session** (uma sessão = um número de WhatsApp conectado nesta instância do
  WAHA). "Instance" não é vocabulário do WAHA. Existe um recurso separado chamado "channels" no
  WAHA, mas refere-se a WhatsApp Channels (listas de transmissão), não ao conceito de
  instância/conta — não confundir.
- **Criar**: `POST /api/sessions` — body `SessionCreateRequest`: `{ name?, start? (padrão true),
  apps?, config? }`. `config` carrega webhooks, proxy, metadata, regras de ignore, configs por
  engine (noweb/gows/webjs), nome do device, debug. Resposta é `SessionInfo` com
  `status:'STARTING'`.
- **(Re)iniciar** uma sessão parada: `POST /api/sessions/{session}/start` (idempotente, por doc).
- **Atualizar**: `PUT /api/sessions/{session}` (apps/config). **Deletar**:
  `DELETE /api/sessions/{session}`.
- **Conectar/parear** (uma vez que `status` vira `SCAN_QR_CODE`):
  - QR code: `GET /api/{session}/auth/qr?format=image|raw`. `format=image` devolve PNG binário;
    `format=raw` devolve JSON — `{ value: <string do QR> }` OU `{ mimetype, data (base64) }`
    (documentação não fecha qual das duas formas é a real; adapter trata ambas).
  - Pareamento por código: `POST /api/{session}/auth/request-code` — body
    `{ phoneNumber: '<intl sem +>', method?: 'sms'|'voice' (omitir = pareamento via app) }`.
    A prosa da doc mostra resposta `{ "code": "ABCD-ABCD" }`, mas o schema OpenAPI só declara
    `201` sem corpo — gap real entre as duas fontes oficiais. **Fora do escopo desta fase**: o
    contrato `InstanceApi.connect()` não recebe telefone, então o fluxo de pairing code não é
    exposto por este adapter em F1 (ver seção "Capabilities" abaixo).
  - Docs recomendam manter o QR sempre como fallback, já que o pairing code "nem sempre está
    disponível".
- **Status**: `GET /api/sessions/{session}` → `SessionInfo { name, status, me, config,
  assignedWorker, presence, timestamps }`. Também empurrado em tempo real via evento/webhook
  `session.status`.
- Valores de `status`: `STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED`.
- **Logout**: `POST /api/sessions/{session}/logout` (revoga o device vinculado; a sessão precisa
  de novo QR/pairing code). `POST /api/sessions/{session}/stop` para/hiberna o engine sem
  deslogar (pode reiniciar com `/start` e continua vinculado). `POST /api/sessions/{session}/restart`.
  Existem variantes legadas sem `{session}` no path (`POST /api/sessions/start|stop|logout`, nome
  no body) marcadas `deprecated:true` — o adapter usa sempre as rotas com `{session}` no path.

## Capabilities implementadas nesta fase (F1)

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `webhooks.parse`.

`instance.pairingCode` **não** foi declarada nesta fase: embora o WAHA suporte pareamento por
código (`POST /api/{session}/auth/request-code`), o método `InstanceApi.connect()` do contrato
não recebe um número de telefone como parâmetro, então não há como expor esse fluxo sem alterar o
contrato central — fica para uma fase futura (possível extensão do contrato). `instance.connect()`
usa exclusivamente o fluxo de QR code.

## Capability adicional: `messages.sendReaction` (retrofit F2, ADR-0008)

`messages.sendReaction` foi adicionada a este adapter num retrofit posterior à F1 (ADR-0008 —
`reply/quote` e `reactions` entraram no core nesta fase; ver `docs/CONTEXT.md`). Suportado: ver
seção "Reações" abaixo e a entrada correspondente na tabela de "Operações core".

## Capabilities adicionais: `groups.*` (retrofit F2, ADR-0009)

As 7 capabilities de `GroupsApi` (`groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`) foram adicionadas a este adapter num retrofit posterior à F1
(ADR-0009 — núcleo + participantes de grupo entraram no core nesta fase; ver `docs/CONTEXT.md`).
Suportado: ver seção "Grupos (núcleo)" abaixo.

Mais 3 capabilities de configuração de grupo (`groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`) foram adicionadas num retrofit posterior. Suportado: ver seção "Grupos:
configuração (updateSubject/updateDescription/updatePicture)" abaixo.

Mais 4 capabilities de convite/saída de grupo (`groups.getInviteLink`, `groups.revokeInviteLink`,
`groups.joinViaInviteLink`, `groups.leaveGroup`) foram adicionadas num retrofit posterior.
Suportado: ver seção "Grupos: convite e saída
(getInviteLink/revokeInviteLink/joinViaInviteLink/leaveGroup)" abaixo.

## Capability adicional: `contacts.*` — descoberta + perfil (retrofit F2, ADR-0010, PR1)

As 5 capabilities de descoberta/perfil de `ContactsApi` (`contacts.list`, `contacts.get`,
`contacts.checkExists`, `contacts.getProfilePicture`, `contacts.getAbout`) foram adicionadas a
este adapter num retrofit posterior (ADR-0010, PR1 — moderação `block`/`unblock`/`listBlocked`
fica para o PR2). Suportado: ver seção "Contatos" abaixo.

## Capabilities adicionais: `messages.edit`/`messages.delete` e `chats.*` (retrofit ADR-0012)

Pesquisa dedicada de 2026-07-12 (mesma metodologia das anteriores — `openapi.json` oficial +
páginas `docs/how-to/`) confirmou, com confiança **Alta**, endpoints para `messages.edit`,
`messages.delete` e 4 das 8 operações do novo namespace `chats.*` (`archive`, `unarchive`,
`markRead`, `markUnread`). As outras 4 (`chats.mute`, `chats.unmute`, `chats.pin`, `chats.unpin`)
**não** foram declaradas — busca exaustiva não encontrou endpoint de silenciar/fixar a CONVERSA
(distinto de fixar uma MENSAGEM dentro do chat, que existe e é discutido abaixo). Suportado: ver
seções "Edição e exclusão de mensagem" e "Conversas (`chats.*`)" abaixo.

## Capabilities adicionais: `messages.forward`/`star`/`unstar`/`pin`/`unpin`/`markRead` (ADR-0013)

Continuação da pesquisa acima, cobrindo o restante da fila de capabilities novas pós-Epic 7. Todas
as 6 confirmadas com confiança **Alta** (mesmas fontes: `openapi.json` oficial + páginas
`docs/how-to/`). Ver seção "Ações sobre mensagem (`messages.forward`/`star`/`unstar`/`pin`/`unpin`/
`markRead`, ADR-0013)" abaixo.

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| instance.connect | `POST /api/sessions/{session}/start` seguido de `GET /api/{session}/auth/qr?format=raw` | Inicia/garante a sessão e devolve o QR cru em `ConnectResult.qr`. Se a sessão ainda não estiver em `SCAN_QR_CODE` (ex.: já `WORKING`), o `GET` do QR pode devolver erro do provider — propagado como `WaConnectorError` normalmente (nenhuma lógica de polling nesta fase). |
| instance.status | `GET /api/sessions/{session}` | Mapeia `status` → `InstanceState` (tabela abaixo). |
| instance.logout | `POST /api/sessions/{session}/logout` | Sem corpo de resposta relevante. |
| messages.sendText | `POST /api/sendText` | Body `{ chatId, text, session, reply_to?, mentions? }`. Destinatário em `chatId` (JID), não `phone`. `mentions` (recurso real da doc oficial, "Mention contact" — ausente do schema OpenAPI de `MessageTextRequest`, gap doc-vs-schema do próprio WAHA) é enviado quando `SendTextInput.mentions` vem preenchido; cada entrada passa por `toWahaChatId`, exceto o valor especial `"all"` (mencionar todo mundo no grupo), repassado intacto. |
| messages.sendMedia | `POST /api/sendImage` \| `/api/sendFile` \| `/api/sendVideo` \| `/api/sendVoice` (endpoint por tipo de mídia, não genérico) | Body base `{ chatId, file: {mimetype, filename?, url} \| {mimetype, filename?, data(base64)}, session, reply_to? }`. Mapeamento de `MediaKind`: `image→sendImage`, `video→sendVideo`, `audio→sendVoice`, `document→sendFile`. `sticker` não tem endpoint documentado no dossiê original — o adapter usa `sendFile` como fallback best-effort (assumido, não confirmado contra instância real). **Exceções por endpoint** (confirmadas no `openapi.json` real): `caption` é omitido (não apenas `undefined` — a chave nem é enviada) para `sendVoice`, cujo schema `MessageVoiceRequest` não declara essa propriedade; `convert: false` é enviado como default explícito para `sendVideo`/`sendVoice`, cujos schemas marcam `convert` como `required` e `SendMediaInput` não expõe essa opção ao chamador (a confirmar contra instância real se o servidor de fato exige o campo). |
| messages.sendReaction | `PUT /api/reaction` | Ver seção "Reações" abaixo. |

### Mapeamento de status → `InstanceState`

| WAHA `status` | `InstanceState` |
| --- | --- |
| `STOPPED` | `disconnected` |
| `STARTING` | `connecting` |
| `SCAN_QR_CODE` | `qr` |
| `WORKING` | `connected` |
| `FAILED` | `disconnected` (escolha do adapter: sessão com falha é tratada como desconectada; não há um estado "erro" dedicado em `InstanceState`) |
| qualquer outro valor não reconhecido | `unknown` (fallback seguro, nunca lança) |

### Mapeamento de `chatId` canônico → WAHA

O conector já normaliza o `to` recebido do usuário antes de chamar o adapter (`normalizeChatId`):
telefone vira só-dígitos (E.164 sem `+`), JIDs explícitos passam intactos. O adapter converte:

| Entrada canônica | Saída WAHA |
| --- | --- |
| Telefone só-dígitos, ex. `5585999999999` | `5585999999999@c.us` |
| JID já com `@` reconhecido pelo WAHA (`@c.us`, `@g.us`, `@newsletter`, `@broadcast`) | passa intacto |
| JID `@lid` | passa intacto (o adapter não valida/bloqueia), **mas a doc oficial do WAHA desaconselha explicitamente usar `@lid` como `chatId` de envio** — não é equivalente em segurança aos demais formatos desta tabela |
| JID no formato interno de engine `<numero>@s.whatsapp.net` | convertido para `<numero>@c.us` (per doc: esse formato "deve ser convertido para `@c.us` antes de usar como chatId — não enviar diretamente para `@s.whatsapp.net`") |

Nota: a doc recomenda usar `GET /api/checkNumberStatus` antes de enviar para números brasileiros
(ambiguidade do 9º dígito). Essa checagem **não** está implementada nesta fase (fora do escopo de
F1: `instance.connect/status/logout`, `messages.sendText/sendMedia`, `webhooks.parse`); o adapter
apenas converte o formato, sem validar a existência do número.

### Reações (`messages.sendReaction`, retrofit F2, ADR-0008)

Confirmado no `openapi.json` oficial (operationId `ChattingController_setReaction`, tag "📤
Chatting") e na página dedicada "Adding Emoji Reactions to Messages" da doc (`waha.devlike.pro/docs/how-to/send-messages/`):

- Endpoint: **`PUT /api/reaction`** — não `POST`. A própria doc alerta explicitamente: "Reaction
  API uses PUT, not POST request! Please make sure you send right request." (uma tabela de prosa
  na mesma página lista o endpoint como "POST /api/reaction", o que é inconsistente com o
  `openapi.json` e com a seção dedicada — tratado como erro de digitação da tabela; o adapter usa
  `PUT`, conforme o schema e a seção específica).
- Body (schema `MessageReactionRequest`): `{ session, messageId, reaction }`. Não existe campo
  `chatId` separado — a mensagem-alvo (e portanto o chat) é resolvida a partir do `messageId`
  (JID completo da mensagem, ex.: `"false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA"`). O adapter não
  envia `input.to` no body; ele só é usado para popular `SentMessage.chatId` via `mapSentMessage`
  no fallback em que a resposta não ecoa o destinatário (mesmo padrão de sendText/sendMedia).
- Emoji vai no campo **`reaction`** (não `emoji`).
- Remoção: enviar `reaction: ""` (string vazia) remove uma reação enviada antes — documentado
  explicitamente ("To remove reaction from a message - send empty string in the reaction
  request"), consistente com a convenção do contrato central (ADR-0008,
  `SendReactionInput.emoji === ''`). Diferente da Z-API (dois endpoints distintos, um para enviar e
  outro para remover), o WAHA usa um único endpoint para os dois casos.
- Resposta: `200`, corpo tipado genericamente como `object` no `openapi.json` (schema vazio, sem
  campos documentados). `mapSentMessage` cai no mesmo fallback usado para respostas sem shape
  confirmado: `id` vira `waha-<timestamp>` e `chatId` vira o `chatId` convertido de `input.to`.
- Suportado nas engines WEBJS, WPP, GOWS e NOWEB, segundo a tabela de capabilities da doc. Sem
  restrição documentada limitando reações a mensagens só-recebidas ou só-enviadas.
- Sem `idempotent: true` na chamada HTTP (mesma regra de sendText/sendMedia — ver ADR-0007):
  reenviar após um `NETWORK_ERROR` poderia alternar/duplicar a reação de forma indevida.
- **Não confirmado nesta pesquisa**: shape do webhook de reação recebida. Fora de escopo desta
  adição — `messages.sendReaction` cobre só o envio; `parseWahaWebhook` continua sem mapear
  `event: "message.reaction"` (webhook de reação recebida cai em `unknown`, como já documentado na
  seção "Webhooks" abaixo).

## Grupos (núcleo)

Suporte completo às 7 operações de `GroupsApi` (ADR-0009), confirmado no `openapi.json` oficial
(tag "📁 Groups"). Todas as 7 capabilities (`groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`) são declaradas por este adapter.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST /api/{session}/groups` | Body: `{ name, participants: [{ id }] }` — cada participante é um **objeto** `{ id }`, não uma string crua. Resposta `201` **sem schema declarado** na doc oficial (gap do próprio WAHA) — quando a resposta não ecoa `subject`/`participants`, o adapter cai de volta para os valores de entrada (mesmo padrão de `mapSentMessage`: `chatId ?? requestedNumber`). Sem fallback possível para `id` (não existe antes da criação); se a resposta não trouxer `id`, o adapter gera um placeholder `waha-group-<timestamp>`. |
| `groups.getInfo` | `GET /api/{session}/groups/{id}` | `{id}` é o `groupId` convertido para `<dígitos>@g.us` (ver abaixo). Resposta (schema `GroupInfo`, **inferido** por cross-reference com o webhook `group.v2.join`, mesma forma): `{ id, subject, description, invite, membersCanAddNewMember, membersCanSendMessages, newMembersApprovalRequired, participants: [{ id, pn?, role }] }`. **Não tem campo `owner`/dono explícito** — `GroupInfo.owner` fica sempre `undefined` para este provider. |
| `groups.list` | `GET /api/{session}/groups` | Query params opcionais existem (`sortBy`/`sortOrder`/`limit`/`offset`/`exclude`) mas não são obrigatórios — o adapter chama sem nenhum. Resposta documentada genericamente como `object` ("depende da engine") — o adapter trata o corpo como array e mapeia cada item no mesmo shape de `getGroupInfo`; se a resposta não vier como array, devolve lista vazia. |
| `groups.addParticipants` | `POST /api/{session}/groups/{id}/participants/add` | Body: `{ participants: [{ id }] }` (mesmo formato objeto de `create`). |
| `groups.removeParticipants` | `POST /api/{session}/groups/{id}/participants/remove` | Mesmo body shape. |
| `groups.promoteParticipants` | `POST /api/{session}/groups/{id}/admin/promote` | Mesmo body shape. **Rota é `/admin/promote`, não `/participants/promote`** — desvio de nomenclatura confirmado na doc oficial. |
| `groups.demoteParticipants` | `POST /api/{session}/groups/{id}/admin/demote` | Mesmo body shape. Rota é `/admin/demote`, mesmo padrão de `promote`. |

### Mapeamento de `groupId` (path `{id}`)

`GroupInfo.id` é um identificador **opaco** (ADR-0009): o conector **não** normaliza `groupId` com
`normalizeChatId` (diferente do `to` de mensagens), porque outros providers (Z-API) usam um ID
sintético sem `@` que seria corrompido por essa normalização. Para o WAHA especificamente, o
formato nativo de grupo é um JID **`<dígitos>@g.us`** — o mesmo domínio `@g.us` já reconhecido por
`toWahaChatId` para `chatId` de mensagem. Ainda assim, o adapter usa uma função dedicada
(`toWahaGroupId`), não `toWahaChatId`: `toWahaChatId` assume `@c.us` como domínio padrão para
entradas sem `@`, o que produziria `<dígitos>@c.us` (incorreto) para um grupo. `toWahaGroupId`
passa a entrada intacta se já tiver `@`, senão acrescenta `@g.us`.

## Grupos: configuração (`updateSubject`/`updateDescription`/`updatePicture`)

3 operações opcionais de `GroupsApi` que alteram metadados de um grupo já existente. Diferente das
7 operações de "Grupos (núcleo)" acima, a pesquisa para estas 3 não foi validada contra uma
instância WAHA real — baseada só no `openapi.json` oficial (tag "📁 Groups"). Todas as 3 retornam
`Promise<void>`: o adapter dispara a chamada HTTP e não processa a resposta.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.updateSubject` | `PUT /api/{session}/groups/{id}/subject` | Body: `{ subject }`. Resposta **sem schema declarado** na doc oficial (mesmo gap já visto em `groups.create`) — não processada. |
| `groups.updateDescription` | `PUT /api/{session}/groups/{id}/description` | Body: `{ description }`. Mesma observação de resposta sem schema. `description: ''` é um caso válido (limpa a descrição do grupo) — já validado pelo conector (`UpdateGroupDescriptionInput.description` aceita string vazia), o adapter apenas repassa. |
| `groups.updatePicture` | `PUT /api/{session}/groups/{id}/picture` | Body: `ProfilePictureRequest = { file }`, onde `file` é um `RemoteFile { mimetype, filename?, url }` ou `BinaryFile { mimetype, filename?, data (base64) }` — o mesmo shape de `file` já usado por `messages.sendMedia` (`buildWahaFile`), reaproveitado com um mimetype-padrão diferente: `'image/jpeg'` em vez de `'application/octet-stream'`, já que grupos só aceitam foto (`UpdateGroupPictureInput.media.kind` é sempre `'image'`, garantido pelo conector). Resposta documentada como `Result = { success: boolean }` — **ignorada de propósito**: o contrato retorna `void` e a doc não deixa claro o que fazer quando `success: false`; tratado como sucesso silencioso, mesmo padrão de "pode retornar `false` silenciosamente" já observado em `updateSubject`/`updateDescription` (nenhum dos dois declara um campo de sucesso/erro no schema de resposta). |

`{id}` no path segue exatamente o mesmo mapeamento de `groupId` já usado pelas 7 operações núcleo
(`toWahaGroupId`, ver seção "Mapeamento de `groupId`" acima) — nenhuma conversão nova foi
introduzida. O path é montado pela mesma função auxiliar já usada por
`addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants`
(`groupParticipantsPath`, que apesar do nome é genérica o bastante para qualquer suffix sob
`/groups/{id}/`).

**Não confirmado nesta pesquisa** (a validar contra uma instância WAHA real):

- Se `PUT .../subject`/`PUT .../description` exigem que o bot seja admin do grupo (comportamento
  esperado do WhatsApp, mas não documentado explicitamente pelo WAHA).
- O shape exato da resposta de sucesso de `subject`/`description` (a doc não declara schema) — o
  adapter assume que qualquer `2xx` sem corpo relevante é sucesso, na falta de informação melhor.
- Se há um limite de tamanho de imagem para `updatePicture` (o WhatsApp historicamente exige
  imagens quadradas/recortadas; o adapter não faz nenhuma validação ou transformação de imagem,
  apenas repassa `media` como veio).

### Mapeamento de participantes

- **Na requisição** (`create`, `addParticipants`, `removeParticipants`, `promoteParticipants`,
  `demoteParticipants`): participantes individuais, ao contrário do `groupId`, **já chegam
  normalizados pelo conector** (telefone vira só-dígitos, JID passa intacto) — mesma convenção de
  um `to` de mensagem comum. O adapter reaproveita `toWahaChatId` (já usado por
  `sendText`/`sendMedia`/`sendReaction`) para cada participante, e envolve o resultado no formato
  objeto `{ id }` que os 5 endpoints de grupo esperam (`toWahaParticipants`).
- **Na resposta** (`getInfo`/`list`): cada participante pode vir como `@lid` (formato de privacidade
  introduzido pelo WhatsApp) na propriedade `id`, com o formato "real" `@c.us` disponível
  separadamente em `pn`. O adapter prefere `pn` quando presente, caindo para `id` apenas quando
  `pn` está ausente. `role` (`'left' | 'participant' | 'admin' | 'superadmin'`) mapeia para
  `GroupParticipant.isAdmin` (`'admin'` ou `'superadmin'`) e `isSuperAdmin` (`'superadmin'`).

## Grupos: convite e saída (`getInviteLink`/`revokeInviteLink`/`joinViaInviteLink`/`leaveGroup`)

4 operações opcionais de `GroupsApi` (ADR-0009) para o ciclo de vida do link de convite e para
entrar/sair de um grupo. Baseadas no `openapi.json` oficial (tag "📁 Groups") — **não validadas
contra uma instância WAHA real**, mesmo status de confiança de "Grupos: configuração" acima.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.getInviteLink` | `GET /api/{session}/groups/{id}/invite-code` | Sem body. Resposta: **STRING PURA** (schema `type: string` no openapi.json, não um objeto) — o CÓDIGO bare do convite. A doc explicita: "then you can put it in the url `https://chat.whatsapp.com/{inviteCode}`". O adapter monta o link completo com `normalizeInviteLink` antes de devolver em `GroupInviteLink.link`. |
| `groups.revokeInviteLink` | `POST /api/{session}/groups/{id}/invite-code/revoke` | Sem body. Resposta: mesmo shape de `getInviteLink` (string pura), presumivelmente o novo código bare — mesma conversão com `normalizeInviteLink`. |
| `groups.joinViaInviteLink` | `POST /api/{session}/groups/join` | Body: `{ code }`. A doc mostra exemplos aceitando tanto o código bare quanto o link completo (`https://chat.whatsapp.com/invitecode`) em `code`. Como o conector sempre entrega `input.invite` já normalizado como link completo (`WaConnector.prepareJoinViaInviteLink`), o adapter repassa `input.invite` direto em `code`, **sem** `extractInviteCode` — desnecessário já que o provider aceita os dois formatos. Resposta: `{ id }` (id do grupo ingressado) — ignorada, o contrato retorna `void`. |
| `groups.leaveGroup` | `POST /api/{session}/groups/{id}/leave` | Sem body, sem schema de resposta relevante — `void`. |

`{id}` em `getInviteLink`/`revokeInviteLink`/`leaveGroup` segue o mesmo mapeamento de `groupId` já
usado pelas demais operações de grupo (`toWahaGroupId`, ver seção "Mapeamento de `groupId`"
acima) — mesma função auxiliar `groupParticipantsPath` reaproveitada (suffixes `invite-code`,
`invite-code/revoke`, `leave`). `groups.join` (usado por `joinViaInviteLink`) não leva `groupId` no
path — é o único dos 4 endpoints desta seção sem `{id}`, já que o grupo é identificado pelo próprio
código/link do convite.

**Não confirmado nesta pesquisa** (a validar contra uma instância WAHA real):

- O shape exato de `invite-code`/`invite-code/revoke` quando o `content-type` da resposta não é
  `application/json` (a doc declara `type: string` no schema, mas não deixa claro se o transporte é
  JSON-com-aspas ou texto puro) — o adapter trata os dois casos da mesma forma (`HttpClient.request`
  já desembrulha ambos para uma `string` JS antes de chegar ao mapeamento).
- Se `groups.join` exige que o link/código ainda seja válido (não revogado) e o comportamento
  exato de erro quando o convite expirou ou o bot já é membro do grupo.
- Se o bot precisa ser admin do grupo para `revokeInviteLink` (comportamento esperado do WhatsApp,
  não documentado explicitamente pelo WAHA).

## Contatos (`contacts.*`, retrofit F2, ADR-0010, PR1 + PR2 moderação)

7 das 8 operações de `ContactsApi` são declaradas por este adapter: as 5 de descoberta/perfil
(`list`, `get`, `checkExists`, `getProfilePicture`, `getAbout`, PR1) mais `block`/`unblock`
(moderação, PR2 — ver seção "Moderação" abaixo). `listBlocked` fica de fora: o WAHA não tem
endpoint nativo de listagem de bloqueados (ver seção "Moderação" para o detalhe da busca).

Regra de ouro desta capability (ADR-0010): cada operação mapeia para **UMA ÚNICA chamada HTTP** —
nunca compõe múltiplas requisições atrás de uma operação canônica. Quando o endpoint mais próximo
não traz um campo, ele fica `undefined` no tipo normalizado (limitação documentada, não bug).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `contacts.list` | `GET /api/contacts/all` | Query: `{ session }`. Resposta: array no schema `WWebJSContact` (`id`, `number`, `name`, `pushname`, `shortName`, `isMe`, `isGroup`, `isWAContact`, `isMyContact`, `isBlocked`). `id`/`number` já vêm em formato `@c.us`, mas passam por `toWahaChatId` (a MESMA conversão usada por `sendText`/`sendMedia`/`groups.*`) para garantir o formato canônico consistente mesmo se um dos dois campos vier sem domínio. **Sem `about`/`profilePictureUrl` neste endpoint** — ficam `undefined` (endpoints próprios, ver `getAbout`/`getProfilePicture` abaixo). |
| `contacts.get` | `GET /api/contacts` | Query: `{ contactId, session }`. A doc aceita `contactId` como dígitos ou `@c.us`, mas o adapter sempre envia o formato `@c.us` (canônico do provider) via `toWahaChatId`. Mesmo shape de resposta de `list`, um objeto só — mesmo mapeamento, mesma limitação de `about`/`profilePictureUrl` ausentes. |
| `contacts.checkExists` | `GET /api/contacts/check-exists` | Query: `{ phone, session }`. **Diferente de `get`**: este endpoint quer o telefone em DÍGITOS, não `@c.us` — `toWahaPhoneDigits` reaproveita `toWahaChatId` (chega a um JID canônico, tratando os mesmos casos de domínio: `@s.whatsapp.net` → `@c.us`, JIDs já reconhecidos intactos) e então corta a parte antes do `@`. Resposta (schema `WANumberExistResult`): `{ numberExists: boolean, chatId?: string }` → `numberExists` vira `exists`; `chatId` (quando presente) passa por `toWahaChatId` pela mesma razão de canonicalização de `list`/`get`, e fica `undefined` quando o provider não o devolve (comum quando `numberExists` é `false`). |
| `contacts.getProfilePicture` | `GET /api/contacts/profile-picture` | Query: `{ contactId, session }` (`refresh` é opcional, default `false` na doc — omitido, sem necessidade de forçar refresh nesta operação). Resposta: `{ profilePictureURL: string \| null }` → `null` (privacidade do contato não permite) mapeia para `url: undefined`, não erro. |
| `contacts.getAbout` | `GET /api/contacts/about` | Query: `{ contactId, session }`. Resposta: `{ about: string \| null }` → `null` (privacidade não permite) mapeia para `about: undefined`, não erro. |
| `contacts.block` | `POST /api/contacts/block` | Body (schema `ContactRequest`): `{ contactId, session }`, `contactId` via `toWahaChatId` (mesma conversão de `get`/`getProfilePicture`/`getAbout`). Resposta: `201`, sem schema de conteúdo declarado — ignorada, contrato retorna `void`. |
| `contacts.unblock` | `POST /api/contacts/unblock` | Mesmo shape de body/resposta de `block`. |

### Moderação (`block`/`unblock`/`listBlocked`, PR2)

`block` e `unblock` são simétricos: mesmo endpoint `ContactRequest` (`{ contactId, session }`), só
muda o path (`/api/contacts/block` vs `/api/contacts/unblock`). Ambos devolvem `201` sem schema de
conteúdo — o adapter ignora o corpo da resposta, mesmo padrão já usado em `groups.updateSubject`/
`groups.leaveGroup` (endpoint sem shape de resposta relevante).

**`contacts.listBlocked` NÃO é implementado nem declarado.** Busca exaustiva no `openapi.json`
oficial (18 tags) não encontrou nenhuma rota "blocklist"/"blocked" — e a tabela de features da doc
oficial do WAHA lista exatamente 7 operações de contato (as 5 de descoberta/perfil + `block` +
`unblock`), sem nenhuma de "listar bloqueados". A rota mais próxima é `GET /api/contacts/all`, cujo
schema `WWebJSContact` traz um campo `isBlocked` por contato individual (já usado por
`contacts.list`/`contacts.get`, ver `mapContact`) — em tese daria para reconstruir a lista de
bloqueados client-side filtrando por `isBlocked: true`. Isso **não conta** como um endpoint nativo
de `listBlocked`: seguindo a mesma regra já aplicada a `uazapi`/`contacts.getAbout` (feature
ausente não vira "quase-suporte" via composição de outra chamada — ver ADR-0010, regra de UMA
ÚNICA chamada HTTP por operação), a capability `contacts.listBlocked` não é declarada e o método
não é implementado neste adapter. Um consumidor que precise dessa lista deve chamar
`contacts.list()` e filtrar por `isBlocked` no próprio código, fora do contrato do waconector.

### Campos de `Contact` que este provider NÃO preenche numa única chamada

- `about` e `profilePictureUrl` ficam **sempre `undefined`** em `contacts.list`/`contacts.get` —
  o WAHA expõe esses dois campos só via endpoints dedicados (`getAbout`/`getProfilePicture`), e a
  regra de ouro do ADR-0010 proíbe compor uma segunda chamada HTTP para completá-los. Um consumidor
  que precise dos dois campos deve chamar `getProfilePicture`/`getAbout` separadamente para o
  `chatId` de interesse.
- `hasWhatsApp` mapeia de `isWAContact` (presente em `list`/`get`) — este SIM é preenchido numa
  única chamada, diferente de outros providers pesquisados (ex.: Evolution GO/Wuzapi não devolvem
  isso no endpoint mais próximo).

### Mapeamento de `chatId`/`phone` em `contacts.*`

Reaproveita a mesma função `toWahaChatId` já usada por `messages.*`/`groups.*` (ver seção
"Mapeamento de `chatId` canônico → WAHA" acima) — nenhuma conversão nova foi introduzida:

- `get`/`getProfilePicture`/`getAbout`/`block`/`unblock`: `chatId` canônico (já normalizado pelo
  conector via `normalizeChatId`) → `toWahaChatId` → `contactId` no formato `@c.us` (query em
  `get`/`getProfilePicture`/`getAbout`, body `ContactRequest` em `block`/`unblock`).
- `checkExists`: `phone` canônico → `toWahaChatId` → `toWahaPhoneDigits` extrai só a parte antes do
  `@` → query `phone` em dígitos crus (o único dos 5 endpoints que quer o telefone sem domínio).
- `list`/`get` (map-in): `id`/`number` da resposta → `toWahaChatId` (mesma função, agora aplicada
  ao valor vindo do provider) → `Contact.id` sempre em formato `@c.us` canônico, mesmo se `number`
  vier sem domínio.

**Não confirmado nesta pesquisa** (a validar contra uma instância WAHA real):

- Se `contactId` aceita de fato dígitos crus (sem `@c.us`) em `get`/`getProfilePicture`/`getAbout`
  como a prosa da doc sugere — o adapter sempre envia `@c.us` (formato confirmado), então essa
  ambiguidade não afeta o comportamento do adapter.
- O shape exato de `WWebJSContact` quando o contato é um `@lid` (formato de privacidade) — a
  pesquisa não encontrou um exemplo de resposta nesse caso específico, diferente do que já é
  documentado para participantes de grupo (campo `pn`, ver "Mapeamento de participantes" acima).

## Edição e exclusão de mensagem (`messages.edit`/`messages.delete`, retrofit ADR-0012)

Confiança **Alta** para os dois — schema OpenAPI e prosa da doc concordam, com exemplo curl
completo em `docs/how-to/send-messages/` e `docs/how-to/chats/` (pesquisa de 2026-07-12).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.edit` | `PUT /api/{session}/chats/{chatId}/messages/{messageId}` | Confirmado no `openapi.json` oficial (operationId `ChatsController_editMessage`, schema `EditMessageRequest`). Body: `{ text }`. O schema também aceita `linkPreview`/`linkPreviewHighQuality` opcionais (mesma semântica de `sendText`), mas `EditMessageInput` do contrato canônico não expõe esses campos ao chamador, então o adapter não os envia — mesma regra de "não inventar campo fora do contrato" já seguida em `sendMedia`/`convert`. A doc confirma explicitamente: "You can edit text messages or 'caption' in media messages" — dá para editar a legenda de uma mídia já enviada, não só texto puro. Resposta `200` sem schema de conteúdo — `mapSentMessage` cai no mesmo fallback já usado por `sendReaction` (`id` vira `waha-<timestamp>` se a resposta não ecoar). |
| `messages.delete` | `DELETE /api/{session}/chats/{chatId}/messages/{messageId}` | Confirmado no `openapi.json` oficial (operationId `ChatsController_deleteMessage`). Sem body, sem schema de resposta relevante — contrato retorna `void`. |

`{chatId}`/`{messageId}` no path passam por `toWahaChatId`/`encodeURIComponent` respectivamente
(função auxiliar `messagePath`, que reaproveita `chatPath` — ver seção "Conversas (`chats.*`)"
abaixo). `messageId` já vem no formato de JID de mensagem que o WAHA usa em toda a API
(`{fromMe}_{chat}_{message_id}[_{participant}]`, ex.:
`true_5585999999999@c.us_AAAAAAAAAAAAAAAAAAAA`) — a doc chama atenção explicitamente para escapar
`@` (`%40`) tanto em `chatId` quanto em `messageId` ("👉 Remember to escape @ in chatId and
messageId with %40"), o que `encodeURIComponent` já cobre para os dois.

**Não confirmado nesta pesquisa** (a validar contra uma instância WAHA real):

- **Sem janela de tempo documentada para `messages.edit`.** O WhatsApp real limita edição a ~15
  minutos após o envio e só para mensagens próprias — nenhuma das duas fontes oficiais do WAHA
  menciona essa restrição nem um código de erro específico para "prazo expirado". Fica a cargo do
  engine subjacente devolver erro nesse caso; o adapter não valida nenhum prazo localmente.
- **Sem distinção documentada em `messages.delete` entre "apagar só localmente" vs. "apagar para
  todos" (revoke).** Não há parâmetro `everyone`/`forEveryone` no schema, nem prosa que descreva o
  comportamento exato — diferente de outros providers pesquisados (ex.: Evolution GO/Wuzapi/
  QuePasa confirmam em código que é sempre revogação). `DeleteMessageInput` do contrato canônico
  não carrega campo de escopo (ver ADR-0012), então esta ambiguidade não afeta a assinatura do
  adapter, só o comportamento real em runtime (a confirmar).

## Ações sobre mensagem (`messages.forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`, ADR-0013)

Continuação da pesquisa de `messages.edit`/`delete` acima. Confiança **Alta** para as 6, mesmas
fontes (`openapi.json` oficial + páginas `docs/how-to/`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.forward` | `POST /api/forwardMessage` | Confirmado no `openapi.json` (operationId `ChattingController_forwardMessage`, schema `MessageForwardRequest`). Body: `{chatId, messageId, session}` — `chatId` é o DESTINO (`input.to`); a origem é resolvida pelo próprio `messageId` (formato `{fromMe}_{chat}_{id}` autoidentifica o chat de origem), então `ForwardMessageInput.fromChatId` (opcional no contrato canônico, ADR-0013) nunca é enviado por este adapter. Resposta `201`: `WAMessage` completo, mesmo shape de `mapSentMessage`. **Nuance documentada verbatim**: "You can forward a message to another chat (that you chatted before, otherwise it may fail)" — encaminhar para um chat nunca contatado pode falhar (limitação do protocolo, não bug do adapter). |
| `messages.star` / `messages.unstar` | `PUT /api/star` | Confirmado no `openapi.json` (operationId `ChattingController_setStar`, schema `MessageStarRequest`) e na página dedicada "Star and unstar message". Body: `{messageId, chatId, star, session}` — diferente de `sendReaction` (que resolve o chat só pelo `messageId`), aqui `chatId` é campo obrigatório separado. Um único endpoint com flag booleana `star` cobre as duas direções; as 2 capabilities canônicas (ADR-0013) mapeiam para `star: true`/`star: false`. Resposta `200` sem schema — ignorada, `Promise<void>`. Doc não documenta limite de mensagens favoritáveis por chat (o app oficial tem um teto de 1.000 na conta) — não confirmado. |
| `messages.pin` / `messages.unpin` | `POST .../messages/{messageId}/pin` \| `.../unpin` | Confirmado na doc (schema `PinMessageRequest`, confiança Alta para request, Média para o schema de resposta — gap doc-vs-`openapi.json`, mesma classe já vista em `groups.updatePicture`). `pin` exige `duration` em SEGUNDOS — só 3 valores nativos do WhatsApp: `86400` (24h), `604800` (7 dias), `2592000` (30 dias). `PinMessageInput` do contrato canônico não expõe duração (ADR-0013 — nenhum formato converge entre providers); este adapter usa **`86400` (24h) como default**, decisão própria documentada no código, não um default do provider. `unpin` não tem body. Resposta (segundo a doc): `{success: true}` — ignorada. É fixação de MENSAGEM dentro do chat, distinto de "pin chat" no topo da lista (`chats.pin`, não suportado por este provider — busca não encontrou `POST /chats/{chatId}/pin`). |
| `messages.markRead` | `POST /api/sendSeen` | Confirmado no `openapi.json` (operationId `ChattingController_sendSeen`, schema `SendSeenRequest`). Nível de MENSAGEM, distinto de `chats.markRead` (nível de conversa, `.../chats/{chatId}/messages/read`, ADR-0012). Body: `{chatId, messageIds: [messageId], session}` — `messageId` singular existe no schema mas está `deprecated: true`; este adapter sempre usa o array com 1 elemento. `participant` (obrigatório só para grupos em engines NOWEB/GOWS) não é enviado — `MarkMessageReadInput` não carrega esse campo; pode ser necessário para marcar mensagem de terceiro em grupo, não confirmado contra instância real. |

`{chatId}`/`{messageId}` seguem o mesmo mapeamento/escape já usado por `messages.edit`/`delete`
(`toWahaChatId`/`encodeURIComponent`, função `messagePath` estendida com um `suffix` opcional para
`pin`/`unpin`).

## Conteúdo estruturado (`messages.sendLocation`/`sendContactCard`/`sendPoll`, ADR-0014)

Cobertura 3/3 — mesma fonte (`openapi.json` oficial + páginas `docs/how-to/send-messages/`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.sendLocation` | `POST /api/sendLocation` | Confirmado no `openapi.json` (operationId `ChattingController_sendLocation`, schema `MessageLocationRequest` — confiança Alta). Body: `{chatId, latitude, longitude, title, session}` — **`title` é campo obrigatório no schema, não há `address`** (o `WALocation` de RECEPÇÃO tem `address`/`url`/`description`/`thumbnail`/`live`, mas o request de ENVIO só aceita `title`); `SendLocationInput.address` não tem para onde ir neste provider e é ignorado. `input.name` mapeia para `title`; ausente vira string vazia. |
| `messages.sendContactCard` | `POST /api/sendContactVcard` | Confirmado no `openapi.json` (operationId `ChattingController_sendContactVcard`, schema `MessageContactVcardRequest` — confiança **Média**, o schema `oneOf` tem um segundo formato `Contact`/vCard bruto não totalmente capturado). Body: `{session, chatId, contacts: [{fullName, phoneNumber}]}` — o schema aceita um ARRAY de contatos (`VCardContact`), mas `SendContactCardInput` só modela um contato; este adapter sempre envia um array de 1 elemento. `whatsappId`/`organization` (opcionais no schema) não têm de onde vir no contrato canônico e são omitidos. |
| `messages.sendPoll` | `POST /api/sendPoll` | Confirmado no `openapi.json` (operationId `ChattingController_sendPoll`, schema `MessagePollRequest` — confiança Alta). Body: `{session, chatId, poll: {name, options, multipleAnswers}}` — `question`/`options`/`allowMultipleAnswers` mapeiam direto para `name`/`options`/`multipleAnswers` (booleano puro, sem tradução de escala). A doc recomenda salvar o `id` da resposta (`201`) para casar com votos recebidos via webhook (`poll.vote`/`poll.vote.failed`, este último indicando falha de decriptação por falta de storage persistente) — não modelado nesta fase, fora do escopo de ENVIO. |

Resposta `201` das 3 operações: `WAMessage` completo, mesmo shape reaproveitado por
`mapSentMessage` (mesmo padrão de `sendText`/`sendMedia`/`forward`).

## Presença (`presence.*`, ADR-0015)

Cobertura 3/3, confiança Alta — página dedicada bem detalhada, incluindo FAQ operacional.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `presence.setTyping` | `POST /api/{session}/presence` | Confirmado no `openapi.json` (operationId `PresenceController_setPresence`, schema `WAHASessionPresence`). Body: `{chatId, presence}` — `session` vai no PATH aqui (diferente de `sendText`/`sendMedia`/etc., que usam `session` no body) porque `presence` é um controller distinto (`PresenceController`), com convenção de path própria. `chatId` OBRIGATÓRIO para este caso. `TypingState.composing` mapeia para o literal `typing` do provider (`recording`/`paused` batem 1:1). |
| `presence.set` | `POST /api/{session}/presence` | MESMO endpoint de `setTyping`, mas `chatId` deve ser OMITIDO — confirmado na descrição do campo: "Required for chat-related presence statuses; omit for ONLINE/OFFLINE". `PresenceState` (`online`/`offline`) mapeia direto para o enum do provider. |
| `presence.subscribe` | `POST /api/{session}/presence/{chatId}/subscribe` | Confirmado (operationId `PresenceController_subscribe`). Sem body. Necessário chamar antes de receber `presence.update` de um contato específico via webhook — `GET /api/{session}/presence/{chatId}` já auto-subscreve como efeito colateral, mas este adapter não implementa `presence.get` nesta fase (ver ADR-0015, cobertura insuficiente para unificar com confiança). |

**Nuances operacionais documentadas** (não são bugs, comportamento nativo do WhatsApp Web
multi-device): manter a sessão sempre "online" via `presence.set('online')` suprime notificações
push no celular do usuário ("WhatsApp doesn't send push notifications to the device if a web client
is active") — a doc recomenda enviar `offline` explicitamente quando a automação terminar. Variáveis
de ambiente do servidor (`WAHA_PRESENCE_AUTO_ONLINE`, `WAHA_PRESENCE_AUTO_ONLINE_DURATION_SECONDS`)
controlam um comportamento automático de marcar a sessão como online por N segundos após qualquer
request — configuração do servidor, não deste adapter. `POST /startTyping`/`POST /stopTyping`
(atalhos documentados para `presence` com `typing`/`paused`) não são usados por este adapter —
`presence.setTyping` já cobre os dois via o enum.

## Conversas (`chats.*`, retrofit ADR-0012)

Namespace novo (ADR-0012) de gestão de estado de conversa. Cobertura real na pesquisa de
2026-07-12 é bem mais desigual que `groups.*`/`contacts.*`: só 4 das 8 operações candidatas têm
endpoint confirmado.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `chats.archive` | `POST /api/{session}/chats/{chatId}/archive` | Confirmado no `openapi.json` oficial (operationId `ChatsController_archiveChat`). Sem body; resposta `201` com objeto genérico — ignorada, contrato retorna `void`. Existe também um webhook associado `chat.archive` (payload `{ id, timestamp, archived: true\|false }`, disparado tanto ao arquivar quanto ao desarquivar) — **não mapeado** por `parseWahaWebhook` nesta fase (fora de escopo desta ADR; cai em `unknown`). |
| `chats.unarchive` | `POST /api/{session}/chats/{chatId}/unarchive` | Confirmado no `openapi.json` oficial (operationId `ChatsController_unarchiveChat`), par simétrico de `archive` — mesmo tratamento de resposta. |
| `chats.markRead` | `POST /api/{session}/chats/{chatId}/messages/read` | Confirmado no `openapi.json` oficial (operationId `ChatsController_readChatMessages`). Existe um endpoint CONCORRENTE, `POST /api/sendSeen`, que opera no nível de MENSAGEM (exige `messageIds` explícito, `deprecated: true` para o campo singular `messageId`) — este (`.../messages/read`) é o único dos dois que opera por `chatId` sozinho, coerente com a semântica de chat INTEIRO de `ChatsApi.markRead` (distinto de um eventual `messages.markRead` por id, fora de escopo desta ADR). Sem query params: o adapter usa os defaults documentados pelo provider (marca como lidas as mensagens não lidas dos últimos 7 dias, até 30 no DM / 100 em grupo — citação verbatim da doc: "Send seen (read a message) for all unread messages older than 7 days (30 max for DM, 100 max for groups)"); o contrato canônico não expõe `count`/`days` para esta operação. Resposta (schema `ReadChatMessagesResponse`): `{ ids: string[] }` com os ids marcados como lidos — ignorada, contrato retorna `void`. A doc do endpoint concorrente `/messages/read` nota um pré-requisito de engine: "👉 NOWEB: Please make sure to Enable NOWEB Store before using this API!" (não documentado para `sendSeen`). |
| `chats.markUnread` | `POST /api/{session}/chats/{chatId}/unread` | Confirmado no `openapi.json` oficial (operationId `ChatsController_unreadChat`). Sem body; resposta sem schema declarado — ignorada, contrato retorna `void`. |

`{chatId}` em todas as 4 operações segue o mesmo mapeamento de `chatId` de `messages.*`/
`contacts.*` (`toWahaChatId`, ver seção "Mapeamento de `chatId` canônico → WAHA" acima) — NÃO o
tratamento opaco de `groupId` (ADR-0009 vs. ADR-0012): um "chat" é o mesmo alvo endereçável de
`messages.sendText`, podendo ser indivíduo ou grupo via JID explícito. Função auxiliar dedicada
`chatPath(session, chatId, suffix)` monta o path `/api/{session}/chats/{chatId}/<suffix>`
reaproveitado pelas 4 operações (mesmo padrão de `groupParticipantsPath` para `groups.*`).

### Operações candidatas NÃO implementadas (`chats.mute`/`unmute`/`pin`/`unpin`)

- **`chats.mute`/`chats.unmute`**: busca exaustiva no `openapi.json` oficial não encontrou nenhum
  endpoint de silenciar uma CONVERSA comum. O único "mute" confirmado no schema é
  `POST /api/{session}/channels/{id}/mute` (e `.../unmute`) — domínio de **WhatsApp Channels**
  (newsletters), não de chat regular (`@c.us`/`@g.us`). Declarar `chats.mute` reaproveitando esse
  endpoint seria incorreto (semântica de domínio diferente) — capability NÃO declarada, método NÃO
  implementado.
- **`chats.pin`/`chats.unpin`**: o WAHA só documenta fixar uma MENSAGEM dentro do chat
  (`POST /api/{session}/chats/{chatId}/messages/{messageId}/pin` e `.../unpin`, schema
  `PinMessageRequest` com `duration` obrigatório em segundos — valores documentados: 24h
  `86400`, 7 dias `604800`, 30 dias `2592000`, os três únicos aceitos nativamente pelo WhatsApp)
  — operação distinta de fixar a CONVERSA no topo da lista (`ChatsApi.pin`, ver ADR-0012). Busca
  não encontrou `POST /chats/{chatId}/pin` nem equivalente. Capability `chats.pin`/`chats.unpin`
  NÃO declarada, método NÃO implementado — mesmo critério já usado para `contacts.listBlocked`
  (feature ausente não vira "quase-suporte" via outro endpoint de domínio diferente).

**Não confirmado nesta pesquisa** (a validar contra uma instância WAHA real):

- Se `chats.archive`/`chats.unarchive`/`chats.markUnread` exigem algum pré-requisito de engine
  (NOWEB/GOWS "Enable Store") equivalente ao já documentado para `chats.markRead` — a doc não
  menciona isso para os outros 3 endpoints.
- O shape exato do corpo de resposta `201` de `archive`/`unarchive` (a doc não declara schema,
  mesmo gap já visto em `groups.create`/`updateSubject`).

## Webhooks

Duas camadas independentes de configuração:

1. **Por sessão (recomendado)**: `config.webhooks` (array) em `POST /api/sessions` ou
   `PUT /api/sessions/{session}`. Cada item: `{ url, events: string[], hmac?: {key}, retries?:
   {policy, delaySeconds, attempts}, customHeaders? }`.
2. **Global (env vars, todas as sessões)**: `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS`,
   `WHATSAPP_HOOK_HMAC_KEY`, `WHATSAPP_HOOK_RETRIES_POLICY`,
   `WHATSAPP_HOOK_RETRIES_DELAY_SECONDS`, `WHATSAPP_HOOK_RETRIES_ATTEMPTS`,
   `WHATSAPP_HOOK_CUSTOM_HEADERS`. Não aparece em `GET /api/sessions`.

Entrega: POST JSON com headers `X-Webhook-Request-Id`, `X-Webhook-Timestamp` e, se HMAC
configurado, `X-Webhook-Hmac` + `X-Webhook-Hmac-Algorithm: sha512`.

Envelope genérico (todo webhook): `{ id, timestamp, event, session, metadata?, me?, engine,
environment, payload }`. Nesta fase (F1) o adapter mapeia `message` (→
`message.received`/`message.sent` conforme `payload.fromMe`), `message.ack` (→ `message.ack`) e
`session.status` (→ `connection.update`). Um retrofit posterior (ADR-0009, ver seção "Webhooks de
grupo" abaixo) acrescentou `group.v2.participants`, `group.v2.update`, `group.v2.join` e
`group.v2.leave` (→ `group.update`). Qualquer outro `event` (ex.: `message.reaction`,
`presence.update`, `call.received`, os legados `group.join`/`group.leave`, ...) vira evento
canônico `unknown` — não é um erro, é escopo de fases futuras (F2/F3) ou confiança insuficiente
para parsing estruturado (ver seção seguinte).

### Webhooks de grupo (`group.v2.*`, retrofit ADR-0009)

Popula o evento canônico `GroupUpdateEvent` (`type: 'group.update'`) a partir dos webhooks de grupo
do WAHA. Confiança **ALTA**: os 4 eventos abaixo (tag "📁 Groups" do `openapi.json` oficial e a
página <https://waha.devlike.pro/docs/how-to/groups/>) têm shape de payload confirmado por exemplos
JSON literais nas duas fontes. Os eventos legados `group.join`/`group.leave` (sem `v2`, marcados
`deprecated: true` no `openapi.json`, payload não documentado/genérico) **não** ganharam parsing
estruturado — confiança baixa demais; continuam caindo em `unknown`, como já documentado acima.

| Evento WAHA (`envelope.event`) | `action` do `GroupUpdateEvent` | `participants` | Observações |
| --- | --- | --- | --- |
| `group.v2.participants` | `'participants.' + payload.type` (`join→add`, `leave→remove`, `promote→promote`, `demote→demote`) | Presente: IDs dos participantes **afetados** (`payload.participants`), mesma preferência `pn` > `id` já usada em `mapGroupParticipant` (`groups.getInfo`) | Evento **principal** de mudança de participante. `payload.type` fora dos 4 valores conhecidos vira `unknown` (nunca inventa uma `action` genérica). |
| `group.v2.update` | `'subject'` e/ou `'description'` — **um `GroupUpdateEvent` por campo presente** em `payload.group` | Ausente (evento não carrega lista de participantes) | `payload.group` pode ser parcial: só `{id, subject}`, só `{id, description}`, ou os dois juntos (mudança simultânea) — nesse caso o adapter emite **dois** eventos no array (`parseWebhook` já retorna `CanonicalEvent[]`). `description: ''` é um valor válido (limpa a descrição), não tratado como ausente. Nenhum dos dois campos presente em `group` (além de `id`) vira `unknown`. |
| `group.v2.join` | `'participants.add'` | **Ausente, deliberadamente** | Dispara quando a PRÓPRIA sessão entra/é adicionada a um grupo. O payload traz o `GroupInfo` completo em `group`, mas não isola qual participante é "a própria sessão" vs a lista inteira — o adapter não inventa esse dado (ADR-0002/0003). |
| `group.v2.leave` | `'participants.remove'` | Ausente (payload só traz `group: { id }`) | Dispara quando a PRÓPRIA sessão sai/é removida de um grupo. |

`groupId` em todos os 4 casos vem de `payload.group.id` (sem conversão adicional — já chega no
formato de JID `<dígitos>@g.us` usado nativamente pelo WAHA, o mesmo formato de `GroupInfo.id`).
Qualquer um dos 4 eventos sem `payload` ou sem `group.id` reconhecível vira `unknown` (nunca lança).

**Nuance documentada, não é bug**: a doc oficial avisa que `group.v2.participants` PODE duplicar
`group.v2.join`/`group.v2.leave` quando o participante afetado é a própria sessão (ex.: o bot é
adicionado a um grupo por outra pessoa — `group.v2.join` dispara, e `group.v2.participants` com
`type: 'join'` também pode disparar para o mesmo evento). O adapter não deduplica: um consumidor
pode legitimamente receber 2 `GroupUpdateEvent` para essa mesma mudança em alguns casos. Trate
`GroupUpdateEvent` como at-least-once, não exactly-once, para essa sobreposição específica.

**Não confirmado nesta pesquisa** (a validar contra uma instância WAHA real):

- O shape exato de `payload._data` (presente nos 4 eventos, ignorado pelo adapter) — provavelmente
  o payload bruto do engine subjacente (whatsmeow/GOWS ou outro), não documentado como parte da API
  pública.
- Se `group.v2.update` pode reportar mudanças além de `subject`/`description` (ex.: configurações
  `membersCanAddNewMember`) em versões futuras do WAHA — o adapter só reconhece esses dois campos
  hoje; qualquer campo adicional presente em `group` além de `id` é ignorado silenciosamente (não é
  erro, é escopo não coberto).
- Fixtures desta seção (`webhook-group-v2-participants-join.json`,
  `webhook-group-v2-update-subject.json`, `webhook-group-v2-join.json`,
  `webhook-group-v2-leave.json`) são **reconstruídas** a partir do shape documentado na pesquisa
  (não uma cópia verbatim capturada de uma instância real ou de uma página específica da doc) —
  mesmo tratamento de confiança que `fixtures/webhook-message-received.json` (ver seção "Payloads
  capturados / fixtures" abaixo): plausíveis, mas a confirmar contra uma instância real.

### Verificação HMAC de webhooks

Sem verificação de assinatura, qualquer um que descubra a URL do webhook pode forjar eventos. O
WAHA suporta assinar a entrega com HMAC-SHA512 quando `hmac.key` (por sessão, em
`config.webhooks[]`) ou `WHATSAPP_HOOK_HMAC_KEY` (global) está configurado no servidor — ver seção
acima. O adapter WAHA verifica isso de forma **opt-in** (ADR-0006):

1. Configure `webhookHmacKey` em `WahaOptions` com o mesmo valor da chave HMAC do servidor:

   ```ts
   const adapter = waha({
     baseUrl: 'http://localhost:3000',
     apiKey: process.env.WAHA_API_KEY!,
     webhookHmacKey: process.env.WAHA_WEBHOOK_HMAC_KEY,
   });
   ```

2. **Passe `rawBody`** ao chamar `parseWebhook`/`wa.webhooks.dispatch`. Isso é obrigatório para a
   verificação funcionar: HMAC precisa dos bytes brutos do request, e a maioria dos frameworks já
   consumiu e parseou o body antes do seu handler rodar — reserializar o objeto parseado
   (`JSON.stringify(req.body)`) não reproduz de forma confiável o corpo original byte-a-byte, então
   não pode ser usado para a comparação de assinatura.

   Exemplo com Express (captura o corpo bruto no `verify` callback do `express.json()`):

   ```ts
   import express from 'express';

   declare module 'express-serve-static-core' {
     interface Request {
       rawBody?: string;
     }
   }

   const app = express();
   app.use(
     express.json({
       verify: (req, _res, buf) => {
         (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
       },
     }),
   );

   app.post('/webhooks/waha', (req, res) => {
     const events = wa.webhooks.dispatch({
       headers: req.headers as Record<string, string | string[] | undefined>,
       body: req.body,
       rawBody: req.rawBody,
     });
     res.status(200).json({ ok: true });
     // ... encaminhar `events` para o resto da aplicação
   });
   ```

3. Comportamento resultante:
   - `webhookHmacKey` **não** configurada ⇒ sem mudança (comportamento anterior, sem verificação).
   - `webhookHmacKey` configurada + `rawBody` presente + assinatura válida ⇒ processa normalmente.
   - `webhookHmacKey` configurada + assinatura ausente/inválida ⇒ vira evento `unknown` (nunca
     processa o payload; nunca lança, ADR-0003).
   - `webhookHmacKey` configurada + `rawBody` ausente ⇒ vira evento `unknown` (falha fechada: não
     dá pra verificar, então não assume válido).

### Payloads capturados / fixtures

- **`fixtures/webhook-ack.json`** — **verbatim**, copiado sem alteração do exemplo oficial
  (`waha.devlike.pro/docs/how-to/events/`).
- **`fixtures/webhook-connection-update.json`** — **verbatim**, copiado sem alteração do exemplo
  oficial (idêntico em `docs/how-to/events/` e `docs/how-to/sessions/`).
- **`fixtures/webhook-message-received.json`** — **RECONSTRUÍDO, não verbatim**. O único exemplo
  de evento `message` mostrado na documentação oficial tem `payload.fromMe: true` (é uma mensagem
  ecoada, enviada pelo próprio número — inclusive tem o campo `source: "app"`, que a doc diz só
  existir quando `fromMe:true`). Como o nome do arquivo e o uso no adapter exigem um exemplo de
  mensagem **recebida** (`fromMe: false`), a fixture foi adaptada a partir do exemplo oficial:
  trocado `fromMe` para `false`, removido o campo `source` (documentado como exclusivo de
  `fromMe:true`), e o prefixo do `id` de `true_` para `false_` (convenção real e documentada do
  WhatsApp: mensagens de fora usam prefixo `false_`, ecoadas usam `true_`). Todos os demais campos
  e valores vêm do exemplo oficial. Tratar como plausível, não como payload capturado ao vivo.
- **`fixtures/webhook-group-v2-participants-join.json`**,
  **`fixtures/webhook-group-v2-update-subject.json`**, **`fixtures/webhook-group-v2-join.json`**,
  **`fixtures/webhook-group-v2-leave.json`** — **RECONSTRUÍDAS, não verbatim**. Montadas a partir
  do shape de payload confirmado na pesquisa (ver seção "Webhooks de grupo" acima), não copiadas
  byte-a-byte de uma captura real. Tratar como plausíveis, a confirmar contra uma instância WAHA
  real.

Mensagem respondida (reply): quando `payload.replyTo` está presente (schema `ReplyToMessage`,
confirmado no `openapi.json` real), `payload.replyTo.id` é mapeado para `WaMessage.quotedId` no
evento canônico.

Estrutura de mídia recebida: a seção de particularidades da doc menciona que uma mensagem com
mídia expõe `media.url` apontando de volta para a própria instância WAHA (ex.:
`http://localhost:3000/api/files/<id>.oga`), exigindo `X-Api-Key` também para baixar. O nome exato
dos demais campos do objeto `media` (`mimetype`, `filename`) não veio explicitado numa fixture
oficial — o adapter assume `media.mimetype`/`media.filename` por consistência com o restante do
schema WAHA (`RemoteFile`/`BinaryFile` usam esses mesmos nomes), mas isso é uma suposição a
confirmar contra uma instância real.

### Mapeamento de `ack` → `MessageAck`

A doc confirma apenas `ackName: "READ"` ⇄ `ack: 3` via o exemplo oficial. A tabela completa não
está publicada; o adapter assume a convenção comum do WhatsApp (a confirmar em runtime):

| `ack` (num.) | `ackName` | `MessageAck` canônico |
| --- | --- | --- |
| `-1` | `ERROR` | `error` |
| `0` | `PENDING` | `pending` |
| `1` | `SERVER`/`SENT` | `sent` |
| `2` | `DEVICE`/`DELIVERED` | `delivered` |
| `3` | `READ` (confirmado pela doc) | `read` |
| `4` | `PLAYED` | `played` |
| valor não reconhecido | — | `sent` (fallback neutro, não lança) |

### Normalização de timestamp

Quirk observado comparando os dois exemplos oficiais: `payload.timestamp` de uma mensagem vem em
**segundos** (`1667561485` ⇒ nov/2022), mas `payload.statuses[].timestamp` do evento
`session.status` já vem em **milissegundos** (`1700000001000`). O adapter usa uma heurística
defensiva: valores menores que `1_000_000_000_000` são tratados como segundos e multiplicados por
1000; valores maiores já são tratados como milissegundos.

## Limites e particularidades

- Sem rate limiting HTTP documentado/imposto pelo WAHA (sem política 429 na spec). Existe um guia
  comportamental ("How to Avoid Blocking") sobre o WhatsApp banir o número por comportamento de
  bot — orientação de uso, não uma limitação técnica que o adapter precise implementar.
- Múltiplas engines plugáveis (WEBJS, WPP, NOWEB, GOWS; VENOM aparece como legado) com cobertura de
  recursos diferente por endpoint. Engine padrão: WEBJS (Chromium). NOWEB/GOWS são mais leves mas
  precisam de "Enable Store" para expor histórico de chats/contatos/mensagens — não afeta as
  operações desta fase (connect/status/logout/sendText/sendMedia/webhook), mas pode afetar fases
  futuras (contatos, histórico).
- Números brasileiros: ambiguidade do 9º dígito recomenda `GET /api/checkNumberStatus` antes de
  enviar — fora do escopo desta fase (o adapter apenas converte formato, não valida existência).
- `hasMedia: true` pode legitimamente vir acompanhado de `media: null` quando o WAHA não faz
  auto-download da mídia — o adapter trata isso como mensagem sem `MediaRef` anexado, não como
  erro.
- Self-hosted sem host fixo: `baseUrl` é sempre fornecido pelo consumidor do adapter (não há
  endpoint SaaS para hardcode).
- `POST /api/{session}/auth/request-code` (pairing code): resposta real documentada só em prosa
  (`{"code": "ABCD-ABCD"}`), sem schema OpenAPI correspondente — não implementado nesta fase (ver
  "Capabilities implementadas").
- `GET /api/sessions` referencia um esquema `oauth2` inexistente em `components.securitySchemes`
  — artefato da spec, ignorado pelo adapter (`X-Api-Key` é o único mecanismo real).
