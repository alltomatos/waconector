---
"waconector": minor
---

Namespace novo `labels.*` (`list`/`create`/`update`/`delete`/`addToChat`/`removeFromChat`) — ver
ADR-0016. `WaAdapter.labels?` inteiramente opcional, mesmo padrão de `chats?`/`presence?`
(ADR-0012/0015). Cobre etiquetas estilo WhatsApp Business: CRUD de labels e associação/desassociação
a uma conversa. `color` é um valor opaco (cada provider usa um vocabulário de cor diferente).

Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.
