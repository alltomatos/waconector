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
environment, payload }`. Nesta fase (F1) o adapter mapeia apenas `message` (→
`message.received`/`message.sent` conforme `payload.fromMe`), `message.ack` (→ `message.ack`) e
`session.status` (→ `connection.update`). Qualquer outro `event` (ex.: `message.reaction`,
`group.join`, `presence.update`, `call.received`, ...) vira evento canônico `unknown` — não é um
erro, é escopo de fases futuras (F2/F3).

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
