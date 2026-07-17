---
"waconector": minor
---

Adapter **izapia** (`waconector/izapia`) — nono provider suportado, SaaS multi-tenant próprio
construído sobre `tulir/whatsmeow` (auth via `Authorization: Bearer <apiKey>`, sessão identificada
por `sid`). Cobertura mais ampla entre todos os adapters deste pacote: 64/68 capabilities —
`instance.connect/status/logout`, `messages.*` (exceto `forward`, sem endpoint compatível com o
contrato), `groups.*` completo, `contacts.*` completo, `chats.*` completo, `presence.*` completo,
`labels.*` completo, `channels.*` (exceto `delete`, `501 NOT_IMPLEMENTED` hoje), `business.getProfile`
(sem `updateProfile`, mesmo motivo) e `calls.*`, com dossiê próprio em `docs/providers/izapia.md` e
testes de contrato.
