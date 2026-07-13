---
"waconector": minor
---

Namespace novo `calls.*` (`make`/`reject`) — ver ADR-0019. `WaAdapter.calls?` inteiramente
opcional, mesmo padrão de `chats?`/`presence?`/`labels?`/`channels?`/`business?`
(ADR-0012/0015/0016/0017/0018). Cobre chamadas de voz: `make` origina uma "chamada vazia" (só toca,
sem áudio real — uazapi, Z-API); `reject` rejeita uma chamada recebida (WAHA, Whapi, Wuzapi,
Evolution GO, uazapi, WPPConnect). Este é o último item da fila de capabilities novas planejada
(ADR-0013 a ADR-0019).

Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.
