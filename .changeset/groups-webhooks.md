---
"waconector": minor
---

Webhooks de atualização de grupo (ADR-0009): `GroupUpdateEvent` (já existente, mas não usado) agora
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
