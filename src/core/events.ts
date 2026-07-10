import type { InstanceState, MessageAck, WaMessage } from './types';

/**
 * Eventos canônicos: todo webhook de qualquer provider é traduzido para um
 * destes formatos. Payloads não reconhecidos viram `unknown` (nunca exceção),
 * para que um endpoint de webhook jamais responda 500 por causa de um evento
 * novo do provider.
 */

interface BaseEvent {
  provider: string;
  instanceId?: string;
  raw: unknown;
}

export interface MessageReceivedEvent extends BaseEvent {
  type: 'message.received';
  message: WaMessage;
}

/** Mensagem enviada pelo próprio número (eco de `fromMe`). */
export interface MessageSentEvent extends BaseEvent {
  type: 'message.sent';
  message: WaMessage;
}

export interface MessageAckEvent extends BaseEvent {
  type: 'message.ack';
  messageId: string;
  chatId?: string;
  ack: MessageAck;
}

export interface ConnectionUpdateEvent extends BaseEvent {
  type: 'connection.update';
  state: InstanceState;
  qr?: string;
}

export interface GroupUpdateEvent extends BaseEvent {
  type: 'group.update';
  groupId: string;
  action?: string;
}

export interface UnknownEvent extends BaseEvent {
  type: 'unknown';
  reason?: string;
}

export type CanonicalEvent =
  | MessageReceivedEvent
  | MessageSentEvent
  | MessageAckEvent
  | ConnectionUpdateEvent
  | GroupUpdateEvent
  | UnknownEvent;

export type CanonicalEventType = CanonicalEvent['type'];

export type EventOf<T extends CanonicalEventType> = Extract<CanonicalEvent, { type: T }>;
