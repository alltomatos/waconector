import type { CapabilitySet } from './capabilities';
import type { CanonicalEvent } from './events';
import type {
  ConnectResult,
  CreateGroupInput,
  GroupInfo,
  GroupParticipantsInput,
  InstanceStatus,
  SendMediaInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
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
 * Todo método é opcional (ver ADR-0009): diferente de `messages` (`sendText`/`sendMedia`
 * obrigatórios desde o F0), `groups` é um namespace inteiramente novo — nem todo adapter precisa
 * implementar nenhum método dele, e adapters futuros (F3+) podem cobrir só um subconjunto.
 */
export interface GroupsApi {
  create?(input: CreateGroupInput): Promise<GroupInfo>;
  getInfo?(groupId: string): Promise<GroupInfo>;
  list?(): Promise<GroupInfo[]>;
  addParticipants?(input: GroupParticipantsInput): Promise<void>;
  removeParticipants?(input: GroupParticipantsInput): Promise<void>;
  promoteParticipants?(input: GroupParticipantsInput): Promise<void>;
  demoteParticipants?(input: GroupParticipantsInput): Promise<void>;
  updateSubject?(input: UpdateGroupSubjectInput): Promise<void>;
  updateDescription?(input: UpdateGroupDescriptionInput): Promise<void>;
  updatePicture?(input: UpdateGroupPictureInput): Promise<void>;
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
  readonly groups: GroupsApi;
  parseWebhook(input: WebhookInput): CanonicalEvent[];
}
