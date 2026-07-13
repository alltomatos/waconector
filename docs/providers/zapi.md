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
`messages.sendMedia`, `messages.sendReaction`, `messages.edit`, `messages.delete`,
`messages.forward`, `messages.pin`, `messages.unpin`, `messages.markRead` (ADR-0013 — sem
`messages.star`/`unstar`, ver seção dedicada abaixo),
`groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`, `groups.getInviteLink`, `groups.revokeInviteLink`,
`groups.joinViaInviteLink`, `groups.leaveGroup`, `contacts.list`, `contacts.get`,
`contacts.checkExists`, `contacts.getProfilePicture`, `contacts.getAbout`, `contacts.block`,
`contacts.unblock`, `chats.archive`, `chats.unarchive`, `chats.mute`, `chats.unmute`, `chats.pin`,
`chats.unpin`, `chats.markRead`, `chats.markUnread`, `webhooks.parse`.

`contacts.listBlocked` **não** foi declarada: a Z-API não expõe um endpoint de listagem de
contatos bloqueados (ver "### `contacts.listBlocked` — NÃO suportado pela Z-API" na seção
"Contatos" abaixo).

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

## Edição e exclusão de mensagem (`messages.edit`/`messages.delete`, retrofit ADR-0012)

Relatório de pesquisa dedicado a capabilities novas (2026-07-12, mesma metodologia das rodadas
anteriores — índice `llms.txt` + páginas `developer.z-api.io/<seção>/<página>` + espelho `.md` em
`raw.githubusercontent.com/Z-API/z-api-docs`).

| Operação canônica | Endpoint | Confiança | Observações |
| --- | --- | --- | --- |
| `messages.edit` | `POST /send-text`, campo opcional `editMessageId` no corpo | Alta | MESMO endpoint de `messages.sendText` — sem rota dedicada. Body `{ phone, message, editMessageId }`; `editMessageId` já era citado en passant na tabela "Operações core" acima como campo "não exposto pelo contrato atual" antes desta adição. Resposta idêntica a `send-text` (`{ zaapId, messageId, id }`), reaproveitando `mapSentMessage`. |
| `messages.delete` | `DELETE /messages?messageId=...&phone=...&owner=true\|false` | Média | **Único endpoint `DELETE` de toda a superfície Z-API pesquisada** — todos os demais efeitos colaterais já documentados neste dossiê usam `GET` (`/disconnect`, `/accept-invite-group`) ou `POST`/`PUT`. Parâmetros em **query string**, não em corpo JSON (incomum para um verbo que permite body). Resposta `204` sem corpo. |

### `messages.edit`: pré-requisito de webhook e ausências

A doc afirma explicitamente: **"É necessário configurar o webhook antes de editar"** — sem um
webhook de recebimento configurado na instância, a edição não é aplicada (mesmo requisito
documentado para `messages.forward`, ver seção dedicada abaixo). O adapter não valida
esse pré-requisito (não há como checar de dentro de uma chamada HTTP isolada) — se a instância não
tiver webhook configurado, a chamada provavelmente é aceita (`200`) mas sem efeito real no
WhatsApp, **não confirmado contra uma instância real**. Também não confirmado: se a Z-API preserva
o `messageId` original (comportamento do WhatsApp oficial) ou gera um novo; nem uma janela de tempo
para editar (a doc não menciona limite, diferente do ~15min real do WhatsApp).

### `messages.delete`: decisão de mapeamento do parâmetro `owner`

`owner` (booleano) indica se a mensagem original foi enviada **pela própria instância** (`true`) ou
**recebida** (`false`) — a doc não esclarece se esse campo controla o **escopo** da exclusão
(apagar só para mim vs. revogar/apagar para todos) ou é só um metadado informativo; não há um
parâmetro separado tipo `deleteForEveryone`. `DeleteMessageInput` do contrato canônico só carrega
`to`/`messageId` (ADR-0012 não modela escopo/`onlyLocal`), sem indicar quem enviou a mensagem
original. Este adapter sempre envia **`owner: true`**: a semântica assumida por `messages.delete`
no contrato é "sempre revogação" (apagar para todos), e no protocolo real do WhatsApp só é possível
revogar uma mensagem que a própria conta enviou — apagar uma mensagem recebida só teria efeito
"local", fora do que este contrato modela. **Não validado contra uma instância real**: se uma
chamada mostrar comportamento diferente para mensagens com `fromMe: false`, revisitar esta decisão.
Também não há janela de tempo documentada (o WhatsApp oficial limita edição/exclusão-para-todos a
~15min–2 dias dependendo da versão; a Z-API não menciona limite algum).

## Ações sobre mensagem (`messages.forward`/`pin`/`unpin`/`markRead`, ADR-0013)

Continuação da pesquisa acima. **Sem `messages.star`/`unstar`** — não há rota `*star*` em nenhuma
página consultada (índice `llms.txt` completo); busca negativa confirmada, não gap de pesquisa.

| Operação canônica | Endpoint | Confiança | Observações |
| --- | --- | --- | --- |
| `messages.forward` | `POST /forward-message` | Média-Alta | Body `{phone, messageId, messagePhone}` — `phone` é o DESTINO (`input.to`); `messagePhone` é a ORIGEM da mensagem (`ForwardMessageInput.fromChatId`), **obrigatório para este provider especificamente** (diferente de outros adapters, a Z-API não resolve a origem sozinha a partir do `messageId`). Quando `fromChatId` está ausente, este adapter usa `phone` (destino) também como origem — best-effort, **não confirmado contra instância real**. Resposta: `{zaapId}` só — **não** o trio completo `{zaapId, messageId, id}` de `send-text`/`send-media`; `mapSentMessage` cai no fallback de id sintético. Mesmo pré-requisito de webhook configurado que `messages.edit` (ver acima). |
| `messages.pin` / `messages.unpin` | `POST /pin-message` | Média-Alta | Body `{phone, messageId, messageAction: "pin"\|"unpin", pinMessageDuration}`. A doc afirma explicitamente que `pinMessageDuration` **"does not have effect in the case of unfixing a message"** — enviado sempre (mesmo em `unpin`), ignorado pelo provider nesse caso. Valores documentados: `"24_hours"`, `"7_days"`, `"30_days"` (mesmas 3 opções do recurso oficial do WhatsApp). `PinMessageInput` não expõe duração (ADR-0013); este adapter usa **`"24_hours"`** como default, decisão própria. Fixa a MENSAGEM dentro do chat — distinto de `chats.pin` (conversa inteira, endpoint `/modify-chat`, ADR-0012). Não confirmado se a Z-API replica algum limite de mensagens fixadas simultâneas do app oficial. |
| `messages.markRead` | `POST /read-message` | Alta | Body `{phone, messageId}`. Resposta `204` vazia. Marca UMA mensagem específica como lida (envia o "azulzinho" de leitura ao remetente) — distinto de `chats.markRead` (chat inteiro, `/modify-chat` com `action: "read"`, ADR-0012). |

`phone`/`messagePhone` em todas as 3 operações passam por `toZapiPhone`, mesma conversão de
`messages.sendText`/`contacts.*` — não o tratamento sintético de `groupId` (ver seção "Grupos"
acima).

## Conteúdo estruturado (`messages.sendLocation`/`sendContactCard`/`sendPoll`, ADR-0014)

Cobertura 3/3. `sendPoll` já estava no relatório de pesquisa original desta rodada (confiança
Média-Alta); `sendLocation`/`sendContactCard` **não estavam** — confirmados via verificação ao
vivo (`developer.z-api.io` + mirror GitHub raw da doc) durante a implementação desta ADR.

| Operação canônica | Endpoint | Confiança | Observações |
| --- | --- | --- | --- |
| `messages.sendLocation` | `POST /send-location` | Alta (verificação ao vivo) | Body `{phone, title, address, latitude, longitude}` — `SendLocationInput.name` mapeia para `title` (ambos tratados como o mesmo rótulo do pin); campos ausentes no input não são enviados. Resposta: mesmo shape `{zaapId, messageId, id}` de `send-text`. |
| `messages.sendContactCard` | `POST /send-contact` | Alta (verificação ao vivo) | Body `{phone, contactName, contactPhone}` — campos soltos, **sem vCard**: diferente de Whapi/Wuzapi, este provider aceita nome/telefone diretamente e monta a mensagem de contato internamente (não precisa de um helper `buildVcard` como os outros dois). |
| `messages.sendPoll` | `POST /send-poll` | Média-Alta | Body `{phone, message, poll: [{name}], pollMaxOptions}` — `question` mapeia para `message`; `options` mapeia para um array de OBJETOS `{name}` (não strings soltas, diferente da maioria dos outros adapters pesquisados). `pollMaxOptions: 1` é a forma documentada de simular escolha única; a doc afirma que sem esse campo o padrão parece ser múltipla escolha — este adapter sempre envia o valor explícito (`options.length` para múltipla escolha) em vez de depender desse default implícito não confirmado contra instância real. Endpoint irmão `POST /send-poll-vote` existe para a própria instância votar (`{phone, pollMessageId, pollVote: [{name}]}`) — fora do escopo desta ADR (só ENVIO). |

## Presença — NÃO implementado (ADR-0015)

**Busca negativa confirmada, 0/3**: este é o único adapter da fila sem nenhuma das 3 capabilities
de `presence.*`. Só existe `delayTyping` (1-15s) como parâmetro de `send-text` — atrasa a
*entrega* mostrando "digitando…" durante o delay, não é um controle de presença independente do
envio de uma mensagem real — e um webhook de *recepção* (`PresenceChatCallback`, configurável via
`PUT /instances/{id}/token/{token}/update-webhook-chat-presence`, payload `{type:
"PresenceChatCallback", phone, status, lastSeen, instanceId}` com `status` em `UNAVAILABLE|
AVAILABLE|COMPOSING|PAUSED|RECORDING`). Nenhum endpoint de *envio* de indicador de digitação/
gravação nem de presença global (online/offline) foi encontrado no índice completo da doc
(`llms.txt`) nem nas páginas de mensagem — limitação real do provider, não gap de pesquisa.

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

## Etiquetas (`labels.list`, ADR-0016)

Cobertura 1/6 — só `labels.list`, mesmo critério de "não arredondar cobertura" já aplicado ao
`presence.*` deste mesmo adapter (0/3, acima).

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `labels.list` | `GET /instances/{id}/token/{token}/tags` | Confiança Média-Alta — payload confirmado no dossiê: `[{id, name, color}]`. Tipo exato de `color` não confirmado (número ou string); `mapZapiLabel` aceita os dois, mesmo critério defensivo já usado no adapter WAHA. **Restrição de plataforma documentada verbatim**: "Este método está disponível apenas para dispositivos conectados a versão Multi-Devices do WhatsApp" — mesma classe de restrição já vista para os estados `paused`/`recording` de presença (ADR-0015), não uma limitação deste adapter. |

**`create`/`update`/`delete`/`addToChat`/`removeFromChat` deliberadamente NÃO implementados** — os
endpoints (`create-tag`/`edit-tag`/`delete-tag`/`tags-add`/`tags-remove`) aparecem só por NOME no
índice completo da doc oficial; nenhuma página individual foi aberta para confirmar payload/schema.
Confiança Baixa demais para declarar nesta rodada — mesmo critério de "declarar só o que o
relatório confirma com payload real" já aplicado a outras capabilities de baixa confiança neste
adapter (ex.: `presence.*`, 0/3).

## Canais (`channels.create`, ADR-0017)

Cobertura 1/6 — só `channels.create`, mesmo critério de "não arredondar cobertura" já aplicado a
`labels.*`/`presence.*` deste mesmo adapter.

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `channels.create` | `POST /instances/{id}/token/{token}/create-newsletter` | Confiança Média-Alta — payload real confirmado no dossiê. Body `{name, description?}` — **não aceita foto na criação** (a doc diz explicitamente que imagem não é suportada nesse endpoint; precisaria de `update-newsletter-picture` depois, fora do escopo desta ADR). Resposta: `{id: "999999999999999999@newsletter"}` — só o id, sem `name`/`description` ecoados; este adapter usa o `input` (nome/descrição enviados) como fallback para popular o resto do `ChannelInfo`. |

**Demais 8 operações do índice (`newsletter-list`, `update-newsletter-name`/`description`/
`picture`/`config`, `delete-newsletter`, `follow`/`unfollow-newsletter`) deliberadamente NÃO
implementadas** — só confirmadas por NOME no índice completo da doc oficial; nenhuma página
individual foi aberta para confirmar payload/schema. Confiança Baixa demais para declarar nesta
rodada — mesmo critério de "declarar só o que o relatório confirma com payload real" já aplicado a
`labels.*`/`presence.*` deste adapter.

## Perfil comercial — NÃO implementado (ADR-0018)

**`business.getProfile` deliberadamente NÃO implementado** — existe um endpoint candidato
(`GET /instances/{id}/token/{token}/business/profile?phone=...`, payload real capturado no
dossiê original: `{description, address, email, websites, categories, businessHours,
hasCoverPhoto}`), mas o parâmetro `phone` **exige o alvo da consulta**, mesmo padrão já usado por
`contacts.getProfilePicture`/`getAbout` DESTE MESMO adapter (que recebem `chatId`) — ou seja, é
provavelmente uma consulta ao perfil comercial de UM CONTATO específico, não "meu próprio perfil"
(o que `BusinessApi.getProfile()` modela, sem nenhum parâmetro). Este adapter não implementa
`instance.getDevice`/`GET /device` (que teria o telefone da própria instância conectada) nem
qualquer outro meio barato de obter o "próprio número" para testar a hipótese de auto-consulta —
descasamento de FORMA de capability, não gap de confiança no payload (ver ADR-0018, Contexto/
Alternativas). Candidata para uma futura `contacts.getBusinessProfile(chatId)`, não para esta ADR.
Sem endpoint de edição (`PUT`/`POST`) encontrado no índice pesquisado — `business.updateProfile`
também não implementado.

## Chamadas de voz (`calls.make`, ADR-0019)

Cobertura 1/2 — só `make`, confiança Média-Alta.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `calls.make` | `POST /instances/{id}/token/{token}/send-call` | Body `{phone, callDuration? (padrão 5s, máx 15s documentado — não validado por este adapter, deixado para o provider rejeitar), callAudioUrl?}` — `callAudioUrl` (tocar um áudio durante a "chamada") não exposto pelo contrato canônico: só funciona "para contas que possuem a funcionalidade de chamadas habilitada" (feature paga/opt-in adicional, não confirmada universal). Resposta `{zaapId, messageId, id}` — ignorada, contrato exige `Promise<void>`. |

**`calls.reject` deliberadamente NÃO implementado** — busca no índice de endpoints não encontrou
uma ação "rejeitar ESTA chamada". Os únicos campos relacionados (`callRejectAuto`/
`callRejectMessage`, vistos em `GET /me`) são uma CONFIGURAÇÃO de conta (auto-rejeição automática +
mensagem enviada ao rejeitar), não uma ação invocável sob demanda — limitação real do provider
(ou, no mínimo, do que a pesquisa encontrou), não gap de confiança.

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
| `groups.updateSubject` | `POST /update-group-name` | Body `{ groupId, groupName }` — `subject` de entrada (já validado não-vazio pelo conector) mapeado para `groupName` (nome de campo **não** é `subject`/`groupSubject`, desvio confirmado na pesquisa). `groupId` no **corpo**, verbatim. Resposta `{ value: true }` — `void`. |
| `groups.updateDescription` | `POST /update-group-description` | Body `{ groupId, groupDescription }` — `description` mapeado para `groupDescription` (não `description`). String vazia é aceita e limpa a descrição do grupo (comportamento assumido pela pesquisa como suportado por todos os providers do pacote; não testado contra uma instância Z-API real). Resposta `{ value: true }` — `void`. |
| `groups.updatePicture` | `POST /update-group-photo` | Body `{ groupId, groupPhoto }` — `groupPhoto` reaproveita `resolveMediaValue` (mesma função usada por `messages.sendMedia`): aceita `media.url` diretamente ou monta uma data URI `data:<mime>;base64,...` a partir de `media.base64` (usando `media.mimeType` ou o mimetype-padrão de imagem quando ausente). `media.kind === 'image'` já é garantido pelo conector antes de chegar ao adapter. Resposta `{ value: true }` — `void`. |

**Assunção não validada contra uma instância real (as três operações acima)**: rotas, nomes de
campo (`groupName`/`groupDescription`/`groupPhoto`) e shape de resposta (`{ value: true }`) vêm da
pesquisa da documentação oficial da Z-API para esta adição — nenhuma chamada real foi feita contra
`api.z-api.io/.../update-group-*` durante o levantamento (sem credenciais). Em particular, não foi
confirmado se `groupPhoto` aceita OS DOIS formatos (URL e data URI base64) com a mesma flexibilidade
documentada para os campos de mídia de `send-image`/`send-video`/etc., nem se a Z-API teria alguma
exigência adicional (dimensão, proporção, tamanho máximo) para a foto de grupo.

### Convite/saída de grupo (`getInviteLink`/`revokeInviteLink`/`joinViaInviteLink`/`leaveGroup`)

Fonte primária: `developer.z-api.io/group/*` (páginas `group-invitation-link`,
`redefine-invitation-link`, `accept-invite-group`, `leave-group`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.getInviteLink` | `GET /group-invitation-link/{groupId}` | `groupId` no **path**, verbatim (opaco, mesma convenção da tabela acima). Resposta confirmada: `{ phone, invitationLink }` — `invitationLink` já vem como link completo (`https://chat.whatsapp.com/<código>`). O adapter passa o valor por `normalizeInviteLink` mesmo assim (idempotente quando já é um link completo), como camada defensiva — mesmo padrão adotado pelos adapters Evolution GO/Wuzapi para este campo. |
| `groups.revokeInviteLink` | `POST /redefine-invitation-link/{groupId}` | `groupId` no **path**, verbatim; **sem corpo** (nenhum campo de corpo documentado). Resposta confirmada: `{ invitationLink }` — o NOVO link completo (o anterior deixa de funcionar). Mesmo mapeamento de `getInviteLink` (via `normalizeInviteLink`). |
| `groups.joinViaInviteLink` | `GET /accept-invite-group` | Query param `url` recebe a URL **completa** do convite — a doc não confirma que o endpoint aceita só o código bare, então o adapter usa `input.invite` diretamente (já normalizado como link completo pelo conector, ver `WaConnector.prepareJoinViaInviteLink`), **sem** `extractInviteCode`. Resposta confirmada `{ success: true }` — ignorada (`Promise<void>`). **Quirk de método**: é `GET` apesar do efeito colateral, mesma particularidade já documentada para `/disconnect`. |
| `groups.leaveGroup` | `POST /leave-group` | Corpo `{ groupId }` — `groupId` no **corpo** (diferente das duas operações de convite acima, que levam no path), verbatim (opaco). Resposta confirmada `{ value: true }` — `void`. |

**Assunções não validadas contra uma instância real (as quatro operações acima)**: nenhuma chamada
real foi feita contra `api.z-api.io/.../group-invitation-link`, `/redefine-invitation-link`,
`/accept-invite-group` ou `/leave-group` durante o levantamento (sem credenciais) — rotas, nomes de
campo e shapes de resposta vêm só da documentação oficial. Em particular:

- Não confirmado se `GET /accept-invite-group` de fato aceita a URL completa do convite no query
  param `url` (em vez de só o código bare) — a doc não traz um exemplo de requisição completo para
  este endpoint. Diferente do Wuzapi (que a pesquisa já marca como **confiança média** e trata como
  aceitando só o código, via `extractInviteCode`), aqui a decisão foi enviar o link completo por
  ausência de evidência em contrário — se uma instância real rejeitar esse formato, a correção é
  trocar para `extractInviteCode(input.invite)` no query param.
- Não confirmado se `POST /redefine-invitation-link/{groupId}` de fato dispensa corpo, ou se aceita/
  exige algum campo opcional não documentado.
- Não confirmado o comportamento de `GET /accept-invite-group`/`POST /leave-group` quando o
  chamador já é membro do grupo (idempotência) ou quando o convite expirou/foi revogado — a doc não
  documenta um código de erro dedicado para nenhum desses casos.

### Limitações e assunções não confirmadas contra uma instância real

- Nenhuma chamada real foi feita contra `api.z-api.io/.../group/*` durante a pesquisa (sem
  credenciais) — os shapes de resposta acima vêm da documentação oficial, não de uma instância
  viva.
- `groups.list` devolve `participants: []` para todo item por limitação do endpoint `GET /groups`
  (não do adapter) — ver tabela acima.
- Webhooks de eventos de grupo chegam pelo mesmo `type: "ReceivedCallback"` de mensagem, discriminados
  por `record.notification` — ver "### Webhooks de grupo" abaixo para o que é e o que não é mapeado
  para `group.update` nesta fase (parcial: só as 5 variantes de participante).

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
| `ReceivedCallback` com `notification` de participante (`GROUP_PARTICIPANT_ADD`/`REMOVE`/`LEAVE`/`PROMOTE`/`DEMOTE`) | `group.update` | Ver "### Webhooks de grupo" abaixo — implementado PARCIALMENTE. |
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

### Webhooks de grupo

Eventos de grupo **não têm webhook de configuração dedicado**: chegam pelo MESMO `type:
"ReceivedCallback"` já usado para mensagens, discriminados por um campo adicional
`notification` (string, enum) presente no mesmo `record` — não há envelope `{ event, data }`
aninhado, nem um `type` próprio de grupo.

**Envelope confirmado** (schema comum a TODAS as notificações, exemplificado literalmente na
pesquisa para `MEMBERSHIP_APPROVAL_REQUEST`/`REVOKED_MEMBERSHIP_REQUESTS` — dois valores do enum
ADJACENTES, mas DIFERENTES dos 10 valores `GROUP_*` tratados aqui):

```json
{
  "isGroup": true,
  "isNewsletter": false,
  "instanceId": "...",
  "messageId": "...",
  "phone": "5544999999999-group",
  "connectedPhone": "...",
  "fromMe": false,
  "momment": 1700000000000,
  "status": "RECEIVED",
  "type": "ReceivedCallback",
  "notification": "GROUP_PARTICIPANT_ADD",
  "notificationParameters": ["5511999999999", "5511988887777"]
}
```

O enum completo de `notification` é confirmado **por nome** na doc (10 valores `GROUP_*`):
`GROUP_CREATE`, `GROUP_CHANGE_SUBJECT`, `GROUP_CHANGE_DESCRIPTION`, `GROUP_CHANGE_ICON`,
`GROUP_PARTICIPANT_PROMOTE`, `GROUP_PARTICIPANT_DEMOTE`, `GROUP_PARTICIPANT_LEAVE`,
`GROUP_PARTICIPANT_ADD`, `GROUP_PARTICIPANT_REMOVE`, `GROUP_PARTICIPANT_INVITE`. **Nenhum desses 10
valores tem payload literal capturado na pesquisa** — só os 2 valores adjacentes citados acima têm
exemplo real, e eles não são notificações `GROUP_*`.

#### Implementado (confiança razoável: mesmo envelope estrutural dos 2 exemplos confirmados)

As 5 variantes de **participante** são mapeadas para `group.update`, com `groupId = record.phone` e
`participants = record.notificationParameters` (array de telefones — nesta fase, sem passar por
`mapGroupParticipant`: esse helper converte um `Record` de `groups.getInfo`/`{ phone, isAdmin,
isSuperAdmin, ... }` para `GroupParticipant`; aqui `notificationParameters` já chega como
`string[]` de telefones, sem objeto para desestruturar, então a reutilização não se aplica):

| `notification` | `action` canônico | Observação |
| --- | --- | --- |
| `GROUP_PARTICIPANT_ADD` | `'participants.add'` | |
| `GROUP_PARTICIPANT_REMOVE` | `'participants.remove'` | |
| `GROUP_PARTICIPANT_LEAVE` | `'participants.remove'` | **Mesma `action` de REMOVE, deliberadamente**: do ponto de vista canônico ambos resultam em "não é mais participante do grupo", e `GroupUpdateEvent.action` não tem um valor dedicado para distinguir "saiu por conta própria" de "foi removido por um admin". Quem precisar da distinção original ainda pode inspecionar `raw.notification`. |
| `GROUP_PARTICIPANT_PROMOTE` | `'participants.promote'` | |
| `GROUP_PARTICIPANT_DEMOTE` | `'participants.demote'` | |

Cada notificação gera exatamente **um** `GroupUpdateEvent` (nunca múltiplos eventos a partir de um
único payload de entrada): ao contrário de providers baseados em whatsmeow (Evolution GO/Wuzapi),
que reportam várias mudanças simultâneas dentro de um único payload de webhook, a Z-API reporta UM
`notification` por chamada — múltiplos participantes afetados pela MESMA ação (ex.: dois números
adicionados juntos) aparecem como múltiplas entradas em `notificationParameters` de UM único evento,
não como eventos separados.

#### Deliberadamente NÃO implementado (zero exemplo de payload — seria adivinhação)

`GROUP_CREATE`, `GROUP_CHANGE_SUBJECT`, `GROUP_CHANGE_DESCRIPTION`, `GROUP_CHANGE_ICON` e
`GROUP_PARTICIPANT_INVITE` **não** são reconhecidos como `group.update` nesta fase. Motivo: nenhum
desses 5 valores tem um payload de exemplo capturado na pesquisa, então não há como confirmar onde
viria o "novo valor" de cada mudança (o novo `subject`? a nova `description`? o link/código do
convite?) — implementar seria inventar um formato de campo sem base real, o que a ADR-0002/ADR-0003
proíbem explicitamente. Esses 5 valores de `notification` são ignorados silenciosamente pelo branch
de grupo; o `record` segue para o dispatch de mensagem comum (`mapZapiMessage`), que por sua vez cai
em `MessageKind: 'unknown'` (não tendo nenhuma chave de conteúdo reconhecida) — nunca em `unknown`
de EVENTO, já que o `type` de nível superior (`"ReceivedCallback"`) continua sendo reconhecido.

#### `fixtures/webhook-group-participant-add.json` — RECONSTRUÍDO (nível de confiança: parcial)

Fixture montada a partir do envelope comum confirmado (campos e nomes reais) + o valor de enum
`GROUP_PARTICIPANT_ADD` (confirmado por nome, mas sem payload literal próprio) + valores de exemplo
inventados para `messageId`/`phone`/`notificationParameters` (formato plausível, não copiados de
nenhum payload real). **Precisa de validação contra uma instância real** antes de se apoiar nela em
produção — especialmente para confirmar (a) que `notificationParameters` de fato contém telefones em
texto puro (dígitos, sem `@`) e não algum outro formato (JID, objeto), e (b) que os outros 4 valores
de participante (`REMOVE`/`LEAVE`/`PROMOTE`/`DEMOTE`) realmente compartilham o mesmo envelope.

## Contatos

Fonte primária: `developer.z-api.io/chats/*` e `developer.z-api.io/instance/*` (páginas `contacts`,
`contact`, `phone-exists`, `profile-picture`). Ver ADR-0010 para o contrato canônico (`Contact`,
`CheckExistsResult`, `ContactProfilePicture`, `ContactAbout`) e a regra de ouro desta capability:
cada operação mapeia para **UMA ÚNICA** chamada HTTP — nenhuma é composta de múltiplas chamadas.

### `chatId`/`phone` de contato NÃO é opaco

Diferente do `groupId` (opaco, ver seção "Grupos" acima), o identificador de contato é o MESMO
chatId canônico usado por `messages.*`: dígitos DDI+DDD+número (sem `+`) para a imensa maioria dos
casos, ou um JID explícito intacto — inclusive um `"...@lid"` opaco nos casos raros de contato com
privacidade ativada (o WhatsApp usa um "Linked ID" em vez do telefone real). O adapter reaproveita
`toZapiPhone` (a mesma função de `messages.*`/participantes de grupo) nos **dois sentidos**: para
montar o path/query da requisição (canônico → Z-API) e para mapear o `phone`/`lid` de volta de uma
resposta (Z-API → canônico). Isso é seguro porque a regra de `toZapiPhone` é simétrica: qualquer
string com `"@"` é tratada como JID e passa intacta nos dois sentidos; qualquer outra vira dígitos
puros (idempotente quando já são dígitos puros).

### Operações

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `contacts.list` | `GET /contacts` | Exige paginação (`page`, `pageSize`) como query params — `ContactsApi.list()` não expõe paginação no contrato canônico, então o adapter usa o mesmo default fixo já adotado por `groups.list` (`page=1, pageSize=100`). Resposta: array de `{ name?, short?, notify?, vname?, phone }`. `id` vem de `phone` (convertido para o formato canônico via `toZapiPhone`); `name` vem de `name` (fallback `notify`, fallback `short`). **Limitação**: este endpoint NÃO devolve `about`/`imgUrl`/confirmação de "tem WhatsApp" — todo `Contact` desta lista vem com `about`/`profilePictureUrl`/`hasWhatsApp` indefinidos. |
| `contacts.get` | `GET /contacts/{phone}` | `phone` no **path**, convertido do chatId canônico via `toZapiPhone`. Resposta MAIS RICA entre os providers pesquisados para esta capability: `{ name, phone, notify, short, imgUrl, about }` num único endpoint. Mapeamento: `name` (fallback `notify`) → `name`, `imgUrl` → `profilePictureUrl`, `about` → `about`; `id` cai de volta no `phone` da resposta (convertido ao canônico), com fallback no chatId requisitado. **SEM `hasWhatsApp` explícito** — é isso que `contacts.checkExists` confirma. |
| `contacts.checkExists` | `GET /phone-exists/{phone}` | `phone` no **path** — **cuidado**: a doc oficial rotula a seção como "Query Parameters", mas o exemplo `curl` real confirma que é path; o adapter segue o `curl`, não o cabeçalho de prosa. Resposta: ARRAY com um único item, `[{ exists, phone, lid }]` (`lid` é `string \| null`). O adapter pega o primeiro item; mapeia `exists` → `exists`, e `lid` (quando presente — contato com privacidade ativada) OU `phone` → `chatId`, ambos convertidos ao canônico via `toZapiPhone`. |
| `contacts.getProfilePicture` | `GET /profile-picture` | `phone` como **query param** (não path, diferente de `get`/`checkExists`). Resposta: `{ link: string }` → `ContactProfilePicture.url`. `link` ausente/vazio (contato sem foto, ou privacidade que bloqueia) vira `url: undefined`, nunca lança. |
| `contacts.getAbout` | `GET /contacts/{phone}` | **MESMO endpoint de `contacts.get`** — o adapter reaproveita a mesma função interna de requisição (`fetchContactDetail`) em vez de compor uma segunda chamada (ADR-0010: uma operação canônica, uma chamada HTTP). O campo `about` já vem embutido nessa resposta. |
| `contacts.block` | `POST /contacts/modify-blocked` | Body `{ phone, action: 'block' }` — `phone` via `toZapiPhone`. Resposta confirmada `{ value: true }` — ignorada (`void`). |
| `contacts.unblock` | `POST /contacts/modify-blocked` | **MESMO endpoint de `contacts.block`** — discriminado só pelo valor do campo `action` (`'unblock'` em vez de `'block'`), mesmo body `{ phone, action }`. Resposta idêntica, ignorada. |

### `contacts.listBlocked` — NÃO suportado pela Z-API

Busca exaustiva nas 273 páginas do índice completo da documentação oficial (`contacts/*`,
`chats/*`, `privacy/*`, etc., via `developer.z-api.io/llms.txt`) não encontrou nenhum endpoint de
**listagem** de contatos bloqueados — só o par de escrita (`POST /contacts/modify-blocked`, ver
tabela acima) foi confirmado. Por isso a capability `contacts.listBlocked` **não** é declarada nem
implementada por este adapter (mesma regra já seguida para `contacts.getAbout` na uazapi — ver
docs/providers/uazapi.md#contactsgetabout--não-suportado-pela-uazapi).

**Não confundir com `GET /privacy/get-disallowed-contacts`**: esse endpoint existe e é documentado,
mas é uma feature adjacente e DIFERENTE — uma blacklist de **privacidade** por capability (quem
fica de fora de "visto por último", foto de perfil, descrição, etc., configurável em
`privacy/*`), não a lista de contatos efetivamente bloqueados (que impede troca de mensagens). Um
contato pode estar na lista de "não mostrar meu status" sem estar bloqueado, e vice-versa — por
isso `get-disallowed-contacts` não é usado como substituto de `listBlocked`.

### Limitações e assunções não confirmadas contra uma instância real

- Nenhuma chamada real foi feita contra `api.z-api.io/.../contacts`, `/phone-exists/*` ou
  `/profile-picture` durante a pesquisa (sem credenciais) — rotas, nomes de campo e shapes de
  resposta vêm só da documentação oficial.
- `contacts.list` nunca preenche `about`/`profilePictureUrl`/`hasWhatsApp` — limitação do endpoint
  `GET /contacts` (que devolve um objeto leve), não um bug do adapter. Para esses campos, use
  `contacts.get`/`getProfilePicture`/`checkExists` por contato.
- `contacts.get` não confirma "tem WhatsApp" (`hasWhatsApp` fica sempre `undefined` nesta
  operação) — só `contacts.checkExists` confirma isso.
- `isBlocked` fica sempre `undefined` em todas as operações desta capability: nenhum endpoint
  pesquisado da Z-API expõe esse dado.
- Não confirmado se `GET /phone-exists/{phone}` de fato aceita apenas dígitos no path para
  qualquer formato de telefone (DDI+DDD+número) ou se há alguma normalização adicional exigida
  pelo provider.

## Conversas (`chats.*`, retrofit ADR-0012)

Namespace novo (ADR-0012) de gestão de estado de conversa. As 8 operações candidatas dividem o
**mesmo endpoint** `POST /instances/{id}/token/{token}/modify-chat`, discriminadas só pelo campo
`action` — mesmo padrão "um endpoint, N verbos" já usado por `contacts.block`/`unblock` acima.

| Operação canônica | `action` | Confiança | Observações |
| --- | --- | --- | --- |
| `chats.archive` | `"archive"` | Média-Alta | Body `{ phone, action }` → resposta `{ value: true }`, ignorada. |
| `chats.unarchive` | `"unarchive"` | Média-Alta | Par simétrico de `archive`. |
| `chats.mute` | `"mute"` | Média-Alta | **Gap notável**: a doc não expõe duração de silenciamento (8h/1 semana/sempre, como no app oficial) — só um booleano ligado/desligado. Limitação real do endpoint, não do adapter: qualquer uso deste método só resulta em mute permanente/indefinido até `unmute` explícito, coerente com a decisão de ADR-0012 de não modelar duração nesta fase (nenhum formato de duração converge entre os providers pesquisados). |
| `chats.unmute` | `"unmute"` | Média-Alta | Par simétrico de `mute`. |
| `chats.pin` | `"pin"` | Média-Alta | Fixa a CONVERSA no topo da lista — **distinto de `messages.pin`** (fixar uma MENSAGEM dentro do chat, candidata fora do escopo desta ADR, com endpoint Z-API completamente diferente, `POST /pin-message`). Não confirmado se a Z-API replica o limite de 3 conversas fixadas simultaneamente do app oficial. |
| `chats.unpin` | `"unpin"` | Média-Alta | Par simétrico de `pin`. |
| `chats.markRead` | `"read"` | Alta | Confirmado em `developer.z-api.io/chats/read-chat` ("Ler chats"): "responsável por realizar a ação de ler um chat como um todo, ou também marcar um chat como não lido" — mesmo endpoint/shape dos demais 6 verbos. **Correção (verificação adversarial de 2026-07-12)**: uma primeira rodada de implementação não encontrou esta página e declarou `markRead`/`markUnread` como "não suportado"; a página existe no mesmo diretório `docs/chats/` já citado para as demais 6 ações. |
| `chats.markUnread` | `"unread"` | Alta | Par simétrico de `markRead`, mesma página/endpoint. |

`chatId` (diferente de `groupId`, opaco — ver seção "Grupos" acima) passa por `toZapiPhone`, MESMA
conversão de `contacts.*`/`messages.*` — coerente com ADR-0012 (um "chat" é o mesmo alvo
endereçável de `messages.sendText`, indivíduo ou grupo via JID explícito, não o tratamento opaco
de `groupId`).

`chats.markRead`/`chats.markUnread` (nível de CHAT INTEIRO, via `/modify-chat`) são operações
distintas de `POST /read-message` (`{ phone, messageId }`, nível de UMA mensagem específica) — o
segundo corresponderia a um eventual `messages.markRead` futuro, fora do escopo desta ADR (ADR-0012
distingue explicitamente os dois mecanismos).

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
