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

/**
 * `action` é livre (não um union estrito) porque a granularidade de mudança varia por provider —
 * mas segue, por convenção, um destes valores quando identificável univocamente:
 * `'participants.add'|'participants.remove'|'participants.promote'|'participants.demote'|
 * 'subject'|'description'`. Ausente quando o provider reporta múltiplas mudanças simultâneas num
 * único payload (comum em providers baseados em whatsmeow) — nesse caso, `parseWebhook` emite um
 * `GroupUpdateEvent` por mudança identificada (mesma mensagem pode gerar vários eventos no array
 * retornado), e `raw` sempre carrega o payload original completo para o que não for coberto aqui.
 */
export interface GroupUpdateEvent extends BaseEvent {
  type: 'group.update';
  groupId: string;
  action?: string;
  /** Participantes afetados — presente quando `action` for uma mudança de participante. */
  participants?: string[];
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
