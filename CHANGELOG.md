# waconector

## 1.1.0

### Minor Changes

- bacbae1: Namespace novo `business.*` (`getProfile`/`updateProfile`) — ver ADR-0018. `WaAdapter.business?`
  inteiramente opcional, mesmo padrão de `chats?`/`presence?`/`labels?`/`channels?`
  (ADR-0012/0015/0016/0017). Cobre o perfil comercial WhatsApp Business (endereço, e-mail, sites,
  categorias) — leitura e atualização parcial (`description`/`address`/`email`), sem catálogo/
  produtos nesta rodada.

  Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.

- d4f8f1d: Namespace novo `calls.*` (`make`/`reject`) — ver ADR-0019. `WaAdapter.calls?` inteiramente
  opcional, mesmo padrão de `chats?`/`presence?`/`labels?`/`channels?`/`business?`
  (ADR-0012/0015/0016/0017/0018). Cobre chamadas de voz: `make` origina uma "chamada vazia" (só toca,
  sem áudio real — uazapi, Z-API); `reject` rejeita uma chamada recebida (WAHA, Whapi, Wuzapi,
  Evolution GO, uazapi, WPPConnect). Este é o último item da fila de capabilities novas planejada
  (ADR-0013 a ADR-0019).

  Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.

- b7c7ad1: Namespace novo `channels.*` (`list`/`create`/`getInfo`/`delete`/`follow`/`unfollow`) — ver
  ADR-0017. `WaAdapter.channels?` inteiramente opcional, mesmo padrão de `chats?`/`presence?`/
  `labels?` (ADR-0012/0015/0016). Cobre canais do WhatsApp ("WhatsApp Channels" — nome público do
  produto; a maioria dos providers chama de "newsletter" internamente): listar, criar, consultar,
  apagar e seguir/deixar de seguir um canal. `channelId` é um valor opaco (mesmo critério de
  `groupId`/`labelId`).

  Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.

- af3bed2: Namespace novo `labels.*` (`list`/`create`/`update`/`delete`/`addToChat`/`removeFromChat`) — ver
  ADR-0016. `WaAdapter.labels?` inteiramente opcional, mesmo padrão de `chats?`/`presence?`
  (ADR-0012/0015). Cobre etiquetas estilo WhatsApp Business: CRUD de labels e associação/desassociação
  a uma conversa. `color` é um valor opaco (cada provider usa um vocabulário de cor diferente).

  Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.

- 24f49a9: Namespace novo `presence.*` (`setTyping`/`set`/`subscribe`) — ver ADR-0015. `WaAdapter.presence?`
  inteiramente opcional, mesmo padrão de `chats?` (ADR-0012). Cobre indicador de digitação/gravação
  por conversa, presença global da conta (online/offline) e inscrição para receber atualizações de
  presença de um contato via webhook.

  Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.

- 512330e: Novo namespace `chats.*` (`archive`/`unarchive`, `mute`/`unmute`, `pin`/`unpin`, `markRead`/
  `markUnread`) e capabilities `messages.edit`/`messages.delete` — ver ADR-0012 para o desenho
  completo e a justificativa de `chats` ser um campo OPCIONAL em `WaAdapter` (diferente do
  precedente de `groups`/`contacts`, que são campos obrigatórios).

  Mudança 100% aditiva: `WaAdapter.chats?` é opcional, `MessagesApi.edit?`/`delete?` são opcionais,
  e as 10 novas entradas em `CAPABILITIES` são apenas adições à union — nenhum adapter existente
  (próprio ou de terceiros) precisa mudar para continuar compilando.

- e1dd5db: Capabilities novas `messages.forward`, `messages.star`/`unstar`, `messages.pin`/`unpin` e
  `messages.markRead` — ver ADR-0013. Métodos opcionais em `MessagesApi`, mesmo padrão de
  `messages.edit`/`delete` (ADR-0012). `messages.pin`/`unpin`/`markRead` operam no nível de UMA
  mensagem, distintos de `chats.pin`/`unpin`/`markRead` (nível de conversa, já existentes).

  Mudança 100% aditiva: todos os métodos são opcionais, nenhum adapter existente precisa mudar para
  continuar compilando.

- ceaa5b2: Capabilities novas `messages.sendLocation`, `messages.sendContactCard` e `messages.sendPoll` — ver
  ADR-0014. Métodos opcionais em `MessagesApi`, cobrindo o ENVIO dos tipos de conteúdo que
  `MessageKind` já classifica na recepção (`'location'`/`'contact'`/`'poll'`) desde a F1.

  Mudança 100% aditiva: todos os métodos são opcionais, nenhum adapter existente precisa mudar para
  continuar compilando.

- 590dc4d: Adapter Whapi.Cloud ganha `messages.sendReaction`, as 14 operações de `groups.*` (ADR-0009) e as 8
  de `contacts.*` (ADR-0010) — de 6/30 para 29/30 capabilities declaradas, só `instance.pairingCode`
  segue fora (obstáculo estrutural: `InstanceApi.connect()` não recebe telefone).

  Pontos não óbvios do mapeamento:

  - `groups.updateSubject`/`updateDescription` usam o MESMO endpoint (`PUT /groups/{GroupID}`,
    `UpdateGroupInfoRequest {subject?, description?}`) — cada operação envia só o campo que lhe
    corresponde, para não sobrescrever silenciosamente o outro.
  - `groups.revokeInviteLink`: `DELETE /groups/{GroupID}/invite` só confirma sucesso, sem devolver o
    novo código — o adapter encadeia `DELETE` + `GET /groups/{GroupID}/invite` para devolver o link
    atualizado exigido pelo contrato (exceção documentada a "uma única chamada por operação").
  - `Participant.rank` (`admin`/`member`/`creator`) mapeia para `isAdmin`/`isSuperAdmin` (`creator` →
    ambos `true`).
  - `contacts.checkExists` usa `HEAD /contacts/{ContactID}`: o resultado vem só do status HTTP
    (`200` = existe, `404` = não existe) — único método deste adapter que intercepta um status
    não-2xx esperado em vez de deixar propagar como erro.
  - `contacts.block`/`unblock` usam `ContactIdOrLid` (`/blacklist/{id}`), que aceita só dígitos ou
    `@lid` — o sufixo `@s.whatsapp.net` do chatId canônico é removido antes de montar o path.

  Ver `docs/providers/whapi.md` para o dossiê completo dos 23 endpoints.

- 292f8ce: Adapter WPPConnect Server ganha `groups.list` e as 4 operações restantes de `contacts.*`
  (`list`/`get`/`getProfilePicture`/`getAbout`) — de 24/30 para 29/30 capabilities declaradas, só
  `instance.pairingCode` segue fora (obstáculo estrutural: `InstanceApi.connect()` não recebe
  telefone).

  As 5 eram listadas como fora de escopo por "shape de resposta não confirmado" numa auditoria
  anterior que olhou só o controller fino do `wppconnect-server`. Descendo à lib subjacente
  (`@wppconnect-team/wppconnect`), o shape de resposta de todas está tipado ou visível no script
  injetado — nenhuma é limitação real do provider.

  Pontos não óbvios do mapeamento:

  - `groups.list` usa `POST /list-chats` com `{onlyGroups: true}`, não `GET /all-groups`
    (confirmado `#swagger.deprecated` — "Deprecated in favor of 'list-chats'"). O `Chat` devolvido
    pela lib não carrega participantes — `GroupInfo.participants` fica `[]` de propósito para todo
    item da listagem; quem precisar da lista completa encadeia `groups.getInfo` por grupo.
  - `contacts.list`/`contacts.get` reaproveitam o mesmo shape (`WAPI._serializeContactObj`, visível
    no script injetado `get-all-contacts.js`/`get-contact.js`) — confiança média-alta, por vir de um
    script injetado real, não da interface TS tipada diretamente da lib.
  - `contacts.getProfilePicture` prioriza `imgFull` sobre `img` (mesmo padrão "prefira a versão
    full" já usado por outros adapters deste pacote, ex.: Whapi).
  - `contacts.getAbout` mapeia `status` → `about`; string vazia vira `undefined` (nunca inventa um
    recado).

  Ver `docs/providers/wppconnect.md` para o dossiê atualizado.

## 1.0.0

### Major Changes

- Primeira versão estável (v1.0.0). Critérios atingidos:

  - **8 adapters** (WAHA, Evolution GO, uazapi, Z-API, Wuzapi, Whapi, QuePasa, WPPConnect) passando
    100% da suite de contrato compartilhada (`test/contract/adapter-contract.ts`), muito acima do
    piso original de "3+ adapters".
  - **API pública estável**: desde o `v0.1.0`, houve exatamente 1 breaking change em toda a história
    do projeto (`ConnectResult.raw`/`InstanceStatus.raw` obrigatórios), ocorrida antes de existir
    qualquer adapter além de WAHA/Evolution GO. Todas as releases seguintes (`v0.2.0` a `v0.4.0` —
    6 adapters novos, `groups.*`/`contacts.*`/`messages.sendReaction`, CLI `doctor`, exemplos) foram
    100% aditivas, sem alterar os formatos centrais (`WaMessage`, `SendTextInput`, `SendMediaInput`,
    `InstanceStatus`, `ConnectResult`).

  A partir desta versão, mudanças que quebram compatibilidade exigem um bump **major** (semver de
  verdade) e uma issue de discussão prévia — não são mais "aceitáveis em minors" como na fase 0.x
  (ver `CONTRIBUTING.md`).

## 0.4.0

### Minor Changes

- 28cf692: Novo comando `npx waconector doctor --provider <nome>`: diagnóstico de conectividade/auth contra
  um provider real, configurado via variáveis `WACONECTOR_*` específicas de cada adapter. Só chama
  `instance.status()` (checagem de leitura) — nunca `connect()`, então é seguro rodar repetidamente
  sem alterar o estado da instância no provider. Sai com código `0` em sucesso, `1` em qualquer
  falha (provider desconhecido, variável obrigatória ausente, ou erro na chamada).

  Implementado como um novo entry point ESM-only em `src/cli/` (bundle separado via `tsup`, com
  shebang), usando `node:util.parseArgs` — nenhuma dependência de runtime nova (ADR-0004).

  Também adicionados dois exemplos executáveis em `examples/` (Express e Next.js/App Router),
  usando `MockAdapter` por padrão — `npm install && npm start`/`npm run dev` funciona sem nenhuma
  credencial real. Cada exemplo documenta como trocar para um provider real usando as mesmas
  variáveis `WACONECTOR_*` do `doctor`.

  Fecha o último item pendente do roadmap da F3.

## 0.3.0

### Minor Changes

- d80ef23: Nova capability `contacts.*` (ADR-0010) — descoberta + perfil: `wa.contacts.list`,
  `wa.contacts.get`, `wa.contacts.checkExists`, `wa.contacts.getProfilePicture`,
  `wa.contacts.getAbout`. Implementado em 4 dos 5 adapters existentes (WAHA, Evolution GO, Z-API,
  Wuzapi) — **uazapi não declara `contacts.getAbout`**, por não expor nenhum endpoint/campo para o
  recado pessoal de um contato em toda a sua documentação oficial (confirmado por busca exaustiva).

  Diferente de `groupId`, o identificador de contato (`chatId`) não é opaco — é o mesmo chatId
  canônico já usado por `messages.*`, normalizado da mesma forma. Nenhum adapter compõe múltiplas
  chamadas HTTP atrás de uma única operação canônica: campos que o provider não devolve numa única
  chamada (ex.: nome de exibição no Evolution GO/Wuzapi) ficam `undefined`, documentados no dossiê de
  cada provider — nunca inventados nem obtidos via chamada adicional.

  Moderação (`block`/`unblock`/`listBlocked`) fica para um PR seguinte; `getPresence` fica fora do
  escopo por ser majoritariamente assíncrono/webhook (ver ADR-0010).

- ad1e754: Capability `contacts.*` (ADR-0010) ganha as operações de moderação: `wa.contacts.block`,
  `wa.contacts.unblock` e `wa.contacts.listBlocked`. Implementado nos 5 adapters existentes (WAHA,
  Evolution GO, uazapi, Z-API, Wuzapi) — **WAHA e Z-API não declaram `contacts.listBlocked`**, por
  não exporem nenhum endpoint de listagem de bloqueados em suas documentações oficiais (Z-API
  distinguido conscientemente de `privacy/get-disallowed-contacts`, uma blacklist de privacidade
  diferente da lista de contatos efetivamente bloqueados). `block`/`unblock` são suportados pelos 5.

  Isso fecha as 8 operações request-response originalmente escopadas para `contacts.*` (descoberta,
  perfil e moderação). `getPresence` segue fora do escopo — majoritariamente assíncrono/webhook em 4
  dos 5 providers — tratado como incremento futuro separado (ver ADR-0010).

- fa67322: Capability `groups.*` (ADR-0009) ganha as operações de configuração: `wa.groups.updateSubject`,
  `wa.groups.updateDescription` (string vazia limpa a descrição) e `wa.groups.updatePicture`
  (recebe um `MediaRef`, com `media.kind` obrigatoriamente `'image'`). Implementado nos 5 adapters
  existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi) — cada um convertendo o `MediaRef` para o
  formato de imagem exigido pelo provider, que nem sempre coincide com o formato aceito por
  `messages.sendMedia` no mesmo provider (ex.: Evolution GO/Wuzapi exigem data-URI com prefixo
  explícito; Wuzapi só aceita JPEG de fato). Convites/saída (`getInviteLink`/`revokeInviteLink`/
  `joinViaInviteLink`/`leaveGroup`) ficam para um PR seguinte (ver ADR-0009).
- b203263: Nova capability `groups.*` (ADR-0009) — núcleo + participantes: `wa.groups.create`,
  `wa.groups.getInfo`, `wa.groups.list`, `wa.groups.addParticipants`, `wa.groups.removeParticipants`,
  `wa.groups.promoteParticipants`, `wa.groups.demoteParticipants`. Implementado nos 5 adapters
  existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi), cada um traduzindo `groupId` (identificador
  opaco — a Z-API usa um ID sintético que não é um JID) e a lista de participantes para o formato
  nativo do provider. Configurações de grupo (nome/descrição/foto) e convites/saída ficam para PRs
  seguintes (ver ADR-0009).
- 520f918: Capability `groups.*` (ADR-0009) ganha as operações de convite e saída: `wa.groups.getInviteLink`,
  `wa.groups.revokeInviteLink`, `wa.groups.joinViaInviteLink` e `wa.groups.leaveGroup`. Implementado
  nos 5 adapters existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi).

  O link de convite é sempre normalizado para o formato completo (`https://chat.whatsapp.com/<código>`),
  mesmo quando o provider devolve só o código bare (ex.: WAHA) — via novas funções
  `normalizeInviteLink`/`extractInviteCode` em `src/core/chat-id.ts`, reutilizáveis por qualquer
  adapter. `joinViaInviteLink` aceita tanto o código bare quanto o link completo do chamador.

  Isso fecha as 14 operações originalmente escopadas para `groups.*` (núcleo, participantes,
  configurações, convites/saída). Webhooks de atualização de grupo (`GroupUpdateEvent`) seguem como
  incremento separado (ver ADR-0009).

- ee0760e: Webhooks de atualização de grupo (ADR-0009): `GroupUpdateEvent` (já existente, mas não usado) agora
  é populado a partir de webhooks reais em 4 dos 5 adapters, respeitando o nível de confiança real da
  pesquisa por provider:

  - **WAHA**: `group.v2.participants`/`group.v2.update`/`group.v2.join`/`group.v2.leave` implementados
    completos (payloads confirmados na doc oficial).
  - **Evolution GO / Wuzapi**: evento de diff `GroupInfo` (reconstruído do código-fonte whatsmeow, sem
    payload real capturado) — quando reporta múltiplas mudanças simultâneas, `parseWebhook` emite um
    `GroupUpdateEvent` por mudança identificada; `JoinedGroup` também implementado.
  - **Z-API**: só as 5 notificações de participante (`GROUP_PARTICIPANT_ADD/REMOVE/LEAVE/PROMOTE/
DEMOTE`) — as demais (criação, mudança de nome/descrição/ícone, convite) não têm nenhum exemplo de
    payload confirmado e continuam caindo no dispatch de mensagem comum.
  - **uazapi**: nenhum parsing estruturado — não existe nenhum exemplo de payload de evento de grupo
    em lugar nenhum da documentação oficial; eventos de grupo continuam caindo em `unknown` (padrão
    seguro, não uma regressão).

  `GroupUpdateEvent` ganhou o campo opcional `participants?: string[]`. Isso fecha as 14 operações +
  webhooks originalmente escopados para `groups.*` no ADR-0009.

- b79ab70: Novo adapter **QuePasa** (`waconector/quepasa`), F3: self-hosted via Docker
  (`nocodeleaks/quepasa`, sobre `tulir/whatsmeow`). Capabilities: `instance.status`,
  `instance.logout` (soft-stop — preserva credenciais, não é um logout de verdade),
  `messages.sendText`, `messages.sendMedia`, `groups.getInviteLink`,
  `contacts.getProfilePicture`, `webhooks.parse`
  (`message.received`/`message.sent`/`message.ack`/`connection.update`/`group.update`).

  Deliberadamente **fora do escopo** nesta fase, com justificativa detalhada em
  `docs/providers/quepasa.md`:

  - `instance.connect`/`instance.pairingCode` **não declaradas**: o endpoint de QR (`GET /scan`)
    devolve uma imagem PNG binária crua (não JSON com base64, diferente de todo outro adapter deste
    pacote) — o `HttpClient` atual decodifica respostas não-JSON como texto UTF-8, o que corrompe
    bytes binários de forma irreversível. Corrigir isso de verdade exigiria um modo de resposta
    binária/`ArrayBuffer` no core, fora do escopo desta fase.
  - `messages.sendReaction`, `groups.*` (além de `getInviteLink`) e `contacts.*` (além de
    `getProfilePicture`): o snapshot mais recente examinado tem uma API v5 completa para os três, mas
    gated por sessão de usuário via JWT — incompatível com o token por instância que este adapter usa.
    Não é ausência do recurso no provider, é incompatibilidade de modelo de autenticação — ver
    `docs/providers/quepasa.md`.
  - `messages.sendMedia` com `kind: 'sticker'` lança `INVALID_INPUT`: o QuePasa não tem tipo de
    mensagem de figurinha (viraria um documento genérico, não uma figurinha de verdade).

  O repositório oficial (`github.com/nocodeleaks/quepasa`) está bloqueado no GitHub por um aviso de
  DMCA não relacionado a mensagens/webhooks (módulo de VoIP) — a pesquisa foi feita em três
  forks/mirrors não bloqueados, com alta confiança de fidelidade ao código-fonte real. Todas as
  fixtures de webhook são reconstruídas a partir das definições de struct Go confirmadas (nenhum
  payload de tráfego real foi encontrado na pesquisa) — ver `docs/providers/quepasa.md` para o
  detalhamento de confiança por seção.

- f5594f7: `messages.sendReaction` implementado nos 5 adapters existentes (uazapi, Evolution GO, WAHA,
  Z-API, Wuzapi) — retrofit previsto pelo ADR-0008 (que introduziu a capability opcional no core
  sem alterar nenhum adapter). Cada adapter passa a declarar `messages.sendReaction` em seu
  `CapabilitySet` e a implementar `MessagesApi.sendReaction`, traduzindo `SendReactionInput` para o
  endpoint de reação nativo do provider; emoji vazio (`''`) remove uma reação já enviada, seguindo a
  convenção do próprio WhatsApp. Dossiês atualizados em `docs/providers/*.md` e cobertura estendida
  em `test/contract/*.contract.test.ts` (via o teste condicional já preparado em
  `test/contract/adapter-contract.ts`).
- 1d56a9a: Novo adapter **Whapi.Cloud** (`waconector/whapi`), F3: `instance.connect`, `instance.status`,
  `instance.logout`, `messages.sendText`, `messages.sendMedia`, `webhooks.parse`
  (`message.received`/`message.sent`/`message.ack`/`connection.update`). Ver
  `docs/providers/whapi.md` para o dossiê completo, incluindo capabilities confirmadas mas ainda não
  implementadas nesta fase (`messages.sendReaction`, `instance.pairingCode`, `groups.*`,
  `contacts.*`).

  Mensagens de mídia recebidas via webhook (`image`/`video`/`document`) agora normalizam a legenda
  (`caption`) para `WaMessage.text`, alinhado ao comportamento já existente no adapter Z-API para o
  mesmo caso.

- a68e713: Novo adapter **WPPConnect Server** (`waconector/wppconnect`), F3: self-hosted via Docker
  (`wppconnect-team/wppconnect-server`, wrapper REST sobre `@wppconnect-team/wppconnect`/Puppeteer).
  Capabilities: `instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`
  (com suporte a `mentions` via `POST /send-mentioned`), `messages.sendMedia`,
  `messages.sendReaction`, 13 operações de `groups.*` (create/getInfo/participantes/subject/
  description/picture/invite links/join/leave), `contacts.checkExists`/`block`/`unblock`/
  `listBlocked`, `webhooks.parse`
  (`message.received`/`message.sent`/`message.ack`/`connection.update`/`group.update`).

  Deliberadamente **fora do escopo** nesta fase, com justificativa detalhada em
  `docs/providers/wppconnect.md`:

  - `instance.pairingCode` **não declarada**: mesmo obstáculo estrutural de todo adapter deste
    pacote — `InstanceApi.connect()` não recebe telefone como parâmetro, e o WPPConnect só produz
    pairing code no momento de criação da sessão (`start-session` com `phone` no body).
  - `groups.list`: único endpoint (`GET /all-groups`) marcado como deprecated pelo próprio provider,
    sem shape de resposta confirmado.
  - `contacts.list`/`get`/`getProfilePicture`/`getAbout`: endpoints existem, mas nenhum shape de
    resposta foi confirmado pela pesquisa (só a transformação do lado do request).

  Achados notáveis documentados no dossiê: o endpoint `POST /create-group` devolve `id`/`name`
  aninhados em `groupInfo[0]`, com `id` sem o sufixo `@g.us` esperado pelo resto de `groups.*`
  (corrigido no adapter, lendo o array aninhado e reconstruindo o JID); `POST /send-message` e os
  endpoints de mídia (`/send-file-base64`, `/send-voice-base64`, `/send-sticker`) devolvem `response`
  como um ARRAY de um elemento, não o objeto bare (corrigido no adapter, desembrulhando o array antes
  de mapear `id`/`chatId`/`timestamp`); o campo `phone` de envio de mensagem exige a parte LOCAL do
  JID (não o JID completo, que produziria um sufixo duplicado no servidor); e `instance.connect()`
  com `waitQrCode: true` (padrão) pode travar até o timeout se chamado numa sessão nova sem cliente
  registrado — reavaliado como um risco mais estreito que o inicialmente suposto (não afeta
  reconexão de sessão já vista antes, ainda não confirmado empiricamente, ver
  `WppconnectOptions.waitQrCode`).

## 0.2.0

### Minor Changes

- 3b82fa6: Adapter **uazapi** (`waconector/uazapi`) — primeiro provider da fase F2, SaaS multi-tenant
  (auth via header `token` de instância). Implementa `instance.connect/status/logout`,
  `messages.sendText/sendMedia` e `webhooks.parse`, com dossiê próprio em `docs/providers/uazapi.md`
  e testes de contrato. Ver o dossiê para suposições não validadas contra uma instância real
  (formato exato do envelope de webhook e do campo `messageType`).
- 672e035: Adapter **Wuzapi** (`waconector/wuzapi`) — terceiro e último provider planejado da fase F2,
  self-hosted (construído sobre `tulir/whatsmeow`, mesma lib do Evolution GO). Implementa
  `instance.connect/status/logout`, `messages.sendText/sendMedia` e `webhooks.parse`, com dossiê
  próprio em `docs/providers/wuzapi.md` (pesquisado direto no código-fonte Go, com várias
  divergências doc-vs-código documentadas) e testes de contrato.
- 8d93b82: Adapter **Z-API** (`waconector/zapi`) — segundo provider da fase F2, SaaS brasileiro (auth via
  `instanceId`+`token` embutidos na URL, sem `Authorization: Bearer`). Implementa
  `instance.connect/status/logout`, `messages.sendText/sendMedia` (incluindo `sticker`) e
  `webhooks.parse`, com dossiê próprio em `docs/providers/zapi.md` e testes de contrato. Sem
  endpoint de criação de instância documentado (provisionamento é só via painel).

## 0.1.0

### Minor Changes

- Primeiro release com adapters de provider reais: **WAHA** (`waconector/waha`) e **Evolution GO**
  (`waconector/evolution`), implementados a partir de dossiês próprios em `docs/providers/` e
  auditados adversarialmente contra a documentação/código-fonte oficial de cada provider.

  Também incluído neste release:

  - Verificação HMAC opt-in de webhooks WAHA (`WahaOptions.webhookHmacKey` + `WebhookInput.rawBody`).
  - `HttpClient`: retry só para operações idempotentes por padrão (evita duplicar mensagens em
    retry) e suporte ao header `Retry-After`.
  - `ConnectResult.raw`/`InstanceStatus.raw` agora obrigatórios (alinhado ao ADR-0002) — breaking
    change de tipo, mas nenhum adapter existente precisou de correção.
  - Cobertura de testes com thresholds, templates de issue/PR, `CONTRIBUTING.md`, Dependabot.
  - Modelo de branches (`main` protegido, `develop` de integração) e automações de CI (revisão de
    código automática, sincronização de docs/wiki pós-merge).
