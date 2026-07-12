# Dossiê: QuePasa

- Docs oficiais: **nenhuma confiável encontrada** — `https://docs.quepasa.ai/reference` (URL
  originalmente apontada para este dossiê) é um produto SaaS de RAG ("Retrieval-Augmented
  Generation" — upload de documentos, indexação, busca semântica, integração com Telegram)
  **completamente não relacionado a WhatsApp**. Confirmado por fetch direto de duas páginas
  distintas do domínio (`/reference` e a home, que traz literalmente "QuePasa.ai is a RAG service…
  not related to WhatsApp"). É uma colisão de nome, não o produto deste dossiê.
- Repositório canônico do QuePasa WhatsApp real: **`github.com/nocodeleaks/quepasa`** (Go, sobre
  `tulir/whatsmeow`, self-hosted via Docker/docker-compose) — **bloqueado no GitHub por aviso de
  DMCA** desde 2026-06-30/07 (`HTTP 451`, `github/dmca/2026/06/2026-06-30-voip-go-library.md`). O
  aviso é especificamente sobre um módulo de VoIP (`src/voip/calls`, alegação de cópia de
  `purpshell/meowcaller`) — **não é sobre mensagens/webhooks** — mas o bloqueio é do repositório
  inteiro, impedindo leitura direta do código-fonte oficial atual.
- **Metodologia usada para contornar o bloqueio**: pesquisa feita em três forks/mirrors não
  bloqueados, todos com a mesma estrutura de pacotes Go (`controllers/`, `models/`, `whatsapp/`,
  `whatsmeow/`) e mesmo README/licença (AGPLv3, mesmo canal Telegram `quepasa_api`, mesmo link para
  `tulir/whatsmeow`) do projeto original:
  - `botarenaweb/Quepasa-api` (fork de `edcarlosm/quepasa`, sem o diretório `src/voip`, snapshot
    **2025-05-07**);
  - `edcarlosm/quepasa` (mirror mais antigo, snapshot **~2023-04-20**, sem tags);
  - `deivisonrpg/quepasa` (último push em **2026-07-07** — mesmo dia do bloqueio DMCA — portanto o
    snapshot mais recente conhecido do código antes do bloqueio. **Nota de proveniência**: chamado
    de "fork" ao longo deste dossiê por analogia com os demais, mas os metadados do GitHub reportam
    `fork: false` e nenhum repositório-pai registrado para ele — ou seja, não está de fato
    registrado na rede de forks de `nocodeleaks/quepasa`. O conteúdo (README/licença/estrutura)
    pode ter sido copiado em vez de derivado via "fork" do GitHub — não afeta nenhuma alegação
    funcional deste dossiê, só a precisão da proveniência);
  - Checagem cruzada adicional contra `ssteeltm/sufficit-quepasa` (segunda linhagem independente,
    ligada à "Sufficit Soluções", detentora da licença AGPL citada no README).

  Confiança **alta** de que estes forks refletem o código-fonte real do `nocodeleaks/quepasa`
  pré-bloqueio, mas nenhum é a URL canônica — sinalizado explicitamente onde relevante. Toda citação
  de código abaixo referencia o fork e o snapshot exatos.
- Versão testada: nenhuma instância Docker real foi exercitada nesta pesquisa (só leitura de
  código-fonte) — ver "Gaps conhecidos" ao final.
- Hospedagem: self-hosted (Docker/docker-compose). Sem SaaS gerenciado conhecido.

> **Escopo desta fase**: `instance.status`, `instance.logout` (soft-stop, ver seção dedicada),
> `messages.sendText`, `messages.sendMedia`, `messages.edit`, `messages.delete`,
> `groups.getInviteLink`, `contacts.getProfilePicture`, `chats.archive`, `chats.unarchive`,
> `chats.markRead`, `chats.markUnread`, `webhooks.parse`. **`instance.connect` e
> `instance.pairingCode` deliberadamente NÃO implementadas** (limitação técnica real, não apenas de
> escopo — ver "`instance.connect` — achado crítico" abaixo). `messages.sendReaction` e o restante
> de `groups.*`/`contacts.*` TÊM endpoints confirmados numa API v5 mais recente, mas atrás de um
> modelo de autenticação (JWT de usuário) incompatível com o token por instância usado por este
> adapter — ver "Capabilities confirmadas mas não implementadas nesta fase" ao final. `messages.edit`/
> `messages.delete`/`chats.*` (ADR-0012) usam a família de rotas **legacy** (mesma de `/scan`/
> `/command`), que nunca passa por esse gate de JWT — ver seção dedicada logo abaixo de
> "Modelo de instância/sessão". `chats.mute`/`chats.unmute`/`chats.pin`/`chats.unpin` NÃO foram
> declaradas (nenhum endpoint equivalente encontrado).

## Autenticação

Não existe API key global. O **token é público, por instância** ("server"/"bot") — qualquer string
escolhida pelo cliente (tipicamente um UUID) vira o identificador da instância assim que o
pareamento é concluído (não há um passo de "criar instância" separado).

Extração do token (e de qualquer parâmetro da API) segue ordem de prioridade **path → query → form
→ header**, confirmado literalmente em `src/models/util.go`:

```go
func GetRequestParameter(r *http.Request, parameter string) string {
	result := chi.URLParam(r, parameter)
	if len(result) == 0 {
		if QueryHasKey(r.URL, parameter) {
			result = QueryGetValue(r.URL, parameter)
		} else {
			if r.Form.Has(parameter) {
				result = r.Form.Get(parameter)
			} else {
				result = r.Header.Get("X-QUEPASA-" + strings.ToUpper(parameter))
			}
		}
	}
	return strings.TrimSpace(result)
}
```

Ou seja: header confirmado é **`X-QUEPASA-TOKEN`** (não Bearer, não `Authorization`). Em rotas
`v2`/`v3` o token TAMBÉM pode vir no path (`/v2|v3/bot/{token}/...`) — e, quando a rota é registrada
com `{token}` no path (como as rotas `v3` usadas por este adapter), o roteador `chi` EXIGE um
segmento naquela posição para a rota casar, e ele tem precedência sobre qualquer header/query. Em
rotas sem `{token}` no path (`/scan`, `/command`, v1/v4) só dá para usar query `?token=` ou o
header.

**Este adapter usa os dois mecanismos**: envia `X-QUEPASA-TOKEN` em TODA requisição (via
`HttpClient.headers`) e, adicionalmente, embute o token no path para as rotas `v3` que o exigem
(`botPath()`). `QuepasaOptions.token` é enviado em `secrets` do `HttpClient` para redação em
mensagens de erro.

## Modelo de instância/sessão

- Struct de domínio: **`QpWhatsappServer`** (campo Go); a rota usa o termo **"bot"**
  (`/bot/{token}`); a tabela do banco é **`servers`** (migração `202303011900_qrcode_api.up.sql`
  mostra o rename de `bots` → `servers`).
- "Sessão WhatsApp" = **`wid`** (WhatsApp ID — na prática o telefone em E.164, via
  `GetPhoneByWId`), campo `db:"wid" json:"wid"` em `src/models/qp_server.go`.
- Não existe um passo explícito de "criar instância": o cliente escolhe um `token` arbitrário e
  chama `/scan`; o registro em `servers` só é persistido quando o pareamento é confirmado
  (`OnPaired`, `src/models/qp_whatsapp_pairing.go`).

### `instance.connect` — achado crítico (por que NÃO é declarada)

Rota (aliases `""`, `/current`, `/v4`): `GET {alias}/scan` (`ScannerController`,
`src/controllers/api_handlers.go`):

```go
token := GetToken(r)
pairing := &models.QpWhatsappPairing{Token: token, User: user}
con, err := pairing.GetConnection()
result := con.GetWhatsAppQRCode()
var png []byte
png, err = qrcode.Encode(result, qrcode.Medium, 256)
w.Header().Set("Content-Disposition", "attachment; filename=qrcode.png")
w.Header().Set("Content-Type", "image/png")
w.WriteHeader(http.StatusOK)
w.Write([]byte(png))
```

A resposta **não é JSON** — é a imagem PNG **crua** do QR code (`Content-Type: image/png`),
diferente de TODOS os outros adapters deste pacote (WAHA/Evolution/Whapi/etc., que devolvem base64
em JSON). `GetWhatsAppQRCode()` (implementação whatsmeow) devolve a string crua do QR (`evt.Code`
do canal do whatsmeow) e é o PRÓPRIO controller que a renderiza em PNG — **a string bruta do QR
nunca é exposta em nenhum endpoint HTTP**. A chamada é bloqueante: aguarda o whatsmeow emitir o
primeiro evento `"code"` antes de responder (não espera o scan, só a geração do código) — ou seja,
é um side effect real (dispara o pareamento no servidor).

O `HttpClient` deste pacote (`src/core/http.ts`) decodifica toda resposta não-JSON via
`response.text()` (UTF-8) — aplicado a bytes binários de PNG, isso **corrompe o conteúdo de forma
IRREVERSÍVEL** (sequências de byte inválidas viram U+FFFD, o replacement character; não há como
reconstituir os bytes originais a partir do texto resultante). Não existe, com o `HttpClient`
atual, um modo de resposta binária/`ArrayBuffer` — estender o core para isso é uma mudança real,
mas está fora do escopo desta fase (o pacote não modifica `src/core/` sem uma necessidade
genuinamente nova documentada num ADR dedicado).

**Decisão**: `instance.connect` NÃO é declarada em `QUEPASA_CAPABILITIES` — declarar mesmo assim
seria "arredondar para cima" um recurso que não entrega o que promete (`ConnectResult.qr`
utilizável). `connectInstance()` ainda é implementada (obrigatória pela interface `InstanceApi`),
chama `GET /scan` de fato (então o pareamento no servidor real ainda é disparado), mas sempre
devolve `qr: undefined` — nunca inventamos uma string corrompida como se fosse um QR válido.
Consumidores que chamam `wa.instance.connect()` via `createConnector` recebem
`UnsupportedCapabilityError`; quem chama `adapter.instance.connect()` diretamente ainda dispara o
side effect real, sabendo da limitação.

### `instance.pairingCode` — não suportado

`IWhatsappConnection` (`src/whatsapp/whatsapp_connection_interface.go`) só expõe:

```go
GetWhatsAppQRChannel(context.Context, chan<- string) error
GetWhatsAppQRCode() string
```

Sem nenhum método de linking por telefone. A lib subjacente `tulir/whatsmeow` TEM `PairPhone`
(`pair-code.go` existe no repo oficial da lib), mas o QuePasa não chama isso em lugar nenhum do
código examinado — mesmo obstáculo estrutural já documentado nos demais adapters deste pacote.

### `instance.status`

`GET {alias}/command?action=status` (aliases `""`, `/current`, `/v4`; token via query/header):

```go
case "status":
    status := server.GetStatus()
    response.ParseSuccess(status.String())
```

Resposta (via `ParseSuccess`/`QpResponse`, reconstruída a partir do struct — **não é uma captura de
tráfego real**): `{"success": true, "status": "<WhatsappConnectionState>"}`.

#### Mapeamento de estado

`WhatsappConnectionState` é uma **string** (via `MarshalJSON` customizado — confirmado no snapshot
mais recente, 2026-07-07): `Unknown, UnPrepared, UnVerified, Starting, Connecting, Stopping,
Stopped, Restarting, Reconnecting, Connected, Fetching, Ready, Halting, Disconnected, Failed`.
Estados efetivamente emitidos hoje segundo `docs/CONNECTION_STATES.md` do fork: `Unknown,
UnPrepared, UnVerified, Connecting, Stopping, Stopped, Connected, Ready, Disconnected, Failed` — os
demais (`Starting, Restarting, Reconnecting, Fetching, Halting`) estão reservados no enum mas não
observados em uso.

| `status` | `InstanceState` canônico | Nota |
| --- | --- | --- |
| `Ready` | `connected` | Confiança alta — estado terminal de sessão logada. |
| `Disconnected`, `Stopped`, `UnVerified`, `UnPrepared` | `disconnected` | `Stopped` é resultado de um soft-stop (ver `instance.logout`); `UnVerified`/`UnPrepared` são "nunca pareado" — três sabores diferentes de "não conectado" sem 1:1 exato, agrupados aqui. |
| `Connected`, `Connecting`, `Starting`, `Stopping`, `Restarting`, `Reconnecting`, `Fetching`, `Halting` | `connecting` | `Connected` é AMBÍGUO por design do provider: "socket conectado, ainda não logado" — a janela em que um QR pode estar pendente, mas sem garantia disso no momento da consulta (não há estado "QR pronto" dedicado). Mapeado para `connecting`, não `qr`, por ser a leitura mais conservadora — decisão de implementação, não fato documentado. |
| `Failed`, `Unknown`, qualquer outro | `unknown` | Nunca lança. |

Implementação em `src/whatsmeow/whatsmeow_connection.go` (snapshot ~2023, lógica de transição —
ainda coerente com o enum atual):

```go
func (conn *WhatsmeowConnection) GetStatus() whatsapp.WhatsappConnectionState {
	if conn.Client == nil { return whatsapp.UnVerified }
	if conn.Client.IsConnected() {
		if conn.Client.IsLoggedIn() { return whatsapp.Ready }
		return whatsapp.Connected
	}
	if conn.failedToken { return whatsapp.Failed }
	return whatsapp.Disconnected
}
```

### `instance.logout` — declarada, mas documentada como soft-stop

Dois níveis, **assimétricos** — achado importante para o design deste adapter:

**a) "Soft stop" (via token, API REST, usado por este adapter)**: `GET {alias}/command?action=stop`:

```go
case "stop":
    err = server.Stop("command")
```

`Stop()` → `Disconnect()` → `connection.Dispose()`. Comentário no próprio código confirma a
semântica:

```go
/*
	Disconnect if connected
	Cleanup Handlers
	Dispose resources
	Does not erase permanent data !
*/
func (conn *WhatsmeowConnection) Dispose(reason string) { ... }
```

Fecha o socket e limpa handlers, **mas preserva as credenciais salvas**. Um `instance.connect()`
seguinte tende a reconectar SEM gerar um novo QR — diferente do que "logout" normalmente implica
nos demais adapters deste pacote.

**b) "Hard delete" (logout de verdade, NÃO acessível por este adapter)**: só existe via
`POST /form/delete`, autenticado por **cookie JWT** (login de usuário/senha,
`src/controllers/form_authenticated_handlers.go`), não pelo token por instância:

```go
func (conn *WhatsmeowConnection) Delete() (err error) {
	if conn.Client.IsLoggedIn() {
		err = conn.Client.Logout()   // desvincula no lado do WhatsApp
	}
	err = conn.Client.Store.Delete() // apaga chaves locais
	...
}
```

**Decisão**: `instance.logout` É declarada (diferente de `instance.connect`) porque desconecta a
sessão ativa de fato — um efeito real, só que num grau mais fraco do que "logout" normalmente
implica. `logoutInstance()` chama `GET /command?action=stop`.

## Capabilities implementadas nesta fase (ADR-0012: edição/exclusão de mensagem + `chats.*`)

`messages.edit`, `messages.delete`, `chats.archive`, `chats.unarchive`, `chats.markRead`,
`chats.markUnread`.

**Achado estrutural que muda o cálculo de risco em relação ao restante deste dossiê**: TODAS as
seis operações acima vivem na família de rotas **legacy** (`legacy.RegisterAPIControllers`, aliases
`""`/`/current`/`/v4` — a MESMA família de `/scan` e `/command`, já usada por este adapter). Essa
família é registrada num `r.Group(...)` **separado** do grupo v5 "canonical" (`src/api/api.go`,
função `Configure`) e **nunca passa** por `jwtauth.Verifier`/`AuthenticatedAPIHandler`. Ou seja, ao
contrário de `groups.*`/`contacts.*`/`messages.sendReaction` (já documentados acima como bloqueados
por JWT), tudo abaixo usa **exatamente o mesmo mecanismo de auth que este adapter já implementa**
(`X-QUEPASA-TOKEN`, resolvido só por `GetServer(r)` → token → registro em `servers`) — nenhum campo
novo em `QuepasaOptions` foi necessário.

Fonte: pesquisa dedicada feita contra o mesmo mirror já usado no restante deste dossiê
(`deivisonrpg/quepasa`, commit `17c3b10bac751346ca4d6c3514839ea60e8d73ce`, 2026-07-07T17:56:12Z),
via leitura direta de código-fonte (`gh api`/`gh search code`) — o repositório oficial
(`nocodeleaks/quepasa`) segue bloqueado por DMCA (ver topo deste dossiê). Todas as citações abaixo
são trechos literais de arquivos reais desse snapshot, não reconstruções.

## Edição e exclusão de mensagem

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.edit` | `PUT /edit` | Corpo `{messageId, content}`. Ver subseção dedicada abaixo. |
| `messages.delete` | `DELETE /message/{messageid}` | Sem corpo — id vai no path. Ver subseção dedicada abaixo. |

### `messages.edit` — `PUT /edit`

Rota confirmada em `legacy/routes.go`: `r.Put(endpoint+"/edit", ...EditMessageController)`. Corpo
confirmado por struct (`edit_message_request.go`, citado por completo):

```go
type EditMessageRequest struct {
	MessageId string `json:"messageId"` // Required: Message ID to edit
	Content   string `json:"content"`   // New content for the message
}
```

O handler (`api_handlers+MessageController.go`) decodifica o body, valida `content`/`messageId`
não-vazios, resolve o server pelo token e chama `server.Edit(request.MessageId, request.Content)`.

**Implementação real** (`src/models/server_messaging.go` → `src/whatsmeow/whatsmeow_connection.go`,
linhas 287-312), citada por completo:

```go
func (source *WhatsmeowConnection) Edit(msg whatsapp.IWhatsappMessage, newContent string) error {
	...
	textMessage := &waE2E.Message{Conversation: &newContent}
	editMessage := source.Client.BuildEdit(jid, msg.GetId(), textMessage)
	_, err = source.Client.SendMessage(context.Background(), jid, editMessage)
	...
}
```

`BuildEdit` é o protocolo REAL de edição do whatsmeow (mesma família de `BuildRevoke`, ver
`messages.delete` abaixo) — não é um "editar só localmente".

**Resposta**: envelope `QpResponse` padrão (`{"success": true, "status": "message edited
successfully"}`) — SEM um campo `message` aninhado com id/chatId (diferente das respostas de
`sendtext`/`sendurl`/`sendencoded`). Este adapter mapeia para `SentMessage` com fallback no próprio
`messageId`/`chatId` requisitados (não um id sintético novo — editar não gera uma mensagem nova).

**Nuance importante (confiança média)**: nem o handler nem `Edit()` verificam nenhuma janela de
tempo antes de mandar a edição — o WhatsApp real limita edição a ~15 minutos após o envio
(comportamento conhecido do protocolo, aplicado do lado do WhatsApp/destinatário, não deste
código). Uma edição fora da janela provavelmente não lança erro aqui (a chamada HTTP "sucede"), mas
o destinatário real pode simplesmente ignorá-la — não verificado contra tráfego real.

### `messages.delete` (revoke) — `DELETE /message/{messageid}`

Rota confirmada nos aliases legacy: `DELETE /message/{messageid}` e `DELETE /message` (id via
query/header como fallback). Também há uma variante "por prefixo" (`RevokeByPrefix`, ativada pelo
parâmetro `messageidasprefix`, default `true` — `GetMessageIdAsPrefix`), não usada por este adapter
(a chamada de id exato já cobre o contrato canônico).

O handler (`api_handlers+MessageController.go`, `RevokeController`) resolve `messageid`
(path/query/header, com fallback de compatibilidade `?id=` da v3) e chama `server.Revoke(messageid)`
ou `server.RevokeByPrefix(messageid)`.

**Implementação real** — confirma que é "apagar para todos" de verdade, não local
(`whatsmeow_connection.go:261-284`):

```go
func (source *WhatsmeowConnection) Revoke(msg whatsapp.IWhatsappMessage) error {
	...
	newMessage := source.Client.BuildRevoke(jid, participantJid, msg.GetId())
	_, err = source.Client.SendMessage(context.Background(), jid, newMessage)
	...
}
```

`BuildRevoke` é o protocolo padrão do whatsmeow para "delete for everyone" — dispara um frame real
de revogação para o chat, não é um "apagar só localmente".

**Nuance confirmada por código** (`server_messaging.go`): mensagens de sistema
(`SystemMessageType`) **não podem** ser revogadas — `Revoke`/`RevokeByPrefix` retornam erro
explícito `"system messages cannot be revoked"` antes de sequer chamar o whatsmeow. Se o provider
propagar isso como um HTTP não-2xx, o `HttpClient` deste adapter já traduz para `WaConnectorError`
normalmente (nenhum tratamento especial foi adicionado neste adapter para esse caso).

**Resposta**: `QpResponse` (`{"success": true, "status": "revoked with success"}`) — inteiramente
ignorada, contrato retorna `Promise<void>`.

**Confiança**: Alta para o mecanismo (delete-for-everyone real, restrição de mensagens de sistema).
Nenhuma janela de tempo é validada neste código — o WhatsApp real também limita revogação a uma
janela (historicamente ampliada, hoje generosa), não verificado contra tráfego real qual o
comportamento em caso de mensagem muito antiga.

## Conversas (`chats.*`)

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `chats.archive` | `POST /chat/archive` (`archive: true`) | Ver subseção dedicada abaixo. |
| `chats.unarchive` | `POST /chat/archive` (`archive: false`) | MESMO endpoint de `chats.archive`. |
| `chats.markRead` | `POST /chat/markread` | Ver subseção dedicada abaixo. |
| `chats.markUnread` | `POST /chat/markunread` | MESMO corpo de `chats.markRead`, endpoint irmão. |

`chats.mute`/`chats.unmute`/`chats.pin`/`chats.unpin` **não** foram declaradas — a pesquisa dedicada
desta rodada não encontrou nenhum endpoint equivalente no código-fonte (legacy nem v5). O único
achado relacionado a "pin" é um efeito colateral documentado de `chats.archive` (ver abaixo), não um
endpoint dedicado.

### `chats.archive`/`chats.unarchive` — `POST /chat/archive`, endpoint único com parâmetro booleano

Corpo confirmado por struct (`api_handlers+ChatArchiveController.go`, citada):

```go
type ChatArchiveRequest struct {
	ChatId  string `json:"chatid"`
	Archive bool   `json:"archive"` // true = arquivar, false = desarquivar
}
```

**Atenção de nomenclatura**: a tag JSON é `chatid` (minúsculo, sem "I" maiúsculo) — diferente de
`chatId` usado por `sendtext`/`sendurl`/`sendencoded` neste MESMO provider. `archive` é um
booleano: o mesmo endpoint cobre as duas direções (`true` = `chats.archive`, `false` =
`chats.unarchive`).

**Nuance documentada no próprio comentário do Swagger do handler**: *"Archiving also unpins the
chat automatically"* — arquivar um chat fixado (pinned) o desafixa automaticamente como efeito
colateral, sem endpoint dedicado para isso (por isso `chats.pin`/`chats.unpin` não são declaradas
nesta fase — não há um endpoint próprio a mapear).

Mesma base técnica de `chats.markRead`/`chats.markUnread` abaixo (App State Protocol via
`whatsmeow.ArchiveChat`), portanto **sujeita ao mesmo bug conhecido de conflito 409/LTHash**
documentado na próxima subseção.

**Resposta**: `{"success": true, "status": "chat ...@s.whatsapp.net archived successfully"}` (ou
`"unarchived successfully"`) — inteiramente ignorada, contrato retorna `Promise<void>` para as duas
operações.

**Confiança**: Alta.

### `chats.markRead`/`chats.markUnread` — `POST /chat/markread` / `POST /chat/markunread`

**Payload confirmado por documentação de primeira mão do mantenedor** (`docs/CHAT_MANAGEMENT.md`,
citada literalmente — não reconstruída):

Request:
```json
{"chatid": "5511999999999"}
```
Resposta de sucesso:
```json
{"success": true, "message": "chat 5511999999999@s.whatsapp.net marked as read"}
```

Mesma tag minúscula `chatid` de `chats.archive` acima (não `chatId`).

O handler (`api_handlers+ChatReadController.go`) valida `chatid`, formata via
`whatsapp.FormatEndpoint` (mesma função de normalização de chatId já usada por `sendtext`), checa
`server.GetStatus() == Ready` (senão `503`), e chama `whatsmeow.MarkChatAsRead(conn, chatId)` /
`MarkChatAsUnread`.

**Nível de CHAT, não de mensagem**: distinto de um eventual `messages.markRead` futuro (marcar
mensagens específicas por id — protocolo de receipt padrão, mecanismo genuinamente diferente). Este
endpoint marca a badge de não-lida do chat INTEIRO.

**Nuance crítica, documentada pelo próprio mantenedor (não é uma suposição deste dossiê)**: essa
operação usa o **App State Protocol** do WhatsApp (`appstate.BuildMarkChatAsRead`), o mesmo
mecanismo de sincronização multi-dispositivo — e o `docs/CHAT_MANAGEMENT.md` documenta um **bug
conhecido do whatsmeow (upstream, `tulir/whatsmeow#858`, "mismatching LTHash")** que causa erros
`409 conflict` intermitentes nessa família de operação. Resposta de erro típica citada no doc:
```json
{"success": false, "status": "server returned error updating app state: conflict"}
```
O QuePasa **não faz retry automático** — repassa o erro diretamente ("Current Implementation
Strategy: return errors directly to the user without automatic retry"). Um cliente deste adapter
precisaria implementar sua própria lógica de retry se quisesse tolerar esse conflito.

**Confiança**: Alta para o endpoint/payload (fonte primária do mantenedor). O bug de conflito é
documentado como real e aberto (não resolvido no snapshot pesquisado).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | *(não declarada)* | `GET /scan` — ver seção dedicada acima. |
| `instance.status` | `GET /command?action=status` | Ver mapeamento de estado acima. |
| `instance.logout` | `GET /command?action=stop` | Soft-stop — ver seção dedicada acima. |
| `messages.sendText` | `POST /v3/bot/{token}/sendtext` | Body `{chatId, text}`. `to` aceita telefone com `+`, dígitos E.164 puros, JID completo ou o formato legado de grupo `numero-timestamp` — chatId canônico do waconector já bate 1:1 sem transformação. |
| `messages.sendMedia` | `POST /v3/bot/{token}/sendurl` (`media.url`) ou `POST /v3/bot/{token}/sendencoded` (`media.base64`) | Sem endpoint por tipo — servidor auto-detecta pelo mimetype. Ver seção dedicada abaixo. |
| `messages.edit` | `PUT /edit` | Rota legacy (não `/v3/bot/{token}/...`). Body `{messageId, content}`. Ver "Edição e exclusão de mensagem" acima. |
| `messages.delete` | `DELETE /message/{messageid}` | Rota legacy. Sempre revoke ("apagar para todos"). Ver "Edição e exclusão de mensagem" acima. |
| `groups.getInviteLink` | `GET /v3/bot/{token}/invite/{chatid}` | Único endpoint de grupo confirmado. |
| `chats.archive`/`chats.unarchive` | `POST /chat/archive` | Rota legacy. Body `{chatid, archive}` (tag minúscula). Ver "Conversas (`chats.*`)" acima. |
| `chats.markRead`/`chats.markUnread` | `POST /chat/markread` / `POST /chat/markunread` | Rota legacy. Body `{chatid}`. Ver "Conversas (`chats.*`)" acima. |
| `contacts.getProfilePicture` | `GET /v3/bot/{token}/picinfo/{chatid}` | Único endpoint de contato confirmado. |

### Formato do destinatário (`chatId`)

`FormatEndpoint()` (`src/whatsapp/whatsapp_extensions.go`), citado literalmente:

```go
func FormatEndpoint(source string) (destination string, err error) {
	if strings.HasPrefix(destination, "+") {
		destination = PhoneToWid(destination) // remove "+", concatena "@s.whatsapp.net"
		return
	}
	if strings.ContainsAny(destination, "@") {
		// já tem @s.whatsapp.net ou @g.us — valida sufixo, mantém
	} else {
		if strings.Contains(destination, "-") {
			// formato antigo de grupo "numero-timestamp" -> concatena "@g.us"
		} else {
			if IsValidE164(destination) {
				destination = PhoneToWid(destination) // dígitos puros -> "...@s.whatsapp.net"
			} else {
				destination = destination + "@g.us" // fallback: assume grupo
			}
		}
	}
	return
}
```

Confiança alta: aceita E.164 (`+55...` ou dígitos puros) OU JID completo
(`...@s.whatsapp.net`/`...@g.us`) OU o formato legado de grupo `numero-timestamp` sem `@`. Bate com
o chatId canônico do waconector — `toQuepasaChatId` é função identidade, mesmo padrão do
`toWhapiChatId`/`toWuzapiPhone` dos demais adapters.

### `messages.sendText`

`QpSendRequest` (`src/models/qp_send_request.go`):

```go
type QpSendRequest struct {
	Id       string `json:"id,omitempty"`
	ChatId   string `json:"chatId"`
	TrackId  string `json:"trackId,omitempty"`
	Text     string `json:"text,omitempty"`
	FileName string `json:"fileName,omitempty"`
	Content  []byte
}
```

Corpo enviado por este adapter: `{"chatId": "...", "text": "..."}`.

**Reply/quote e menções: NÃO suportados no envio** (confiança alta, busca exaustiva de código por
"quoted"/"mention": zero resultados em ambos). O campo `InReply` existe em `WhatsappMessage`, mas é
usado só na RECEPÇÃO (extraído de `ContextInfo.StanzaId`) — o caminho de envio inteiro nunca seta
isso na mensagem de saída. `SendTextInput.quotedId`/`.mentions` são silenciosamente ignorados por
este adapter (não lançamos por um campo opcional sem suporte).

### `messages.sendMedia`

Não existe um endpoint genérico "sendMedia" nem endpoints por tipo (`/sendimage`, `/sendvideo`
etc.) — o TIPO real da mensagem é auto-detectado no SERVIDOR pelo mimetype do conteúdo
(`GetMessageType`, `src/whatsapp/whatsapp_extensions.go`):

```go
switch mimeOnly[0] {
case "image/png", "image/jpeg":
	return ImageMessageType
case "audio/ogg", "application/ogg", "audio/oga", "audio/ogx",
     "audio/x-mpeg-3", "audio/mpeg3", "audio/mpeg",
     "audio/mp4", "audio/wav", "audio/x-wav":
	return AudioMessageType
case "video/mp4":
	return VideoMessageType
default:
	return DocumentMessageType
}
```

Este adapter escolhe entre dois endpoints de ENTREGA (não de tipo), conforme o que `MediaRef`
fornece:

| Endpoint | Quando | Corpo |
| --- | --- | --- |
| `POST /v3/bot/{token}/sendurl` | `media.url` presente | `{chatId, url, fileName?, text?}` — servidor baixa a URL. |
| `POST /v3/bot/{token}/sendencoded` | só `media.base64` presente | `{chatId, content, fileName?, text?}` — `content` assumido como base64 PURO (sem prefixo `data:mime;base64,`, removido por este adapter se presente — **assunção não confirmada literalmente**, coerente com `[]byte` do Go/`encoding-json`). |

Outros endpoints confirmados pela pesquisa mas NÃO usados por este adapter: `POST
/v3/bot/{token}/send` (decide texto vs. anexo pela presença de `url`/`content`, redundante com os
dois acima), `POST /v3/bot/{token}/sendbinary` (corpo é o binário cru, não JSON — mesma classe de
incompatibilidade do `/scan`), `POST /v3/bot/{token}/senddocument` (v2, marcado
`// deprecated, discard/remove on next version` no próprio código).

**Caption — achado não-óbvio, tratado inteiramente no SERVIDOR** (`SendMessage`,
`src/models/qp_whatsapp_server.go`, citado por completo):

```go
if msg.HasAttachment() {
	if len(msg.Text) > 0 {
		if msg.Type == whatsapp.ImageMessageType || msg.Type == whatsapp.VideoMessageType {
			msg.Attachment.FileName = msg.Text   // caption "sequestra" o campo FileName
		} else {
			// document/audio: manda o texto como MENSAGEM SEPARADA antes do anexo
			textMsg := *msg
			textMsg.Type = whatsapp.TextMessageType
			textMsg.Attachment = nil
			_, err = server.connection.Send(&textMsg)
		}
	}
}
response, err = server.connection.Send(msg)
```

Para **imagem/vídeo**: o `text` do request sobrescreve `Attachment.FileName`, que vira `Caption` no
proto — funciona como legenda, mas o nome de arquivo original é perdido como efeito colateral. Para
**documento/áudio**: não existe caption inline — o texto vira uma MENSAGEM DE TEXTO SEPARADA,
enviada ANTES do anexo. Este adapter não replica essa lógica — só repassa `text: input.caption` e
`fileName: input.media.filename`, deixando o servidor decidir.

**Sticker: sem caminho de ENVIO, confiança alta — mas o tipo EXISTE no modelo, ao contrário do que
uma versão anterior deste dossiê afirmava.** O enum `WhatsappMessageType` DO INCLUIR um
`StickerMessageType` (confirmado lendo `whatsapp_message_type.go` no snapshot mais recente,
`deivisonrpg/quepasa` — serializa como a string literal `"sticker"`, o mesmo valor que este adapter
já reconhece na recepção de webhooks, ver seção "Webhooks" abaixo). O que de fato falta é
auto-detecção por mimetype no ENVIO: `image/webp` não está no case de `GetMessageType`
(`whatsapp_extensions.go`) usado para classificar o tipo a partir do conteúdo — um "sticker" enviado
por qualquer endpoint viraria um `DocumentMessage` comum, não uma figurinha de verdade. Este adapter
lança `INVALID_INPUT` para `media.kind === 'sticker'` em vez de mandar silenciosamente algo
diferente do que o chamador pediu — mas por ausência de rota de envio, não por ausência do tipo no
modelo.

**Áudio como PTT (nota de voz) é automático por mimetype**, não por parâmetro:

```go
func ShouldUsePtt(Mimetype string) bool {
	return strings.Contains(Mimetype, "ogg") && strings.Contains(Mimetype, "opus")
}
```

### Resposta de envio

v3 (`QpSendResponse`/`QpSendResponseMessage`), confirmada por struct — **sem payload de resposta
literal capturado**:

```go
type QpSendResponse struct {
	QpResponse
	Message *QpSendResponseMessage `json:"message,omitempty"`
}
type QpSendResponseMessage struct {
	Id      string `json:"id,omitempty"`
	Wid     string `json:"wid,omitempty"`
	ChatId  string `json:"chatId,omitempty"`
	TrackId string `json:"trackId,omitempty"`
}
```

Mapeado para `SentMessage`: `id` = `message.id` (fallback `quepasa-<Date.now()>`), `chatId` =
`message.chatId` (fallback no `chatId` requisitado). **Sem timestamp** — diferente de outros
adapters deste pacote, a resposta v3 não devolve o instante do envio; `SentMessage.timestamp` fica
sempre `undefined`.

Existe também um formato v2 legado (`QpSendResponseV2`, campos `message_id`/`date`/`from`/`chat`/
`result`) mantido só por compatibilidade — não usado por este adapter (só v3).

## Grupos

**Escopo muito limitado, confiança alta**: o único endpoint de grupo em todo o código é `GET
/v3/bot/{token}/invite/{chatid}` (`api_handlers+InviteController.go`):

```go
if !strings.HasSuffix(chatId, "@g.us") {
	err = fmt.Errorf("chatId must be a valid and formated (@g.us) group id")
}
url, err := server.GetInvite(chatId)
response.Url = url
```

Resposta confirmada literalmente (`QpInviteResponse{QpResponse, Url string}`):
`{"success": true, "url": "https://chat.whatsapp.com/..."}` — já vem como link completo, mas ainda
passa por `normalizeInviteLink` por segurança (idempotente quando já completo), mesmo padrão do
adapter Wuzapi.

Busca por `CreateGroup`, `JoinedGroups`, participantes, config (subject/description/picture),
revoke invite, join via invite, leave group nos forks de snapshot mais antigo (`edcarlosm/quepasa`,
`botarenaweb/Quepasa-api`): zero resultados. **Mas** o snapshot mais recente (`deivisonrpg/quepasa`,
2026-07-07) TEM uma API v5 completa para grupos — `src/api/api_routes_groups.go` registra
list/create/get/leave/patch/name/description/participants/photo/requests/invite/revoke-invite.
Nenhum desses é implementado por este adapter nesta fase — não por ausência do endpoint, mas porque
essas rotas exigem sessão de usuário via JWT (`jwtauth.Verifier` + `AuthenticatedAPIHandler`),
incompatível com o token por instância deste contrato. Ver "Capabilities confirmadas mas não
implementadas nesta fase" ao final.

## Contatos

**Escopo muito limitado, confiança alta**: único endpoint relacionado é foto de perfil, `GET/POST
/v3/bot/{token}/picinfo[/{chatid}/{pictureid}]` (e a variante `/picdata`, que faz proxy dos BYTES da
imagem — mesma classe de incompatibilidade binária do `/scan`, não usada por este adapter),
retornando `WhatsappProfilePicture`:

```go
type WhatsappProfilePicture struct {
	Id     string `json:"id,omitempty"`
	Type   string `json:"type,omitempty"`
	Url    string `json:"url,omitempty"`
	ChatId string `json:"chatid,omitempty"`
	Wid    string `json:"wid,omitempty"`
}
```

**Envelope de resposta CONFIRMADO por código-fonte** (não mais por analogia): `PictureController`
(`botarenaweb/Quepasa-api`, `src/controllers/api_handlers+PictureController.go`) faz
`response.Info = info` sobre um `*models.QpPictureResponse`, cujo struct (`qp_picture_response.go`)
é:

```go
type QpPictureResponse struct {
	QpResponse
	Info *whatsapp.WhatsappProfilePicture `json:"info,omitempty"`
}
```

Ou seja, o corpo real é `{success, status, info: {id, type, url, chatid, wid}}` — `url` vem
ANINHADO sob `info`, NÃO solto no nível raiz. A suposição original deste dossiê (por analogia com
`QpInviteResponse`/`QpSendResponse`, que embutem os campos lado a lado sem aninhamento extra) estava
**incorreta** e foi corrigida após verificação direta do controller acima; este adapter extrai
`url` de `info.url`. `url` fica `undefined` quando o contato não tem foto OU quando `info` está
ausente do corpo — nunca lança.

Busca por `IsOnWhatsApp`/checagem de existência, listagem de contatos, `getAbout`/status,
block/unblock/listBlocked nos forks de snapshot mais antigo: zero resultados. Existe um
`UserController`, mas é sobre contas internas do QuePasa (multi-tenant), não contatos do WhatsApp —
fora de escopo. **Mas**, assim como em Grupos acima, o snapshot mais recente (`deivisonrpg/quepasa`,
2026-07-07) TEM uma API v5 completa para contatos — `src/api/api_routes_contacts.go` registra
list/identifier/search/get/availability/block/unblock/save — atrás do mesmo gate de autenticação
JWT/usuário, incompatível com o token por instância deste adapter. Ver "Capabilities confirmadas mas
não implementadas nesta fase" ao final.

## Webhooks

Configurado por instância via `GET/POST/DELETE /webhook` (resolvido por token, `GetServer(r)`).
Corpo do `POST` decodifica em `QpWebhook` (`src/models/qp_webhook.go`):

```go
type QpWebhook struct {
	whatsapp.WhatsappOptions
	Url             string      `db:"url" json:"url,omitempty"`
	ForwardInternal bool        `db:"forwardinternal" json:"forwardinternal,omitempty"`
	TrackId         string      `db:"trackid" json:"trackid,omitempty"`
	Extra           interface{} `db:"extra" json:"extra,omitempty"`
}
```

`WhatsappOptions` embutido traz flags booleanas por assinatura de webhook que decidem quais eventos
aquele endpoint recebe: `readreceipts`, `deliveryreceipts`, `groups`, `broadcasts`, `calls`,
`direct`. Única variável de ambiente relevante é `WEBHOOK_TIMEOUT` (timeout do POST).

### Envelope

`QpWebhookPayload{ *whatsapp.WhatsappMessage, Extra }` — os campos de `WhatsappMessage` são
PROMOVIDOS (embedding anônimo do Go) para o nível raiz do JSON, sem wrapper por categoria como no
Whapi. Struct completa (`src/whatsapp/whatsapp_message.go`), citada por ser a evidência mais
confiável disponível (nenhum payload de exemplo real foi capturado — ver "Gaps" ao final):

```go
type WhatsappMessage struct {
	Id      string `json:"id"`
	TrackId string `json:"trackid,omitempty"`
	Timestamp time.Time           `json:"timestamp"`
	Type      WhatsappMessageType `json:"type"`
	Chat WhatsappChat `json:"chat"`
	Participant *WhatsappChat `json:"participant,omitempty"`
	Text string `json:"text,omitempty"`
	Attachment *WhatsappAttachment `json:"attachment,omitempty"`
	FromMe bool `json:"fromme"`
	FromInternal bool `json:"frominternal"`
	FromHistory bool `json:"fromhistory,omitempty"`
	Edited bool `json:"edited,omitempty"`
	ForwardingScore uint32 `json:"forwardingscore,omitempty"`
	InReaction bool `json:"inreaction,omitempty"`
	InVideoNote bool `json:"invideonote,omitempty"`
	InReply string `json:"inreply,omitempty"`
	Synopsis string `json:"synopsis,omitempty"`
	Status WhatsappMessageStatus `json:"status,omitempty"`
	Wid string `json:"wid,omitempty"`
	Info any `json:"info,omitempty"`
	Poll *WhatsappPoll `json:"poll,omitempty"`
	Location *WhatsappLocation `json:"location,omitempty"`
	Contact *WhatsappContact `json:"contact,omitempty"`
	Exceptions []string `json:"exceptions,omitempty"`
	ExpiresAt int64 `json:"expiresat,omitempty"`
}
```

`type` é STRING (via `MarshalJSON` customizado, confirmado no snapshot mais recente): `image,
document, audio, video, text, location, contact, call, system, group, revoke, poll, sticker,
view_once, unhandled`. `wid` (corpo) e o header `X-QUEPASA-WID` carregam o mesmo valor — mapeado
para `CanonicalEvent.instanceId`. `chat.id` para eventos de sistema usa o sentinel `WASYSTEMCHAT =
{Id: "system", Title: "Internal System Message"}`.

**`WhatsappAttachment` (shape do anexo recebido): CONFIRMADO por código-fonte** (correção de um erro
deste dossiê — uma versão anterior descrevia este shape como "não confirmado" e deixava
`WaMessage.media` sempre `undefined`). `whatsapp_attachment.go` (snapshot mais recente,
`deivisonrpg/quepasa`) traz, entre outros campos:

```go
type WhatsappAttachment struct {
	Mimetype   string `json:"mime"`
	FileName   string `json:"filename,omitempty"`
	Url        string `json:"url,omitempty"`
	FileLength uint64 `json:"filelength"`
	// + thumbnail, duração de áudio, coordenadas de localização — não usados por este adapter
}
```

Este adapter popula `WaMessage.media` (`mimeType`/`filename`/`url`) a partir de `record.attachment`
para tipos de mídia (image/video/audio/document/sticker), lendo exatamente estes três campos
confirmados. `media` fica `undefined` quando `attachment` está ausente do payload (mensagens de
texto/localização/contato/poll) — nunca lança.

### `message.received` / `message.sent`

`type` em `{text, image, video, audio, document, sticker, poll, location, contact}` — `fromme`
distingue recebida vs. eco. `view_once` também cai neste caminho, com `kind: 'unknown'` (confiança
baixa — a pesquisa não confirmou como distinguir o tipo de mídia subjacente do wrapper "ver uma
vez"). `quotedId` = `inreply` quando presente.

### `message.ack` — forma sintética atípica

Achado importante: o recibo de entrega/leitura chega como `type: "system"` (não um tipo dedicado de
ack), com uma forma bem diferente do padrão dos outros adapters deste pacote
(`src/whatsmeow/whatsmeow_handlers.go`, `Receipt`, citado por completo):

```go
message := &whatsapp.WhatsappMessage{Content: evt}
message.Id = "deliveryreceipt"          // ou "readreceipt" — string LITERAL, não o id real
message.Timestamp = evt.Timestamp
message.Chat = *NewWhatsappChat(source, evt.Chat)
message.Type = whatsapp.SystemMessageType
message.Text = id                        // aqui sim vai o ID real da mensagem afetada
```

Ou seja: `id` do payload é literalmente a string `"deliveryreceipt"`/`"readreceipt"` — o id REAL da
mensagem confirmada vai em `text`. Este adapter detecta esse sentinel de `id` ANTES de qualquer
outra interpretação de `type: "system"` e monta `MessageAckEvent{messageId: record.text, ack:
id === 'readreceipt' ? 'read' : 'delivered'}`.

Mapeamento receipt → status, confirmado (`GetWhatsappMessageStatus`,
`src/whatsmeow/whatsmeow_extensions.go`):

```go
func GetWhatsappMessageStatus(receipt types.ReceiptType) whatsapp.WhatsappMessageStatus {
	switch receipt {
	case types.ReceiptTypeDelivered: return whatsapp.WhatsappMessageStatusDelivered
	case types.ReceiptTypeRetry, types.ReceiptTypeServerError: return whatsapp.WhatsappMessageStatusError
	case types.ReceiptTypeRead, types.ReceiptTypePlayed: return whatsapp.WhatsappMessageStatusRead
	}
	return whatsapp.WhatsappMessageStatusUnknown
}
```

**Implicações**: não existe `pending`/`sent` distinto no webhook (só `delivered`/`read` chegam);
`played` (áudio ouvido) colapsa em `read` — o QuePasa não distingue. Também gated por config por
assinatura de webhook (`readreceipts`/`deliveryreceipts` booleanos).

### `connection.update` — via `type: "system"`, discriminado por `info.event`

Depois de excluir o sentinel de ack acima, o restante de `type: "system"` é notificação de ciclo de
vida da conexão, discriminada por `info.event` (`LifecycleHandler`, `src/models/lifecycle_handler.go`,
citado por completo para `disconnected`):

```go
func (lh *LifecycleHandler) OnDisconnected(cause string, details string) {
	eventData := map[string]interface{}{
		"event": "disconnected", "cause": cause, "details": details,
		"wid": wid, "phone": phone, "timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	message := &whatsapp.WhatsappMessage{
		Id: uuid.New().String(), Timestamp: time.Now().UTC(), Type: whatsapp.SystemMessageType,
		FromMe: false, Chat: whatsapp.WASYSTEMCHAT, Text: description, Info: eventData,
	}
	lh.dispatcher.AppendMsgToCache(message, "disconnected")
}
```

`stopped`/`deleted` seguem o mesmo padrão. `logged_out` é dispatchado por um caminho diferente
(`whatsmeow_handlers.go`, `handler.Follow(message, "logout")`), com `text` = razão do whatsmeow —
o valor exato de `info.event` para este caso não foi confirmado literalmente (assumido
`"logged_out"` por analogia com o padrão dos demais).

| `info.event` | `InstanceState` | Confiança |
| --- | --- | --- |
| `connected`, `pair_success` | `connected` | Média-alta (`connected` não tem citação literal de `eventData`, só inferido por simetria com `disconnected`; `pair_success` citado na tabela de eventos do router). |
| `disconnected`, `stopped`, `deleted`, `logged_out` | `disconnected` | Alta para `disconnected`; média para os demais (mesmo padrão, não citados byte-a-byte). |
| `qr_scan` | `qr` | **Média** — ver ressalva abaixo. |
| `blocklist`, qualquer outro | *(sem mudança de estado — vira `unknown`)* | — |

**Ressalva sobre `qr_scan`**: o handler de QR do fork examinado (`OnQREvent`) tenta ler campos por
reflection (`Event`/`Code`) que a struct real `whatsmeow/types/events.QR` NÃO possui (só `Codes
[]string`) — plausível que, na prática, esse caminho sempre caia num fallback genérico
(`status:"unknown", message:"QR event received (structure unknown)"`) em vez de realmente disparar
`info.event: "qr_scan"` como desenhado. Este adapter mapeia pelo design PRETENDIDO do código (é o
melhor sinal disponível), documentando esta incerteza — a fixture
`webhook-connection-qr-reconstructed.json` é marcada como reconstruída por causa disso.

### `group.update` — só entrada no grupo

`type: "group"` é disparado SÓ quando o próprio bot entra num grupo (`events.JoinedGroup`).
Mudanças em grupos JÁ existentes (assunto, descrição, participantes) NÃO são despachadas via
webhook nesta versão — `events.GroupInfo` cai num handler "não implementado"
(`whatsmeow_event_router.go`, citado):

```go
r.register(reflect.TypeOf(&events.JoinedGroup{}), func(raw interface{}) {
    evt := raw.(*events.JoinedGroup)
    source.JoinedGroup(*evt)
})
r.register(reflect.TypeOf(&events.GroupInfo{}), unimplementedHandler)
```

`action` fica sempre `undefined` neste adapter: nenhuma convenção de `GroupUpdateEvent.action`
(`participants.add/remove/promote/demote`, `subject`, `description`) descreve "eu entrei neste
grupo". `info.Participants` é só a CONTAGEM de membros no momento da entrada (não a lista de JIDs).

### `call`, `revoke`, `unhandled` — sem `CanonicalEvent` equivalente

`type: "call"` (chamada de voz/vídeo — o contrato central não modela chamadas),
`type: "revoke"` (mensagem apagada) e `type: "unhandled"` (o próprio QuePasa não classificou) viram
`unknown` com `reason` descritivo — não há um `CanonicalEvent` dedicado para nenhum dos três nesta
fase.

### Timestamp

`Timestamp time.Time` nativo do Go, SEM `MarshalJSON` customizado no próprio campo — serializa como
string **RFC3339** (`"2026-07-11T21:14:24.000123Z"`), NÃO epoch numérico — diferente de
WAHA/Evolution/Whapi/etc. (que usam epoch em segundos). Este adapter usa `Date.parse` nativo, com
fallback para `Date.now()` se o parsing falhar (nunca lança).

## Limites e particularidades

- **Healthcheck dedicado por instância**: não encontrado. Só existe `GET /metrics` (Prometheus,
  processo inteiro, sem granularidade por instância) — fora do escopo do contrato `WaAdapter`.
- **Listar instâncias via REST/token**: não encontrado. A única listagem existente é `GET
  /form/account` (HTML server-rendered, autenticado por cookie JWT) — não é uma API JSON e não usa
  o modelo de token por instância.
- **Rate limit**: nenhuma fonte com número documentado (self-hosted — depende da infraestrutura do
  operador, não de um limite do provider).
- **`/scan` e `/picdata`** (variante de foto de perfil) são as duas rotas que devolvem BYTES
  binários crus em vez de JSON — mesma classe de incompatibilidade com o `HttpClient` atual deste
  pacote (ver `instance.connect` acima); `/picdata` não é usada por este adapter, só `/picinfo`
  (que devolve a URL em JSON).
- **`sendbinary`**: aceita o corpo cru como binário (não JSON) — mesma classe de incompatibilidade,
  não usada por este adapter.

## Capabilities confirmadas mas não implementadas nesta fase

- **`instance.connect`** — tecnicamente confirmado no provider (`GET /scan` gera e entrega um QR),
  mas incompatível com o `HttpClient` atual deste pacote (resposta binária corrompida por
  `response.text()`). Requer estender o core para um modo de resposta `ArrayBuffer` — ADR dedicado
  antes de promover.
- **`instance.pairingCode`** — `IWhatsappConnection` não expõe pareamento por telefone; a lib
  subjacente (`whatsmeow`) tem `PairPhone`, mas o QuePasa não o chama em lugar nenhum do código
  examinado.
- **`messages.sendReaction`**, **`groups.*` além de `getInviteLink`** e **`contacts.*` além de
  `getProfilePicture`** — **não é "zero resultados no provider"**: o snapshot mais recente
  pesquisado (`deivisonrpg/quepasa`, último push 2026-07-07) contém uma API v5 "canônica" completa
  para os três:
  - Reações: `SendReaction` (`src/whatsmeow/whatsmeow_extensions+reactions.go`), exposto via
    `POST/DELETE /messages/react` (`src/api/api_handlers+ReactionsController.go`,
    `src/api/api_routes_messages.go`).
  - Grupos: `src/api/api_routes_groups.go` registra list/create/get/leave/patch/name/description/
    participants/photo/requests/invite/revoke-invite.
  - Contatos: `src/api/api_routes_contacts.go` registra list/identifier/search/get/availability/
    block/unblock/save.

  Essas rotas estão registradas atrás de `jwtauth.Verifier` + `AuthenticatedAPIHandler` (e parte
  também exige `requireOwnedServerToken -> GetAuthenticatedUser`) — ou seja, exigem uma sessão de
  USUÁRIO via JWT, não o token por instância (`X-QUEPASA-TOKEN`) que este adapter usa. Excluir estas
  capabilities desta fase continua sendo uma decisão defensável, mas pela incompatibilidade de
  modelo de autenticação — não porque o endpoint não exista. Se um token de instância consegue obter
  um JWT (e portanto se esta API v5 é alcançável a partir do modelo de token deste adapter) **não
  foi verificado** nesta pesquisa; validar isso é pré-requisito antes de promover qualquer uma
  destas capabilities numa fase futura.

### Follow-up (2026-07-12): a "indício" do token por instância foi confirmada — e um dos argumentos usados para recusar a implementação estava errado

Uma auditoria de gaps subsequente (Epic 6 do `ORCHESTRATOR-ROADMAP.md`) levantou um indício, só de
ler código-fonte, de que as rotas v5 acima aceitariam o MESMO `X-QUEPASA-TOKEN` já usado por este
adapter, sem precisar de JWT de verdade — sinalizado explicitamente como "não testado contra
instância real, validar antes de implementar em lote". Esta seção documenta a validação feita (via
leitura adicional de código-fonte do mesmo mirror, `deivisonrpg/quepasa`) e por que a conclusão
final continua sendo **não implementar** — mas com uma correção importante: uma verificação
adversarial subsequente (mesmo dia) mostrou que o argumento "nenhuma imagem Docker lançada teria
essa API" (usado abaixo numa versão anterior desta seção) é **falso** e foi removido. Os detalhes
da correção estão na subseção "Correção (mesmo dia)" ao final desta seção.

**O indício procede, tecnicamente**: `AuthenticatedAPIHandler` (`src/api/api_authenticated_routes.go`)
tem um fallback explícito que aceita `X-QUEPASA-TOKEN` quando não há JWT válido no contexto —
resolve o usuário dono via `findPersistedServerRecord(token).GetUser()` (ou uma sessão viva via
`runtime.FindLiveSessionByToken`), e depois grava esse token numa `scopedSessionAuth` no contexto da
requisição. `requireOwnedServerToken()` (usado nas rotas "canonical" de grupos/contatos) em seguida
chama `ensureTokenScope` — que EXIGE que o `token` da URL bata exatamente com o token usado para
autenticar — e `GetOwnedServerRecord`, que rejeita se `server.GetUser() != user.Username`. Ou seja:
com esse código, o MESMO `X-QUEPASA-TOKEN` que este adapter já envia em toda requisição seria
suficiente, sem JWT, DESDE QUE o registro do servidor tenha um usuário dono associado. Isso é
corroborado por um documento de primeira mão do próprio mirror,
`docs/USAGE-authentication-modes.md`, que descreve `X-QUEPASA-TOKEN` como modo de autenticação
válido para rotas "canonical" protegidas e recomenda explicitamente esse modo "for headless bots" —
exatamente o perfil deste adapter.

**Mas esse usuário dono não existe no modelo de pareamento anônimo que este adapter (e o resto deste
dossiê) assume.** Lendo o handler atual de `/scan` (`ScannerController`,
`src/api/api_handlers+ScannerAndPairCodeController.go`, MESMO snapshot): antes de gerar o QR, ele
chama `ValidateUsername(r)` -> `GetUsername(r)` -> `GetUser(r)`, e `GetUser` **retorna erro
"missing user name parameter" quando não há um parâmetro `user`** (path/query/form/header
`X-QUEPASA-USER`) — sem nenhum fallback anônimo. Este adapter nunca envia esse parâmetro (o modelo
documentado no início deste dossiê é "token arbitrário, sem login"). Ou seja, no MESMO snapshot que
confirma o fallback de token, o próprio pareamento parece exigir um usuário dono — uma tensão
interna que não foi possível resolver só lendo código (pode haver um caminho alternativo de
pareamento sem essa exigência que a pesquisa não localizou).

**Esta camada não está em nenhuma tag com nome de versão — mas ISSO NÃO significa "não lançada em
Docker".** Toda essa camada — rotas `/api/v5` "canonical", `AuthenticatedAPIHandler` com fallback de
token, `docs/USAGE-authentication-modes.md` — existe no HEAD da branch `main` de
`deivisonrpg/quepasa` (commit `17c3b10bac751346ca4d6c3514839ea60e8d73ce`, 2026-07-07T17:56:12Z,
autor "Deivison Lincoln", mantenedor deste mirror especificamente — não o autor original).
Confirmado via API do GitHub (`GET /repos/deivisonrpg/quepasa/tags`, todas as ~39 tags, com data de
commit de cada uma): a tag de nome de versão mais recente **não é** `3.25.2707.1705` — essa data
foi lida errado numa versão anterior desta seção. A verdadeira mais recente é **`3.25.0924.2015`**
(commit `84ea6db9`, **2025-09-24T23:18:07Z**), cerca de **9,5 meses** antes de hoje (2026-07-12),
não "mais de um ano". Mesmo essa tag correta **não contém** `src/api/v5`
(`GET /repos/deivisonrpg/quepasa/contents/src/api/v5?ref=3.25.0924.2015` -> 404, verificado
diretamente) — então a conclusão "nenhuma tag git nomeada tem a API v5" continua de pé, só a tag
citada como evidência estava errada. A tag `latest` (git, não Docker) aponta para o PRIMEIRO commit
do repositório (2025-01-29, autor "No Code Leaks", mensagem "first commit ?!"). Não há nenhum
GitHub Release publicado (`GET /repos/deivisonrpg/quepasa/releases` -> `[]`).

**Mas existe, sim, uma imagem Docker real e ativamente usada com este código.** O workflow
`.github/workflows/docker.yml` deste mesmo mirror builda e publica a tag **`:latest` do Docker Hub**
(`IMAGE_NAME: codeleaks/quepasa`, não a tag `latest` do git acima — são coisas diferentes) a cada
push em `main`. Consultando a API pública do Docker Hub (`GET
/v2/repositories/codeleaks/quepasa/tags/latest`): essa imagem foi publicada em
**2026-07-07T21:04:32Z** — cerca de 3h depois do commit `17c3b10b` auditado acima — e puxada pela
última vez em **2026-07-12T12:41:29Z** (hoje), com **29.965 pulls** históricos acumulados só nessa
tag e o repositório do Docker Hub ativo desde 2023-04-20. Ou seja: a imagem `:latest`, que é a que
a maioria dos operadores self-hosted roda por padrão (`docker-compose` sem pin de versão), JÁ
contém a API v5 e o fallback de token — não é "trabalho em andamento que pode nunca chegar a uma
instância self-hosted real", já chegou. O argumento "nada disso está em nenhuma versão lançada"
usado numa versão anterior desta seção estava errado e foi removido — ver "Correção (mesmo dia)"
abaixo.

**Decisão**: `messages.sendReaction`, `groups.*` (além de `getInviteLink`) e `contacts.*` (além de
`getProfilePicture`) continuam **não implementadas nesta fase** — mas agora apoiada só nos
argumentos que de fato se sustentam, não mais em "código não lançado":

1. **Nenhuma instância real foi exercitada.** Toda a validação desta seção (e do dossiê original)
   é leitura de código-fonte + metadados públicos do Docker Hub/GitHub — nenhuma chamada HTTP real
   foi feita contra um container rodando. Não há confirmação de que o fluxo completo
   (`/scan` → pareamento → `X-QUEPASA-TOKEN` → rota v5) realmente autentica de ponta a ponta.
2. **A tensão do `/scan` exigir `user` continua sem resolver.** O pareamento (`ScannerController` ->
   `GetUser`) exige um parâmetro `user` sem fallback anônimo, incompatível com o modelo "token
   arbitrário, sem login" que este adapter assume — não está confirmado que um token pareado por
   este adapter (sem `user` associado) sequer teria um `GetOwnedServerRecord` válido para passar
   por `ensureTokenScope` nas rotas v5.

Declarar essas capabilities com base só em leitura de código, sem testar contra tráfego real, viola
o princípio deste pacote de "declarar apenas capabilities realmente suportadas" — o risco é uma
integração real receber 401/404 silenciosamente. Este item foi fechado no
`ORCHESTRATOR-ROADMAP.md` (Epic 6) como "investigado e recusado com evidência", não como
implementado; reabrir exigiria uma instância Docker real (ex.: `docker pull codeleaks/quepasa:latest`,
publicamente disponível — ver acima) exercitada de ponta a ponta contra tráfego real, não apenas
leitura de código ou metadados.

### Correção (mesmo dia): o argumento "não lançado" estava errado

Uma verificação adversarial da seção acima, feita no mesmo dia, encontrou dois erros factuais numa
versão anterior deste follow-up, ambos corrigidos no texto acima:

- A frase "nenhuma imagem Docker de uma versão tagueada/lançada deste mirror teria essa API v5"
  tratava "tag git nomeada" como sinônimo de "imagem Docker publicada" — são coisas diferentes. A
  tag **`:latest` do Docker Hub** (distinta da tag git `latest`) é publicada a partir do HEAD de
  `main` a cada push, então ela SEGUE o HEAD, não uma tag de versão. Confirmado publicada ~3h após
  o commit auditado e puxada pela última vez hoje, com quase 30 mil pulls acumulados — uma imagem
  real, pública e ativamente usada, não "trabalho em andamento não lançado".
- A tag git de nome de versão citada como "a mais recente" (`3.25.2707.1705`, 2025-07-27) não era a
  mais recente — pelo menos 20 outras tags do mesmo repositório apontam para commits posteriores; a
  verdadeira mais recente é `3.25.0924.2015` (2025-09-24). E mesmo para a tag citada originalmente,
  a diferença até hoje era de ~11,5 meses, não "mais de um ano" como escrito.

A conclusão sobre tags GIT especificamente (nenhuma tag nomeada contém `src/api/v5`) continua
válida mesmo após a correção — foi verificada de novo contra a tag correta. O que mudou foi a
inferência daí para "logo não há imagem Docker real com essa API": essa inferência não se sustenta,
porque a imagem `:latest` do Docker Hub não é construída a partir de uma tag git de versão, e sim
do HEAD da branch a cada push.

## Gaps conhecidos (a validar contra uma instância real)

| Ponto | Gap |
| --- | --- |
| Fonte da pesquisa | Repo oficial (`nocodeleaks/quepasa`) bloqueado por DMCA; pesquisa feita em três forks/mirrors (2023-04-20, 2025-05-07, 2026-07-07) — alta confiança de fidelidade, mas nenhum é a URL canônica. |
| `ConnectResult.qr` (`GET /scan`) | Resposta é PNG binário cru — incompatível com o `HttpClient` atual (decodificação texto/UTF-8 corrompe os bytes). `instance.connect` não é declarada por causa disso — ver seção dedicada. |
| Envelope de resposta de `contacts.getProfilePicture` (`GET /picinfo`) | ~~Struct `WhatsappProfilePicture` confirmada, mas envelope assumido "campos soltos no nível raiz" por analogia~~ — **corrigido**: envelope confirmado por código-fonte (`QpPictureResponse`/`PictureController`), `url` vem aninhado sob `info`. Ver seção "Contatos" acima. |
| Shape de `WhatsappAttachment` (webhook, mensagem recebida) | ~~Campo confirmado, mas nomes de campo internos não confirmados — `WaMessage.media` sempre `undefined`~~ — **corrigido**: shape confirmado por código-fonte (`mime`/`filename`/`url`), `WaMessage.media` agora populado para tipos de mídia. Nenhum exemplo de payload REAL (tráfego capturado) com anexo populado foi encontrado, então o comportamento contra uma instância real ainda não foi validado — ver linha "Comportamento contra uma instância Docker real" abaixo. |
| `info.event` para `connected`/`pair_success`/`logged_out`/`qr_scan` | Só `disconnected`/`stopped`/`deleted` têm citação literal de `eventData`; os demais são inferidos por simetria de código — `qr_scan` em particular tem confiança média (possível bug de reflection no handler observado). |
| `content` (base64) em `/sendencoded` | Assumido como base64 puro, sem prefixo de data URI — não confirmado por nenhuma requisição de exemplo capturada. |
| Todas as fixtures deste adapter | RECONSTRUÍDAS a partir de definições de struct Go confirmadas — nenhum payload de webhook real (tráfego capturado) foi encontrado na pesquisa, diferente de outros dossiês deste pacote que têm exemplos literais. |
| Comportamento contra uma instância Docker real | Nenhuma instância foi de fato exercitada nesta pesquisa (só leitura de código-fonte) — shape exato de erros HTTP, rate-limit/retry, e se alguma das lacunas acima foi preenchida em versões mais novas do `nocodeleaks/quepasa` não são verificáveis enquanto o repo oficial estiver bloqueado. |
| `chats.archive`/`chats.markRead`/`chats.markUnread` sob conflito 409/LTHash | Bug upstream confirmado por documentação de primeira mão do mantenedor (`docs/CHAT_MANAGEMENT.md`, `tulir/whatsmeow#858`), não por tráfego real capturado nesta pesquisa — o shape exato do erro e a frequência real do conflito contra uma instância viva não foram exercitados. |
| Janela de tempo de `messages.edit`/`messages.delete` | Nem o handler nem a implementação (`Edit`/`Revoke`) validam um prazo — o comportamento exato do WhatsApp real para edição/revogação fora da janela (~15min para edição; janela mais ampla para revogação) não foi verificado contra tráfego real. |
