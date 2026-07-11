---
"waconector": minor
---

Novo adapter **Whapi.Cloud** (`waconector/whapi`), F1: `instance.connect`, `instance.status`,
`instance.logout`, `messages.sendText`, `messages.sendMedia`, `webhooks.parse`
(`message.received`/`message.sent`/`message.ack`/`connection.update`). Ver
`docs/providers/whapi.md` para o dossiê completo, incluindo capabilities confirmadas mas ainda não
implementadas nesta fase (`messages.sendReaction`, `instance.pairingCode`, `groups.*`,
`contacts.*`).

Mensagens de mídia recebidas via webhook (`image`/`video`/`document`) agora normalizam a legenda
(`caption`) para `WaMessage.text`, alinhado ao comportamento já existente no adapter Z-API para o
mesmo caso.
