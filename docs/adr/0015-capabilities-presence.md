# ADR-0015: Namespace `presence.*` (`setTyping`/`set`/`subscribe`)

- Status: aceito
- Data: 2026-07-12

## Contexto

Terceiro item da fila de capabilities novas (ver ADR-0013/0014 para os dois primeiros) — e o
primeiro namespace inteiramente novo desta rodada (os dois anteriores foram métodos adicionados a
`MessagesApi` já existente). Reconfirmação de escopo (releitura dos 8 relatórios salvos da Epic 7 +
verificação ao vivo via `gh api` para WPPConnect, cujo relatório original só tinha achado o
`onPresenceChanged` do lado de RECEPÇÃO/webhook, não um endpoint de envio):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `presence.setTyping` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 7/8 |
| `presence.set` | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ | 5/8 |
| `presence.subscribe` | ✅ | — | — | — | ✅ | ✅ | — | ✅ | 4/8 |

**Z-API tem 0/3, com busca negativa explícita já registrada** no relatório original: só existe
`delayTyping` como efeito colateral de `send-text` (atrasa a entrega mostrando "digitando…" durante
o delay, não é um controle de presença independente) e um webhook de *recepção*
(`PresenceChatCallback`) — nenhum endpoint de *envio* de indicador de presença. Tratado como
limitação real do provider, não gap de pesquisa.

**Achado que muda o cálculo de risco do WPPConnect**: o relatório original só tinha encontrado
`onPresenceChanged` (webhook), levando à leitura de "sem envio confirmado". Verificação ao vivo
(`gh api` contra `wppconnect-server@f09e2fed`, `routes.ts`) encontrou 4 rotas reais:
`POST /typing` (`DeviceController.setTyping`), `POST /set-online-presence`
(`SessionController.setOnlinePresence`), `POST /subscribe-presence`
(`SessionController.subscribePresence`) e `GET /chat-is-online/:phone` (não usada nesta ADR — ver
Alternativas). WPPConnect acaba sendo o adapter com a **segunda melhor cobertura** desta ADR (3/3),
atrás só de WAHA/Wuzapi/Whapi.

**`presence.get` (consultar presença atual) deliberadamente FORA desta ADR**: confirmado só em
2/8 (WAHA — `GET /api/{session}/presence(/{chatId})`, resposta rica
`{id, presences: [{participant, lastKnownPresence, lastSeen}]}`; Whapi — `GET /presences/{EntryID}`,
schema `Presence` próprio) — cobertura baixa demais e shapes de resposta heterogêneos demais para
unificar com confiança nesta rodada (mesmo critério de "não arredondar cobertura" já aplicado em
ADRs anteriores). Fica como candidata para uma rodada futura se a demanda justificar.

## Decisão

1. **Namespace novo `WaAdapter.presence?: PresenceApi`, inteiramente OPCIONAL** — mesmo padrão de
   `chats?` (ADR-0012): todos os 3 métodos também opcionais dentro da interface.
2. **Tipos novos em `src/core/types.ts`**:
   - `TypingState = 'composing' | 'recording' | 'paused'` — vocabulário nativo do whatsmeow, que a
     maioria dos providers pesquisados já usa diretamente ou com pequenas variações de superfície
     (Whapi usa `pause` no singular; Wuzapi expressa `recording` como `composing` + um campo
     `Media: "audio"` separado) — a tradução fica a cargo de cada adapter.
   - `SetTypingInput { to, state: TypingState }`.
   - `PresenceState = 'online' | 'offline'` — presença GLOBAL da conta, distinta do indicador por
     conversa. Todo provider pesquisado converge neste par binário (alguns usam
     `available`/`unavailable` no wire, sempre com o mesmo significado).
3. **`PresenceApi`**:
   ```ts
   interface PresenceApi {
     setTyping?(input: SetTypingInput): Promise<void>;
     set?(state: PresenceState): Promise<void>;
     subscribe?(chatId: string): Promise<void>;
   }
   ```
4. **`ConnectorPresenceApi`** — todo método sempre presente (namespace resolvido no conector),
   gateado por capability + guard-rail `PROVIDER_ERROR` via um novo `callPresenceMethod`, réplica
   exata de `callChatsMethod` (o `?.` cobre tanto "namespace inteiro ausente" quanto "método
   individual ausente" com o mesmo erro).
5. **Validação no conector**: `to`/`chatId` normalizado via `normalizeChatId` (mesmo tratamento do
   resto de `messages.*`/`chats.*`); `state` validado contra os 3 valores de `TypingState` (rede de
   segurança em runtime para chamadores JS sem checagem de tipo, mesmo critério já usado noutros
   pontos do conector); `presence.set` não tem chatId — não há o que normalizar além do enum já
   tipado.

## Justificativa

- **Por que namespace novo em vez de métodos em `ChatsApi`/`MessagesApi`**: presença é um conceito
  ortogonal — não é conteúdo de mensagem (`messages.*`) nem estado persistente de conversa
  (`chats.*`, que sobrevive a reconexões); é um sinal efêmero e ambíguo o bastante (por conversa
  `setTyping` vs. global `set`) para merecer seu próprio agrupamento, mesmo critério que já levou
  `chats.*` a ser namespace separado de `messages.*` no ADR-0012.
- **Por que `setTyping` recebe um `to` normalizado por `normalizeChatId` (não opaco)**: mesmo
  tratamento de `messages.*`/`chats.*` — presença por conversa sempre se refere a um chat individual
  ou de grupo, nunca a um identificador opaco como `groupId`.
- **Por que não modelar duração/timeout de `setTyping`**: QuePasa aceita um campo `duration` (ms,
  reenvia o indicador periodicamente até expirar); os demais não têm esse conceito ou o modelam via
  webhook assíncrono (uazapi, Wuzapi). Nenhum formato converge — mesmo critério já usado para
  `chats.mute` (ADR-0012) e `messages.pin` (ADR-0013): cada adapter usa seu próprio default/omite o
  campo, documentado no dossiê.

## Consequências

- Enum de capabilities cresce de 49 para 52.
- Cobertura desigual entre os 3 métodos (7/8, 5/8, 4/8) — Z-API fica sem nenhum dos 3 (limitação
  real, busca negativa confirmada); evolution e QuePasa ficam só com `setTyping` (1/3 cada).
- `MockAdapter` implementa os 3 métodos em memória (`globalPresence`, `typingStateByChatId`,
  `subscribedPresenceChatIds`) com getters de inspeção (`getGlobalPresence`/`getTypingState`/
  `isSubscribedToPresence`) só para teste — mesmo padrão de `isMessageStarred`/`isChatArchived`.
- Changeset `minor` — mudança aditiva, sem breaking change.

## Alternativas consideradas

- **`presence.get`**: rejeitado nesta fase — cobertura 2/8 e shapes de resposta divergentes demais
  para unificar com confiança (ver Contexto). Candidata para rodada futura.
- **WPPConnect `GET /chat-is-online/:phone`/`getLastSeen` como implementação de `presence.get`**:
  cogitado como um substituto de menor risco (resposta simples booleano/timestamp em vez do objeto
  rico de WAHA/Whapi), mas descartado por ser um formato de resposta unicamente diferente dos 2
  outros candidatos — implementaria uma "capability" com 3 shapes totalmente distintos entre os 3
  providers, contrariando o objetivo de contrato canônico unificado.
- **Enum único para `TypingState`/`PresenceState`** (`'composing'|'recording'|'paused'|'online'|
  'offline'` num tipo só): rejeitado — são conceitos com escopo diferente (por conversa vs. global)
  e nem todo provider que suporta um suporta o outro (evolution/QuePasa só têm `setTyping`); tipos
  separados deixam essa assimetria explícita na própria assinatura dos métodos.
