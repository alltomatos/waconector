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

- **waha**: 57/72
- **evolution**: 53/72
- **uazapi**: 66/72
- **zapi**: 48/72
- **wuzapi**: 42/72
- **whapi**: 68/72
- **quepasa**: 24/72
- **wppconnect**: 57/72
- **izapia**: 68/72

## Detalhe por namespace

### `instance.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `instance.connect` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `instance.pairingCode` | — | — | — | — | — | — | — | — | — |
| `instance.status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instance.logout` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### `messages.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `messages.sendText` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendMedia` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendReaction` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `messages.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.forward` | ✅ | — | — | ✅ | — | ✅ | — | ✅ | — |
| `messages.star` | ✅ | — | — | — | — | ✅ | — | ✅ | ✅ |
| `messages.unstar` | ✅ | — | — | — | — | ✅ | — | ✅ | ✅ |
| `messages.pin` | ✅ | — | ✅ | ✅ | — | ✅ | — | — | ✅ |
| `messages.unpin` | ✅ | — | ✅ | ✅ | — | ✅ | — | — | ✅ |
| `messages.markRead` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `messages.sendLocation` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendContactCard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendPoll` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.download` | — | ✅ | ✅ | — | — | ✅ | — | — | ✅ |

### `groups.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `groups.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.getInfo` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.addParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.removeParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.promoteParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.demoteParticipants` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.updateSubject` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.updateDescription` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.updatePicture` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.getInviteLink` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `groups.revokeInviteLink` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.joinViaInviteLink` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `groups.leaveGroup` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |

### `contacts.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `contacts.list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.get` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.checkExists` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.getProfilePicture` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `contacts.getAbout` | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.block` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.unblock` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.listBlocked` | — | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |

### `chats.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `chats.archive` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chats.unarchive` | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chats.mute` | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| `chats.unmute` | — | — | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| `chats.pin` | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| `chats.unpin` | — | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| `chats.markRead` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| `chats.markUnread` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |

### `presence.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `presence.setTyping` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `presence.set` | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| `presence.subscribe` | ✅ | — | — | — | ✅ | ✅ | — | ✅ | ✅ |

### `labels.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `labels.list` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| `labels.create` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| `labels.update` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — | ✅ |
| `labels.delete` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| `labels.addToChat` | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| `labels.removeFromChat` | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |

### `channels.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `channels.list` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | ✅ |
| `channels.create` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| `channels.getInfo` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.delete` | ✅ | — | ✅ | — | — | ✅ | — | ✅ | — |
| `channels.follow` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.unfollow` | ✅ | — | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.getMessages` | — | ✅ | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.markViewed` | — | — | ✅ | — | — | — | — | — | ✅ |
| `channels.reactToPost` | — | — | ✅ | — | — | — | — | — | ✅ |

### `business.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `business.getProfile` | — | — | ✅ | — | — | ✅ | — | — | ✅ |
| `business.updateProfile` | — | — | ✅ | — | — | ✅ | — | ✅ | — |

### `calls.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls.make` | — | — | ✅ | ✅ | — | — | — | — | ✅ |
| `calls.reject` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |

### `webhooks.*`

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | izapia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks.parse` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
