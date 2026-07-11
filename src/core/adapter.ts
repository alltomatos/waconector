import type { CapabilitySet } from './capabilities';
import type { CanonicalEvent } from './events';
import type {
  ConnectResult,
  InstanceStatus,
  SendMediaInput,
  SendReactionInput,
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
  /**
   * Corpo bruto do request (string, capturado ANTES do body-parser do framework rodar
   * `JSON.parse`). Opcional e aditivo: existe apenas para adapters que precisam verificar uma
   * assinatura (HMAC ou similar) calculada pelo provider sobre os bytes originais do payload.
   * `JSON.stringify(body)` NÃO é garantidamente idêntico byte-a-byte ao request original (ordem
   * de chaves, espaçamento, escaping podem diferir), então não serve para essa comparação — só o
   * `rawBody` capturado pelo consumidor é confiável. Adapters/consumidores que não fazem
   * verificação de assinatura podem ignorar este campo com segurança.
   */
  rawBody?: string;
}

export interface InstanceApi {
  connect(): Promise<ConnectResult>;
  status(): Promise<InstanceStatus>;
  logout(): Promise<void>;
}

export interface MessagesApi {
  sendText(input: SendTextInput): Promise<SentMessage>;
  sendMedia(input: SendMediaInput): Promise<SentMessage>;
  /**
   * Opcional: só precisa ser implementado por adapters que declaram a capability
   * `messages.sendReaction` (nem todo provider expõe reação programática). Ver ADR-0008.
   */
  sendReaction?(input: SendReactionInput): Promise<SentMessage>;
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
