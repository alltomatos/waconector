export type { InstanceApi, MessagesApi, WaAdapter, WebhookInput } from './core/adapter';
export type { Capability, CapabilitySet } from './core/capabilities';
export { CAPABILITIES, hasCapability, isKnownCapability } from './core/capabilities';
export { digitsOnly, isGroupChatId, isJid, normalizeChatId } from './core/chat-id';
export type { WaEventListener, WebhooksApi } from './core/connector';
export { createConnector, WaConnector } from './core/connector';
export type { WaConnectorErrorOptions, WaErrorCode } from './core/errors';
export {
  isWaConnectorError,
  redactSecrets,
  statusToErrorCode,
  UnsupportedCapabilityError,
  WaConnectorError,
} from './core/errors';
export type {
  CanonicalEvent,
  CanonicalEventType,
  ConnectionUpdateEvent,
  EventOf,
  GroupUpdateEvent,
  MessageAckEvent,
  MessageReceivedEvent,
  MessageSentEvent,
  UnknownEvent,
} from './core/events';
export type { HttpClientOptions, HttpRequestOptions } from './core/http';
export { HttpClient } from './core/http';
export type {
  ConnectResult,
  InstanceState,
  InstanceStatus,
  MediaKind,
  MediaRef,
  MessageAck,
  MessageKind,
  SendMediaInput,
  SendTextInput,
  SentMessage,
  WaMessage,
} from './core/types';
export { INSTANCE_STATES, MESSAGE_ACKS } from './core/types';
