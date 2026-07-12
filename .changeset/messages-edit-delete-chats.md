---
"waconector": minor
---

Novo namespace `chats.*` (`archive`/`unarchive`, `mute`/`unmute`, `pin`/`unpin`, `markRead`/
`markUnread`) e capabilities `messages.edit`/`messages.delete` — ver ADR-0012 para o desenho
completo e a justificativa de `chats` ser um campo OPCIONAL em `WaAdapter` (diferente do
precedente de `groups`/`contacts`, que são campos obrigatórios).

Mudança 100% aditiva: `WaAdapter.chats?` é opcional, `MessagesApi.edit?`/`delete?` são opcionais,
e as 10 novas entradas em `CAPABILITIES` são apenas adições à union — nenhum adapter existente
(próprio ou de terceiros) precisa mudar para continuar compilando.
