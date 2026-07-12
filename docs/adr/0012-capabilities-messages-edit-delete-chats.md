# ADR-0012: Capabilities `messages.edit`/`messages.delete` e novo namespace `chats.*`

- Status: aceito
- Data: 2026-07-12

## Contexto

Após ADR-0008 (reactions), ADR-0009 (grupos) e ADR-0010 (contatos), uma pesquisa dedicada (1
agente por provider, mesma metodologia rigorosa das anteriores) investigou capabilities novas nos
8 adapters existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi, Whapi, QuePasa, WPPConnect).
Diferente das rodadas anteriores, esta pesquisa não teve um escopo fechado de operações — cada
agente levantou tudo que encontrou fora do enum atual de 30 capabilities, produzindo dezenas de
candidatas (enquetes, presença, labels, canais, comunidades, catálogo comercial, chamadas, status/
stories, entre outras).

Desta lista ampla, duas áreas se destacam por (a) cobertura cross-provider forte e (b) não
dependerem de um tipo de conta especial (WhatsApp Business) nem de um domínio novo grande o
suficiente para merecer ADR próprio:

1. **Editar/apagar mensagem já enviada** — confirmado com confiança Alta em 7/8 (`edit`) e 8/8
   (`delete`, com 2 em confiança Média) providers.
2. **Gestão de estado de conversa** (`chats.*`: arquivar, silenciar, fixar, marcar como lida) — um
   namespace inteiramente novo, com cobertura real bem mais desigual que grupos/contatos.

Achados centrais da pesquisa:

- **`messages.delete` é, na prática, sempre revogação ("apagar para todos")** nos providers onde o
  mecanismo interno foi confirmado a fundo (Evolution GO, Wuzapi, QuePasa — todos via
  `BuildRevoke`/protocolo real do whatsmeow, sem alternativa "local"). Só o **WPPConnect** confirma
  em código um parâmetro real de escopo (`onlyLocal`, default `false`) — e o próprio exemplo de
  documentação do provider erra esse default (rotula um payload de "only me" que na verdade produz
  "apagar para todos", por omitir `onlyLocal: true`). WAHA/uazapi/Z-API/Whapi não confirmam nem
  negam um modo local.
- **`messages.edit` não tem janela de tempo verificável em nenhum dos 8 providers** — nenhum valida
  localmente um prazo (o WhatsApp real limita a ~15min, mas isso é decidido do lado do
  cliente/servidor do WhatsApp, fora do código aberto de qualquer provider pesquisado).
- **`chats.*` tem suporte muito mais desigual que `groups.*`/`contacts.*`**: Wuzapi não tem NENHUMA
  das 8 operações candidatas exceto `archive` (busca exaustiva em código sem resultado para mute/
  pin/markRead/markUnread); WAHA não documenta mute nem pin de conversa (só pin de MENSAGEM,
  operação diferente); Evolution GO tem `archive`/`mute`/`pin` mas confirma explicitamente a
  ausência dos endpoints inversos (`unarchive`/`unmute`) — só o par pin/unpin é simétrico lá.
- **Duração de mute não converge num formato único**: uazapi usa um enum de horas (`0|8|168|-1`),
  Whapi usa timestamp Unix em ms (`mute_until`, `0` = desmutar), WPPConnect usa `time`+`type` com um
  bug confirmado (`type: 'year'` na verdade soma DIAS, não anos). Sem um formato universal
  confirmado, um campo de duração canônico seria inventado sem base — fica fora do escopo desta
  ADR (mesmo critério usado em ADR-0010 para adiar `getPresence`).
- **`chats.pin` (conversa inteira) é operação distinta de `messages.pin` (mensagem dentro do
  chat)** — as duas existem em paralelo em pelo menos WAHA (só mensagem) e Z-API (as duas, com
  endpoints diferentes). Esta ADR cobre só `chats.pin` (conversa); `messages.pin`/`star`/`forward`
  ficam fora de escopo, candidatos a incremento futuro.
- **`chats.markRead`/`markUnread` (chat inteiro) são operações distintas de um eventual
  `messages.markRead` (mensagem por id)** — uazapi e WPPConnect confirmam os dois mecanismos
  coexistindo com endpoints diferentes. Esta ADR cobre só o nível de chat.
- **WPPConnect tem um bug confirmado em código** para `chats.pin`: o controller compara
  `state === 'true'` (string), não o booleano — enviar `state: true` (como o próprio schema pede)
  resulta sempre em desafixar. Registrado aqui para não ser redescoberto na implementação: o
  adapter WPPConnect precisará serializar `state` como a STRING `"true"`/`"false"`, não booleano.

## Decisão

1. **`MessagesApi.edit?`/`MessagesApi.delete?`** — opcionais, mesmo padrão de `sendReaction?`
   (ADR-0008). Tipos novos em `src/core/types.ts`:
   - `EditMessageInput { to, messageId, text }` → retorna `Promise<SentMessage>`.
   - `DeleteMessageInput { to, messageId }` → retorna `Promise<void>`. Sem campo de
     escopo/`onlyLocal` nesta fase (ver "Achados" acima) — semântica assumida é sempre revogação.
2. **Novo namespace `ChatsApi`**, com TODO método opcional (mesmo padrão de `GroupsApi`/
   `ContactsApi`): `archive?`, `unarchive?`, `mute?`, `unmute?`, `pin?`, `unpin?`, `markRead?`,
   `markUnread?` — todos `(chatId: string) => Promise<void>`.
3. **`readonly chats?: ChatsApi` é OPCIONAL em `WaAdapter`** — DIFERENTE do precedente de
   `groups`/`contacts` (ADR-0009/0010, campo obrigatório). Dois motivos, um de processo e um
   técnico:
   - **Processo**: pós-v1.0, `CONTRIBUTING.md` exige issue de discussão + changeset `major` para
     qualquer mudança que quebre `WaAdapter`. Um campo obrigatório novo quebraria a compilação dos
     8 adapters existentes — exatamente o gatilho que a regra foi desenhada para pegar. Um campo
     opcional é 100% aditivo: nenhum adapter existente precisa mudar.
   - **Técnico**: a cobertura real por provider é irregular demais para um campo mandatório fazer
     sentido aqui (ver "Achados" — Wuzapi não tem quase nada do namespace). Forçar todo adapter a
     ter um objeto `chats: {...}` com a maioria dos métodos `undefined` não reflete cobertura real
     nem ajuda o consumidor — um campo ausente é mais honesto que um objeto quase vazio.
   - Não há razão técnica para preferir o padrão antigo: o guard-rail do conector
     (`callChatsMethod`) já precisa checar método-ausente por método; estender isso para também
     tolerar objeto-inteiro-ausente é uma troca de `.` por `?.`, sem custo adicional de design.
4. **`chatId` de `chats.*` passa por `normalizeChatId`** no conector — mesmo tratamento de
   `contacts.*` (ADR-0010), NÃO o tratamento opaco de `groupId` (ADR-0009). Um "chat" é o mesmo
   alvo endereçável de `messages.sendText`, podendo ser indivíduo ou grupo via JID explícito.
5. **Cada par archive/unarchive, mute/unmute, pin/unpin, markRead/markUnread vira 2 capabilities
   separadas**, não 1 capability com parâmetro booleano — mesmo padrão de `contacts.block`/
   `unblock`. Evidência concreta (não só estilo): Evolution GO tem `archive` mas confirma a
   ausência de `unarchive` — só com capabilities separadas o adapter consegue declarar o suporte
   real (parcial) sem mentir sobre a metade que falta.
6. **`ConnectorChatsApi`/`callChatsMethod`** seguem o mesmo padrão dual de `ConnectorGroupsApi`/
   `callGroupsMethod`: todo método sempre presente no conector, gateado por capability +
   `PROVIDER_ERROR` quando o adapter declara sem implementar (incluindo o caso de `adapter.chats`
   inteiro ausente, coberto via optional chaining).
7. **`ConnectorMessagesApi.edit`/`delete`** seguem o mesmo padrão; o guard-rail antes inline de
   `sendReaction` é generalizado para um helper `callMessagesMethod` (refatoração interna, sem
   mudança de comportamento observável — mesmo texto de erro).

## Justificativa

- Reaproveita integralmente o padrão dual já validado 3 vezes (`sendReaction`/`groups.*`/
  `contacts.*`) — nenhuma decisão arquitetural nova além do ponto 3 (campo opcional em vez de
  obrigatório), que é uma correção de curso justificada pela regra de breaking change pós-v1.0
  criada depois que ADR-0009/0010 foram aceitas.
- Não incluir escopo de delete (`onlyLocal`) nem duração de mute evita inventar campos sem
  confiança cross-provider suficiente — mesmo critério que já levou ADR-0010 a adiar `getPresence`
  em vez de forçar um shape ruim.
- Separar `chats.pin`/`markRead` de `messages.pin`/`markRead` (mensagem-a-mensagem) evita colisão
  semântica confirmada na própria pesquisa (uazapi e WPPConnect documentam os dois mecanismos como
  operações distintas do protocolo).

## Consequências

- Escopo fatiado em PRs, mesmo espírito de ADR-0009/0010, por ordem de cobertura real:
  1. `messages.edit`/`messages.delete` (maior cobertura combinada).
  2. `chats.archive`/`chats.unarchive`.
  3. `chats.markRead`/`chats.markUnread`.
  4. `chats.pin`/`chats.unpin` (WPPConnect precisa do workaround de string `'true'`/`'false'`).
  5. `chats.mute`/`chats.unmute` (cobertura mais fraca e mais inconsistente).
- `MockAdapter` (`src/testing/mock-adapter.ts`) implementa `messages.edit`/`delete` e um objeto
  `chats` em memória (mesmo estilo de `blockedIds`/`contactsById`) na mesma mudança que adiciona as
  entradas ao enum `CAPABILITIES` — `MockAdapterOptions.capabilities` default para o enum inteiro,
  então o enum crescer sem o `MockAdapter` implementar quebraria o próprio guard-rail de
  `PROVIDER_ERROR` na suite de contrato.
- `docs/providers/<nome>.md` de cada adapter ganha seções novas ("Edição/exclusão de mensagem",
  "Conversas (chats.*)") durante a implementação, documentando por adapter as ausências
  (`unarchive`/`unmute` no Evolution GO, o namespace `chats.*` quase todo ausente no Wuzapi, o bug
  de `state === 'true'` no WPPConnect, etc.).
- `messages.star`, `messages.forward`, `messages.pin` (nível de mensagem), `presence.*`,
  `labels.*`, `channels.*`, `communities.*`, `business.*`, `calls.*`, `stories.*` — todos
  encontrados na pesquisa com força variável — ficam explicitamente fora desta ADR, candidatos a
  ADRs dedicados futuros (mesmo padrão de ADR-0010 adiando `getPresence`).
- Nenhuma issue de discussão prévia foi tecnicamente exigida por este desenho: por ser aditivo em
  toda a superfície (campo `chats?` opcional, métodos `edit?`/`delete?` opcionais, novas entradas
  de union em `CAPABILITIES`), não há quebra de compatibilidade que acione o gate do
  `CONTRIBUTING.md`. Changeset `minor`.

## Alternativas consideradas

- **`readonly chats: ChatsApi` obrigatório** (mesmo padrão de `groups`/`contacts`): rejeitado —
  quebraria compilação dos 8 adapters, acionando o gate de breaking change pós-v1.0 sem
  necessidade técnica (ver "Decisão" item 3).
- **`chats.archive(chatId, archived: boolean)`** (1 capability, parâmetro booleano): rejeitado —
  Evolution GO tem `archive` funcional sem `unarchive`; uma única capability booleana obrigaria o
  adapter a mentir sobre suporte total ou declarar nada.
- **`DeleteMessageInput.forEveryone?: boolean`**: rejeitado nesta fase — só WPPConnect confirma a
  distinção em código; os demais 7 providers não têm essa opção confirmada.
- **`ChatMuteInput { chatId, durationSeconds? }`**: rejeitado nesta fase — nenhum formato de
  duração converge entre os providers que suportam mute; ver "Achados".
