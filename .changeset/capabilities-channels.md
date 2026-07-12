---
"waconector": minor
---

Namespace novo `channels.*` (`list`/`create`/`getInfo`/`delete`/`follow`/`unfollow`) — ver
ADR-0017. `WaAdapter.channels?` inteiramente opcional, mesmo padrão de `chats?`/`presence?`/
`labels?` (ADR-0012/0015/0016). Cobre canais do WhatsApp ("WhatsApp Channels" — nome público do
produto; a maioria dos providers chama de "newsletter" internamente): listar, criar, consultar,
apagar e seguir/deixar de seguir um canal. `channelId` é um valor opaco (mesmo critério de
`groupId`/`labelId`).

Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.
