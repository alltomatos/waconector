---
"waconector": minor
---

Adapter Whapi.Cloud ganha `messages.sendReaction`, as 14 operações de `groups.*` (ADR-0009) e as 8
de `contacts.*` (ADR-0010) — de 6/30 para 29/30 capabilities declaradas, só `instance.pairingCode`
segue fora (obstáculo estrutural: `InstanceApi.connect()` não recebe telefone).

Pontos não óbvios do mapeamento:

- `groups.updateSubject`/`updateDescription` usam o MESMO endpoint (`PUT /groups/{GroupID}`,
  `UpdateGroupInfoRequest {subject?, description?}`) — cada operação envia só o campo que lhe
  corresponde, para não sobrescrever silenciosamente o outro.
- `groups.revokeInviteLink`: `DELETE /groups/{GroupID}/invite` só confirma sucesso, sem devolver o
  novo código — o adapter encadeia `DELETE` + `GET /groups/{GroupID}/invite` para devolver o link
  atualizado exigido pelo contrato (exceção documentada a "uma única chamada por operação").
- `Participant.rank` (`admin`/`member`/`creator`) mapeia para `isAdmin`/`isSuperAdmin` (`creator` →
  ambos `true`).
- `contacts.checkExists` usa `HEAD /contacts/{ContactID}`: o resultado vem só do status HTTP
  (`200` = existe, `404` = não existe) — único método deste adapter que intercepta um status
  não-2xx esperado em vez de deixar propagar como erro.
- `contacts.block`/`unblock` usam `ContactIdOrLid` (`/blacklist/{id}`), que aceita só dígitos ou
  `@lid` — o sufixo `@s.whatsapp.net` do chatId canônico é removido antes de montar o path.

Ver `docs/providers/whapi.md` para o dossiê completo dos 23 endpoints.
