# Dossiê: Z-API

- Docs oficiais: <https://developer.z-api.io/api-reference/introduction> (fonte primária adicional:
  <https://github.com/Z-API/z-api-docs>, arquivos `.md` brutos lidos via `raw.githubusercontent.com`)
- Versão testada: documentação consultada em 2026-07-11
- **Correção pós-auditoria (2026-07-11)**: o levantamento original não havia visitado
  `docs/message/send-message-sticker.md` nem `docs/message/reply-message.md` (esta última listada
  separadamente de `send-message-text.md` no índice `https://developer.z-api.io/llms.txt`, por isso
  passou despercebida). Confirmado em 3 fontes independentes cada
  (`developer.z-api.io/message/send-message-sticker`, `developer.z-api.io/message/reply-message`,
  os respectivos `.md` brutos em `raw.githubusercontent.com/Z-API/z-api-docs/main/docs/message/` e o
  índice `llms.txt`): (a) existe sim `POST /send-sticker` (`{ phone, sticker, messageId?,
  delayMessage?, stickerAuthor? }`); (b) `POST /send-text` aceita sim um `messageId` opcional para
  citar/responder uma mensagem. Ambos os pontos foram corrigidos nesta revisão — ver tabela de
  "Operações core" abaixo.
- Hospedagem: SaaS — host único `https://api.z-api.io` para todos os clientes (instâncias rodam em
  containers na Oracle Cloud, provisionados só via painel administrativo). Nenhuma opção
  self-hosted/on-premise foi encontrada em nenhuma página consultada.

## Autenticação

Mecanismo **URL path**, não header `Authorization: Bearer` e não API-key em header (diferente de
WAHA/Evolution GO/uazapi): `instanceId` e `token` vão embutidos como segmentos literais da URL de
toda chamada — `https://api.z-api.io/instances/{instanceId}/token/{token}/{endpoint}`. Exemplo
literal da doc: `https://api.z-api.io/instances/SUA_INSTANCIA/token/SEU_TOKEN/send-text`.

Existe um segundo mecanismo **opcional** de segurança de conta: **Client-Token** (painel > aba
Segurança > "Token de Segurança da Conta"), desabilitado por padrão. Quando uma conta o ativa,
**todas** as instâncias da conta passam a exigir o header `Client-Token: <valor>` em toda
requisição — sem ele a Z-API responde `200` com corpo `{"error": "null not allowed"}` (não fica
claro na doc se algum outro status HTTP também é usado). Quase toda página de endpoint traz uma
tabela "Header" listando só esse `Client-Token` como cabeçalho documentado (além de
`Content-Type: application/json` no corpo).

Também existem bloqueio por IP (allowlist configurável no painel) e 2FA no painel — ambos recursos
de conta/dashboard, não afetam o contrato HTTP deste adapter.

`ZapiOptions.instanceId`/`ZapiOptions.token` **não são enviados em header** — são interpolados no
prefixo de path (`/instances/{instanceId}/token/{token}`) usado em toda chamada. Ambos (e
`clientToken`, quando presente) são passados em `secrets` do `HttpClient` para redação em mensagens
de erro; como o texto usado nas mensagens de erro do `HttpClient` é o mesmo texto literal passado em
`HttpRequestOptions.path` (não a URL final resolvida), o adapter monta esse prefixo com o token CRU
(sem `encodeURIComponent`) — garantindo que a string bata exatamente com a entrada em `secrets` e
seja redigida.

## Modelo de instância/sessão

Termo do provider: **"instância"**, tecnicamente uma VM/container dedicado por número conectado. Uma
instância só tem um número por vez, mas pode ser desconectada e reconectada a outro número (não é
presa permanentemente a um número). Não há conceito de "sessão" separado do de instância.

- **Criar**: não foi encontrado endpoint documentado para criar uma instância via API — instâncias
  são provisionadas manualmente pelo painel administrativo Z-API (fluxo SaaS/checkout comercial).
  `ZapiOptions.instanceId`/`token` assumem instância já provisionada externamente.
- **Conectar**: `GET /instances/{id}/token/{token}/qr-code` (bytes crus do QR) |
  `GET /instances/{id}/token/{token}/qr-code/image` (imagem base64 pronta para `<img>`) |
  `GET /instances/{id}/token/{token}/phone-code/{phone}` (pairing code; `phone` com DDI, retorna
  `{"value":"A1B2C3D4E5"}`). Todos GET, header opcional `Client-Token`. QR expira a cada 20s; a doc
  recomenda polling de 10-20s e parar após 3 tentativas sem leitura. Em alguns dispositivos pode vir
  um objeto `challenge` (WebAuthn-like) exigindo um passo extra de confirmação — não documentado em
  detalhe em nenhuma página consultada.
- **Status**: `GET /instances/{id}/token/{token}/status` → `{ connected: boolean,
  smartphoneConnected: boolean, error?: string }`.
- **Desconectar**: `GET /instances/{id}/token/{token}/disconnect` — desconecta o número (reconectável
  via novo QR/pairing code); após desconectar, todos os métodos da API ficam indisponíveis e
  webhooks param de ser enviados. **Quirk**: é `GET`, não `POST`/`DELETE`, apesar do efeito
  colateral. Endpoints irmãos (não implementados nesta fase): `GET /restart` (reinicia sem reler QR)
  e `GET /restore-session` (tenta restabelecer conexão após webhook de desconexão, sem novo QR).

## Capabilities implementadas nesta fase (F2)

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `messages.sendReaction`, `groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `webhooks.parse`.

`instance.pairingCode` **não** foi declarada: embora a Z-API suporte pareamento por código
(`GET /phone-code/{phone}`), `InstanceApi.connect()` não recebe telefone como parâmetro nesta
versão do contrato — expor esse fluxo exigiria mudar o contrato central (mesma decisão dos adapters
WAHA/uazapi).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `GET /qr-code/image` | `ConnectResult.qr` extraído do campo `value` (suposição por analogia com `/phone-code/{phone}`, cujo shape É confirmado como `{"value": "..."}"`; a doc não mostra um exemplo JSON literal de `/qr-code/image`) — com fallback para `qrcode`/`base64`, e para o corpo inteiro quando a resposta não é um objeto JSON. `/qr-code` (bytes crus) não é usado por não servir a um `string`. **Assunção a validar contra uma instância real.** |
| `instance.status` | `GET /status` | Mapeia apenas `connected: true → 'connected'` / `connected: false → 'disconnected'`; qualquer corpo sem `connected` booleano vira `'unknown'`. Não há diferenciação de `'qr'`/`'connecting'` neste endpoint pelo dossiê — ver tabela de mapeamento abaixo. |
| `instance.logout` | `GET /disconnect` | GET com efeito colateral (quirk do provider). Elegível ao retry automático de GET do `HttpClient` — seguro, pois desconectar uma instância já desconectada é idempotente em efeito. |
| `messages.sendText` | `POST /send-text` | Body `{ phone, message, messageId? }`. Campos opcionais documentados (`delayMessage`, `delayTyping`, `editMessageId`) não são expostos por `SendTextInput`. **Citação confirmada** na página dedicada "reply-message" — mesma URL de `/send-text`, campo opcional `messageId` no corpo — por isso `SendTextInput.quotedId` é mapeado para `messageId`. `mentions` continua sem campo confirmado em nenhuma página consultada e é silenciosamente ignorado. |
| `messages.sendMedia` | `POST /send-image` \| `/send-video` \| `/send-audio` \| `/send-document/{extension}` \| `/send-sticker` | Um endpoint por `MediaKind`, incluindo `sticker` (`{ phone, sticker, messageId?, delayMessage?, stickerAuthor? }`; `stickerAuthor` não é exposto por `SendMediaInput` nesta fase). `document` exige que o adapter derive `{extension}` de `media.filename` ou de um mapeamento MIME→extensão best-effort (lança `INVALID_INPUT` se nenhum dos dois permitir). Campo de mídia aceita URL OU data URI base64 (`data:<mime>;base64,...`); se `media.base64` vier sem o prefixo `data:`, o adapter monta a data URI com `media.mimeType` ou um mimetype-padrão por tipo. `caption` só é enviado para `image`/`video`/`document` — a doc não documenta esse campo para `audio`/`sticker`. `messageId` (citação) é enviado para `image`/`video`/`document`/`sticker`. |
| `messages.sendReaction` | `POST /send-reaction` (envio) \| `POST /send-remove-reaction` (remoção) | Ver seção "Reações" abaixo. |

### Formato de resposta de envio

Confirmado no dossiê para todos os `send-*`: `{ zaapId, messageId, id }` (`id` é alias de
`messageId`, mantido só por compatibilidade com Zapier). `SentMessage.id` vem de `messageId`
(fallback `id`, fallback `zapi-<timestamp>`); `SentMessage.chatId` usa o `phone` requisitado (a
resposta não ecoa o destinatário); `SentMessage.timestamp` fica `undefined` — nenhum campo de
timestamp é documentado na resposta de envio.

### Reações (`messages.sendReaction`)

Confirmado em duas páginas dedicadas da doc oficial (`developer.z-api.io/message/send-message-reaction`
e `.../send-remove-reaction`), com URL padrão consistente entre as duas: `https://api.z-api.io/instances/{instanceId}/token/{token}/send-reaction` e `.../send-remove-reaction`.
São **dois endpoints distintos** (não um único endpoint com "reaction vazia = remove"):

- Envio: `POST /send-reaction` — body `{ phone, reaction, messageId, delayMessage? }`. `phone` é o
  destinatário (ou ID do grupo), `reaction` é o emoji, `messageId` é o ID da mensagem-alvo.
- Remoção: `POST /send-remove-reaction` — mesmo body, **sem** o campo `reaction`.
- Resposta idêntica nos dois: `{ zaapId, messageId, id }` (mesmo shape de `send-text`/`send-media`,
  mapeado por `mapSentMessage`).
- A doc confirma explicitamente que dá para reagir tanto a mensagens enviadas quanto recebidas
  ("mensagens enviadas ou recebidas").
- `delayMessage` (1-15s) não é exposto por `SendReactionInput` nesta fase (mesmo padrão de
  `sendText`/`sendMedia`, que também não expõem esse campo).

O contrato central (ADR-0008) define que `SendReactionInput.emoji === ''` remove uma reação
enviada antes. Como a Z-API modela remoção como um endpoint dedicado (sem campo `reaction`), o
adapter roteia `emoji === ''` para `/send-remove-reaction` em vez de mandar `reaction: ''` para
`/send-reaction` (que não tem esse comportamento documentado).

**Não confirmado nesta pesquisa**: shape do webhook de reação recebida (fora de escopo desta
adição — `messages.sendReaction` cobre só o envio; `parseWebhook` continua sem mapear reações
recebidas para `WaMessage.reaction`, que segue `kind: 'unknown'` quando o payload trouxer uma
chave de reação, ver nota em `mapMessageContent`).

### Mapeamento de status → `InstanceState`

| Z-API `connected` | `InstanceState` |
| --- | --- |
| `true` | `connected` |
| `false` | `disconnected` |
| corpo sem `connected` booleano (shape inesperado) | `unknown` (fallback seguro, nunca lança) |

O dossiê confirma só três campos no corpo de `/status` (`connected`, `smartphoneConnected`, `error`)
e nenhum deles distingue "aguardando leitura de QR" de "conectando" — por isso esta fase não deriva
`'qr'`/`'connecting'` a partir de `/status`; para saber se está no meio do fluxo de pareamento, o
consumidor chama `instance.connect()` (que devolve o QR atual). **A confirmar contra uma instância
real** se `smartphoneConnected`/`error` permitiriam refinar esse mapeamento no futuro.

### Mapeamento de `chatId` canônico → Z-API

O conector já normaliza o `to` recebido do usuário (`normalizeChatId`) antes de chamar o adapter:
telefone vira só-dígitos (E.164 sem `+`), JIDs explícitos passam intactos. O dossiê confirma que o
campo `phone` da Z-API aceita dígitos DDI+DDD+número para chats 1:1 ("SOMENTE DÍGITOS, sem +,
espaços ou máscara") e que, para grupos, "o mesmo campo `phone` recebe o ID do grupo" — sem
especificar se esse ID de grupo inclui o sufixo `@g.us`. Decisão do adapter (`toZapiPhone`): JIDs
explícitos passam intactos; qualquer outra entrada é filtrada para dígitos puros como camada
defensiva (o conector já entrega o formato certo, mas o adapter pode ser instanciado diretamente,
sem `createConnector`).

## Grupos (núcleo)

Fonte primária: `developer.z-api.io/group/*` (páginas `create-group`, `group-metadata`,
`get-all-groups`, `add-participant`, `remove-participant`, `add-admin`, `remove-admin`).

### Nota crítica: `groupId` NÃO é um JID

O identificador de grupo da Z-API é um **ID sintético sem `@`** — não é um JID no formato
`...@g.us` usado por outros providers (WAHA, Evolution GO, uazapi). Dois formatos observados:

- **Atual (desde 2021-11-04)**: `"{idNumerico}-group"` (ex.: `"120363019502650977-group"`).
- **Legado**: `"{telefoneCriador}-{timestampUnix}"` (grupos criados antes da mudança acima).

Como `GroupInfo.id`/`GroupParticipantsInput.groupId` são opacos por contrato (ver ADR-0009), o
conector **não** roda `groupId` por `normalizeChatId` antes de entregá-lo ao adapter. Este adapter
mantém essa opacidade internamente: `groupId` é sempre repassado **verbatim**, no path (`getInfo`)
ou no corpo (`addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants`) —
**nunca** passado por `toZapiPhone`/`digitsOnly`, que corromperiam o sufixo `-group` ou os
hífens do formato legado. Participantes individuais (dentro de `participants: string[]`), ao
contrário, já chegam normalizados pelo conector (telefone → dígitos, JID passa intacto) e se
comportam como um `to` de mensagem comum — por isso reaproveitam `toZapiPhone`.

### Operações

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST /create-group` | Body `{ autoInvite, groupName, phones }`; `autoInvite: false` é o default seguro adotado pelo adapter (comportamento de `true` não documentado em detalhe, e `CreateGroupInput` não expõe esse flag). `phones` reaproveita `toZapiPhone` sobre cada participante de entrada. **Resposta não ecoa nome nem participantes**: `{ phone, phonesNotAdded, invitationLink }` — `phone` é o novo ID do grupo. `GroupInfo.subject`/`participants` são montados com fallback nos valores de entrada (mesmo padrão de `mapSentMessage`). |
| `groups.getInfo` | `GET /group-metadata/{groupId}` | `groupId` no **path**, verbatim. Resposta: `{ phone, description, owner, subject, creation (epoch ms), invitationLink, participants: [{ phone, isAdmin, isSuperAdmin, short?, name? }] }`. Mapeamento direto: `id←phone` (fallback: `groupId` requisitado), `subject←subject` (fallback `''`), `description←description`, `owner←owner`, cada participante `{ id←phone, isAdmin, isSuperAdmin }` (`short`/`name` não expostos por `GroupParticipant` nesta fase). |
| `groups.list` | `GET /groups` | Exige paginação (`page`, `pageSize`) como query params — `GroupsApi.list()` não expõe paginação no contrato canônico, então o adapter usa um default fixo (`page=1, pageSize=100`). **Limitação documentada**: a resposta é uma lista de objetos LEVES (`{ isGroup: true, name, phone }`), sem `description`/`owner`/`participants` — por isso todo `GroupInfo` desta lista vem com `participants: []`. Para os participantes de um grupo específico, use `groups.getInfo`. |
| `groups.addParticipants` | `POST /add-participant` | **Singular** — não `/add-participants` (desvio de nome confirmado na pesquisa). Body `{ autoInvite, groupId, phones }`; `groupId` no **corpo**, verbatim. Retorna `void` (contrato não pede o grupo atualizado de volta). |
| `groups.removeParticipants` | `POST /remove-participant` | Singular, mesmo desvio de nome. Body `{ groupId, phones }` (sem `autoInvite`, que não se aplica a remoção). |
| `groups.promoteParticipants` | `POST /add-admin` | Nome do endpoint **não** é `/promote-participant(s)` — desvio de nome confirmado na pesquisa. Body `{ groupId, phones }`. |
| `groups.demoteParticipants` | `POST /remove-admin` | Nome do endpoint **não** é `/demote-participant(s)` — desvio de nome confirmado na pesquisa. Body `{ groupId, phones }`. |

### Limitações e assunções não confirmadas contra uma instância real

- Nenhuma chamada real foi feita contra `api.z-api.io/.../group/*` durante a pesquisa (sem
  credenciais) — os shapes de resposta acima vêm da documentação oficial, não de uma instância
  viva.
- `groups.list` devolve `participants: []` para todo item por limitação do endpoint `GET /groups`
  (não do adapter) — ver tabela acima.
- Webhooks de eventos de grupo (criação, entrada/saída de participante, mudança de admin) **não**
  são mapeados nesta fase — `parseWebhook` continua sem um `type` dedicado para eles; qualquer
  payload desse tipo cai em `unknown` (nunca lança).

## Webhooks

Configuração via endpoints `PUT` dedicados por tipo de evento (não um único endpoint genérico),
todos com corpo `{ "value": "https://..." }` e exigindo HTTPS explicitamente ("O Z-API não aceita
webhooks que não sejam HTTPS"):

- `PUT /update-webhook-received` — webhook "ao receber" (mensagens recebidas; nome confirmado
  consistente em `docs/webhooks/on-message-received.md`, apesar de uma página de configuração trazer
  também a grafia sem "d", `update-webhook-receive`, num trecho secundário — tratado como typo).
- `PUT /update-webhook-received-delivery` — variante que também habilita notificação de mensagens
  enviadas por mim.
- `PUT /update-notify-sent-by-me` — corpo `{ notifySentByMe: boolean }`.
- `PUT /update-webhook-delivery` — webhook "ao enviar" (confirmação de entrega ao WhatsApp).
- `PUT /update-webhook-message-status` — webhook de status/ack (sent/received/read/played).
- `PUT /update-webhook-connected` / `PUT /update-webhook-disconnected` — webhooks de conexão.
- `PUT /update-every-webhooks` — corpo `{ value: url, notifySentByMe? }`, seta a mesma URL para
  todos de uma vez.

**Nenhum header de assinatura/HMAC é documentado** para verificar autenticidade do payload recebido
— diferente do WAHA, este adapter não implementa (nem pode implementar) verificação de assinatura.

O discriminador de evento é o campo `type` no corpo do webhook (não há envelope `{ event, data }`
como no uazapi — os campos do evento vêm todos no nível raiz do corpo).

| `type` | Evento canônico | Observações |
| --- | --- | --- |
| `ReceivedCallback` | `message.received` (ou `message.sent` se `fromMe: true`) | Ver detalhamento abaixo. |
| `DeliveryCallback` | `message.ack` | `ack: 'error'` se `error` presente, senão `'sent'` (chegou ao servidor do WhatsApp, não necessariamente ao destinatário). |
| `MessageStatusCallback` | `message.ack` (um evento por item de `ids`) | Ver mapeamento de `status` abaixo. |
| `ConnectedCallback` | `connection.update` (`state: 'connected'`) | |
| `DisconnectedCallback` | `connection.update` (`state: 'disconnected'`) | |
| qualquer outro valor | `unknown` | Nunca lança. |

### `fixtures/webhook-message-received.json` — REAL, copiado verbatim da doc

Evento de texto simples (`docs/webhooks/on-message-received-examples.md`). `record.phone`
representa o chat (para 1:1, o próprio remetente); `record.participantPhone` (mensagens de grupo)
seria o remetente real — inferência a partir dos nomes de campo `isGroup`/`participantPhone` do
envelope, já que o único exemplo literal capturado é uma mensagem 1:1 (`isGroup: false`,
`participantPhone: null`). **Não validado contra uma mensagem de grupo real.**

`mapMessageContent` deriva `MessageKind`/`media` a partir da CHAVE de tipo presente no corpo
(`text`, `image`, `video`, `audio`, `document`, `sticker`). Só o shape de `text: { message }` é
copiado verbatim da doc. A doc menciona a EXISTÊNCIA de dezenas de outras variantes (image, audio,
video, document, sticker, contact, location, reaction, poll, poll vote, buttons, list, templates
hidratados, carousel, chamadas, notificações de grupo/canal) sem publicar o shape de campo completo
de cada uma — **exceto** pelos nomes `image.imageUrl`/`audio.audioUrl`, confirmados indiretamente
pela nota de expiração de mídia do dossiê ("URLs em image.imageUrl, audio.audioUrl, etc. expiram...
em 30 dias"). `video.videoUrl`/`document.documentUrl`/`sticker.stickerUrl`/`caption`/`mimeType`/
`fileName` seguem esse mesmo padrão por analogia — **não confirmados individualmente contra a doc
nem contra uma instância real**. Qualquer outra chave de tipo vira `MessageKind: 'unknown'`.

### `fixtures/webhook-ack.json` e `fixtures/webhook-delivery.json` — REAIS, copiados verbatim da doc

Dois eventos distintos de "entrega/ack" existem na Z-API, ambos com exemplo JSON literal na
documentação:

- `MessageStatusCallback` (`webhook-ack.json`, usado como fixture principal do contrato de teste):
  mudanças de status no destinatário. Mapeamento `status → MessageAck`: `SENT→sent`,
  `RECEIVED→delivered`, `READ→read`, `READ_BY_ME→read` (lido a partir de outro dispositivo
  vinculado à mesma conta — sem valor canônico mais específico), `PLAYED→played`; qualquer valor não
  reconhecido cai em `'sent'` (fallback neutro, nunca lança).
- `DeliveryCallback` (`webhook-delivery.json`): confirma só a chegada ao servidor do WhatsApp: não
  tem campo `status` — carrega `error` apenas em caso de falha.

### `fixtures/webhook-connection-update.json` — RECONSTRUÍDO (correção de sintaxe, conteúdo real)

O exemplo de `ConnectedCallback` na doc original tem uma vírgula sobrando e a chave `instanceId`
duplicada (erro de digitação do próprio material fonte). A fixture usada aqui corrige só a sintaxe
JSON, mantendo os mesmos campos/valores do exemplo original:

```json
{
  "type": "ConnectedCallback",
  "connected": true,
  "momment": 26151515154,
  "instanceId": "instance.id",
  "phone": "5544999999999"
}
```

### `fixtures/webhook-disconnected.json` — REAL, copiado verbatim da doc

`DisconnectedCallback` já vinha sintaticamente válido no material fonte, sem necessidade de
correção.

## Limites e particularidades

- SaaS-only: nenhuma menção a self-hosted/on-premise em toda a documentação consultada.
- Endpoints de ação com efeito colateral (`disconnect`, `restart`, `restore-session`, `status`,
  `me`, `device`) são todos `GET` — não seguem a convenção REST usual de `POST`/`DELETE` para
  mutações. Endpoints de envio de mensagem são `POST`; endpoints de configuração de webhook são
  `PUT`.
- `send-document` exige o parâmetro `{extension}` como segmento literal da URL, não como campo do
  corpo.
- Nenhum rate limit numérico (req/s, limite por plano) foi encontrado em nenhuma página consultada.
  `HttpClient` deste pacote não retenta automaticamente `POST`/`PUT`/`PATCH`/`DELETE` (ver
  ADR-0007) — inclui `sendText`/`sendMedia`.
- `Client-Token` é opcional e desligado por padrão; se ativado, vale para TODAS as instâncias da
  conta simultaneamente, não por instância individual.
- Existe bloqueio de IP (allowlist) configurável no painel — requisições de IP não autorizado
  recebem corpo `{"error": "[IP] not allowed"}`.
- Todos os webhooks exigem HTTPS explicitamente.
- Arquivos de mídia recebidos expiram do storage da Z-API em 30 dias.
- QR code expira a cada 20 segundos; a doc recomenda polling de 10-20s e interromper após 3
  tentativas sem leitura.
- Três conceitos de "status"/"ack" distintos, para não confundir: (a) campo `status` dentro do
  próprio payload `ReceivedCallback` (`PENDING`/`SENT`/`RECEIVED`/`READ`/`PLAYED`, sobre a mensagem
  recebida em si — não usado por este adapter, que só olha a chave de tipo `text`/`image`/...); (b)
  campo `status` do `MessageStatusCallback` (mudanças de status de mensagens enviadas); (c)
  `DeliveryCallback`, que não tem campo `status` — dispara uma vez na entrega ao servidor do
  WhatsApp e carrega `error` só em caso de falha.
- Nenhuma chamada real foi feita contra `api.z-api.io` durante a pesquisa (sem credenciais) —
  formatos de erro HTTP reais (códigos, corpo) além de `200`/`405`/`415` não foram verificados na
  prática.
- Não confirmado se o objeto `challenge` (WebAuthn-like) ocasionalmente retornado pelos endpoints de
  QR/phone-code tem um fluxo de "completar o challenge" documentado — a doc só menciona sua
  existência.
- Não confirmado se `Client-Token`, quando ativo, é obrigatório também nos endpoints `GET` de
  status/qrcode ou só nos de envio — assumido que sim (vale para todos), já que cada página de
  endpoint individual lista `Client-Token` na tabela de headers.
