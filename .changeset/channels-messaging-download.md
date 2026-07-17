---
"waconector": minor
---

Capabilities novas `messages.download` e `channels.getMessages`/`markViewed`/`reactToPost` — ver
ADR-0020/ADR-0021. `MessagesApi.download?`/`ChannelsApi.getMessages?`/`markViewed?`/`reactToPost?`
inteiramente opcionais, mesmo padrão dos demais métodos por namespace (ADR-0012/0017). Enum de
capabilities cresce de 68 para 72.

`messages.download` baixa o anexo de uma mensagem já recebida e devolve `{base64, mimeType?,
filename?, raw}` — `DownloadMediaInput.raw` (o `WaMessage.raw` da mensagem original) é consumido
pelos providers stateless (Evolution GO, Whapi, izapia — nenhum deles guarda histórico de mensagens
recebidas server-side), enquanto uazapi resolve só com `messageId`. `MediaRef` ganha um campo novo
`id?: string` (identificador opaco de mídia no provider, populado quando o webhook não entrega
`url`/`base64` prontos).

`channels.getMessages`/`markViewed`/`reactToPost` cobrem o CONTEÚDO dos posts de um canal (`ChannelPost`
novo: `{id, timestamp, text?, viewsCount?, reactionCounts?, raw}`) — lacuna real do namespace
`channels.*` (ADR-0017), que até aqui só cobria metadados do canal.

Cobertura por provider: uazapi e izapia implementam as 4 (68/72 cada, junto com Whapi que implementa
`messages.download`/`channels.getMessages`, 68/72); Evolution GO implementa `messages.download`/
`channels.getMessages` (53/72). Os demais 5 providers (WAHA, Z-API, Wuzapi, QuePasa, WPPConnect)
resolvem mídia recebida por outro mecanismo (URL já pronta no webhook) ou não confirmam suporte —
candidatos a uma rodada futura, não gap de pesquisa.

Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.
