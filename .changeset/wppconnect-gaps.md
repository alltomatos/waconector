---
"waconector": minor
---

Adapter WPPConnect Server ganha `groups.list` e as 4 operações restantes de `contacts.*`
(`list`/`get`/`getProfilePicture`/`getAbout`) — de 24/30 para 29/30 capabilities declaradas, só
`instance.pairingCode` segue fora (obstáculo estrutural: `InstanceApi.connect()` não recebe
telefone).

As 5 eram listadas como fora de escopo por "shape de resposta não confirmado" numa auditoria
anterior que olhou só o controller fino do `wppconnect-server`. Descendo à lib subjacente
(`@wppconnect-team/wppconnect`), o shape de resposta de todas está tipado ou visível no script
injetado — nenhuma é limitação real do provider.

Pontos não óbvios do mapeamento:

- `groups.list` usa `POST /list-chats` com `{onlyGroups: true}`, não `GET /all-groups`
  (confirmado `#swagger.deprecated` — "Deprecated in favor of 'list-chats'"). O `Chat` devolvido
  pela lib não carrega participantes — `GroupInfo.participants` fica `[]` de propósito para todo
  item da listagem; quem precisar da lista completa encadeia `groups.getInfo` por grupo.
- `contacts.list`/`contacts.get` reaproveitam o mesmo shape (`WAPI._serializeContactObj`, visível
  no script injetado `get-all-contacts.js`/`get-contact.js`) — confiança média-alta, por vir de um
  script injetado real, não da interface TS tipada diretamente da lib.
- `contacts.getProfilePicture` prioriza `imgFull` sobre `img` (mesmo padrão "prefira a versão
  full" já usado por outros adapters deste pacote, ex.: Whapi).
- `contacts.getAbout` mapeia `status` → `about`; string vazia vira `undefined` (nunca inventa um
  recado).

Ver `docs/providers/wppconnect.md` para o dossiê atualizado.
