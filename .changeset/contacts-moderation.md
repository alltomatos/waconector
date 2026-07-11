---
"waconector": minor
---

Capability `contacts.*` (ADR-0010) ganha as operações de moderação: `wa.contacts.block`,
`wa.contacts.unblock` e `wa.contacts.listBlocked`. Implementado nos 5 adapters existentes (WAHA,
Evolution GO, uazapi, Z-API, Wuzapi) — **WAHA e Z-API não declaram `contacts.listBlocked`**, por
não exporem nenhum endpoint de listagem de bloqueados em suas documentações oficiais (Z-API
distinguido conscientemente de `privacy/get-disallowed-contacts`, uma blacklist de privacidade
diferente da lista de contatos efetivamente bloqueados). `block`/`unblock` são suportados pelos 5.

Isso fecha as 8 operações request-response originalmente escopadas para `contacts.*` (descoberta,
perfil e moderação). `getPresence` segue fora do escopo — majoritariamente assíncrono/webhook em 4
dos 5 providers — tratado como incremento futuro separado (ver ADR-0010).
