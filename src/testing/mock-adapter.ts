import type { GroupsApi, InstanceApi, MessagesApi, WaAdapter, WebhookInput } from '../core/adapter';
import { CAPABILITIES, type CapabilitySet } from '../core/capabilities';
import { WaConnectorError } from '../core/errors';
import type { CanonicalEvent } from '../core/events';
import {
  type GroupInfo,
  type GroupParticipant,
  INSTANCE_STATES,
  type InstanceState,
  MESSAGE_ACKS,
  type MessageAck,
  type SendMediaInput,
  type SendReactionInput,
  type SendTextInput,
  type SentMessage,
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

  private state: InstanceState;
  private seq = 0;
  private groupSeq = 0;
  private readonly groupsById = new Map<string, GroupInfo>();

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
    };
  }

  simulateConnected(): void {
    this.state = 'connected';
  }

  simulateState(state: InstanceState): void {
    this.state = state;
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
