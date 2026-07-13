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

- **waha**: 57/68
- **evolution**: 51/68
- **uazapi**: 62/68
- **zapi**: 48/68
- **wuzapi**: 42/68
- **whapi**: 66/68
- **quepasa**: 24/68
- **wppconnect**: 57/68

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
| `messages.sendLocation` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendContactCard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendPoll` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

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

### `presence.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `presence.setTyping` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| `presence.set` | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ |
| `presence.subscribe` | ✅ | — | — | — | ✅ | ✅ | — | ✅ |

### `labels.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `labels.list` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| `labels.create` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| `labels.update` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `labels.delete` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| `labels.addToChat` | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |
| `labels.removeFromChat` | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ |

### `channels.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `channels.list` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — |
| `channels.create` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ |
| `channels.getInfo` | ✅ | ✅ | ✅ | — | — | ✅ | — | — |
| `channels.delete` | ✅ | — | ✅ | — | — | ✅ | — | ✅ |
| `channels.follow` | ✅ | ✅ | ✅ | — | — | ✅ | — | — |
| `channels.unfollow` | ✅ | — | ✅ | — | — | ✅ | — | — |

### `business.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `business.getProfile` | — | — | ✅ | — | — | ✅ | — | — |
| `business.updateProfile` | — | — | ✅ | — | — | ✅ | — | ✅ |

### `calls.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls.make` | — | — | ✅ | ✅ | — | — | — | — |
| `calls.reject` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ |

### `webhooks.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks.parse` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
