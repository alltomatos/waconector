---
"waconector": minor
---

Capability `groups.*` (ADR-0009) ganha as operações de configuração: `wa.groups.updateSubject`,
`wa.groups.updateDescription` (string vazia limpa a descrição) e `wa.groups.updatePicture`
(recebe um `MediaRef`, com `media.kind` obrigatoriamente `'image'`). Implementado nos 5 adapters
existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi) — cada um convertendo o `MediaRef` para o
formato de imagem exigido pelo provider, que nem sempre coincide com o formato aceito por
`messages.sendMedia` no mesmo provider (ex.: Evolution GO/Wuzapi exigem data-URI com prefixo
explícito; Wuzapi só aceita JPEG de fato). Convites/saída (`getInviteLink`/`revokeInviteLink`/
`joinViaInviteLink`/`leaveGroup`) ficam para um PR seguinte (ver ADR-0009).
