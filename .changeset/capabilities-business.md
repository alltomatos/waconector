---
"waconector": minor
---

Namespace novo `business.*` (`getProfile`/`updateProfile`) — ver ADR-0018. `WaAdapter.business?`
inteiramente opcional, mesmo padrão de `chats?`/`presence?`/`labels?`/`channels?`
(ADR-0012/0015/0016/0017). Cobre o perfil comercial WhatsApp Business (endereço, e-mail, sites,
categorias) — leitura e atualização parcial (`description`/`address`/`email`), sem catálogo/
produtos nesta rodada.

Mudança 100% aditiva: nenhum adapter existente precisa mudar para continuar compilando.
