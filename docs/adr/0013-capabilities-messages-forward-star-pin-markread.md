# ADR-0013: Capabilities `messages.forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`

- Status: aceito
- Data: 2026-07-12

## Contexto

Primeiro item da fila de capabilities novas planejada após a Epic 7 (ADR-0012), coberta pelos 8
relatórios de pesquisa já produzidos naquela rodada (escopo original era só `messages.edit`/
`delete` + `chats.*`, mas os agentes de pesquisa levantaram candidatas adicionais em "seções
secundárias" que ficaram registradas para revisão futura). Diferente da Epic 7 (fila via
`Workflow`/multi-agente), esta rodada é executada sequencialmente, sem múltiplos agentes em
paralelo, a pedido do usuário.

Reconfirmação de escopo (releitura dos relatórios salvos + verificação pontual ao vivo contra
`gh api` para os casos ambíguos — QuePasa e WPPConnect, cujos relatórios originais focaram só nas
6 capabilities do ADR-0012):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `messages.forward` | ✅ | — | — (busca exaustiva, confirmado ausente) | ✅ | — (busca exaustiva) | ✅ | — (confirmado via `legacy/routes.go`, sem rota) | ✅ | 4/8 |
| `messages.star`/`unstar` | ✅ | — | — (busca exaustiva, confirmado ausente) | — | — | ✅ | — | ✅ | 3/8 |
| `messages.pin`/`unpin` | ✅ | — | ✅ | ✅ | — (busca exaustiva em `handlers.go`, zero ocorrência de "Pin") | ✅ | — (confirmado ausente) | — (confirmado ausente, só `chats.pin` de nível de conversa) | 4/8 |
| `messages.markRead` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (`markAsRead`) | ✅ | — (só `chats.markRead`/`markUnread` de nível de conversa existem, já implementados) | 7/8 |

`messages.markRead` tem a cobertura mais forte (7/8) — todo provider exceto WPPConnect confirma um
endpoint de nível de MENSAGEM, distinto do `chats.markRead` (nível de conversa, ADR-0012). Nas
ausências marcadas "confirmado", a pesquisa foi exaustiva (busca por padrão de nome de rota no
spec/código-fonte completo, não just "não encontrei numa leitura superficial") — tratadas como
limitação real do provider, não gap de pesquisa.

## Decisão

1. **Todos os 6 métodos são opcionais em `MessagesApi`** (mesmo padrão de `edit`/`delete`,
   ADR-0012) — nenhum namespace novo, mudança 100% aditiva.
2. **Tipos novos em `src/core/types.ts`**:
   - `ForwardMessageInput { to, messageId, fromChatId? }` → `forward` retorna `Promise<SentMessage>`
     (produz uma mensagem nova, como `edit`). `fromChatId` é opcional: a maioria dos providers
     resolve o chat de origem a partir do próprio `messageId` (formato do WhatsApp normalmente
     autoidentifica); só a Z-API precisa de um campo de origem explícito (`messagePhone`) — o
     adapter Z-API usa esse campo quando presente, mas o contrato não o torna obrigatório para não
     penalizar os demais 3 providers que não precisam dele.
   - `StarMessageInput { to, messageId }` — mesma forma para `star`/`unstar` (a direção é decidida
     pelo MÉTODO chamado, não por um campo booleano — mesmo padrão de `contacts.block`/`unblock`).
   - `PinMessageInput { to, messageId }` — mesma forma para `pin`/`unpin`, **sem campo de
     duração/prazo**: WAHA exige `duration` (não confirmado o formato exato), Whapi usa enum
     `day`/`week`/`month`, uazapi usa dias inteiros com fallback silencioso para 30 se inválido —
     nenhum formato converge (mesmo critério já usado para `chats.mute` no ADR-0012); cada adapter
     decide seu próprio valor/sentinela e documenta a escolha.
   - `MarkMessageReadInput { to, messageId }` — nível de MENSAGEM, distinto de
     `MarkMessageReadInput`... (não confundir com `chats.markRead(chatId)`, que já existe).
3. **`ConnectorMessagesApi`** ganha os 6 métodos correspondentes, todos usando o helper
   `callMessagesMethod` já generalizado no ADR-0012 (nenhum guard-rail novo necessário).
4. **`chatId`/`to` normalizado via `normalizeChatId`** (mesmo tratamento de `contacts.*`/`chats.*`)
   — não é opaco como `groupId`.

## Justificativa

- Reaproveita 100% a infraestrutura já criada no ADR-0012 (`callMessagesMethod`,
  `MessagesApi` opcional) — nenhuma decisão arquitetural nova além dos tipos de input.
- Separar `star`/`unstar` e `pin`/`unpin` em capabilities distintas (não um booleano) segue o
  precedente de `contacts.block`/`unblock` e `chats.archive`/`unarchive` — permite a um adapter
  declarar só uma direção se só uma for confirmada (não ocorreu nesta pesquisa, mas mantém
  consistência de estilo com o resto do enum).
- Não incluir duração em `PinMessageInput` evita inventar um formato sem convergência
  cross-provider (mesmo critério do `chats.mute`, ADR-0012).

## Consequências

- Enum de capabilities cresce de 40 para 46.
- `messages.forward`/`star`/`pin` têm cobertura mais desigual (3-4/8) que `messages.markRead`
  (7/8) — WPPConnect fica sem nenhuma das 3 primeiras por limitação real confirmada
  (`messages.pin`/`markRead` de nível de mensagem não existem no provider; só `chats.*` de nível
  de conversa, já implementado). QuePasa fica sem `forward`/`pin`/`star` pela mesma razão (rotas
  legacy não têm esses endpoints) — mantém `messages.markRead` via `POST /read` (legacy, mesmo
  mecanismo de auth já confiável, sem relação com o bloqueio de `groups.*`/`contacts.*` da Epic 6).
- `MockAdapter` implementa os 6 métodos em memória (`starredMessageIds`/`pinnedMessageIds`/
  `readMessageIds`, mesmo estilo de `blockedIds`/`archivedChatIds`) com getters de inspeção
  (`isMessageStarred`/`isMessagePinned`/`isMessageRead`) só para teste.
- Changeset `minor` — mudança aditiva, sem breaking change.

## Alternativas consideradas

- **`ChatsApi`/`MessagesApi` unificados num namespace só de "ações"**: rejeitado — a distinção
  nível-de-mensagem vs. nível-de-conversa já é uma linha divisória clara no enum (ex.:
  `chats.markRead` vs. `messages.markRead`), manter os métodos em `MessagesApi` preserva essa
  clareza sem introduzir um namespace novo desnecessário.
- **`StarMessageInput`/`PinMessageInput` unificados com `MarkMessageReadInput`** (todos são
  `{to, messageId}`): considerado, mas mantidos como tipos nomeados separados por clareza de
  domínio — mesmo padrão já usado para `EditMessageInput`/`DeleteMessageInput` no ADR-0012 (nomes
  distintos mesmo quando a forma é idêntica).
