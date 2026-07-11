---
"waconector": minor
---

Adapter **uazapi** (`waconector/uazapi`) — primeiro provider da fase F2, SaaS multi-tenant
(auth via header `token` de instância). Implementa `instance.connect/status/logout`,
`messages.sendText/sendMedia` e `webhooks.parse`, com dossiê próprio em `docs/providers/uazapi.md`
e testes de contrato. Ver o dossiê para suposições não validadas contra uma instância real
(formato exato do envelope de webhook e do campo `messageType`).
