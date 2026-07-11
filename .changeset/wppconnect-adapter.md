---
"waconector": minor
---

Novo adapter **WPPConnect Server** (`waconector/wppconnect`), F3: self-hosted via Docker
(`wppconnect-team/wppconnect-server`, wrapper REST sobre `@wppconnect-team/wppconnect`/Puppeteer).
Capabilities: `instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`
(com suporte a `mentions` via `POST /send-mentioned`), `messages.sendMedia`,
`messages.sendReaction`, 13 operações de `groups.*` (create/getInfo/participantes/subject/
description/picture/invite links/join/leave), `contacts.checkExists`/`block`/`unblock`/
`listBlocked`, `webhooks.parse`
(`message.received`/`message.sent`/`message.ack`/`connection.update`/`group.update`).

Deliberadamente **fora do escopo** nesta fase, com justificativa detalhada em
`docs/providers/wppconnect.md`:

- `instance.pairingCode` **não declarada**: mesmo obstáculo estrutural de todo adapter deste
  pacote — `InstanceApi.connect()` não recebe telefone como parâmetro, e o WPPConnect só produz
  pairing code no momento de criação da sessão (`start-session` com `phone` no body).
- `groups.list`: único endpoint (`GET /all-groups`) marcado como deprecated pelo próprio provider,
  sem shape de resposta confirmado.
- `contacts.list`/`get`/`getProfilePicture`/`getAbout`: endpoints existem, mas nenhum shape de
  resposta foi confirmado pela pesquisa (só a transformação do lado do request).

Achados notáveis documentados no dossiê: o endpoint `POST /create-group` devolve `id`/`name`
aninhados em `groupInfo[0]`, com `id` sem o sufixo `@g.us` esperado pelo resto de `groups.*`
(corrigido no adapter, lendo o array aninhado e reconstruindo o JID); `POST /send-message` e os
endpoints de mídia (`/send-file-base64`, `/send-voice-base64`, `/send-sticker`) devolvem `response`
como um ARRAY de um elemento, não o objeto bare (corrigido no adapter, desembrulhando o array antes
de mapear `id`/`chatId`/`timestamp`); o campo `phone` de envio de mensagem exige a parte LOCAL do
JID (não o JID completo, que produziria um sufixo duplicado no servidor); e `instance.connect()`
com `waitQrCode: true` (padrão) pode travar até o timeout se chamado numa sessão nova sem cliente
registrado — reavaliado como um risco mais estreito que o inicialmente suposto (não afeta
reconexão de sessão já vista antes, ainda não confirmado empiricamente, ver
`WppconnectOptions.waitQrCode`).
