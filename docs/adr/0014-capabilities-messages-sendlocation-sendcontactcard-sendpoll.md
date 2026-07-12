# ADR-0014: Capabilities `messages.sendLocation`/`sendContactCard`/`sendPoll`

- Status: aceito
- Data: 2026-07-12

## Contexto

Segundo item da fila de capabilities novas planejada após a Epic 7 (ver ADR-0013 para o primeiro).
`MessageKind` (`src/core/types.ts`) já classifica `'location'`/`'contact'`/`'poll'` na RECEPÇÃO de
webhooks desde a F1 — esta PR cobre o ENVIO, gap simétrico que faltava.

Reconfirmação de escopo (releitura dos 8 relatórios salvos da Epic 7 + verificação ao vivo via
`gh api`/`WebFetch` para os casos não cobertos pelo relatório original — Z-API para location/
contact, QuePasa e WPPConnect para as 3 capabilities inteiras):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `messages.sendLocation` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8/8 |
| `messages.sendContactCard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8/8 |
| `messages.sendPoll` | ✅ | ✅ | ✅ | ✅ | ✅ (só escolha única) | ✅ | ✅ | ✅ | 8/8 |

Melhor cobertura da fila até agora — todos os 8 providers confirmam as 3 capabilities, mas com
shapes de request bem heterogêneos entre si (ver Justificativa). Dois achados por provider que a
implementação precisa respeitar:

- **Wuzapi `sendPoll`** (`POST /chat/send/poll`, `handlers.go:2735-2815`): `BuildPollCreation` é
  chamado com `selectableOptionsCount` **hardcoded em `1`** — não existe forma de habilitar múltipla
  escolha neste provider. `allowMultipleAnswers: true` é aceito pelo contrato, mas o adapter ignora
  o campo e documenta a limitação (mesmo critério de "capability parcial documentada" já usado
  outras vezes no projeto, ex. `chats.mute` sem duração em alguns adapters).
- **QuePasa/WPPConnect** não estavam no relatório original da Epic 7 (que focou só no escopo do
  ADR-0012) — confirmados via primária: QuePasa reaproveita o mesmo endpoint já confiável `/send`
  (`api_handlers+SendController.go`, família legacy/v3, **não** a família v5-JWT que motivou a
  recusa de `groups.*`/`contacts.*` no Epic 6) com campos alternativos `poll`/`location`/`contact`
  no lugar de `text`; WPPConnect confirmado via `gh api` em `routes.ts`/`messageController.ts`/
  `deviceController.ts` no commit já usado como referência (`f09e2fed`).

## Decisão

1. **Todos os 3 métodos são opcionais em `MessagesApi`** (mesmo padrão de `edit`/`delete`/
   `forward`/etc.) — nenhum namespace novo, mudança 100% aditiva.
2. **Tipos novos em `src/core/types.ts`**:
   - `SendLocationInput { to, latitude, longitude, name?, address? }` → localização estática (não
     "ao vivo" — nenhum provider pesquisado confirma um endpoint de encerrar/atualizar uma live
     location já enviada).
   - `SendContactCardInput { to, contactName, contactPhone }` — campos soltos, não vCard bruto:
     metade dos providers pesquisados (evolution, uazapi, zapi, quepasa) já aceita campos soltos e
     monta o vCard no servidor; a outra metade (waha, whapi, wuzapi, wppconnect) exige um vCard/
     array já montado — para esses, o próprio adapter monta a string/array a partir destes 2 campos
     (é trabalho de tradução, a mesma responsabilidade que já cabe ao adapter para outras
     capabilities, não uma capability de "vCard genérico" à parte).
   - `SendPollInput { to, question, options, allowMultipleAnswers? }` — `allowMultipleAnswers`
     ausente/`false` = escolha única, o default mais restritivo e mais amplamente suportado (Wuzapi
     só aceita escolha única, sem exceção).
3. **`ConnectorMessagesApi`** ganha os 3 métodos correspondentes, reaproveitando o helper
   `callMessagesMethod` já generalizado no ADR-0012/0013 (nenhum guard-rail novo necessário).
4. **Validação no conector**: `latitude`/`longitude` precisam ser `number` finito;
   `contactName`/`contactPhone` não vazios; `options` precisa ter pelo menos 2 itens (todo provider
   pesquisado rejeita enquete com menos de 2) — `to` normalizado via `normalizeChatId`, mesmo
   tratamento já usado em todo o resto de `messages.*`.

## Justificativa

- **Por que campos soltos em vez de vCard bruto no contrato**: exigir que o CONSUMIDOR monte um
  vCard 3.0 válido (escapando `\n`, `;`, `,`) empurraria complexidade de formatação para fora do
  pacote — o próprio objetivo do waconector é abstrair esse tipo de diferença de provider. Deixar o
  adapter montar (quando o provider exige) mantém a promessa de "adapter faz a tradução,
  consumidor só fala a língua canônica".
- **Por que `allowMultipleAnswers` como booleano opcional, não um enum/contagem**: dos 8 providers,
  só Whapi (`count: 0|1`) e Evolution (`maxAnswer: number`) têm uma escala mais rica que
  binário-sim/não; uazapi/waha reduzem a booleano na prática (`multipleAnswers`/`selectableCount`);
  Wuzapi não suporta de jeito nenhum. Um contrato binário cobre 100% dos casos reais sem forçar o
  consumidor a entender a semântica invertida de `count` do Whapi ou o `maxAnswer` do Evolution —
  cada adapter faz essa tradução internamente.
- **Por que não incluir `SendLocationInput.name` como obrigatório**: WAHA e Z-API exigem um título/
  nome para o pin; Evolution/uazapi/whapi/quepasa tratam como opcional. Manter opcional no contrato
  e deixar os adapters que exigem o campo usarem um default sensato (ex.: string vazia ou o próprio
  endereço) evita penalizar os demais 5 providers.

## Consequências

- Enum de capabilities cresce de 46 para 49.
- Cobertura 8/8 nas 3 capabilities — mas com fidelidade desigual: Wuzapi's `sendPoll` sempre ignora
  `allowMultipleAnswers: true` (limitação real e documentada, não um bug do adapter); adapters que
  montam vCard client-side (Whapi, Wuzapi) ficam sujeitos a qualquer divergência futura de parsing
  de vCard pelo WhatsApp — mitigado usando o mesmo formato mínimo (`FN`/`TEL;type=CELL;waid=`) que o
  Evolution confirma gerar server-side.
- `MockAdapter` implementa os 3 métodos em memória, retornando um novo `SentMessage` sintético
  (mesmo padrão de `forward`, ADR-0013) — sem necessidade de estado adicional (nenhum getter de
  inspeção novo, já que não há um estado "toggle" para consultar, diferente de `star`/`pin`).
- Changeset `minor` — mudança aditiva, sem breaking change.

## Alternativas consideradas

- **Namespace novo `richMessages.*`**: rejeitado — as 3 capabilities são variações de "enviar uma
  mensagem", mesma categoria de `sendText`/`sendMedia`/`sendReaction` já em `MessagesApi`; um
  namespace novo só fragmentaria a API sem ganho de clareza.
- **`SendContactCardInput` aceitar múltiplos contatos num array** (como WAHA e WPPConnect
  suportam nativamente): rejeitado nesta fase — só 2 dos 8 providers confirmam suporte nativo a
  múltiplos contatos numa única mensagem, e os outros 6 seriam forçados a decidir uma semântica não
  documentada (enviar em loop? primeiro item só?). Fica como candidata futura
  (`messages.sendContactCardList`, análogo ao `sendContact`/`sendContactList` do Whapi) se houver
  demanda real — mesmo critério de "não arredondar cobertura" já aplicado no resto do projeto.
- **Enum/união de tipos para `allowMultipleAnswers`** (`'single' | 'multiple' | number`): rejeitado
  em favor do booleano simples — ver Justificativa acima.
