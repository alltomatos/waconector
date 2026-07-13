# ADR-0019: Namespace `calls.*` (`make`/`reject`)

- Status: aceito
- Data: 2026-07-13

## Contexto

Sétimo e último item da fila de capabilities novas (ver ADR-0013 a ADR-0018 para os seis
primeiros). O plano original já sinalizava esta como "a menor de todos": `calls.reject` citado como
"o mais confirmado (uazapi, Whapi, Z-API, Wuzapi, WAHA)"; `calls.send`/`make` (originar chamada)
como "cobertura mais fraca — avaliar se entra nesta PR ou fica de fora por baixa confiança".
Reconfirmação de escopo (releitura dos 8 relatórios salvos + verificação ao vivo via `gh api`/
arquivos já cacheados para Evolution GO/QuePasa/WPPConnect, que o research original não tinha
investigado explicitamente para este tópico):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls.make` | — | — | ✅ | ✅ | — | — | — | — | 2/8 |
| `calls.reject` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | 6/8 |

**Correção importante em relação à estimativa do plano original**: o plano listava Z-API entre os
confirmados para `calls.reject` — pesquisa mais cuidadosa mostra que os únicos campos
relacionados na Z-API (`callRejectAuto`/`callRejectMessage`, em `GET /me`) são uma CONFIGURAÇÃO de
conta (auto-rejeição automática + mensagem enviada), não uma ação "rejeitar ESTA chamada" invocável
sob demanda — corrigido para 0/2 nesta ADR (ver seção Z-API abaixo).

**`calls.make` é sempre uma "chamada vazia", nunca uma chamada de voz real** — nuance universal
confirmada nos 2 providers que a suportam (uazapi, Z-API): o telefone do contato toca normalmente,
mas nenhum áudio é de fato estabelecido em nenhuma direção. Ambos os providers usam essa capability
tipicamente para notificar/"acordar" um contato ou testar liveness da conexão, não para uma
chamada de verdade — consistente com a limitação estrutural de que nenhum cliente não-oficial do
WhatsApp consegue originar chamadas de voz/vídeo reais via protocolo.

**uazapi 2/2, confiança Alta** — `POST /call/make` (body `{number, call_duration?}`) e
`POST /call/reject` (body `{number?, id?}`, **ambos opcionais** — corpo vazio `{}` é o uso
recomendado pela própria doc, rejeita a chamada ativa no momento sem precisar identificá-la).
Único provider desta ADR onde `reject` não exige nenhum campo.

**Z-API 1/2 (só `make`), achado ao vivo que corrige a estimativa original do plano** —
`POST /instances/{id}/token/{token}/send-call`, confiança Média-Alta, payload real confirmado
(`{phone, callDuration?, callAudioUrl?}` → `{zaapId, messageId, id}`). Sem `calls.reject`: ver
correção acima — os campos candidatos são uma configuração de conta, não uma ação.

**WAHA, Whapi, Wuzapi, Evolution GO, WPPConnect: `calls.reject` confirmado, mas com uma limitação
prática universal** — todos os 5 exigem `callId` (e, exceto WPPConnect, também `callerId`) para
identificar QUAL chamada rejeitar. Esses campos só vêm, na prática, do payload de um webhook de
chamada recebida (`call.received`/evento `"Call"`/`CallOffer`) — **nenhum adapter deste pacote faz
parsing desse evento hoje** (cai em `unknown` em todos eles). Isso NÃO impede a declaração da
capability (ver Decisão/Alternativas): o consumidor ainda pode inspecionar o payload bruto do
webhook recebido (via `WebhookInput.body`, sempre repassado intacto) para extrair `callId`/`from`
usando a documentação do provider — o mesmo padrão já aceito para `groups.joinViaInviteLink`
(o invite link normalmente vem de fora do pacote, não é gerado por ele).

- **WAHA**: `POST /api/{session}/calls/reject`, schema `RejectCallRequest {from, id}`, confiança
  Média (schema confirmado no `openapi.json`, sem página de doc dedicada).
- **Whapi**: `DELETE /calls/{CallID}` (`operationId: rejectCall`, confiança Alta; existe uma rota
  duplicada e obsoleta `POST /calls/{CallID}/reject`, `rejectCallDeprecated`, não usada), body
  `RejectCallRequest {callFrom}`.
- **Wuzapi**: `POST /call/reject`, confiança Alta no endpoint / Média na usabilidade, body em
  **snake_case** (diferente do resto da API): `{call_from, call_id}`.
- **Evolution GO, achado ao vivo (não estava no relatório original)**: `POST /call/reject`,
  confirmado em `call_handler.go`/`call_service.go`. Body `RejectCallStruct {callCreator:
  types.JID, callId: string}` — `callCreator` é serializado como STRING simples, mesmo achado já
  documentado para `channels.*` (ADR-0017): `types.JID` implementa `MarshalText`/`UnmarshalText`.
  `CallService` só expõe `RejectCall` — nenhum método para originar chamada.
- **WPPConnect, achado ao vivo (não estava no relatório original)**: `POST /api/{session}/reject-call`
  (`DeviceController.rejectCall`), body `{callId}` — **único provider onde só `callId` é exigido**,
  sem `callerId` (`req.client.rejectCall(callId)`, um único argumento).

**QuePasa: 0/2, busca negativa confirmada ao vivo** — `whatsmeow_handlers.go` (já cacheado) mostra
que chamadas recebidas viram uma MENSAGEM sintética (`whatsapp.CallMessageType`) roteada pelo MESMO
pipeline de webhook de mensagens, e a rejeição é AUTOMÁTICA via uma flag de config
(`HandleCalls()`/`server_options`, migração `add_rr_rc`) — a menos que um "VoIP Manager" esteja
habilitado (aí a chamada é respondida e ponte para SIP). Não existe nenhum endpoint HTTP para o
consumidor originar ou rejeitar uma chamada especificamente sob demanda — comportamento passivo do
servidor, não uma ação invocável. Limitação real, não gap de pesquisa.

## Decisão

1. **Namespace novo `WaAdapter.calls?: CallsApi`, inteiramente OPCIONAL** — mesmo padrão de
   `chats?`/`presence?`/`labels?`/`channels?`/`business?` (ADR-0012/0015/0016/0017/0018): os 2
   métodos também opcionais dentro da interface.
2. **Tipos novos em `src/core/types.ts`**:
   - `MakeCallInput { to, durationSeconds? }` — `to` é o chatId canônico (normalizado pelo
     conector), `durationSeconds` opcional (não validado contra limites do provider, ex.: máx 15s
     documentado na Z-API — deixado para o provider rejeitar).
   - `RejectCallInput { callId?, callerId? }` — ambos opcionais no TIPO (a obrigatoriedade real
     varia por provider, ver Decisão #5); `callerId` não é opaco (normalizado como chatId comum),
     `callId` é opaco (identificador de chamada específico do provider).
3. **`CallsApi`**:
   ```ts
   interface CallsApi {
     make?(input: MakeCallInput): Promise<void>;
     reject?(input: RejectCallInput): Promise<void>;
   }
   ```
4. **`ConnectorCallsApi`** — todo método sempre presente (namespace resolvido no conector), gateado
   por capability + guard-rail `PROVIDER_ERROR` via um novo `callCallsMethod`, réplica exata de
   `callBusinessMethod`/`callChannelsMethod`.
5. **Validação de `callId`/`callerId` fica no ADAPTER, não no conector** — diferente da maioria das
   validações deste pacote (centralizadas no conector por serem regras universais), a
   obrigatoriedade desses 2 campos é GENUINAMENTE por-provider: uazapi não exige nenhum, WPPConnect
   só exige `callId`, os demais 4 exigem ambos. O conector só normaliza `callerId` (quando
   presente) como chatId comum e rejeita string vazia; cada adapter que precisa dos campos lança
   `INVALID_INPUT` se estiverem ausentes.
6. **`make`/`reject` retornam `Promise<void>`** — nenhum provider tem uma capability de
   acompanhamento que precise do id da chamada de volta (não há `calls.getStatus`/`calls.end` nesta
   rodada); mesmo critério de simplicidade já usado em outras ADRs quando não há follow-up
   necessário.

## Justificativa

- **Por que declarar `calls.reject` mesmo quando `callId`/`callerId` só vêm de um webhook não
  parseado**: o pacote nunca esconde o payload bruto do webhook recebido
  (`WebhookInput.body`/`rawBody` sempre repassados intactos ao consumidor, mesmo quando
  `parseWebhook` não reconhece o formato e devolve um evento `unknown`) — um consumidor motivado
  pode extrair `callId`/`from` inspecionando esse payload com a documentação do provider, e então
  usar `calls.reject` normalmente. Mesmo padrão de "capability real mesmo com input vindo de fora
  do pacote" já aceito para `groups.joinViaInviteLink` (o link normalmente chega por
  compartilhamento externo, não é gerado pelo waconector). Adicionar parsing de `call.received`
  nesta mesma ADR foi considerado e rejeitado por escopo (ver Alternativas).
- **Por que a Z-API perdeu `calls.reject` da estimativa original**: `callRejectAuto`/
  `callRejectMessage` (vistos em `GET /me`) são uma CONFIGURAÇÃO de conta (toggle de
  auto-rejeição + mensagem canned), não uma ação — descoberto ao cruzar esses campos com o padrão
  real de "configuração vs. ação" já estabelecido nas demais capabilities deste pacote.
- **Por que a validação de `callId`/`callerId` fica no adapter, não no conector**: ao contrário de
  `business.updateProfile` (ao menos 1 campo — regra universal, mesma para todo provider), aqui a
  obrigatoriedade dos 2 campos VARIA genuinamente por provider (uazapi: nenhum; WPPConnect: só
  `callId`; os outros 4: ambos) — não há uma regra única que sirva para todos, então cada adapter
  valida o que ele especificamente precisa.
- **Por que `MakeCallInput` não expõe `callAudioUrl`** (Z-API): feature paga/opt-in adicional, "só
  funciona para contas que possuem a funcionalidade de chamadas habilitada" — não confirmada
  universal, mesmo critério de excluir campos provider-específicos não confirmados amplamente já
  usado em ADRs anteriores (ex.: `CreateChannelInput` sem `picture`, ADR-0017).

## Consequências

- Enum de capabilities cresce de 66 para 68 — **o pacote fecha a fila planejada com todos os 7
  itens implementados** (ADR-0013 a ADR-0019).
- Cobertura assimétrica entre os 2 métodos: `calls.make` só 2/8 (uazapi, Z-API — limitação
  estrutural real, nenhum cliente não-oficial origina chamadas de voz/vídeo reais);
  `calls.reject` 6/8 (todos exceto Z-API e QuePasa).
- `MockAdapter` implementa os 2 métodos como no-ops mínimos (`assertConnected` + resolve), mesmo
  padrão já usado por `messages.delete` (nenhum estado persistente natural para uma ação
  transiente como "fazer/rejeitar uma chamada").
- Changeset `minor` — mudança aditiva, sem breaking change.
- Caveat documentado (não resolvido, por design): `calls.reject` em 5 dos 6 providers que a
  implementam exige `callId`/`callerId` que só são obteníveis, na prática, inspecionando o payload
  bruto de um webhook de chamada recebida — este pacote não faz parsing desse evento nesta rodada
  (fica como candidata futura, ver Alternativas).

## Alternativas consideradas

- **Adicionar parsing de `call.received` (um `CanonicalEventType`/evento novo) nesta mesma ADR**:
  rejeitado — expandiria significativamente o escopo desta que é deliberadamente "a menor" da fila
  (novo tipo de evento canônico, mapeamento em até 6 adapters, testes de webhook por provider) sem
  necessidade imediata (o payload bruto já está disponível ao consumidor via `WebhookInput`). Fica
  como candidata clara para uma ADR futura dedicada a eventos de chamada.
- **Declinar `calls.reject` nos 5 providers que exigem `callId`/`callerId` de um webhook não
  parseado, implementando só a variante uazapi (sem exigência de campos)**: rejeitado — o endpoint
  é real e confirmado com boa confiança em todos os 5; o "rough edge" de precisar inspecionar o
  payload bruto do webhook é modesto e já tem precedente aceito (`groups.joinViaInviteLink`), não
  justifica descartar 5 implementações reais e válidas.
- **Expor os campos crus do webhook de chamada como parte do retorno de algum outro método**:
  rejeitado — não haveria um método natural para "consultar chamadas pendentes" nesta rodada; o
  caminho correto continua sendo o consumidor inspecionar `WebhookInput.body` diretamente.
- **Validar `callId`/`callerId` centralizadamente no conector com uma regra "ao menos 1 obrigatório
  em todo provider"**: rejeitado — factualmente incorreto (uazapi aceita corpo totalmente vazio),
  quebraria o único caso de uso mais simples e melhor documentado desta ADR.
