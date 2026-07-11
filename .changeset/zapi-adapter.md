---
"waconector": minor
---

Adapter **Z-API** (`waconector/zapi`) — segundo provider da fase F2, SaaS brasileiro (auth via
`instanceId`+`token` embutidos na URL, sem `Authorization: Bearer`). Implementa
`instance.connect/status/logout`, `messages.sendText/sendMedia` (incluindo `sticker`) e
`webhooks.parse`, com dossiê próprio em `docs/providers/zapi.md` e testes de contrato. Sem
endpoint de criação de instância documentado (provisionamento é só via painel).
