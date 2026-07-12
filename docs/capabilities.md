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

- **waha**: 40/46
- **evolution**: 36/46
- **uazapi**: 41/46
- **zapi**: 42/46
- **wuzapi**: 34/46
- **whapi**: 45/46
- **quepasa**: 14/46
- **wppconnect**: 42/46

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
| `messages.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.forward` | ✅ | — | — | ✅ | — | ✅ | — | ✅ |
| `messages.star` | ✅ | — | — | — | — | ✅ | — | ✅ |
| `messages.unstar` | ✅ | — | — | — | — | ✅ | — | ✅ |
| `messages.pin` | ✅ | — | ✅ | ✅ | — | ✅ | — | — |
| `messages.unpin` | ✅ | — | ✅ | ✅ | — | ✅ | — | — |
| `messages.markRead` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |

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

### `chats.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `chats.archive` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chats.unarchive` | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chats.mute` | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |
| `chats.unmute` | — | — | ✅ | ✅ | — | ✅ | — | ✅ |
| `chats.pin` | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |
| `chats.unpin` | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |
| `chats.markRead` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| `chats.markUnread` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ |

### `webhooks.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks.parse` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
