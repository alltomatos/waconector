# ADR-0008: Capability `messages.sendReaction` opcional na interface do adapter

- Status: aceito
- Data: 2026-07-11

## Contexto

F2 previa "capabilities novas: grupos, contatos, reply/quote, reactions". Ao investigar:

- **reply/quote** já estava, na prática, implementado em todos os 5 adapters existentes via o
  campo opcional `quotedId` em `SendTextInput`/`SendMediaInput` — não precisa de capability nova,
  é um parâmetro opcional de um método já gateado (`messages.sendText`/`sendMedia`).
- **reactions** (enviar/receber reação a uma mensagem) não tinha nenhuma superfície no contrato:
  `MessageKind` já incluía `'reaction'` (usado ao parsear mensagens recebidas via webhook), mas não
  havia um jeito de *enviar* uma reação, nem um jeito estruturado de saber qual emoji/mensagem-alvo
  uma reação recebida carrega.
- **grupos** e **contatos** são capabilities muito maiores (múltiplos endpoints novos por
  provider, pesquisa equivalente à de um adapter novo) — tratados como incrementos futuros
  separados, não parte desta decisão.

## Decisão

- Novo tipo `SendReactionInput { to, messageId, emoji }` e `ReactionInfo { emoji, targetMessageId }`
  (este último populando `WaMessage.reaction` quando `kind === 'reaction'`).
- Nova capability `messages.sendReaction` em `CAPABILITIES`.
- `MessagesApi.sendReaction` é **opcional** na interface que o adapter implementa (`sendReaction?`)
  — diferente de `sendText`/`sendMedia` (obrigatórios desde o F0), porque nem todo provider expõe
  reação programática e não faz sentido forçar todo adapter a implementar um método que vai lançar
  incondicionalmente.
- O **conector** expõe `messages.sendReaction` sempre presente (não opcional) via um tipo próprio
  (`ConnectorMessagesApi`, distinto de `MessagesApi`): checa a capability antes de chamar o adapter,
  e se o adapter declarar a capability sem de fato implementar o método (bug do adapter, não do
  chamador), lança `WaConnectorError` com código `PROVIDER_ERROR` — nunca deixa `undefined is not a
  function` vazar pro consumidor.
- Emoji vazio (`''`) segue a convenção do próprio WhatsApp: remove uma reação enviada antes.

## Justificativa

- Mantém o princípio de ADR-0005 (capability declarada = garantia de que o método funciona) sem
  forçar uma mudança breaking em todos os adapters existentes só para adicionar um método que a
  maioria ainda não implementa.
- Reaproveita o `MessageKind: 'reaction'` que já existia em vez de criar um novo tipo de evento
  canônico — reações recebidas continuam chegando via `message.received`/`message.sent`, só com
  `WaMessage.reaction` populado.

## Consequências

- Qualquer capability futura que nem todo provider suporte deve seguir o mesmo padrão: método
  opcional em `MessagesApi`/`InstanceApi`, exposto sempre presente no `Connector*Api`
  correspondente, com o mesmo guard-rail de `PROVIDER_ERROR` para capability-sem-implementação.
- A suite de contrato compartilhada (`test/contract/adapter-contract.ts`) testa
  `messages.sendReaction` condicionalmente (`ctxTest.skip()` quando o adapter não declara a
  capability) — mesmo padrão deve ser usado para `groups.*`/`contacts.*` quando chegarem.
- Nenhum dos 5 adapters existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi) declarava
  `messages.sendReaction` no momento deste ADR — retrofit é trabalho de acompanhamento, adapter por
  adapter, só onde o provider de fato documentar/suportar reação programática.
