# ADR-0009: Capability `groups.*` — contrato de gestão de grupo

- Status: aceito (núcleo + participantes implementado; configurações e convites/saída
  planejados como incrementos separados — ver "Consequências")
- Data: 2026-07-11

## Contexto

F2 listava "grupos, contatos" como capabilities grandes, tratadas como incrementos futuros
separados (ver ADR-0008). Antes de implementar, uma pesquisa dedicada (workflow com 1 agente por
provider, mesma metodologia rigorosa usada para `messages.sendReaction`) investigou 14 operações
de gestão de grupo nos 5 adapters existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi):
`createGroup`, `getGroupInfo`, `listGroups`, `addParticipants`, `removeParticipants`,
`promoteParticipants`, `demoteParticipants`, `updateSubject`, `updateDescription`,
`updatePicture`, `getInviteLink`, `revokeInviteLink`, `joinViaInviteLink`, `leaveGroup` — mais a
existência de eventos de webhook de atualização de grupo (o tipo `GroupUpdateEvent` já existe em
`src/core/events.ts`, mas nenhum adapter o popula hoje).

### Achados principais

- **Cobertura excepcionalmente completa**: todas as 14 operações têm endpoint HTTP confirmado
  (confidence alta) em **todos os 5 adapters** — diferente de `sendReaction`, aqui não há nenhum
  provider que careça de suporte nativo.
- **Colapso de rotas é a norma, não exceção**: em 3 dos 5 providers (Evolution GO, uazapi, Wuzapi),
  `addParticipants`/`removeParticipants`/`promoteParticipants`/`demoteParticipants` são **UM único
  endpoint** (`POST /group/participant[s]`) discriminado por um campo `action`
  (`add`/`remove`/`promote`/`demote`). Em 3 dos 5 (Evolution GO, uazapi, Wuzapi), `getInviteLink` e
  `revokeInviteLink` também são o **mesmo endpoint**, discriminado por um flag `reset`. Só WAHA e
  Z-API têm rotas de fato separadas para todas as operações. O contrato canônico expõe as 4 (e as
  2) operações como métodos distintos — colapsar em uma chamada HTTP interna é responsabilidade
  de cada adapter (`WaAdapter` é "burro", só traduz).
- **Z-API tem um formato de ID de grupo fundamentalmente diferente dos outros 4**: WAHA, Evolution
  GO, uazapi e Wuzapi usam o JID padrão do protocolo (`<dígitos>@g.us`) — o mesmo formato que
  `isGroupChatId`/`normalizeChatId` (`src/core/chat-id.ts`) já reconhecem. **Z-API usa um
  identificador sintético sem `@`**: `"{idNumérico}-group"` (atual, desde 2021-11-04) ou o legado
  `"{telefoneCriador}-{timestampUnix}"`. Isso é uma armadilha real: `normalizeChatId` roteia
  qualquer string sem `@` para `digitsOnly()`, que **removeria o sufixo `-group`** e corromperia o
  ID. Grupo, portanto, **não pode reusar cegamente `normalizeChatId`** — precisa de um tipo próprio
  (`GroupId` opaco, sem normalização automática no conector) com cada adapter fazendo seu próprio
  map-out, análogo ao que `toZapiPhone`/`toWahaChatId` já fazem para chatId de mensagem.
- **Confiança desigual nos webhooks de atualização de grupo** (o que popularia
  `GroupUpdateEvent`): WAHA tem payloads reais documentados (`group.v2.join/leave/participants/
  update`, confidence alta). Evolution GO e Wuzapi (ambos baseados em whatsmeow) têm o formato
  reconstruído a partir do código-fonte da lib subjacente (mesma metodologia já usada no projeto
  para outros payloads "RECONSTRUÍDO", mas sem exemplo real capturado). uazapi confirma que a
  *categoria* de evento existe, mas não tem nenhum exemplo de payload em lugar nenhum da doc
  (confidence baixa no formato). Z-API não tem endpoint de config dedicado — eventos de grupo
  chegam pelo MESMO webhook de mensagem (`ReceivedCallback`), discriminados por um campo
  `notification` (`GROUP_CHANGE_SUBJECT`, `GROUP_PARTICIPANT_ADD`, ...), com exemplo literal só
  para 2 dos 10 valores do enum.
- **Foto de grupo é mais restrita que mídia de mensagem no mesmo provider**: Evolution GO e Wuzapi
  aceitam qualquer formato de imagem em `messages.sendMedia`, mas seus endpoints de foto de GRUPO
  checam o magic number e só aceitam JPEG (rejeitam PNG/GIF/WEBP apesar da mensagem de erro do
  próprio provider sugerir o contrário) — particularidade a documentar por adapter, não a impor no
  core.
- **Nomes de campo/operação divergem bastante do termo canônico** (ex.: `promoteParticipants` é
  `add-admin` na Z-API, `updateSubject` é `updateGroupName`/`/group/updateName` na uazapi, várias
  operações em Evolution GO/Wuzapi não aparecem na doc oficial e só foram confirmadas lendo
  código-fonte) — mapeamento de nomes é trabalho de implementação por adapter, não do core.

## Decisão

1. **Novo namespace `GroupsApi`**, análogo a `InstanceApi`/`MessagesApi`, exposto como `wa.groups.*`
   no conector via um `ConnectorGroupsApi` sempre presente (mesmo padrão dual do ADR-0008).
2. **Toda operação de `GroupsApi` é opcional na interface do adapter** (`createGroup?`,
   `getInfo?`, ...) — mesmo as 14 sendo suportadas por todos os 5 adapters atuais. Motivo: F3 vai
   trazer Whapi/Zapo/QuePasa, que podem não cobrir tudo; declarar mandatório agora e quebrar depois
   seria uma mudança breaking evitável. Cada operação vira sua própria capability
   (`groups.create`, `groups.getInfo`, `groups.list`, `groups.addParticipants`,
   `groups.removeParticipants`, `groups.promoteParticipants`, `groups.demoteParticipants`,
   `groups.updateSubject`, `groups.updateDescription`, `groups.updatePicture`,
   `groups.getInviteLink`, `groups.revokeInviteLink`, `groups.joinViaInviteLink`, `groups.leave`),
   gateada + `PROVIDER_ERROR` de guard-rail, igual `messages.sendReaction`.
3. **`GroupId` é um tipo opaco (`string`)**, sem passar por `normalizeChatId`. O conector só valida
   não-vazio; a tradução para o formato nativo do provider (JID `@g.us` ou o ID sintético da Z-API)
   é 100% responsabilidade do map-out de cada adapter.
4. **Tipos novos em `src/core/types.ts`**: `GroupParticipant { id, isAdmin, isSuperAdmin }`,
   `GroupInfo { id, subject, description?, owner?, participants: GroupParticipant[], raw }`,
   `CreateGroupInput { subject, participants }`, `InviteLink { link }`. `raw` sempre presente
   (ADR-0002).
5. **Webhooks de grupo tratados à parte**: popular `GroupUpdateEvent` é trabalho subsequente à
   implementação dos métodos de envio, condicionado a validar o payload contra uma instância real
   quando a confiança da pesquisa for média/baixa (uazapi, e os 8/10 valores não-exemplificados de
   `notification` na Z-API) — não travar um parser em produção com base só em reconstrução.

## Consequências

- Escopo é grande o suficiente (14 operações × 5 adapters + parsing de webhook) para ser entregue
  em fatias, não um único PR monolítico. Fatiamento confirmado com o usuário:
  1. **PR1 (implementado)**: núcleo + participantes — `create`, `getInfo`, `list`,
     `addParticipants`, `removeParticipants`, `promoteParticipants`, `demoteParticipants`.
  2. **PR2 (pendente)**: configurações — `updateSubject`, `updateDescription`, `updatePicture`.
  3. **PR3 (pendente)**: convites + saída — `getInviteLink`, `revokeInviteLink`,
     `joinViaInviteLink`, `leaveGroup`.
  4. **Webhooks de grupo (pendente, incremento à parte)**: popular `GroupUpdateEvent` — confiança
     desigual por provider (WAHA alta, Evolution GO/Wuzapi reconstruída, uazapi e 8/10 tipos da
     Z-API baixa) exige validação contra instância real antes de travar parsers em produção.
- Segue o padrão já estabelecido: capability opcional no adapter, sempre presente no `Connector*Api`
  correspondente, guard-rail `PROVIDER_ERROR` (ADR-0008) — reaproveitado, não uma decisão nova.
- Qualquer adapter futuro (F3+) que não suporte uma operação de grupo simplesmente não a declara em
  `capabilities` — nenhuma mudança de contrato necessária.
- `docs/providers/<nome>.md` de cada adapter ganhou uma seção "Grupos (núcleo)" nova, com os desvios
  de nomenclatura/rota levantados na pesquisa (ex.: endpoint compartilhado com discriminador de
  ação, `groupId` opaco — nota crítica na Z-API, cujo ID sintético não é um JID).
