---
"waconector": minor
---

Novo adapter **QuePasa** (`waconector/quepasa`), F3: self-hosted via Docker
(`nocodeleaks/quepasa`, sobre `tulir/whatsmeow`). Capabilities: `instance.status`,
`instance.logout` (soft-stop — preserva credenciais, não é um logout de verdade),
`messages.sendText`, `messages.sendMedia`, `groups.getInviteLink`,
`contacts.getProfilePicture`, `webhooks.parse`
(`message.received`/`message.sent`/`message.ack`/`connection.update`/`group.update`).

Deliberadamente **fora do escopo** nesta fase, com justificativa detalhada em
`docs/providers/quepasa.md`:

- `instance.connect`/`instance.pairingCode` **não declaradas**: o endpoint de QR (`GET /scan`)
  devolve uma imagem PNG binária crua (não JSON com base64, diferente de todo outro adapter deste
  pacote) — o `HttpClient` atual decodifica respostas não-JSON como texto UTF-8, o que corrompe
  bytes binários de forma irreversível. Corrigir isso de verdade exigiria um modo de resposta
  binária/`ArrayBuffer` no core, fora do escopo desta fase.
- `messages.sendReaction`, `groups.*` (além de `getInviteLink`) e `contacts.*` (além de
  `getProfilePicture`): o snapshot mais recente examinado tem uma API v5 completa para os três, mas
  gated por sessão de usuário via JWT — incompatível com o token por instância que este adapter usa.
  Não é ausência do recurso no provider, é incompatibilidade de modelo de autenticação — ver
  `docs/providers/quepasa.md`.
- `messages.sendMedia` com `kind: 'sticker'` lança `INVALID_INPUT`: o QuePasa não tem tipo de
  mensagem de figurinha (viraria um documento genérico, não uma figurinha de verdade).

O repositório oficial (`github.com/nocodeleaks/quepasa`) está bloqueado no GitHub por um aviso de
DMCA não relacionado a mensagens/webhooks (módulo de VoIP) — a pesquisa foi feita em três
forks/mirrors não bloqueados, com alta confiança de fidelidade ao código-fonte real. Todas as
fixtures de webhook são reconstruídas a partir das definições de struct Go confirmadas (nenhum
payload de tráfego real foi encontrado na pesquisa) — ver `docs/providers/quepasa.md` para o
detalhamento de confiança por seção.
