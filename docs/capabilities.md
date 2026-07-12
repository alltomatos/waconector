<!--
  GERADO AUTOMATICAMENTE por `npm run docs:capabilities` (scripts/generate-capabilities-matrix.mjs).
  NÃO EDITE ESTE ARQUIVO À MÃO — suas mudanças serão sobrescritas na próxima geração.
  Fonte da verdade: CAPABILITIES (src/core/capabilities.ts) + `.capabilities` de cada fábrica de
  adapter (src/adapters/<provider>/index.ts). Ver ADR-0005.
-->

# Matriz de capabilities

Gerada a partir do código: ✅ significa que `adapter.capabilities` do provider inclui aquela
capability (fábrica chamada com opções fake, sem rede real — mesma técnica do smoke test).
Nenhuma linha aqui é escrita à mão.

## Resumo por provider

- **waha**: 28/30
- **evolution**: 29/30
- **uazapi**: 28/30
- **zapi**: 28/30
- **wuzapi**: 29/30
- **whapi**: 29/30
- **quepasa**: 7/30
- **wppconnect**: 29/30

## Detalhe por namespace

### `instance.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `instance.connect` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `instance.pairingCode` | — | — | — | — | — | — | — | — |
| `instance.status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instance.logout` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### `messages.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `messages.sendText` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendMedia` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendReaction` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |

### `groups.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `groups.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.getInfo` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.addParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.removeParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.promoteParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.demoteParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.updateSubject` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.updateDescription` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.updatePicture` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.getInviteLink` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `groups.revokeInviteLink` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.joinViaInviteLink` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `groups.leaveGroup` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |

### `contacts.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `contacts.list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `contacts.get` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `contacts.checkExists` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `contacts.getProfilePicture` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `contacts.getAbout` | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | ✅ |
| `contacts.block` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `contacts.unblock` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `contacts.listBlocked` | — | ✅ | ✅ | — | ✅ | ✅ | — | ✅ |

### `webhooks.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks.parse` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
