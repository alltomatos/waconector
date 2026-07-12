import type {
  ChatsApi,
  ContactsApi,
  GroupsApi,
  InstanceApi,
  LabelsApi,
  MessagesApi,
  PresenceApi,
  WaAdapter,
  WebhookInput,
} from '../core/adapter';
import { CAPABILITIES, type CapabilitySet } from '../core/capabilities';
import { extractInviteCode, normalizeInviteLink } from '../core/chat-id';
import { WaConnectorError } from '../core/errors';
import type { CanonicalEvent } from '../core/events';
import {
  type Contact,
  type GroupInfo,
  type GroupParticipant,
  INSTANCE_STATES,
  type InstanceState,
  type LabelInfo,
  MESSAGE_ACKS,
  type MessageAck,
  type PresenceState,
  type SendMediaInput,
  type SendReactionInput,
  type SendTextInput,
  type SentMessage,
  type TypingState,
} from '../core/types';

export interface MockAdapterOptions {
  provider?: string;
  capabilities?: CapabilitySet;
  initialState?: InstanceState;
}

export interface MockOutboxEntry {
  input: SendTextInput | SendMediaInput | SendReactionInput;
  message: SentMessage;
}

/**
 * Adapter em memória: implementação de referência do contrato `WaAdapter` e
 * ferramenta para testar bots sem um provider real. Simula o ciclo de vida da
 * instância (desconectado → qr → conectado), registra envios em `outbox` e
 * gera webhooks sintéticos via `buildIncomingText`/`buildAck`/`buildConnectionUpdate`.
 */
export class MockAdapter implements WaAdapter {
  readonly provider: string;
  readonly capabilities: CapabilitySet;
  readonly outbox: MockOutboxEntry[] = [];
  readonly instance: InstanceApi;
  readonly messages: MessagesApi;
  readonly groups: GroupsApi;
  readonly contacts: ContactsApi;
  readonly chats: ChatsApi;
  readonly presence: PresenceApi;
  readonly labels: LabelsApi;

  private state: InstanceState;
  private seq = 0;
  private groupSeq = 0;
  private inviteSeq = 0;
  private labelSeq = 0;
  private readonly groupsById = new Map<string, GroupInfo>();
  private readonly groupIdByInviteCode = new Map<string, string>();
  private readonly contactsById = new Map<string, Contact>();
  private readonly blockedIds = new Set<string>();
  private readonly archivedChatIds = new Set<string>();
  private readonly mutedChatIds = new Set<string>();
  private readonly pinnedChatIds = new Set<string>();
  private readonly unreadChatIds = new Set<string>();
  private readonly starredMessageIds = new Set<string>();
  private readonly pinnedMessageIds = new Set<string>();
  private readonly readMessageIds = new Set<string>();
  private globalPresence: PresenceState | undefined;
  private readonly typingStateByChatId = new Map<string, TypingState>();
  private readonly subscribedPresenceChatIds = new Set<string>();
  private readonly labelsById = new Map<string, LabelInfo>();
  private readonly labelIdsByChatId = new Map<string, Set<string>>();

  constructor(options: MockAdapterOptions = {}) {
    this.provider = options.provider ?? 'mock';
    this.capabilities = options.capabilities ?? CAPABILITIES;
    this.state = options.initialState ?? 'disconnected';

    this.instance = {
      connect: async () => {
        this.state = 'qr';
        return { qr: 'mock-qr-code', raw: { mock: true } };
      },
      status: async () => ({ state: this.state, raw: { mock: true } }),
      logout: async () => {
        this.state = 'disconnected';
      },
    };

    this.messages = {
      sendText: async (input) => this.deliver(input),
      sendMedia: async (input) => this.deliver(input),
      sendReaction: async (input) => this.deliver(input),
      edit: async (input) => {
        this.assertConnected();
        return {
          id: input.messageId,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input },
        };
      },
      delete: async (input) => {
        this.assertConnected();
        void input;
      },
      forward: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input },
        };
      },
      star: async (input) => {
        this.assertConnected();
        this.starredMessageIds.add(input.messageId);
      },
      unstar: async (input) => {
        this.assertConnected();
        this.starredMessageIds.delete(input.messageId);
      },
      pin: async (input) => {
        this.assertConnected();
        this.pinnedMessageIds.add(input.messageId);
      },
      unpin: async (input) => {
        this.assertConnected();
        this.pinnedMessageIds.delete(input.messageId);
      },
      markRead: async (input) => {
        this.assertConnected();
        this.readMessageIds.add(input.messageId);
      },
      sendLocation: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input },
        };
      },
      sendContactCard: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input },
        };
      },
      sendPoll: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input },
        };
      },
    };

    this.groups = {
      create: async (input) => {
        this.assertConnected();
        const group: GroupInfo = {
          id: `mock-group-${++this.groupSeq}`,
          subject: input.subject,
          participants: input.participants.map((id) => ({
            id,
            isAdmin: false,
            isSuperAdmin: false,
          })),
          raw: { mock: true, input },
        };
        this.groupsById.set(group.id, group);
        return group;
      },
      getInfo: async (groupId) => this.requireGroup(groupId),
      list: async () => Array.from(this.groupsById.values()),
      addParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        const existingIds = new Set(group.participants.map((participant) => participant.id));
        const added: GroupParticipant[] = participants
          .filter((id) => !existingIds.has(id))
          .map((id) => ({ id, isAdmin: false, isSuperAdmin: false }));
        this.groupsById.set(groupId, {
          ...group,
          participants: [...group.participants, ...added],
        });
      },
      removeParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        const removed = new Set(participants);
        this.groupsById.set(groupId, {
          ...group,
          participants: group.participants.filter((participant) => !removed.has(participant.id)),
        });
      },
      promoteParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        this.setAdminFlag(groupId, participants, true);
      },
      demoteParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        this.setAdminFlag(groupId, participants, false);
      },
      updateSubject: async ({ groupId, subject }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        this.groupsById.set(groupId, { ...group, subject });
      },
      updateDescription: async ({ groupId, description }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        this.groupsById.set(groupId, { ...group, description });
      },
      updatePicture: async ({ groupId }) => {
        this.assertConnected();
        this.requireGroup(groupId);
      },
      getInviteLink: async (groupId) => {
        this.assertConnected();
        this.requireGroup(groupId);
        return this.issueInviteLink(groupId);
      },
      revokeInviteLink: async (groupId) => {
        this.assertConnected();
        this.requireGroup(groupId);
        for (const [code, id] of this.groupIdByInviteCode) {
          if (id === groupId) this.groupIdByInviteCode.delete(code);
        }
        return this.issueInviteLink(groupId);
      },
      joinViaInviteLink: async ({ invite }) => {
        this.assertConnected();
        const code = extractInviteCode(invite);
        if (!this.groupIdByInviteCode.has(code)) {
          throw new WaConnectorError(
            'PROVIDER_ERROR',
            `MockAdapter: código de convite "${code}" inválido ou expirado.`,
            { provider: this.provider },
          );
        }
      },
      leaveGroup: async (groupId) => {
        this.assertConnected();
        this.requireGroup(groupId);
        this.groupsById.delete(groupId);
      },
    };

    this.contacts = {
      list: async () => {
        this.assertConnected();
        return Array.from(this.contactsById.values());
      },
      get: async (chatId) => {
        this.assertConnected();
        return (
          this.contactsById.get(chatId) ?? { id: chatId, hasWhatsApp: true, raw: { mock: true } }
        );
      },
      checkExists: async (phone) => {
        this.assertConnected();
        const contact = this.contactsById.get(phone);
        return {
          exists: contact?.hasWhatsApp ?? true,
          chatId: phone,
          raw: { mock: true, contact },
        };
      },
      getProfilePicture: async (chatId) => {
        this.assertConnected();
        return { url: this.contactsById.get(chatId)?.profilePictureUrl, raw: { mock: true } };
      },
      getAbout: async (chatId) => {
        this.assertConnected();
        return { about: this.contactsById.get(chatId)?.about, raw: { mock: true } };
      },
      block: async (chatId) => {
        this.assertConnected();
        this.blockedIds.add(chatId);
        const contact = this.contactsById.get(chatId);
        if (contact) this.contactsById.set(chatId, { ...contact, isBlocked: true });
      },
      unblock: async (chatId) => {
        this.assertConnected();
        this.blockedIds.delete(chatId);
        const contact = this.contactsById.get(chatId);
        if (contact) this.contactsById.set(chatId, { ...contact, isBlocked: false });
      },
      listBlocked: async () => {
        this.assertConnected();
        return Array.from(this.blockedIds);
      },
    };

    this.chats = {
      archive: async (chatId) => {
        this.assertConnected();
        this.archivedChatIds.add(chatId);
      },
      unarchive: async (chatId) => {
        this.assertConnected();
        this.archivedChatIds.delete(chatId);
      },
      mute: async (chatId) => {
        this.assertConnected();
        this.mutedChatIds.add(chatId);
      },
      unmute: async (chatId) => {
        this.assertConnected();
        this.mutedChatIds.delete(chatId);
      },
      pin: async (chatId) => {
        this.assertConnected();
        this.pinnedChatIds.add(chatId);
      },
      unpin: async (chatId) => {
        this.assertConnected();
        this.pinnedChatIds.delete(chatId);
      },
      markRead: async (chatId) => {
        this.assertConnected();
        this.unreadChatIds.delete(chatId);
      },
      markUnread: async (chatId) => {
        this.assertConnected();
        this.unreadChatIds.add(chatId);
      },
    };

    this.presence = {
      setTyping: async (input) => {
        this.assertConnected();
        this.typingStateByChatId.set(input.to, input.state);
      },
      set: async (state) => {
        this.assertConnected();
        this.globalPresence = state;
      },
      subscribe: async (chatId) => {
        this.assertConnected();
        this.subscribedPresenceChatIds.add(chatId);
      },
    };

    this.labels = {
      list: async () => {
        this.assertConnected();
        return Array.from(this.labelsById.values());
      },
      create: async (input) => {
        this.assertConnected();
        const label: LabelInfo = {
          id: `mock-label-${++this.labelSeq}`,
          name: input.name,
          color: input.color,
          raw: { mock: true, input },
        };
        this.labelsById.set(label.id, label);
        return label;
      },
      update: async (input) => {
        this.assertConnected();
        const label = this.requireLabel(input.labelId);
        this.labelsById.set(input.labelId, { ...label, name: input.name, color: input.color });
      },
      delete: async (labelId) => {
        this.assertConnected();
        this.requireLabel(labelId);
        this.labelsById.delete(labelId);
        for (const labelIds of this.labelIdsByChatId.values()) {
          labelIds.delete(labelId);
        }
      },
      addToChat: async ({ chatId, labelId }) => {
        this.assertConnected();
        this.requireLabel(labelId);
        const labelIds = this.labelIdsByChatId.get(chatId) ?? new Set<string>();
        labelIds.add(labelId);
        this.labelIdsByChatId.set(chatId, labelIds);
      },
      removeFromChat: async ({ chatId, labelId }) => {
        this.assertConnected();
        this.requireLabel(labelId);
        this.labelIdsByChatId.get(chatId)?.delete(labelId);
      },
    };
  }

  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatArchived(chatId: string): boolean {
    return this.archivedChatIds.has(chatId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatMuted(chatId: string): boolean {
    return this.mutedChatIds.has(chatId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatPinned(chatId: string): boolean {
    return this.pinnedChatIds.has(chatId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatUnread(chatId: string): boolean {
    return this.unreadChatIds.has(chatId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
  isMessageStarred(messageId: string): boolean {
    return this.starredMessageIds.has(messageId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
  isMessagePinned(messageId: string): boolean {
    return this.pinnedMessageIds.has(messageId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
  isMessageRead(messageId: string): boolean {
    return this.readMessageIds.has(messageId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
  getGlobalPresence(): PresenceState | undefined {
    return this.globalPresence;
  }

  /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
  getTypingState(chatId: string): TypingState | undefined {
    return this.typingStateByChatId.get(chatId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
  isSubscribedToPresence(chatId: string): boolean {
    return this.subscribedPresenceChatIds.has(chatId);
  }

  /** Consulta de estado só para testes (não faz parte do contrato `LabelsApi`). Ver ADR-0016. */
  getChatLabelIds(chatId: string): string[] {
    return Array.from(this.labelIdsByChatId.get(chatId) ?? []);
  }

  simulateConnected(): void {
    this.state = 'connected';
  }

  simulateState(state: InstanceState): void {
    this.state = state;
  }

  /** Semeia (ou atualiza) um contato conhecido pelo mock, usado por `list`/`get`/`checkExists`/etc. */
  simulateContact(contact: Contact): void {
    this.contactsById.set(contact.id, contact);
  }

  parseWebhook(input: WebhookInput): CanonicalEvent[] {
    const body = input.body;
    if (typeof body !== 'object' || body === null) {
      return [this.unknown(input, 'Payload não reconhecido pelo MockAdapter.')];
    }
    const record = body as Record<string, unknown>;
    const event = asString(record.event);

    if (event === 'message') {
      const from = asString(record.from);
      const fromMe = asBoolean(record.fromMe) ?? false;
      const message = {
        id: asString(record.id) ?? `mock-in-${++this.seq}`,
        chatId: asString(record.chatId) ?? from ?? 'unknown',
        from,
        fromMe,
        timestamp: asNumber(record.timestamp) ?? Date.now(),
        kind: 'text' as const,
        text: asString(record.text),
        raw: body,
      };
      return [
        {
          type: fromMe ? 'message.sent' : 'message.received',
          provider: this.provider,
          message,
          raw: body,
        },
      ];
    }

    if (event === 'reaction') {
      const from = asString(record.from);
      const fromMe = asBoolean(record.fromMe) ?? false;
      const message = {
        id: asString(record.id) ?? `mock-in-${++this.seq}`,
        chatId: asString(record.chatId) ?? from ?? 'unknown',
        from,
        fromMe,
        timestamp: asNumber(record.timestamp) ?? Date.now(),
        kind: 'reaction' as const,
        reaction: {
          emoji: asString(record.emoji) ?? '',
          targetMessageId: asString(record.targetMessageId) ?? 'unknown',
        },
        raw: body,
      };
      return [
        {
          type: fromMe ? 'message.sent' : 'message.received',
          provider: this.provider,
          message,
          raw: body,
        },
      ];
    }

    if (event === 'ack') {
      return [
        {
          type: 'message.ack',
          provider: this.provider,
          messageId: asString(record.messageId) ?? 'unknown',
          chatId: asString(record.chatId),
          ack: asMessageAck(record.ack) ?? 'sent',
          raw: body,
        },
      ];
    }

    if (event === 'connection') {
      return [
        {
          type: 'connection.update',
          provider: this.provider,
          state: asInstanceState(record.state) ?? 'unknown',
          qr: asString(record.qr),
          raw: body,
        },
      ];
    }

    return [this.unknown(input, `Evento mock desconhecido: ${String(record.event)}`)];
  }

  /** Webhook sintético de mensagem de texto recebida, no formato que `parseWebhook` entende. */
  buildIncomingText(from: string, text: string): WebhookInput {
    return { body: { event: 'message', from, chatId: from, text, fromMe: false } };
  }

  buildAck(messageId: string, ack: MessageAck): WebhookInput {
    return { body: { event: 'ack', messageId, ack } };
  }

  /** Webhook sintético de reação recebida, no formato que `parseWebhook` entende. */
  buildReaction(from: string, targetMessageId: string, emoji: string): WebhookInput {
    return {
      body: { event: 'reaction', from, chatId: from, targetMessageId, emoji, fromMe: false },
    };
  }

  buildConnectionUpdate(state: InstanceState, qr?: string): WebhookInput {
    return { body: { event: 'connection', state, qr } };
  }

  private deliver(input: SendTextInput | SendMediaInput | SendReactionInput): SentMessage {
    this.assertConnected();
    const message: SentMessage = {
      id: `mock-${++this.seq}`,
      chatId: input.to,
      timestamp: Date.now(),
      raw: { mock: true, input },
    };
    this.outbox.push({ input, message });
    return message;
  }

  private assertConnected(): void {
    if (this.state !== 'connected') {
      throw new WaConnectorError(
        'INSTANCE_DISCONNECTED',
        'MockAdapter: instância não conectada (use simulateConnected()).',
        { provider: this.provider },
      );
    }
  }

  private requireGroup(groupId: string): GroupInfo {
    const group = this.groupsById.get(groupId);
    if (!group) {
      throw new WaConnectorError('PROVIDER_ERROR', `MockAdapter: grupo "${groupId}" não existe.`, {
        provider: this.provider,
      });
    }
    return group;
  }

  private requireLabel(labelId: string): LabelInfo {
    const label = this.labelsById.get(labelId);
    if (!label) {
      throw new WaConnectorError('PROVIDER_ERROR', `MockAdapter: label "${labelId}" não existe.`, {
        provider: this.provider,
      });
    }
    return label;
  }

  private issueInviteLink(groupId: string): { link: string; raw: unknown } {
    const code = `mock-invite-${++this.inviteSeq}`;
    this.groupIdByInviteCode.set(code, groupId);
    return { link: normalizeInviteLink(code), raw: { mock: true, groupId, code } };
  }

  private setAdminFlag(groupId: string, participants: string[], isAdmin: boolean): void {
    const group = this.requireGroup(groupId);
    const targets = new Set(participants);
    this.groupsById.set(groupId, {
      ...group,
      participants: group.participants.map((participant) =>
        targets.has(participant.id)
          ? { ...participant, isAdmin, isSuperAdmin: isAdmin ? participant.isSuperAdmin : false }
          : participant,
      ),
    });
  }

  private unknown(input: WebhookInput, reason: string): CanonicalEvent {
    return { type: 'unknown', provider: this.provider, raw: input.body, reason };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asMessageAck(value: unknown): MessageAck | undefined {
  return typeof value === 'string' && (MESSAGE_ACKS as readonly string[]).includes(value)
    ? (value as MessageAck)
    : undefined;
}

function asInstanceState(value: unknown): InstanceState | undefined {
  return typeof value === 'string' && (INSTANCE_STATES as readonly string[]).includes(value)
    ? (value as InstanceState)
    : undefined;
}
