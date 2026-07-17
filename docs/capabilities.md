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

- **izapia**: 68/72
- **evolution**: 53/72
- **uazapi**: 66/72
- **zapi**: 48/72
- **wuzapi**: 42/72
- **whapi**: 68/72
- **quepasa**: 24/72
- **wppconnect**: 57/72
- **waha**: 57/72

## Detalhe por namespace

### `instance.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `instance.connect` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `instance.pairingCode` | — | — | — | — | — | — | — | — | — |
| `instance.status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instance.logout` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### `messages.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `messages.sendText` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendMedia` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendReaction` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `messages.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.forward` | — | — | — | ✅ | — | ✅ | — | ✅ | ✅ |
| `messages.star` | ✅ | — | — | — | — | ✅ | — | ✅ | ✅ |
| `messages.unstar` | ✅ | — | — | — | — | ✅ | — | ✅ | ✅ |
| `messages.pin` | ✅ | — | ✅ | ✅ | — | ✅ | — | — | ✅ |
| `messages.unpin` | ✅ | — | ✅ | ✅ | — | ✅ | — | — | ✅ |
| `messages.markRead` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `messages.sendLocation` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendContactCard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.sendPoll` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages.download` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | — |

### `groups.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
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

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `contacts.list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.get` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.checkExists` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.getProfilePicture` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `contacts.getAbout` | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.block` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.unblock` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `contacts.listBlocked` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |

### `chats.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `chats.archive` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chats.unarchive` | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chats.mute` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — |
| `chats.unmute` | ✅ | — | ✅ | ✅ | — | ✅ | — | ✅ | — |
| `chats.pin` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — |
| `chats.unpin` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — |
| `chats.markRead` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| `chats.markUnread` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |

### `presence.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `presence.setTyping` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `presence.set` | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| `presence.subscribe` | ✅ | — | — | — | ✅ | ✅ | — | ✅ | ✅ |

### `labels.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `labels.list` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| `labels.create` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| `labels.update` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — | ✅ |
| `labels.delete` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |
| `labels.addToChat` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — |
| `labels.removeFromChat` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — |

### `channels.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `channels.list` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | ✅ |
| `channels.create` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| `channels.getInfo` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.delete` | — | — | ✅ | — | — | ✅ | — | ✅ | ✅ |
| `channels.follow` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.unfollow` | ✅ | — | ✅ | — | — | ✅ | — | — | ✅ |
| `channels.getMessages` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | — |
| `channels.markViewed` | ✅ | — | ✅ | — | — | — | — | — | — |
| `channels.reactToPost` | ✅ | — | ✅ | — | — | — | — | — | — |

### `business.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `business.getProfile` | ✅ | — | ✅ | — | — | ✅ | — | — | — |
| `business.updateProfile` | — | — | ✅ | — | — | ✅ | — | ✅ | — |

### `calls.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls.make` | ✅ | — | ✅ | ✅ | — | — | — | — | — |
| `calls.reject` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |

### `webhooks.*`

| Capability | izapia | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | waha |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks.parse` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
