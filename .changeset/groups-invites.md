---
"waconector": minor
---

Capability `groups.*` (ADR-0009) ganha as operações de convite e saída: `wa.groups.getInviteLink`,
`wa.groups.revokeInviteLink`, `wa.groups.joinViaInviteLink` e `wa.groups.leaveGroup`. Implementado
nos 5 adapters existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi).

O link de convite é sempre normalizado para o formato completo (`https://chat.whatsapp.com/<código>`),
mesmo quando o provider devolve só o código bare (ex.: WAHA) — via novas funções
`normalizeInviteLink`/`extractInviteCode` em `src/core/chat-id.ts`, reutilizáveis por qualquer
adapter. `joinViaInviteLink` aceita tanto o código bare quanto o link completo do chamador.

Isso fecha as 14 operações originalmente escopadas para `groups.*` (núcleo, participantes,
configurações, convites/saída). Webhooks de atualização de grupo (`GroupUpdateEvent`) seguem como
incremento separado (ver ADR-0009).
