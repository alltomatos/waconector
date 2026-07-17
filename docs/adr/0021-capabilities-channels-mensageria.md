# ADR-0021: Capabilities novas `channels.getMessages`/`markViewed`/`reactToPost`

- Status: aceito
- Data: 2026-07-17

## Contexto

Mesma origem da ADR-0020 (Epic 11, pesquisa disparada por uma pergunta do usuário sobre a
diferença entre os ~100 endpoints do izapia e as 68 capabilities do contrato central). O namespace
`channels.*` (ADR-0017) hoje só cobre metadados do canal (`list`/`create`/`getInfo`/`delete`/
`follow`/`unfollow`) — nunca o CONTEÚDO dos posts publicados. Isso é uma lacuna real, não uma
decisão deliberada: a pesquisa original do ADR-0017 nunca investigou mensageria de canal.

Duas rodadas de pesquisa recombinando dossiês existentes não confirmaram convergência (Evolution
GO tinha `channels.getMessages` documentado, mas nenhum outro provider tinha pesquisa dedicada
suficiente). Uma terceira rodada — specs OpenAPI reais de uazapi e Whapi baixados e inspecionados
ao vivo — confirmou:

| Capability | Evolution GO | uazapi | Whapi | izapia | Cobertura |
| --- | --- | --- | --- | --- | --- |
| `getMessages` | ✅ (`POST /newsletter/messages`, endpoint real) | ✅ `POST /newsletter/messages`, body `{id?, jid?, count?, beforeid?}` → array `{serverid, messageid, type, timestamp, viewsCount, reactionCounts, message}` | ✅ `GET /newsletters/{NewsletterID}/messages` (`operationId: getMessagesNewsletter`), params `count`/`before`/`after` | ✅ `GET .../channels/{channelId}/messages` | 4/9 |
| `markViewed` | — | ✅ `POST /newsletter/viewed`, body `{id?, jid?, serverids: integer[]}` → `{response: boolean}` | — | ✅ `POST .../channels/{channelId}/messages/viewed` | 2/9 |
| `reactToPost` | — | ✅ `POST /newsletter/reaction`, body `{id?, jid?, serverid, reaction?, reactionmessageid?}` → `{response: boolean}` (reaction vazia remove) | — | ✅ `POST .../channels/{channelId}/messages/{serverId}/react` | 2/9 |

`markViewed`/`reactToPost` batem o critério no piso mínimo (2 providers) — mesmo padrão já
aceito para `calls.make` (ADR-0019, 2/8 na época).

**Z-API, QuePasa, WPPConnect: busca negativa razoável para os 3 candidatos** (índice completo de
rotas de newsletter revisado, nenhuma é de mensagens/posts). **WAHA**: tem `previewMessages`
(canais NÃO inscritos — semântica diferente de "ler o feed do canal que já sigo"), não conta.

## Decisão

1. **`ChannelsApi` ganha 3 métodos novos, todos opcionais** (mesmo padrão dos demais métodos do
   namespace, ADR-0017):
   ```ts
   interface ChannelsApi {
     // ... métodos existentes
     getMessages?(input: GetChannelMessagesInput): Promise<ChannelPost[]>;
     markViewed?(input: MarkChannelMessagesViewedInput): Promise<void>;
     reactToPost?(input: ReactToChannelMessageInput): Promise<void>;
   }
   ```
2. **Tipo novo `ChannelPost`** (`src/core/types.ts`):
   ```ts
   interface ChannelPost {
     id: string;
     timestamp: number; // epoch ms
     text?: string;
     viewsCount?: number;
     reactionCounts?: Record<string, number>;
     raw: unknown;
   }
   ```
   `id` é o identificador OPACO do post no provider (`serverid`/`serverId`) — distinto do
   `messageId` de uma mensagem de chat comum, mesmo critério de opacidade já usado para
   `GroupInfo.id`/`ChannelInfo.id` (ADR-0009/0017).
3. **Inputs novos**: `GetChannelMessagesInput{channelId, count?, before?}`,
   `MarkChannelMessagesViewedInput{channelId, messageIds: string[]}`,
   `ReactToChannelMessageInput{channelId, messageId, emoji}` — `emoji` vazio remove uma reação já
   enviada, mesma convenção de `SendReactionInput`/`messages.sendReaction` (ADR-0008).
4. **`ConnectorChannelsApi`** ganha os 3 métodos sempre presentes, gateados por capability +
   guard-rail `PROVIDER_ERROR`, mesmo padrão de `callChannelsMethod` já existente.

## Justificativa

- **Por que um `ChannelPost` novo em vez de reaproveitar `WaMessage`**: um post de canal não tem
  remetente individual, não é "de/para" um chat, e carrega campos que `WaMessage` não tem
  (`viewsCount`, `reactionCounts`) — forçar o mesmo tipo obrigaria vários campos de `WaMessage`
  (`from`, `fromMe`, `chatId`) a ficarem sempre vazios/inventados. Um tipo dedicado, mínimo e
  honesto sobre o que um post de canal realmente é, é mais alinhado com "normalizar o comum,
  preservar o específico" (ADR-0002) do que forçar reaproveitamento.
- **Por que `markViewed` recebe uma LISTA de `messageIds` em vez de um por vez**: os 2 providers
  confirmados (uazapi, izapia) aceitam múltiplos ids numa única chamada nativamente
  (`serverids: integer[]`, `server_ids: integer[]`) — expor só 1 por vez forçaria N chamadas HTTP
  para marcar N posts como vistos, contrariando a regra de "uma operação canônica, uma chamada"
  quando o provider já suporta lote nativamente.
- **Por que promover com só 2/9 providers**: mesmo critério já aceito em `calls.make` (ADR-0019).
  O piso histórico deste pacote nunca foi "maioria dos providers", é "convergência real
  confirmada em 2+" — o resto fica documentado como gap real (não pesquisa insuficiente) quando a
  busca foi de fato exaustiva (Z-API/QuePasa/WPPConnect aqui).

## Consequências

- Enum de capabilities cresce de 69 (pós ADR-0020) para 72.
- Cobertura assimétrica: `getMessages` 4/9, `markViewed`/`reactToPost` 2/9 cada.
- `MockAdapter` implementa `getMessages` devolvendo `[]` (não há capability de PUBLICAR um post
  num canal no contrato atual, então não existe um jeito público de popular posts de teste) e
  `markViewed`/`reactToPost` como no-ops (mesmo critério de `calls.make`/`reject` — sem estado
  persistente natural para uma ação transiente).
- Changeset `minor` — mudança aditiva, sem breaking change.

## Alternativas consideradas

- **Modelar `getMessages` como parte de `messages.*` em vez de `channels.*`**: rejeitado — o post
  de canal não é uma mensagem de chat, e todo o resto de "conteúdo de canal" já vive em
  `channels.*` (ADR-0017); manter a coerência do namespace pesa mais que a semelhança superficial
  com "buscar mensagens".
- **Adiar a promoção até confirmar `markViewed`/`reactToPost` em um 3º provider**: rejeitado —
  contrariaria o precedente já aceito de `calls.make` (2/8), e a pesquisa nos 3 providers
  restantes já foi exaustiva o bastante para descartá-los com confiança razoável, não por falta de
  profundidade.
