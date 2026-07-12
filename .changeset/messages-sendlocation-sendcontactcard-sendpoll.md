---
"waconector": minor
---

Capabilities novas `messages.sendLocation`, `messages.sendContactCard` e `messages.sendPoll` — ver
ADR-0014. Métodos opcionais em `MessagesApi`, cobrindo o ENVIO dos tipos de conteúdo que
`MessageKind` já classifica na recepção (`'location'`/`'contact'`/`'poll'`) desde a F1.

Mudança 100% aditiva: todos os métodos são opcionais, nenhum adapter existente precisa mudar para
continuar compilando.
