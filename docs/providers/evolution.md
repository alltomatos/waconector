# Dossiê: Evolution GO

- Docs oficiais: <https://docs.evolutionfoundation.com.br/evolution-go>
- Versão testada: documentação consultada em 2026-07-10
- Hospedagem: self-hosted (imagem Docker; requer ativação de licença via Manager UI antes do uso)

> **Atenção de nomenclatura**: "Evolution GO" (este dossiê) é um projeto **distinto** do mais
> conhecido "Evolution API" (Node/Baileys), da mesma fundação. Apesar da marca semelhante, o
> wire-format (casing de campos, forma dos webhooks) é diferente entre os dois. Não reaproveitar
> adapter/fixtures de um para o outro.

## Autenticação

Um único header HTTP custom, `apikey` (não é `Authorization`, não é Bearer, não é query string),
carrega um de dois tipos de segredo:

1. **GLOBAL_API_KEY** (env var do servidor) — exigido nas rotas **admin** (criar/listar/consultar/
   deletar instância). Comparação literal contra o valor configurado no servidor.
2. **token da instância** (escolhido pelo chamador ao criar a instância) — exigido nas rotas
   **operacionais**: connect, status, qr, pair, disconnect, reconnect, logout e todas as rotas
   `/send/*`, `/message/*`, `/user/*`, `/group/*`, `/chat/*`, `/label/*`, `/newsletter/*`,
   `/community/*`. O servidor resolve a instância dona do token a partir do próprio header — **não
   existe** `instanceId` separado no header/rota nessas chamadas: o token já identifica a
   instância.

Ambos os tipos de segredo compartilham o mesmo nome de header; a diferença é puramente qual valor
vai nele e qual família de rotas está sendo chamada. Algumas rotas admin adicionais também levam
`:instanceId` como parâmetro de path (ex.: `GET /instance/info/:instanceId`,
`DELETE /instance/delete/:instanceId`) mantendo `apikey=GLOBAL_API_KEY` no header.

Este adapter (F1) só implementa capabilities que usam rotas **operacionais** — portanto
`EvolutionOptions.apiKey` deve ser o **token da instância**, não o `GLOBAL_API_KEY`.

## Modelo de instância/sessão

Terminologia do provider: **"instance"** (documentação em português usa "instância"). Não usa
"session"/"channel".

- `POST /instance/create` (header `apikey=GLOBAL_API_KEY`) — cria a instância, define `name` e
  `token`. Fora do escopo deste adapter em F1 (rota admin).
- `POST /instance/connect` (header `apikey=<token da instância>`) — inicia o client whatsmeow e
  começa a geração do QR. Corpo aceita `webhookUrl`, `subscribe` (categorias de evento ou `ALL`),
  `immediate`, `phone`, `rabbitmqEnable`/`websocketEnable`/`natsEnable`. Resposta:
  `{"message":"success","data":{"jid":"","webhookUrl":"...","eventString":"..."}}` — **não**
  inclui o QR code em si.
- `GET /instance/qr` (header `apikey=<token da instância>`) — busca o QR gerado
  separadamente. `data`: `{"qrcode":"data:image/png;base64,...","code":"2@AbCdEf..."}` (campos
  minúsculos, confirmados via struct/json tags). Pode retornar `passkeyStage`/`passkeyOpenUrl`/
  `passkeyCode` quando a conta exige cerimônia de passkey em vez de QR escaneável.
- `POST /instance/pair` — suporta pairing code (`data.PairingCode`, sem json tag — serializa
  capitalizado). **Confirmado como suportado pelo provider**, porém fora do escopo declarado desta
  fase (F1 não lista `instance.pairingCode`); não implementado neste adapter.
- `GET /instance/status` (header `apikey=<token>`) — `data` é um struct Go **sem** json tags,
  serializa capitalizado: `{"Connected": bool, "LoggedIn": bool, "Name": string}`.
- `DELETE /instance/logout` (header `apikey=<token>`, corpo vazio) — logout completo, apaga a
  sessão; exige novo QR/pairing depois. Distinto de `POST /instance/disconnect` (soft disconnect,
  mantém sessão, retomável via `POST /instance/reconnect`) e de
  `DELETE /instance/delete/{instanceId}` (admin, `GLOBAL_API_KEY`, apaga a instância
  permanentemente — irreversível). Somente `logout` está no escopo F1.

### Mapeamento de estado (`GET /instance/status` → `InstanceState` canônico)

| `Connected` | `LoggedIn` | Significado do provider | `InstanceState` canônico |
| --- | --- | --- | --- |
| `false` | `false` | nunca conectada / deslogada | `disconnected` |
| `true` | `false` | socket aberto, aguardando escanear QR/pairing | `qr` |
| `true` | `true` | conectada e autenticada (sessão ativa) | `connected` |
| `false` | `true` | credenciais existem, socket caiu temporariamente (precisa de `/instance/reconnect`) | `connecting` *(suposição — ver "Limites e particularidades")* |
| qualquer valor não-booleano/ausente | — | formato inesperado | `unknown` (nunca lança) |

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `POST /instance/connect` + `GET /instance/qr` | O adapter encadeia as duas chamadas: `connect` inicia a geração do QR no servidor, mas quem devolve o QR é `GET /instance/qr`. A segunda chamada é best-effort (se falhar ou o QR ainda não estiver pronto, `ConnectResult.qr` fica `undefined`, sem lançar). |
| `instance.status` | `GET /instance/status` | Ver tabela de mapeamento acima. |
| `instance.logout` | `DELETE /instance/logout` | Corpo vazio; resposta `{"message":"success"}`. |
| `messages.sendText` | `POST /send/text` | Campo `number` aceita dígitos crus (`"5511999999999"`, sem `+`/`@`) OU JID completo (`...@s.whatsapp.net`, `...@g.us`) já formado — **compatível 1:1 com o `chatId` canônico do waconector** (`normalizeChatId`), então o adapter repassa sem transformação. `formatJid` (default `true`) normaliza dígitos crus no servidor. |
| `messages.sendMedia` | `POST /send/media` | Duas variantes no mesmo endpoint, escolhidas pelo `Content-Type`: JSON (`{number, type, url, caption?, filename?, ...}`) ou `multipart/form-data` (campo binário `file`). **Este adapter implementa a variante JSON** — o `HttpClient` compartilhado sempre serializa o corpo como JSON, não há suporte a `multipart/form-data` nele. O campo `url` da variante JSON é overloaded pelo servidor (`pkg/sendMessage/handler/send_handler.go`): quando o valor não começa com `http://`/`https://`, é tratado como base64 e decodificado (`base64.StdEncoding.DecodeString`) antes do envio — então o adapter envia `media.base64` no mesmo campo `url` quando `media.url` está ausente. Lança `WaConnectorError('INVALID_INPUT', ...)` apenas quando nem `url` nem `base64` são informados. |
| `messages.sendReaction` | `POST /message/react` | Ver seção "Reações" abaixo. |
| `groups.create` | `POST /group/create` | Ver seção "Grupos (núcleo)" abaixo. |
| `groups.getInfo` | `POST /group/info` | Ver seção "Grupos (núcleo)" abaixo. |
| `groups.list` | `GET /group/list` | Ver seção "Grupos (núcleo)" abaixo. |
| `groups.addParticipants` / `groups.removeParticipants` / `groups.promoteParticipants` / `groups.demoteParticipants` | `POST /group/participant` | Mesmo endpoint para as 4 operações; só o campo `action` muda. Ver seção "Grupos (núcleo)" abaixo. |
| `groups.updateSubject` | `POST /group/name` | Ver seção "Grupos (núcleo)" abaixo. |
| `groups.updateDescription` | `POST /group/description` | Ver seção "Grupos (núcleo)" abaixo. |
| `groups.updatePicture` | `POST /group/photo` | Ver seção "Grupos (núcleo)" abaixo. |

## Reações

- Endpoint: `POST /message/react` (`pkg/message/service/message_service.go`, `ReactStruct` +
  `pkg/message/handler/message_handler.go`) — **fica em um pacote separado** de `/send/*`
  (`pkg/message/*`, não `pkg/sendMessage/*`); não confundir os dois ao portar lógica ou procurar o
  handler no código-fonte.
- Corpo: `{number: string, reaction: string, id: string, fromMe: bool, participant?: string}`.
  - `number`: mesmo formato do campo `number` de `/send/text`/`/send/media` (dígitos crus ou JID
    completo) — o adapter repassa via `toProviderNumber`, sem transformação.
  - `id`: o ID da mensagem-alvo da reação. **Atenção de nomenclatura**: este campo se chama `id`,
    **não** `messageId` (diferente de `EditMessage`/`DeleteMessageEveryone`, no mesmo arquivo, que
    usam `messageId`).
  - `reaction`: o emoji (ex.: `"👍"`). O servidor rejeita `reaction: ""` com `400` ("message
    reaction is required") — para remover uma reação já enviada, o sentinel literal
    `"reaction": "remove"` deve ser usado (o serviço traduz isso internamente para texto vazio no
    protocolo whatsmeow, que é o que de fato sinaliza remoção ao WhatsApp). O modelo canônico do
    waconector usa `emoji: ''` para remoção (ADR-0008) — **o adapter traduz** `''` → `"remove"`
    antes de enviar.
  - `fromMe` (obrigatório pelo shape do provider): indica se a mensagem-alvo foi originalmente
    enviada pela própria instância. `SendReactionInput` (contrato canônico) não carrega essa
    informação nem `participant` (autor, necessário em grupos quando `fromMe=false`) — mesma
    limitação já documentada para `quotedId` em `sendText`/`sendMedia`. Este adapter sempre envia
    `fromMe: false`, o valor seguro para o caso mais comum (reagir a uma mensagem recebida);
    reagir a uma mensagem **enviada pela própria instância** é uma limitação conhecida deste
    adapter em F2 (pode não localizar a mensagem corretamente no protocolo WhatsApp).
- Resposta 200: `{"message": "success", "data": <MessageSendStruct>}` — mesmo formato de
  `/send/text`/`/send/media` (`data.Info.ID`/`ServerID`/`Timestamp`), reaproveitado por
  `toSentMessage`. Erros: `400` (número/reaction ausentes) ou `500` (sem sessão ativa, número
  inválido, `id` ausente, falha de envio), ambos `{"error": "..."}`.
- Funciona tanto para reagir a mensagens recebidas quanto enviadas pela própria instância (via
  `fromMe`), em chats individuais e em grupos (via `participant`) — nenhuma limitação direcional
  documentada pelo provider em si; as limitações acima são do adapter, não da API.

## Grupos (núcleo)

As 14 operações de `groups.*` (ver ADR-0009) são suportadas por este adapter. **Nenhuma das 4
operações de participantes (`add`/`remove`/`promote`/`demote`), nem `POST /group/create`, nem as 3
operações de configuração (`updateSubject`/`updateDescription`/`updatePicture`), nem as 4 operações
de convite/saída (`getInviteLink`/`revokeInviteLink`/`joinViaInviteLink`/`leaveGroup`) aparecem na
documentação oficial do site (`docs.evolutionfoundation.com.br`)** — foram confirmadas apenas
lendo o código-fonte Go (`pkg/group/handler` + `pkg/group/service`). `getGroupInfo`/`listGroups`
seguem o mesmo padrão de já-verificado-no-código usado no resto deste dossiê. Tratamos como alta
confiança mesmo assim (fonte primária: o código do provider), mas sem uma captura "ao vivo" —
diferente das fixtures de webhook de mensagem/ack/conexão, copiadas literalmente do site.

### `groups.create` — `POST /group/create`

- Corpo: `{groupName: string, participants: string[]}`. **Atenção de nomenclatura**: o campo é
  `groupName`, **não** `name` — diverge do padrão do resto do provider (que costuma usar
  `name`/`number` para os campos principais). `participants` aceita dígitos crus ou JID completo
  (mesmo formato do campo `number` de `/send/text`), e já chega normalizado pelo conector.
- Resposta: `{"message":"success","data":{"jid":"...","name":"...","owner":"...","added":
  ["..."],"failed":["..."]}}` — um envelope de `data` **diferente** do whatsmeow `GroupInfo` usado
  por `getGroupInfo`/`listGroups` (chaves minúsculas aqui: `jid`/`name`/`owner`; capitalizadas lá:
  `JID`/`Name`/`OwnerJID`). Não há lista detalhada de participantes (com `isAdmin`/`isSuperAdmin`)
  na resposta de criação — o adapter constrói `GroupInfo.participants` a partir do array `added`
  (todos entram como `isAdmin:false`, já que acabaram de ser adicionados), com fallback para a
  lista de entrada (`input.participants`) caso `added` venha vazio (mesmo padrão de fallback já
  usado em `toSentMessage`, ex.: `chatId ?? requestedNumber`).

### `groups.getInfo` — `POST /group/info`

- **POST mesmo sendo uma operação de leitura** — mesmo padrão do provider para as demais rotas de
  grupo (nenhuma delas usa `GET` exceto `list`).
- Corpo: `{groupJid: string}`. `groupJid` aqui é o `groupId` opaco do waconector (ver ADR-0009):
  neste provider, `GroupInfo.id` já É o JID do whatsmeow (`...@g.us`, às vezes na forma legada
  `<criador>-<timestamp>@g.us`), então nenhuma conversão é necessária — diferente da Z-API, que
  usa um ID sintético sem `@`.
- Resposta: `data` é o struct `GroupInfo` do whatsmeow, serializado verbatim (sem json tags,
  chaves capitalizadas — mesmo padrão de `GET /instance/status`):
  `{JID, OwnerJID, Name, Topic (= descrição), IsLocked, GroupCreated, Participants: [{JID,
  PhoneNumber, LID, IsAdmin, IsSuperAdmin, DisplayName, Error, AddRequest}], ...}`. O adapter mapeia
  `JID→id`, `Name→subject`, `Topic→description`, `OwnerJID→owner`, e cada item de `Participants`
  para `GroupParticipant` (`JID→id`, com fallback defensivo em `PhoneNumber`; `IsAdmin`/
  `IsSuperAdmin` direto).

### `groups.list` — `GET /group/list`

- Sem corpo. Resposta: `{"message":"success","data": GroupInfo[]}` — um array do mesmo shape
  whatsmeow de `getGroupInfo`, um item por grupo. O adapter reaproveita o mesmo mapeamento
  (`JID`/`Name`/`Topic`/`OwnerJID`/`Participants`) item a item.

### `groups.addParticipants` / `groups.removeParticipants` / `groups.promoteParticipants` / `groups.demoteParticipants` — `POST /group/participant`

- **Endpoint único compartilhado pelas 4 operações**: corpo `{groupJid: string, participants:
  string[], action: "add"|"remove"|"promote"|"demote"}` — só o campo `action` muda entre elas. O
  adapter implementa as 4 como wrappers finos sobre uma função interna (`updateGroupParticipants`)
  parametrizada por `action`.
- `participants`: dígitos crus ou JID completo, mesmo formato de `number`/`groupId` — já chegam
  normalizados pelo conector (comportam-se como um `to` de mensagem comum, diferente de
  `groupJid`, que é o identificador opaco de grupo).
- Resposta: `{"message":"success"}` — **sem detalhe por participante** (o provider descarta essa
  informação internamente; não é uma limitação deste adapter). As 4 operações canônicas retornam
  `Promise<void>` (não precisam devolver o grupo atualizado), então o adapter só dispara a chamada
  e não extrai nada da resposta além de deixar o `HttpClient` lançar em caso de erro HTTP.

### `groups.updateSubject` — `POST /group/name`

- Corpo: `{groupJid: string, name: string}` (`SetGroupNameStruct`). **Atenção de nomenclatura**: o
  campo é `name`, não `subject` — o adapter traduz `UpdateGroupSubjectInput.subject` → `name`.
  `groupJid` segue a mesma conversão opaca de `toProviderGroupJid` usada pelo resto de `groups.*`.
- Resposta: `{"message":"success"}`, sem `data`. A operação canônica retorna `Promise<void>`,
  então o adapter só dispara a chamada.

### `groups.updateDescription` — `POST /group/description`

- Corpo: `{groupJid: string, description: string}`. `description` **pode ser string vazia** para
  limpar a descrição do grupo — o handler permite isso explicitamente, sem validação de tamanho
  mínimo no servidor (e o conector também trata string vazia como entrada válida, não erro — ver
  `WaConnector.prepareUpdateGroupDescription`).
- Resposta: `{"message":"success"}`, sem `data`. `Promise<void>`, mesmo padrão de
  `updateSubject`.

### `groups.updatePicture` — `POST /group/photo`

- Corpo: `{groupJid: string, image: string}`. **Divergência importante de formato** em relação a
  `messages.sendMedia`/`POST /send/media` (que aceita base64 **cru**, sem prefixo, no campo
  `url` — ver seção `messages.sendMedia` acima): o campo `image` deste endpoint só reconhece OU uma
  URL `http(s)://...` OU uma **data-URI com prefixo exato** `data:image/jpeg;base64,` ou
  `data:image/png;base64,`. Base64 cru sem esse prefixo não é aceito aqui. O adapter
  (`toGroupPictureImage`) repassa `media.url` diretamente quando presente; caso contrário monta a
  data-URI a partir de `media.base64`, escolhendo o prefixo por `media.mimeType`
  (`image/png` → prefixo PNG; qualquer outro valor, incluindo ausente/`image/jpeg`, → prefixo
  JPEG). **Suposição não validada contra uma instância real**: o default para JPEG quando
  `mimeType` está ausente ou não é reconhecido; se o servidor rejeitar um base64 que na verdade não
  é JPEG com esse prefixo, isso é uma limitação conhecida deste adapter a revisar.
- Resposta: `{"message":"success","data":"<novo pictureID string>"}` — o `pictureID` retornado é
  ignorado (a operação canônica `groups.updatePicture` retorna `Promise<void>`).

### `groups.getInviteLink` / `groups.revokeInviteLink` — `POST /group/invitelink`

- **Endpoint único compartilhado pelas duas operações** (mesmo padrão de
  `updateGroupParticipants`): corpo `{groupJid: string, reset: boolean}` — `reset:false` obtém o
  link de convite atual, `reset:true` revoga o link atual e gera um novo. O adapter implementa as
  duas como uma função interna (`getGroupInviteLink`) parametrizada por `reset`.
- Resposta: `{"message":"success","data":"<link completo>"}` — diferente de outras rotas de grupo
  cujo `data` é um objeto/struct, aqui `data` já É a string do link, e **já vem completo**
  (`https://chat.whatsapp.com/<código>`), não o código bare. O adapter roda o valor por
  `normalizeInviteLink` mesmo assim antes de devolver `GroupInviteLink.link` — idempotente para um
  valor que já tem o prefixo, e serve de rede de segurança caso uma versão futura do provider passe
  a devolver só o código.

### `groups.joinViaInviteLink` — `POST /group/join`

- Corpo: `{code: string}`. **Confiança alta** (comportamento do whatsmeow, biblioteca usada
  internamente pelo Evolution GO): o campo `code` aceita tanto o código bare quanto o link completo
  — o whatsmeow remove o prefixo `https://chat.whatsapp.com/` automaticamente se presente antes de
  resolver o convite. O conector já normaliza `input.invite` para o link completo antes de chamar o
  adapter (ver `WaConnector.prepareJoinViaInviteLink`); o adapter repassa esse valor diretamente em
  `code`, sem usar `extractInviteCode`.
- Resposta: `{"message":"success"}` — **sem nenhuma informação sobre qual grupo foi de fato
  ingressado** (nem `jid`, nem `data` de qualquer tipo). A operação canônica `groups.joinViaInviteLink`
  retorna `Promise<void>`, então isso não é uma limitação prática deste adapter.

### `groups.leaveGroup` — `POST /group/leave`

- Corpo: `{groupJid: string}` — mesma conversão opaca de `toProviderGroupJid` usada pelo resto de
  `groups.*`. Resposta: `{"message":"success"}`, sem `data`. `Promise<void>`, mesmo padrão de
  `updateSubject`/`updateDescription`.

## Webhooks

Duas camadas independentes e simultâneas: (a) global via env `WEBHOOK_URL` do servidor (todas as
instâncias); (b) por instância via `webhookUrl` no corpo de `POST /instance/connect` (só aquela
instância). Filtragem de eventos via array `subscribe` (mesma chamada): categorias `MESSAGE`,
`SEND_MESSAGE`, `READ_RECEIPT`, `PRESENCE`, `HISTORY_SYNC`, `CHAT_PRESENCE`, `CALL`, `CONNECTION`,
`LABEL`, `CONTACT`, `GROUP`, `NEWSLETTER`, `QRCODE`, `BUTTON_CLICK`, `PICTURE`, `USER_ABOUT`, ou
`ALL`. Entrega via `HTTP POST`, `Content-Type: application/json`, retentado até 5x a cada 30s até
2xx. **Importante**: o valor pedido em `subscribe` é a categoria (maiúscula); o `event` recebido no
payload é o nome individual do evento em PascalCase (ex.: `subscribe:['CALL']` recebe
`CallOffer`/`CallAccept`/`CallTerminate`, não `"CALL"` literal).

O envelope de webhook expõe os campos do struct Go/whatsmeow **verbatim** (capitalizados: `Info`,
`Message`, `Chat`, `Sender`, `IsFromMe`, `PushName`, `ID`, `Timestamp`, `MessageIDs`, `Type`) — isso
é estruturalmente diferente do envelope estilo Baileys (`key`/`message`/`messageTimestamp`
minúsculos) do projeto "Evolution API" (não confundir os dois ao portar lógica).

**Qualidade da documentação**: os arquivos `docs/wiki/*.md` do próprio repositório terminam com
"Documentação gerada para Evolution GO v1.0" (auto-gerados) e **divergem** do código-fonte real em
pontos verificáveis (ex.: mostram `GET /instance/status` e `POST /instance/pair` com chaves JSON
minúsculas, e um payload de mensagem estilo Baileys — nenhum dos dois bate com os structs
reais/swagger.json). O site `docs.evolutionfoundation.com.br` concordou com o código-fonte em todos
os pontos checados nesta pesquisa. Este dossiê segue o site + código-fonte, não o wiki do repo.

### Payloads de webhook (fixtures em `src/adapters/evolution/fixtures/`)

- `webhook-message-received.json` — **copiado literalmente** do site de docs
  (`docs.evolutionfoundation.com.br`), cruzado com `pkg/whatsmeow/service/whatsmeow.go`.
- `webhook-ack.json` — **copiado literalmente** do site de docs, cruzado com o mesmo arquivo-fonte
  (evento `Receipt`, `state` ∈ `Read`/`Delivered`/`ReadSelf`).
- `webhook-connection-update.json` — **copiado literalmente** do site de docs (evento `Connected`,
  `data.status="open"`).
- `webhook-message-image.json` / `webhook-message-document.json` — **RECONSTRUÍDOS** (não
  capturados "ao vivo"; nenhuma doc/fixture de mensagem de mídia foi encontrada na pesquisa
  original). Montados a partir dos structs gerados do whatsmeow
  (`waE2E/WAWebProtobufsE2E.pb.go` — `ImageMessage`/`DocumentMessage`), com especial atenção ao
  campo de URL: os structs tagueiam esse campo como `json:"URL,omitempty"` (**maiúsculo**),
  diferente de `mimetype`/`caption`/`fileName` (minúsculo/camelCase). Isso foi confirmado
  diretamente no `.pb.go`, não em prosa de doc de terceiros — um bug anterior deste adapter lia
  `record.url` (minúsculo) e por isso nunca populava `WaMessage.media` para nenhuma mensagem de
  mídia recebida. `buildMediaRef` agora lê `record.URL` (com fallback defensivo para `record.url`).

Evento adicional documentado no dossiê de pesquisa mas **RECONSTRUÍDO** (extraído diretamente do
código-fonte `handleQRCodes`, não copiado de prosa de nenhuma doc) — não incluído como fixture
própria porque não foi capturado de uma fonte "ao vivo", apenas citado aqui para referência:

```json
{
  "event": "QRCode",
  "data": { "qrcode": "data:image/png;base64,....", "code": "2@AbCdEf...", "count": 1, "maxCount": 0 },
  "instanceToken": "...", "instanceId": "...", "instanceName": "..."
}
```

O adapter trata `QRCode` como `connection.update` com `state:"qr"` e `qr` = `data.qrcode` (fallback
`data.code`), mas isso não foi exercitado com um payload "ao vivo" — tratar com confiança média.

Outros eventos da categoria CONNECTION mapeados como `connection.update` (mesma lógica dos
exemplos acima, não fixturados individualmente): `Disconnected` → `disconnected`, `LoggedOut` →
`disconnected`, `ConnectFailure` → `disconnected`, `PairSuccess` → `connected`, `TemporaryBan` →
`disconnected` *(suposições — ver "Limites e particularidades")*.

Forma exata do campo `Message` para tipos não-texto (`imageMessage`, `videoMessage`,
`documentMessage`/`documentWithCaptionMessage`, `stickerMessage`, ...) **não foi enumerada** na
pesquisa original — é passthrough do encoding protobuf→JSON do whatsmeow. O adapter detecta o tipo
pela chave presente e extrai `url`/`mimetype`/`fileName`/`caption` quando existirem nesse nível,
sem garantia de cobertura completa (ver `openQuestions` abaixo).

## Limites e particularidades

- **Gate de licença**: servidor recém-implantado devolve HTTP 503 em endpoints de API até ativação
  via Manager UI (`http://host:port/manager/login` com `GLOBAL_API_KEY`) — relevante para
  bootstrap/health check, não tratado por este adapter (apenas surge como `PROVIDER_ERROR` comum).
- Auth é 100% via header, sem query string nem Bearer em nenhum lugar do código-fonte.
- Sem rate limiting implementado ou configurável no código/`.env` — apenas recomendação informal de
  ~50 req/s por instância.
- `/send/button` e `/send/list` são documentados como não-funcionais fora de contas WhatsApp
  Business API (restrição da plataforma, não bug do Evolution GO); `/send/poll` é o substituto
  sugerido. Nenhum dos dois está no escopo deste adapter.
- Áudio enviado via `/send/media` é sempre transcodificado para Opus/PTT no servidor; imagens fora
  de jpg/png são convertidas; vídeo é documentado como MP4-only. Nenhuma dessas conversões é feita
  pelo adapter — é comportamento do servidor.
- `mentionedJid` é **array** de strings (alguns docs de terceiros mostram como string única — está
  errado conforme o struct real `TextStruct`). Diferente do campo `number` (normalizado
  server-side via `utils.CreateJID` independente do formato), `pkg/sendMessage/service/send_service.go`
  copia `data.MentionedJID` **verbatim** para `ContextInfo.MentionedJID` no protobuf de saída —
  sem nenhuma normalização/`CreateJID` no caminho de menções. Por isso o adapter **não** reusa a
  função de mapeamento de `to`: `SendTextInput.mentions` passa por `toMentionJid`, que anexa
  `@s.whatsapp.net` a dígitos crus e repassa JIDs explícitos intactos. Sem isso, uma menção com
  dígitos crus é enviada sem erro mas não destaca o participante (menção muda).
- `quoted` no envio de texto/mídia aceita `{messageId, participant}`; o modelo canônico
  (`quotedId`) não carrega `participant`, então o adapter só envia `messageId`. Se o provider
  exigir `participant` para citar corretamente uma mensagem de grupo, isso é uma limitação
  conhecida deste adapter em F1.
- `messages.sendReaction` (`POST /message/react`) sempre envia `fromMe: false` e nunca envia
  `participant` — o contrato canônico (`SendReactionInput`) não carrega nenhum dos dois. Reagir a
  uma mensagem enviada pela própria instância, ou a uma mensagem de grupo onde `participant` seria
  necessário, é uma limitação conhecida deste adapter. Ver seção "Reações" acima.
- **Suposição** (estado `Connected=false, LoggedIn=true`): mapeado para `connecting` em vez de
  `disconnected`, por representar uma sessão válida em processo de recuperação (o provider mesmo
  recomenda `/instance/reconnect`). Não verificado com o provider real; revisar se a suposição se
  mostrar inadequada em uso real.
- **Suposição** (`PairSuccess` → `connected`, `TemporaryBan`/demais falhas → `disconnected`): o
  dossiê de pesquisa não define esses mapeamentos explicitamente para o modelo canônico do
  waconector; escolhidos por serem os estados canônicos mais próximos semanticamente.
- Envio de mídia via `base64` **é suportado neste adapter**, apesar do dossiê original e da doc
  oficial (`docs.evolutionfoundation.com.br`) afirmarem o contrário: `pkg/sendMessage/handler/
  send_handler.go` mostra que a variante JSON de `POST /send/media` decodifica `data.Url` como
  base64 quando o valor não começa com `http://`/`https://`. O adapter envia `media.base64` nesse
  mesmo campo `url` quando `media.url` está ausente. Só lança `WaConnectorError('INVALID_INPUT')`
  quando nem `url` nem `base64` são informados (`multipart/form-data` com campo binário `file`
  continua fora do escopo, pois o `HttpClient` compartilhado sempre serializa o corpo como JSON).
- Timeout do cliente HTTP de webhook do próprio servidor Evolution GO não está explicitamente
  configurado no código-fonte (`&http.Client{}` puro) — não afeta este adapter (que só recebe
  webhooks, não os envia), citado apenas para contexto.
- `instance.pairingCode` **não implementado** nesta fase apesar de confirmado no provider —
  fora do escopo declarado para F1 deste adapter.
