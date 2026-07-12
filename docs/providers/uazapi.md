# Dossiê: uazapi

- Docs oficiais: <https://docs.uazapi.com/> (OpenAPI bundled: <https://docs.uazapi.com/openapi-bundled.json>)
- Versão testada: documentação consultada em 2026-07-10 (produto "uazapiGO - WhatsApp API", v2.1.1)
- Hospedagem: SaaS multi-tenant por subdomínio — `servers` do OpenAPI usa o template
  `https://{subdomain}.uazapi.com` (exemplos de enum: `free`, `api`). Não foi encontrado
  repositório público nem imagem Docker para self-hosting durante a pesquisa (diferente de
  WAHA/Evolution GO); `baseUrl` em `UazapiOptions` é sempre fornecido pelo consumidor, com o
  subdomínio do próprio cliente.

## Autenticação

Mecanismo de API-key custom em header — **não** `Authorization: Bearer`, sem OAuth/JWT/cookies em
toda a especificação. Dois níveis, ambos declarados como `securitySchemes` tipo `apiKey`/`in:header`
no OpenAPI:

- **`token`** (token de instância): header `token: <valor cru, sem prefixo>`. Exigido pela maioria
  dos endpoints operacionais regulares (send, chat, group, profile, connect, status, disconnect,
  delete instance, config de webhook por instância, sse). É o único token usado pelas capabilities
  implementadas nesta fase (F2).
- **`admintoken`** (token administrativo): header `admintoken: <valor cru>`. Exigido só em
  endpoints administrativos (`POST /instance/create`, listar todas as instâncias, webhook global,
  rotacionar admin token, reiniciar app, editar campos administrativos). **Nenhuma capability
  implementada nesta fase usa `admintoken`** — `UazapiOptions.adminToken` existe apenas para
  permitir que o consumidor guarde os dois tokens num único lugar e para uma fase futura que exponha
  provisionamento de instância (`instance.create`, fora do contrato atual). Rotação
  (`POST /admin/token/rotate`) é limitada a 1x/24h — não implementada.
- Exceção documentada: o endpoint `/sse` (Server-Sent Events, fora do escopo desta fase) aceita o
  token também via query string (`?token=...`), porque `EventSource` não permite headers
  customizados. Nenhum outro endpoint documenta autenticação via query string.

## Modelo de instância/sessão

Termo do provider: **"instância"** (`Instance`). Campos documentados do objeto `Instance`: `id`,
`token`, `status`, `qrcode` (PNG base64), `paircode`, `name`, `profileName`, `profilePicUrl`,
`isBusiness`, `plataform`, `systemName`, `owner`, `current_presence`, `lastDisconnect`,
`lastDisconnectReason`, `adminField01/02`, além de campos de CRM/chatbot (`openai_apikey`,
`chatbot_enabled`, ...), `created`/`updated`.

- **Criar** (fora do escopo desta fase — exige `admintoken`): `POST /instance/create`, body
  `{ name, adminField01?, adminField02? }`; cria em estado `disconnected` e devolve um `token`
  único a ser guardado pelo consumidor. Em servidores free/demo a instância é "automaticamente
  desconectada e deletada após 1 hora".
- **Conectar**: `POST /instance/connect` (header `token`). Body opcional
  `{ phone?, browser?, systemName?, proxy_managed_country?/state?/city? }`. Se `phone` for
  informado (`^\d{10,15}$`), o provider gera **código de pareamento** em vez de QR; se omitido,
  gera QR code. Coloca a instância em `connecting`. **Esta fase não expõe pairing code**: o
  contrato `InstanceApi.connect()` não recebe telefone como parâmetro, então o adapter sempre chama
  `/instance/connect` sem `phone` (fluxo de QR exclusivamente) — ver seção "Capabilities" abaixo.
- **Status**: `GET /instance/status` (header `token`). Resposta confirmada literalmente na doc:
  `{ instance: Instance (inclui qrcode/paircode atualizados durante a conexão), status: { connected, loggedIn, jid } }`,
  com `jid` no formato `{ user, agent, device, server: 's.whatsapp.net' }`.
- **Desconectar (soft)**: `POST /instance/disconnect` (header `token`) — encerra a sessão WhatsApp
  ativa mas **mantém o registro da instância**; reconectar exige novo QR/pairing code. É este
  endpoint que o adapter usa para `instance.logout()` (mesma semântica do `logout` do WAHA: revoga
  o device, mas não apaga a instância).
- **Deletar (hard)**: `DELETE /instance` — remove completamente a instância e seu token do banco.
  **Não implementado nesta fase** (fora do escopo de `InstanceApi`, que não tem operação de
  exclusão de instância).
- **Reset de runtime**: `POST /instance/reset` — reinicia sessão travada sem exigir novo QR e sem
  apagar a instância. Não implementado nesta fase.
- Valores de `status`: `disconnected | connecting | connected | hibernated`. Timeouts documentados
  do fluxo de conexão: 2 minutos para QR code, 5 minutos para pairing code.

## Capabilities implementadas nesta fase (F2)

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `messages.sendReaction`, `messages.edit`, `messages.delete`,
`messages.pin`, `messages.unpin`, `messages.markRead` (ADR-0013 — sem `messages.forward`/`star`,
ver seção dedicada abaixo),
`chats.archive`, `chats.unarchive`, `chats.mute`, `chats.unmute`, `chats.pin`, `chats.unpin`,
`chats.markRead`, `chats.markUnread`, `webhooks.parse`.

`instance.pairingCode` **não** foi declarada: embora o provider suporte pareamento por código
(`POST /instance/connect` com `phone`), `InstanceApi.connect()` não recebe telefone como parâmetro
nesta versão do contrato — expor esse fluxo exigiria mudar o contrato central, fora do escopo desta
fase (mesma decisão tomada no adapter WAHA).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `POST /instance/connect` | Sem `phone` no body (só fluxo de QR). Resposta não tem exemplo literal completo na doc — assumida com o mesmo formato do envelope de `GET /instance/status` (`{ instance: Instance, status? }`), já que ambos manipulam o mesmo objeto `Instance`; `ConnectResult.qr` é extraído de `instance.qrcode` (com fallback para um `qrcode` de topo, defensivo). **Assunção a validar contra uma instância real.** |
| `instance.status` | `GET /instance/status` | Verbatim na doc. `InstanceStatus.state` mapeado a partir de `instance.status` (tabela abaixo); quando `status === 'connecting'` e `instance.qrcode` está presente e não-vazio, o adapter refina para `'qr'` (o provider não expõe um valor de status dedicado para "aguardando scan", só o campo `qrcode` populado durante `connecting`). |
| `instance.logout` | `POST /instance/disconnect` | Soft-disconnect: mantém a instância, exige novo QR/pairing code para reconectar. `DELETE /instance` (hard-delete, apaga a instância) **não** é usado aqui — semântica diferente e fora do escopo de "logout". |
| `messages.sendText` | `POST /send/text` | Body `{ number, text, replyid?, mentions? }`. `number` é o chatId canônico repassado sem transformação (campo polimórfico: dígitos sem `+` OU JID completo — já é o formato canônico do waconector). `replyid` recebe `SendTextInput.quotedId`. `mentions` é uma STRING (não array) com números separados por vírgula ou o valor especial `"all"`; `SendTextInput.mentions: string[]` é convertido: cada entrada `"all"` passa intacta, entradas JID têm o sufixo removido e ficam só dígitos, entradas já em dígitos passam direto. Campos opcionais não expostos por `SendTextInput` (`linkPreview`, `readchat`, `readmessages`, `delay`, `forward`, `async`, `track_source`, `track_id`) não são enviados — o adapter não usa `async:true` (ver quirks: uma resposta 200 com `async` só indica enfileiramento, não sucesso de entrega). |
| `messages.sendMedia` | `POST /send/media` | Body `{ number, type, file, text?, docName?, mimetype? }`. `type` é derivado de `MediaKind` (mapeamento 1:1: `image→image`, `video→video`, `audio→audio`, `document→document`, `sticker→sticker`; o provider também aceita `videoplay`, `myaudio`, `ptt`, `ptv` para variantes que `MediaKind` não distingue — não expostos por este adapter). `file` recebe `media.url` (preferencial) ou `media.base64` (o provider aceita ambos nesse mesmo campo). `docName` só é enviado quando `kind === 'document'` e `media.filename` está presente. `viewOnce` (recurso real da doc) não é exposto — `SendMediaInput` não tem esse campo. |
| `messages.sendReaction` | `POST /message/react` | Body `{ number, text, id }`, os 3 campos obrigatórios pela doc: `number` recebe o chatId canônico (mesma função `toUazapiNumber`, identidade); `text` recebe `SendReactionInput.emoji` — é o emoji Unicode da reação, ou string vazia `""` para remover uma reação já enviada (comportamento documentado explicitamente, com exemplo de request/response dedicado); `id` recebe `SendReactionInput.messageId`. Confiança alta na doc (OpenAPI bundled, seção `/message/react` inspecionada diretamente). **Limitações documentadas pelo próprio endpoint** (não impostas pelo adapter): só é possível reagir a mensagens enviadas por outros usuários (não às enviadas pela própria instância); não é possível reagir a mensagens com mais de 7 dias; um mesmo usuário só pode ter uma reação ativa por mensagem por vez. Resposta 200 documentada segue o schema genérico dos demais endpoints de `/message/*` (`id`, `messageid`, `messageTimestamp`, `messageType: "reaction"`, ...) — sem campo `chatid`, por isso `mapSentMessage` cai no fallback do `number` requisitado também aqui. Existe um endpoint irmão `POST /newsletter/reaction` (canais/newsletters, shape diferente) — **não usado por este adapter**, que só cobre chats/grupos comuns. Sem `idempotent: true` (mesma regra de `sendText`/`sendMedia`, ver ADR-0007). |

### Formato de resposta de envio (assunção)

A doc não mostra um exemplo JSON literal completo do corpo de resposta de `POST /send/text` /
`POST /send/media`. O adapter assume que a resposta é (ou contém, no nível raiz) um objeto com o
mesmo shape do schema `Message` documentado (`id`, `messageid`, `chatid`, `messageTimestamp`,
`status`, ...) — mapeado para `SentMessage` como: `id` de `messageid` (fallback `id`, fallback
`uazapi-<timestamp>`), `chatId` de `chatid` (fallback: o `number` enviado na requisição),
`timestamp` de `messageTimestamp` (já em epoch-ms, conforme os demais exemplos do dossiê). **A
confirmar contra uma instância real.**

### Mapeamento de status → `InstanceState`

| uazapi `status` | `InstanceState` |
| --- | --- |
| `disconnected` | `disconnected` |
| `connecting` (sem `qrcode` presente) | `connecting` |
| `connecting` (com `qrcode` presente e não-vazio) | `qr` |
| `connected` | `connected` |
| `hibernated` | `disconnected` (escolha do adapter — decisão explícita, não fallback: uma instância hibernada não tem sessão WhatsApp ativa, mas o dossiê não documenta um endpoint dedicado para causar/reverter esse estado nem se ele se comporta como uma desconexão comum; tratar diferente exigiria um estado dedicado que `InstanceState` não tem. **A confirmar contra uma instância real.**) |
| qualquer outro valor não reconhecido | `unknown` (fallback seguro, nunca lança) |

### Mapeamento de `chatId` canônico → uazapi

O conector já normaliza o `to` recebido do usuário (`normalizeChatId`) antes de chamar o adapter:
telefone vira só-dígitos (E.164 sem `+`), JIDs explícitos passam intactos. O campo `number` do
uazapi é documentado como polimórfico — aceita exatamente os mesmos dois formatos (dígitos
internacionais sem `+` para chat 1:1, OU um JID completo: grupo `@g.us`, usuário
`@s.whatsapp.net`/`@lid`, canal/newsletter `@newsletter`) — então o adapter repassa o chatId
canônico sem nenhuma transformação (função `toUazapiNumber`, identidade — existe só como ponto único
de mudança, mesmo padrão do adapter Evolution GO).

`mentions`, ao contrário de `number`, precisa ser uma string de dígitos separados por vírgula (não
aceita JID) — o adapter extrai os dígitos de qualquer entrada em formato JID antes de juntar.

## Edição e exclusão de mensagem

Capabilities `messages.edit`/`messages.delete` (ADR-0012). Fonte: pesquisa dedicada de 2026-07-12
sobre o mesmo OpenAPI bundled já citado no topo deste dossiê (`info.version` **2.1.1**, idêntica à
já registrada — sem deriva de spec desde a última auditoria), com confiança **Alta** para os dois
endpoints (schema request/response completo e literal no OpenAPI, com exemplos de erro por status).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `messages.edit` | `POST /message/edit` | Body `{ id, text }`, ambos obrigatórios — **sem** `number`/`to`: o `id` já identifica a mensagem (e implicitamente seu chat/dono) sozinho, então `EditMessageInput.to` **não é enviado no request**, só usado como fallback de `chatId` no mapeamento da resposta (mesmo padrão de `mapSentMessage`/`chatId ?? requestedNumber` já usado por `sendText`/`sendReaction`). Resposta 200 documentada no schema `Message` completo (`id` no formato `owner:messageid`, `messageid`, `content`, `messageTimestamp`, `messageType: "text"`, `status: "Pending"`, `owner`) — reaproveita `mapSentMessage`, sem campo `chatid` explícito. **Limitações documentadas pelo próprio endpoint** (não impostas pelo adapter): só é possível editar mensagens enviadas pela própria instância; "a mensagem deve estar dentro do prazo permitido pelo WhatsApp para edição" — a doc não especifica o valor exato desse prazo (o WhatsApp real aplica ~15min no app oficial, mas isso está fora do spec da uazapi, não validado localmente). Gera um **novo ID** para a mensagem editada, refletido no `id` devolvido (pode diferir de `input.messageId`). |
| `messages.delete` | `POST /message/delete` | Body `{ id }`, único campo obrigatório — igual a `edit`, sem `number`/`to` no request (`DeleteMessageInput.to` existe só por simetria com o restante de `messages.*`, não é enviado). A doc descreve o endpoint como "apaga uma mensagem **para todos** os participantes da conversa" — é sempre revogação ("delete for everyone"); não expõe parâmetro de "apagar só para mim" (compatível com a decisão do ADR-0012 de não ter campo de escopo em `DeleteMessageInput`). Funciona em mensagens "enviadas pelo usuário ou recebidas" segundo a doc (aparentemente sem a limitação usual do WhatsApp de só poder revogar as próprias mensagens — não confirmado empiricamente). Resposta 200 (`{ timestamp, id }`) é ignorada: o contrato exige apenas `Promise<void>`. Sem janela de tempo documentada para o limite de exclusão. |

`input.messageId` é repassado como `id` sem nenhuma transformação em ambos os endpoints — a doc
menciona que o campo aceita tanto o formato completo (`owner:messageid`) quanto só o `messageid`
curto (usado nesse caso "concatenado com o owner para busca"), então qualquer um dos dois formatos
que o consumidor tenha guardado de um `SentMessage.id` anterior funciona sem conversão adicional.

**Nenhuma das 2 operações foi exercitada contra uma instância uazapi real** — mesma ressalva já
registrada para as demais seções deste dossiê.

## Grupos (núcleo)

Capabilities implementadas nesta fase: `groups.create`, `groups.getInfo`, `groups.list`,
`groups.addParticipants`, `groups.removeParticipants`, `groups.promoteParticipants`,
`groups.demoteParticipants`, `groups.updateSubject`, `groups.updateDescription`,
`groups.updatePicture`, `groups.getInviteLink`, `groups.revokeInviteLink`,
`groups.joinViaInviteLink`, `groups.leaveGroup` (ver ADR-0009). As 4 operações de participante
colapsam num único endpoint do provider — ver tabela abaixo. As 4 operações de convite/saída têm
seção dedicada logo abaixo (`### Convite e saída de grupo`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.create` | `POST /group/create` | Body `{ name, participants }`. **Desvio importante**: `participants` aqui aceita SOMENTE dígitos de telefone crus — ao contrário de `updateParticipants` (linha abaixo), NÃO aceita JID. Como o conector já normaliza `CreateGroupInput.participants` como um `to` de mensagem comum (telefone vira dígitos, JID passa intacto), o adapter precisa extrair os dígitos de qualquer entrada em formato JID antes de enviar (`toCreateGroupParticipant`). Resposta 200 documentada como o schema `Group` completo (mesmo shape de `getGroupInfo`), mas **sem exemplo JSON literal na doc** — por isso `mapGroupInfo` recebe fallback com os valores de entrada (`subject`, `participants`) quando a resposta não traz `Name`/`JID`/`Participants`, mesmo padrão de `mapSentMessage` (`chatId ?? requestedNumber`). |
| `groups.getInfo` | `POST /group/info` | Body `{ groupjid }`. Resposta = schema `Group` verbatim na doc: `{ JID, Name, Topic (descrição), OwnerJID`/`OwnerPN (dono), GroupCreated, Participants: [{ JID, IsAdmin, IsSuperAdmin }] }`. |
| `groups.list` | `GET /group/list` | Sem body; query params `force`/`noparticipants` são opcionais e omitidos por este adapter (`GroupsApi.list()` não recebe parâmetros). Resposta: `{ groups: Group[] }` — mesmo shape de `getGroupInfo`, um item por grupo. |
| `groups.addParticipants` / `groups.removeParticipants` / `groups.promoteParticipants` / `groups.demoteParticipants` | `POST /group/updateParticipants` | **As 4 operações são o MESMO endpoint**, discriminado pelo campo `action: "add"\|"remove"\|"promote"\|"demote"`. Body `{ groupjid, action, participants }`. Diferente de `/group/create`, aqui `participants` aceita telefone OU JID — reaproveita `toUazapiNumber` (identidade), a mesma função usada para o `to` de mensagens. Resposta (`{ groupUpdated: [{JID, Error}], group, needs_refresh }`) é ignorada: o contrato exige apenas `Promise<void>`. |
| `groups.updateSubject` | `POST /group/updateName` | Body `{ groupjid, name }` — `name` recebe `UpdateGroupSubjectInput.subject` sem transformação. Limite documentado pelo próprio WhatsApp (1-25 caracteres), **não validado por este adapter** (nem pelo conector — ver `prepareUpdateGroupSubject` em `src/core/connector.ts`, que só exige não-vazio). Resposta (`{ response: "Group name updated successfully", group, needs_refresh }`) é ignorada: `Promise<void>`. |
| `groups.updateDescription` | `POST /group/updateDescription` | Body `{ groupjid, description }` — `description` vazia é permitida e limpa a descrição do grupo (caso válido, não erro; o conector só rejeita valores que não sejam string). Limite documentado de 512 caracteres, **não validado por este adapter**. Resposta (`{ response: "Group description updated successfully", group, needs_refresh }`) ignorada: `Promise<void>`. |
| `groups.updatePicture` | `POST /group/updateImage` | Body `{ groupjid, image }`. `image` aceita URL, uma data-URI base64, ou os literais `"remove"`/`"delete"` para apagar a foto (não usados por esta capability, que só cobre "definir"). Construído a partir de `MediaRef` via `toUazapiGroupImage`: `media.url` tem prioridade quando presente; sem `url`, monta `data:<mimeType>;base64,<base64>` com `mimeType` default `image/jpeg` quando `MediaRef.mimeType` está ausente. Requisito do próprio WhatsApp (não imposto pelo adapter): formato JPEG, resolução máxima 640x640. Resposta (`{ response, group, needs_refresh }`) ignorada: `Promise<void>`. |

### `groupId` opaco e mapeamento de participantes

`GroupParticipantsInput.groupId` é um identificador OPACO (ver ADR-0009): o conector **não** passa
`groupId` por `normalizeChatId` (diferente do `to` de mensagem). Para uazapi especificamente, isso
não é um problema prático: `GroupInfo.id` (populado a partir de `Group.JID` em `getGroupInfo`/
`createGroup`/`listGroups`) já é o JID de grupo nativo do provider, formato `<dígitos>@g.us` — o
mesmo formato que o campo `groupjid` espera de volta. A função `toUazapiGroupJid` existe como ponto
único de mudança (mesmo padrão de `toUazapiNumber`), mas hoje é identidade pura. **Diferente da
Z-API** (que usa um ID sintético sem `@`, onde reaproveitar um helper de chatId de mensagem
corromperia o valor), a uazapi não tem essa armadilha — ainda assim o adapter usa uma função
dedicada (não `toUazapiNumber` diretamente) porque `groupId` semanticamente não é um "chatId de
mensagem" e não deve compartilhar acidentalmente lógica futura que só faça sentido para `to`.

Participantes individuais (dentro de `participants: string[]`), ao contrário do `groupId`, chegam
já normalizados pelo conector (telefone vira só-dígitos, JID passa intacto) — mesma convenção de um
`to` de mensagem comum:

- Em `groups.create` → `POST /group/create`: convertidos para dígitos crus via
  `toCreateGroupParticipant` (extrai os dígitos de qualquer JID; endpoint não aceita JID).
- Em `addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` →
  `POST /group/updateParticipants`: repassados via `toUazapiNumber` (identidade; endpoint aceita
  telefone OU JID).

### Mapeamento do schema `Group` → `GroupInfo`

| Campo uazapi (`Group`) | Campo `GroupInfo`/`GroupParticipant` |
| --- | --- |
| `JID` | `id` (fallback: valor de entrada quando ausente — só relevante em `create`) |
| `Name` | `subject` (fallback: valor de entrada quando ausente — só relevante em `create`) |
| `Topic` | `description` |
| `OwnerJID` (fallback `OwnerPN`) | `owner` |
| `Participants[].JID` | `GroupParticipant.id` |
| `Participants[].IsAdmin` | `GroupParticipant.isAdmin` |
| `Participants[].IsSuperAdmin` | `GroupParticipant.isSuperAdmin` |

Quando o provider não devolve `Participants` (cenário defensivo, sem exemplo JSON literal
confirmado para `POST /group/create`), o adapter cai de volta para os IDs de entrada de
`CreateGroupInput.participants`, com `isAdmin`/`isSuperAdmin: false` como suposição neutra (não há
como inferir status de admin de uma lista de participantes recém-convidados sem a resposta do
provider). **A confirmar contra uma instância real** — mesmo aviso de confiança já registrado para
`mapSentMessage` no restante deste dossiê.

### `updateSubject`/`updateDescription`/`updatePicture` — assunções não validadas

As três rotas (`/group/updateName`, `/group/updateDescription`, `/group/updateImage`) foram
pesquisadas na documentação/OpenAPI, mas **nenhuma foi exercitada contra uma instância uazapi
real** neste dossiê — mesma ressalva já registrada para `groups.create`/`sendText`/`sendMedia`
neste documento. Pontos específicos a validar:

- O nome exato do campo de resposta (`response`) e se `group`/`needs_refresh` realmente vêm
  populados nos três casos — o adapter ignora a resposta por completo (`Promise<void>`), então um
  formato de resposta diferente do documentado não quebraria nada em runtime, mas também não foi
  confirmado.
- Se `POST /group/updateImage` de fato aceita uma data-URI (`data:image/jpeg;base64,...`) no campo
  `image`, ou se espera só o base64 cru sem prefixo — a doc não mostra um exemplo de request
  literal para o caso de definir uma nova foto (só o comportamento de `"remove"`/`"delete"` está
  documentado com clareza). **Assunção do adapter**: data-URI com prefixo, por analogia com o
  padrão de outros providers que aceitam esse formato. Se a instância real rejeitar, o fallback é
  enviar `media.base64` cru (sem prefixo) — mudança pontual em `toUazapiGroupImage`.
- Se `POST /group/updateName` de fato trunca/rejeita nomes fora do intervalo 1-25 caracteres, e
  qual `code`/mensagem de erro devolve nesse caso (o adapter não valida o tamanho, delega ao
  provider — um 4xx do provider vira `PROVIDER_ERROR` via `HttpClient`, não `INVALID_INPUT`).

### Convite e saída de grupo

Capabilities: `groups.getInviteLink`, `groups.revokeInviteLink`, `groups.joinViaInviteLink`,
`groups.leaveGroup` (ver ADR-0009 e os tipos `GroupInviteLink`/`JoinGroupInviteInput` em
`src/core/types.ts`).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `groups.getInviteLink` | `POST /group/info` com `{ groupjid, getInviteLink: true }` | **Não existe rota dedicada** para obter o link de convite — é o mesmo endpoint de `groups.getInfo`, mas com o flag `getInviteLink: true` no body, que faz o schema `Group` da resposta vir com o campo adicional `invite_link` (snake_case, já em formato de link COMPLETO segundo a doc). O adapter reaproveita a chamada HTTP através de uma função interna comum (`requestGroupInfo`), evitando duplicar a montagem do body entre `getGroupInfo`/`getGroupInviteLink`. `normalizeInviteLink` (core) é aplicada ao valor de `invite_link` mesmo assim, como defesa caso o provider devolva só o código bare (idempotente quando já é link completo) — **não confirmado contra uma instância real** que `invite_link` sempre vem populado como link completo. |
| `groups.revokeInviteLink` | `POST /group/resetInviteCode` | Body `{ groupjid }`. Resposta: `{ InviteLink, group, needs_refresh }` — **atenção ao casing**: o campo é `InviteLink` (PascalCase), diferente de `invite_link` (snake_case) devolvido por `POST /group/info`. Já é o NOVO link completo (o código anterior é invalidado pelo provider). `normalizeInviteLink` também é aplicada aqui por defesa. |
| `groups.joinViaInviteLink` | `POST /group/join` | Body `{ invitecode }` (documentado como string de 10-50 caracteres). O provider aceita tanto o código curto quanto a URL completa nesse mesmo campo — como o conector já normaliza `JoinGroupInviteInput.invite` para o link completo antes de chamar o adapter (ver `WaConnector.prepareJoinViaInviteLink` em `src/core/connector.ts`), o adapter repassa `input.invite` direto em `invitecode`, **sem** usar `extractInviteCode`. Resposta (`{ response: "Group join successful", group, needs_refresh }`) é ignorada: o contrato exige apenas `Promise<void>`. |
| `groups.leaveGroup` | `POST /group/leave` | Body `{ groupjid }` (padrão documentado `^\d+@g\.us$`, mesmo formato de `GroupInfo.id`). Resposta (`{ response: "Group leave successful" }`) ignorada: `Promise<void>`. |

**Nenhuma das 4 operações foi exercitada contra uma instância uazapi real** — mesma ressalva já
registrada para as demais rotas de `groups.*` neste dossiê. Pontos específicos ainda não validados:

- Se `invite_link` de fato vem sempre presente e já como link completo em toda resposta de
  `POST /group/info` com `getInviteLink: true`, inclusive para grupos recém-criados sem link
  gerado ainda (nesse caso o adapter cairia no fallback de string vazia, que `normalizeInviteLink`
  transformaria no prefixo `https://chat.whatsapp.com/` sem código — resultado inválido, mas nunca
  lança).
- Se `POST /group/join` de fato aceita a URL completa (`https://chat.whatsapp.com/<código>`) no
  campo `invitecode`, ou só o código bare — a doc documenta a faixa de tamanho (10-50 caracteres)
  compatível com ambos os formatos, mas não mostra um exemplo de request literal usando a URL
  completa. Se a instância real rejeitar a URL completa, o ajuste é trocar `input.invite` por
  `extractInviteCode(input.invite)` (já disponível em `../../core/chat-id`) dentro de
  `joinGroupViaInviteLink`.
- Se `POST /group/leave` de fato exige exatamente o padrão `^\d+@g\.us$` (grupos com JID em outro
  formato, se existirem, poderiam ser rejeitados) — não testado.

## Webhooks

Dois níveis de configuração: por instância (`GET`/`POST /webhook`, header `token`) e global
(`GET`/`POST /globalwebhook`, header `admintoken` — fora do escopo desta fase). Body do `POST`:
`{ url, events: string[], excludeMessages?: string[], enabled?, addUrlEvents?, addUrlTypesMessages? }`.
A doc recomenda explicitamente sempre configurar `excludeMessages: ['wasSentByApi']` para evitar
loops de automação quando a própria integração envia mensagens pela API. **Nenhum header de
assinatura/HMAC é documentado** para verificar autenticidade do payload recebido — diferente do
WAHA, este adapter não implementa (nem pode implementar) verificação de assinatura de webhook.

### ⚠️ Payloads RECONSTRUÍDOS — não são exemplos literais da documentação

A documentação oficial não publica um exemplo JSON completo e literal do corpo `POST` entregue ao
webhook para nenhum dos três eventos abaixo. O que existe é: (a) o schema genérico `WebhookEvent`
(`{ event, instance, data }`, `additionalProperties: true`, com `event` documentado como enum
`['message', 'status', 'presence', 'group', 'connection']` — **note o singular**), e (b) os schemas
`Message`/`Instance` documentados separadamente. As três fixtures em `fixtures/` foram **montadas**
combinando esses dois pedaços — tratar como plausíveis, não como capturas reais, e **validar
empiricamente contra uma instância real antes de travar o parser em produção**.

Há também uma inconsistência real na própria especificação, não resolvida pela pesquisa: a lista de
`events` aceita na *configuração* do webhook usa nomes no plural/diferentes (`messages`,
`messages_update`, `newsletter_messages`, ...), enquanto o enum do envelope `WebhookEvent` usa
singular (`message`, `status`, ...). Não ficou claro se isso é um erro de documentação ou se o
envelope realmente entrega nomes diferentes dos configurados. **Decisão defensiva do adapter**:
`parseWebhook` reconhece **ambas** as grafias para cada categoria de evento:

### ⚠️ Risco alto, não apenas rodapé: o schema `WebhookEvent` não é referenciado por nenhum endpoint

O schema `WebhookEvent` (`{ event, instance, data }`) existe nos `components` do OpenAPI, mas
**nenhum endpoint documentado o referencia via `$ref`** — ou seja, não há exemplo confirmado do
payload realmente entregue ao webhook configurado pelo cliente. Uma pista adicional (não presente
em versões anteriores deste dossiê): o exemplo de resposta de `GET /webhook/errors` (log de
tentativas de entrega) mostra um payload de tentativa real com o shape
`{"EventType": "messages", "token": "instance-token"}` — nomes de campo diferentes (PascalCase
`EventType`, e um `token` no nível raiz) do envelope `{ event, instance, data }` que o parser
espera. Se a entrega real de fato usar `EventType` em vez de `event`, isso derrubaria o
reconhecimento de qualquer webhook até essa mudança. **Mitigação aplicada**: `parseWebhookUnsafe`
aceita `envelope.EventType` como sinônimo defensivo de `envelope.event` (mesma lógica case-tolerante
usada para as grafias plural/singular abaixo). Isso reduz o risco de silêncio total, mas **não
substitui validar ao menos um payload de webhook genuíno (instância de teste/trial) antes de
habilitar este adapter contra tráfego real**.

| Categoria canônica | Nomes de `event` aceitos (case-insensitive) |
| --- | --- |
| `message.received` / `message.sent` | `"message"` (enum do envelope) OU `"messages"` (nome de configuração) |
| `message.ack` | `"status"` (enum do envelope) OU `"messages_update"` (nome de configuração) OU `"message.ack"` |
| `connection.update` | `"connection"` (usado em ambos os enums) OU `"connection.update"` |

Qualquer outro valor de `event` (incluindo `presence`, `group`, `newsletter_messages`, `call`,
`contacts`, `chats`, `labels`, `blocks`, `sender`, etc. — todos fora do escopo desta fase) vira
evento canônico `unknown`, nunca lança.

- **`fixtures/webhook-message-received.json`** — RECONSTRUÍDO (ver aviso acima). `data.messageType`
  **não** tem nenhum exemplo literal confirmado no OpenAPI oficial para texto recebido via webhook
  (o schema `Message` documenta o campo como `type: string` livre, sem enum). `"conversation"` é
  uma suposição herdada de terminologia comum em outros providers baseados em Baileys — os únicos
  valores literais de `messageType` encontrados na especificação (respostas de
  `POST /message/react` e `POST /message/edit`) usam `"text"`. Por isso o adapter aceita **ambos**
  `"conversation"` e `"text"` como sinônimos de `MessageKind: 'text'`; qualquer outro valor
  (presumivelmente tipos de mídia, não enumerados pela doc) vira `MessageKind: 'unknown'` — `data.text`
  ainda é populado quando presente, independente do `kind` resultante. **Nenhum dos dois valores foi
  validado contra uma instância uazapi real** — tratar como suposição, não como fato confirmado, até
  essa validação empírica acontecer. `data` também não documenta um campo de mídia (URL/mimetype) —
  `WaMessage.media` fica sempre `undefined` nesta fase. `data.quoted` (ID da mensagem citada,
  documentado no schema `Message`) é mapeado para `WaMessage.quotedId`, alinhado com o padrão dos
  adapters WAHA/Evolution GO.
- **`fixtures/webhook-ack.json`** — RECONSTRUÍDO. Mapeamento de `data.status` → `MessageAck`:
  `Queued→pending`, `Sent→sent`, `Delivered→delivered`, `Read→read`, `Failed→error`,
  `Canceled→error`; qualquer valor não reconhecido cai em `sent` (fallback neutro — o evento em si
  já implica que a mensagem foi processada, mesmo padrão do adapter WAHA/Evolution GO).
- **`fixtures/webhook-connection-update.json`** — RECONSTRUÍDO, reaproveitando o exemplo real
  (literal) de `GET /instance/status` dentro do envelope `{event, instance, data}`. `data.instance`
  e `data.status` seguem exatamente os shapes documentados desses dois schemas.

### Webhooks de grupo — não implementado nesta fase

`GroupUpdateEvent` (core: `src/core/events.ts`) existe no contrato canônico e já é populado por
outros adapters da fase (providers baseados em whatsmeow, como Evolution GO/Wuzapi, que documentam
o shape real de `data` para mudanças de grupo). **Este adapter (uazapi) deliberadamente não
implementa esse mapeamento** — o dispatch de `parseWebhookUnsafe` não tem nenhum `case` para
`"group"`/`"groups"`, então esses eventos caem no fallback genérico `unknown` já existente
(`Evento uazapi não mapeado nesta fase: "group"` / `"groups"`), com `raw` preservando o payload
original. Isso é comportamento seguro por design (ADR-0002/ADR-0003: `parseWebhook` nunca lança e
nunca inventa dado), não uma lacuna acidental.

Por que não foi implementado:

- A *categoria* de evento de grupo existe em dois lugares da especificação — `"groups"` no array
  de configuração de webhook (`POST /webhook`, campo `events`) e `"group"` no enum documentado do
  envelope `WebhookEvent` (mesma discrepância plural/singular já registrada acima para
  `message`/`messages` e `status`/`messages_update`) — mas, diferente desses outros eventos,
  **nenhum exemplo de payload de `data` para grupo foi encontrado em lugar nenhum da especificação
  OpenAPI**, nem reconstrução plausível a partir de outro schema documentado.
- O único indício indireto encontrado (`GET /webhook/errors`, log de tentativas de entrega — não
  documentação de payload de grupo) sugere que o campo de nome do evento entregue pode ser
  `EventType` (PascalCase) em vez de `event`, e que pode existir um campo `token` no nível raiz do
  envelope; isso já é tratado defensivamente pelo parser genérico (`envelope.EventType` como
  sinônimo de `envelope.event`, ver seção acima), mas **não é uma confirmação do formato de `data`
  especificamente para grupo** — não há base real para inferir `groupId`, `action`
  (`participants.add`/`remove`/`promote`/`demote`/`subject`/`description`) ou o formato de
  `participants` sem inventar um shape.
- Inventar esse shape violaria a regra mais importante do parser (ADR-0002/ADR-0003): "nunca
  lança, e nunca inventa dado". Implementar parsing estruturado aqui sem uma amostra real
  arriscaria emitir `GroupUpdateEvent`s com campos incorretos silenciosamente, em vez de cair no
  fallback seguro `unknown`.

O que falta para implementar com confiança (pré-requisito, não faça sem isso): capturar ao menos
um payload real de `data` entregue por uma instância uazapi de teste para cada mudança de grupo
relevante (entrada/saída de participante, promoção/rebaixamento de admin, troca de nome/descrição)
e confirmar o nome de campo real do evento (`event` vs. `EventType`) nesse contexto específico. Só
então mapear para `GroupUpdateEvent` (`groupId`, `action`, `participants` — reaproveitando
`mapGroupParticipant`/o formato de ID já usado por `groups.getInfo` quando fizer sentido) seguindo
a convenção documentada em `src/core/events.ts`. Ver testes em
`test/contract/uazapi.contract.test.ts` que fixam o comportamento atual (fallback `unknown`) como
contrato explícito, não acidental.

## Contatos

Capabilities implementadas nesta fase: `contacts.list`, `contacts.get`, `contacts.checkExists`,
`contacts.getProfilePicture` (PR1 do ADR-0010 — descoberta + perfil), e `contacts.block`,
`contacts.unblock`, `contacts.listBlocked` (moderação de contato). `contacts.getAbout` **não** foi
declarada — ver seção dedicada abaixo.

`chatId`/`phone` de contato **não são opacos** (diferente do `groupId` de grupos, ver ADR-0009):
é o mesmo chatId canônico já usado por `messages.*`, normalizado pelo conector via
`normalizeChatId` antes de chegar ao adapter. O adapter reaproveita a mesma função de conversão
usada para o `to` de mensagens (`toUazapiNumber`, identidade) — nenhuma função nova foi criada
para contatos.

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `contacts.list` | `GET /contacts` | Lista completa, sem paginação — usada em vez do `POST /contacts/list` paginado, já que `ContactsApi.list()` não recebe parâmetros (sem cursor para repassar). Query `contactScope: 'all'` é enviada explicitamente: o default do provider é `address_book` (só contatos salvos na agenda); `'all'` cobre também contatos "fora da agenda" com quem a instância já trocou mensagem, batendo melhor com a semântica de "conhecidos" que o método `list()` sugere — **decisão explícita do adapter, não o default do provider**. Resposta: array de `{ jid, contact_name, contact_FirstName }`. Mapeamento: `jid` -> `id`; `contact_name` (fallback `contact_FirstName`) -> `name`. Sem `about`/`profilePictureUrl`/`hasWhatsApp`/`isBlocked` — o endpoint não devolve nenhum desses campos, ficam `undefined` (limitação do provider, não bug). |
| `contacts.get` | `POST /chat/details` | Body `{ number, preview: false }` — `number` recebe o chatId canônico via `toUazapiNumber`. Resposta = schema `Chat`: `{ name, phone, wa_chatid, wa_name, wa_contactName, wa_isBlocked, image, imagePreview, ... }`. Mapeamento: `wa_contactName` (fallback `wa_name`, fallback `name`) -> `name`; `wa_isBlocked` -> `isBlocked`; `image` -> `profilePictureUrl` (o endpoint já devolve isso de graça, sem custo de uma segunda chamada); `wa_chatid` (fallback: o chatId requisitado) -> `id`. **Sem `about`**: a uazapi não expõe recado pessoal em nenhum endpoint — ver seção dedicada abaixo. `hasWhatsApp` também fica `undefined` (o schema `Chat` não tem um booleano equivalente; para isso, o consumidor usa `contacts.checkExists`). |
| `contacts.checkExists` | `POST /chat/check` | Body `{ numbers: [phone] }` — array de um único elemento, já que o contrato canônico verifica um telefone por vez. Resposta: array de `{ query, jid, lid, isInWhatsapp, verifiedName?, groupName?, error? }`, um item por número consultado; o adapter usa apenas o primeiro (único, nesta chamada). Mapeamento: `isInWhatsapp` -> `exists` (fallback `false` se a resposta vier vazia — nunca lança); `jid` -> `chatId` (fica `undefined` quando o provider não resolve um JID, ex. número sem WhatsApp). |
| `contacts.getProfilePicture` | `POST /chat/details` | **Mesmo endpoint de `contacts.get`** — reaproveita a função interna `requestChatDetails` (regra de ouro do ADR-0010: nunca compor múltiplas chamadas HTTP atrás de uma única operação canônica; aqui as duas operações canônicas simplesmente mapeiam a mesma única chamada de formas diferentes). Campo `image` (foto completa, pedida via `preview: false` — `imagePreview` traria só a miniatura) -> `ContactProfilePicture.url`. `undefined` quando o contato não tem foto ou a privacidade dele não permite (o provider omite o campo nesse caso). |
| `contacts.block` / `contacts.unblock` | `POST /chat/block` | **Mesmo endpoint para as duas operações**, discriminado pelo campo `block: boolean` (mesmo padrão de "um endpoint, vários verbos canônicos" já usado por `groups.addParticipants`/etc. em `POST /group/updateParticipants`). Body `{ number, block }` — `number` recebe o chatId canônico via `toUazapiNumber` (identidade), a mesma função usada pelo restante de `contacts.*`. Resposta (`{ response, blockList }` — a lista atualizada de bloqueados) é ignorada: o contrato exige apenas `Promise<void>`. |
| `contacts.listBlocked` | `GET /chat/blocklist` | Sem body/params. Resposta: `{ blockList: string[] }` — array de JIDs dos contatos bloqueados, já no mesmo formato canônico de chatId usado em `Contact.id`; repassado sem transformação. Entradas que não sejam string (resposta malformada) são descartadas defensivamente, nunca lança. |

### `contacts.getAbout` — não suportado pela uazapi

**Deliberadamente não implementado nem declarado em `capabilities`.** Uma busca exaustiva nas
~132 rotas do OpenAPI bundled (`https://docs.uazapi.com/openapi-bundled.json`), não apenas uma
tentativa rápida por falta de tempo, não encontrou nenhum campo ou endpoint que exponha o recado
pessoal ("about"/"status message") de um contato — nem no schema `Chat` (`POST /chat/details`),
nem em `GET /contacts`, nem em nenhuma outra rota de perfil/contato do OpenAPI. O único achado
adjacente foi `/business/get/profile` (perfil de conta *Business*, feature diferente — descrição
comercial de uma conta WhatsApp Business, não o recado pessoal de um contato qualquer). Diferente
de `getProfilePicture` (que reaproveita `/chat/details`), não há aqui nenhum endpoint "mais
próximo" cujo campo ausente justificasse deixar `about` apenas `undefined` — é a ausência do
próprio recurso na API, por isso a capability inteira fica de fora. Ver ADR-0010 para o
levantamento comparativo entre os 5 adapters (uazapi é o único, dos 5, sem essa operação).

### Campos que ficam sempre `undefined` (limitação do provider, não bug)

- `Contact.about`: nenhum endpoint da uazapi expõe esse campo (ver seção acima) — sempre
  `undefined` em `contacts.list`/`contacts.get`.
- `Contact.hasWhatsApp`: nem `GET /contacts` nem `POST /chat/details` devolvem um booleano
  equivalente — para essa informação, use `contacts.checkExists`, que é a única operação com
  esse dado (`isInWhatsapp`).
- `Contact.isBlocked`/`Contact.profilePictureUrl`: presentes em `contacts.get` (via
  `wa_isBlocked`/`image` de `/chat/details`), mas **ausentes** em `contacts.list` (`GET /contacts`
  não devolve nenhum dos dois) — reflexo direto de cada operação mapear para um único endpoint
  diferente (ADR-0010), não uma inconsistência do adapter.

**Nenhuma das 4 operações foi exercitada contra uma instância uazapi real** — mesma ressalva já
registrada para as demais seções deste dossiê (`instance.*`, `groups.*`). Os shapes de resposta
acima seguem os schemas documentados no OpenAPI bundled, mas sem confirmação empírica contra
tráfego real.

## Ações sobre mensagem (`messages.pin`/`unpin`/`markRead`, ADR-0013)

Continuação da pesquisa de `messages.edit`/`delete` (seção "Edição e exclusão de mensagem" acima).
**Sem `messages.forward`/`star`** — busca exaustiva por padrão de nome de rota (`star`, `forward`,
`translate`, `poll`, `vote`) nas 132 rotas do spec não encontrou nenhuma correspondência: não há
rota `*star*`; o "forward" existente é só um campo `forward: boolean` COSMÉTICO nos endpoints de
envio (`/send/location`, `/send/contact`, etc.) que apenas marca a mensagem NOVA como
"Encaminhada" no WhatsApp — não reencaminha o conteúdo de uma mensagem já existente por ID. Busca
negativa confirmada, não gap de pesquisa.

| Capability | Endpoint | Confiança | Observações |
| --- | --- | --- | --- |
| `messages.pin` / `messages.unpin` | `POST /message/pin` | Alta | Body `{id, pin?: boolean (default true), duration?: integer (default 30)}`. **Nuance documentada explicitamente**: `duration` só aceita `1`, `7` ou `30` (dias) — qualquer outro valor cai silenciosamente para 30 (exemplo dedicado no spec, `duration: 99` → 30). `PinMessageInput` não expõe duração (ADR-0013); este adapter omite o campo, usando o default do próprio provider (30 dias). Em grupos, a permissão depende da config do WhatsApp do grupo — "o backend não valida localmente se a instância é admin; a decisão final é do WhatsApp". Newsletters/canais não são suportados por este endpoint. Resposta rica (`messageType: "PinInChatMessage"`, `pinned: boolean`) — ignorada, `Promise<void>`. |
| `messages.markRead` | `POST /message/markread` | Alta | Body `{id: string[]}` — lista de IDs, marca várias mensagens de uma vez; este adapter sempre envia um array com 1 elemento. Resposta `{results: [{message_id, status, error?}]}` (por item, não all-or-nothing) — ignorada, `Promise<void>`. Distinto de `chats.markRead` (`/chat/read`, nível de conversa, ver seção "Chats" abaixo). |

## Conteúdo estruturado (`messages.sendLocation`/`sendContactCard`/`sendPoll`, ADR-0014)

Cobertura 3/3, confiança Alta para as 3.

| Capability | Endpoint | Observações |
| --- | --- | --- |
| `messages.sendLocation` | `POST /send/location` | Request mínimo `{number, latitude, longitude}` (obrigatórios); `name`/`address` opcionais para pin nomeado. Herda os campos comuns de envio (`replyid`/`mentions`/`delay`/`forward`/`track_source`/`track_id`/`async`) que `sendText`/`sendMedia` já ignoram deliberadamente hoje — mesmo critério aplicado aqui. |
| `messages.sendContactCard` | `POST /send/contact` | Request mínimo `{number, fullName, phoneNumber}` (obrigatórios) — campos soltos, o provider monta um vCard completo clicável no servidor (diferente de outros providers pesquisados que exigem um vCard já montado pelo chamador). `phoneNumber` aceita múltiplos números separados por vírgula na doc, mas `SendContactCardInput` só modela um telefone; `organization`/`email`/`url` (opcionais) não têm de onde vir no contrato canônico e são omitidos. |
| `messages.sendPoll` | `POST /send/menu` (`type: "poll"`) | Interface UNIFICADA para botões/lista/enquete/carrossel, discriminada pelo campo `type`. Para enquete: `{number, type: "poll", text, choices: string[], selectableCount?}` — `question`/`options` mapeiam para `text`/`choices`; `selectableCount` só se aplica a enquetes (permite múltipla escolha) — este adapter envia `1` (escolha única) quando `allowMultipleAnswers` é falso/ausente, `options.length` quando verdadeiro. `choices` usa convenção textual compacta só para os tipos `list`/`carousel` (`"[Título]"` demarca seção, `"Título|id|descrição"` demarca opção) — para `type: "poll"` os itens de `choices` são strings simples (os próprios textos das opções), sem essa sintaxe. |

## Chats (gestão de estado da conversa)

Namespace `chats.*` introduzido pelo ADR-0012 — distinto de `contacts.*` (sobre a pessoa/JID) e de
`messages.*` (sobre uma mensagem específica): estas 8 operações atuam sobre o **estado da
conversa** como um todo (arquivar, silenciar, fixar, marcar como lida). Fonte: mesma pesquisa
dedicada de 2026-07-12 citada na seção "Edição e exclusão de mensagem" acima, confiança **Alta**
para as 4 rotas (8 capabilities, 2 verbos por rota).

`chatId` de `chats.*` **não é opaco** (mesmo tratamento de `contacts.*`, ver ADR-0010/ADR-0012,
diferente do `groupId` opaco de `groups.*`) — é o mesmo chatId canônico já usado por
`messages.*`/`contacts.*`, repassado sem transformação via `toUazapiNumber` (identidade).

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `chats.archive` / `chats.unarchive` | `POST /chat/archive` | **Mesmo endpoint para as duas operações**, discriminado pelo campo `archive: boolean` (mesmo padrão de "um endpoint, vários verbos canônicos" já usado por `contacts.block`/`unblock`). Body `{ number, archive }`. Resposta (`{ response: "Chat updated successfully" }`) ignorada: o contrato exige `Promise<void>`. Nuance documentada: "não afeta as mensagens ou o conteúdo do chat" — puramente cosmético/organizacional. |
| `chats.mute` / `chats.unmute` | `POST /chat/mute` | Body `{ number, muteEndTime }` — `muteEndTime` é um **enum fechado de 4 valores** (`0 \| 8 \| 168 \| -1`), não um timestamp Unix arbitrário: `0` remove o silenciamento, `8`/`168` são horas (8h/1 semana), `-1` é permanente. **Mapeamento de decisão do adapter, não um default do provider**: como `ChatsApi.mute`/`unmute` do contrato canônico não recebem duração (ADR-0012 — nenhum formato de duração converge entre os providers pesquisados), `mute(chatId)` sempre envia `muteEndTime: -1` (permanente) e `unmute(chatId)` sempre envia `muteEndTime: 0` (remove). Consumidores que precisem de granularidade por horas/semana não têm essa opção via contrato canônico nesta fase. |
| `chats.pin` / `chats.unpin` | `POST /chat/pin` | Body `{ number, pin: boolean }`. Resposta (`{ response: "Chat pinned" }`) ignorada. Nuance: distinto de fixar uma MENSAGEM dentro do chat (`messages.pin`, fora de escopo desta fase — ver ADR-0012) — este fixa a CONVERSA inteira no topo da lista. O OpenAPI da uazapi não documenta nenhum limite de conversas fixadas simultâneas (o limite de 3 do app oficial do WhatsApp é conhecimento externo, não confirmado nesta API — não assumir que a uazapi replica essa trava). |
| `chats.markRead` / `chats.markUnread` | `POST /chat/read` | Body `{ number, read: boolean }` — `read: false` marca como **não lido** (reintroduz o indicador visual de pendência, não é um simples "desfazer lido"). Distinto de um eventual `messages.markRead` por id de mensagem (não implementado nesta fase, fora de escopo do ADR-0012) — este marca o chat INTEIRO de uma vez, sem precisar dos IDs das mensagens. |

**Nenhuma das 8 operações foi exercitada contra uma instância uazapi real** — mesma ressalva já
registrada para as demais seções deste dossiê. Os shapes de resposta acima seguem os schemas
documentados no OpenAPI bundled (`info.version` 2.1.1, mesma versão já auditada), sem confirmação
empírica contra tráfego real.

## Limites e particularidades

- WhatsApp Business é recomendado explicitamente sobre conta pessoal; contas pessoais podem sofrer
  "inconsistências, desconexões, limitações e instabilidades" segundo a doc.
- Servidores gratuitos/demo têm TTL de instância: exemplo documentado de "automaticamente
  desconectada e deletada após 1 hora".
- Limite máximo de instâncias conectadas por servidor não tem valor numérico publicado; ao atingir
  o limite, criar/conectar responde `429`.
- Sem rate limit numérico publicado para envio de mensagens — só a resposta genérica `429 Rate
  limit exceeded` quando algum limite interno é atingido. `HttpClient` deste pacote não retenta
  automaticamente `POST`/`PUT`/`PATCH`/`DELETE` (ver ADR-0007) — inclui `sendText`/`sendMedia`.
- Timeout do fluxo de conexão: QR expira em 2 minutos, pairing code em 5 minutos.
- Rotação de `admintoken` (`POST /admin/token/rotate`) é limitada a 1x/24h.
- Proxy interno usa IPs brasileiros por padrão; proxy gerenciado regional só documenta suporte a
  `country=br` — fora do escopo desta fase (`instance.connect()` do adapter não expõe os campos de
  proxy do dossiê).
- Sem assinatura/HMAC documentada para webhooks — diferente do adapter WAHA, este adapter **não**
  verifica autenticidade de payload recebido (não há mecanismo do provider para isso).
- Campo `async: true` em `/send/text`/`/send/media` enfileira o envio sem bloquear a resposta HTTP
  — uma resposta `200` só indica enfileiramento, não sucesso de entrega (falhas exigem consultar
  `GET/POST /message/find?status=failed`, fora do escopo desta fase). O adapter nunca envia
  `async:true`.
- Suporta placeholders estilo Mustache (<code v-pre>{{name}}</code>, <code v-pre>{{wa_name}}</code>,
  <code v-pre>{{lead_*}}</code>) em texto/legenda —
  recurso de CRM embutido do provider, tratado como texto opaco por este adapter (nenhuma
  substituição client-side).
- Usa tanto JIDs tradicionais (`@s.whatsapp.net`) quanto o novo "LID" (Linked ID) de privacidade do
  WhatsApp (`@lid`) — o schema `Message` documentado expõe `sender_pn`/`sender_lid` separadamente,
  não capturado por este adapter nesta fase (`WaMessage.from` usa apenas `data.sender`).
- Não foi possível confirmar de forma independente (site institucional é uma SPA não renderizável
  via fetch simples) se existe alguma oferta de self-hosting/on-premise além do modelo SaaS por
  subdomínio — presume-se SaaS-only.
