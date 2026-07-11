---
"waconector": minor
---

Nova capability `groups.*` (ADR-0009) — núcleo + participantes: `wa.groups.create`,
`wa.groups.getInfo`, `wa.groups.list`, `wa.groups.addParticipants`, `wa.groups.removeParticipants`,
`wa.groups.promoteParticipants`, `wa.groups.demoteParticipants`. Implementado nos 5 adapters
existentes (WAHA, Evolution GO, uazapi, Z-API, Wuzapi), cada um traduzindo `groupId` (identificador
opaco — a Z-API usa um ID sintético que não é um JID) e a lista de participantes para o formato
nativo do provider. Configurações de grupo (nome/descrição/foto) e convites/saída ficam para PRs
seguintes (ver ADR-0009).
