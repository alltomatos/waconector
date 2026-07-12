---
"waconector": minor
---

Capabilities novas `messages.forward`, `messages.star`/`unstar`, `messages.pin`/`unpin` e
`messages.markRead` — ver ADR-0013. Métodos opcionais em `MessagesApi`, mesmo padrão de
`messages.edit`/`delete` (ADR-0012). `messages.pin`/`unpin`/`markRead` operam no nível de UMA
mensagem, distintos de `chats.pin`/`unpin`/`markRead` (nível de conversa, já existentes).

Mudança 100% aditiva: todos os métodos são opcionais, nenhum adapter existente precisa mudar para
continuar compilando.
