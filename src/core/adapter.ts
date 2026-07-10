import type { CapabilitySet } from './capabilities';
import type { CanonicalEvent } from './events';
import type {
  ConnectResult,
  InstanceStatus,
  SendMediaInput,
  SendTextInput,
  SentMessage,
} from './types';

/**
 * Entrada de webhook framework-agnostic: o app entrega `{ headers, body }`
 * de qualquer framework (Express, Fastify, Next.js, Workers) — o waconector
 * nunca depende do objeto `req` de um framework específico.
 */
export interface WebhookInput {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface InstanceApi {
  connect(): Promise<ConnectResult>;
  status(): Promise<InstanceStatus>;
  logout(): Promise<void>;
}

export interface MessagesApi {
  sendText(input: SendTextInput): Promise<SentMessage>;
  sendMedia(input: SendMediaInput): Promise<SentMessage>;
}

/**
 * Contrato que todo adapter de provider implementa.
 *
 * O adapter é "burro" de propósito: apenas traduz o modelo canônico de/para o
 * provider (`map-out`/`map-in`). Validação, checagem de capabilities, retry e
 * eventos são responsabilidade do conector (`createConnector`).
 */
export interface WaAdapter {
  readonly provider: string;
  readonly capabilities: CapabilitySet;
  readonly instance: InstanceApi;
  readonly messages: MessagesApi;
  parseWebhook(input: WebhookInput): CanonicalEvent[];
}
