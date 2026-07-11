---
"waconector": minor
---

Adapter **Wuzapi** (`waconector/wuzapi`) — terceiro e último provider planejado da fase F2,
self-hosted (construído sobre `tulir/whatsmeow`, mesma lib do Evolution GO). Implementa
`instance.connect/status/logout`, `messages.sendText/sendMedia` e `webhooks.parse`, com dossiê
próprio em `docs/providers/wuzapi.md` (pesquisado direto no código-fonte Go, com várias
divergências doc-vs-código documentadas) e testes de contrato.
