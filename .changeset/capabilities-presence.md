---
"waconector": minor
---

Namespace novo `presence.*` (`setTyping`/`set`/`subscribe`) — ver ADR-0015. `WaAdapter.presence?`
inteiramente opcional, mesmo padrão de `chats?` (ADR-0012). Cobre indicador de digitação/gravação
por conversa, presença global da conta (online/offline) e inscrição para receber atualizações de
presença de um contato via webhook.

Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.
