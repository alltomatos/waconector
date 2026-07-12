import type { CapabilitySet } from './capabilities';
import type { CanonicalEvent } from './events';
import type {
  CheckExistsResult,
  ConnectResult,
  Contact,
  ContactAbout,
  ContactProfilePicture,
  CreateGroupInput,
  DeleteMessageInput,
  EditMessageInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipantsInput,
  InstanceStatus,
  JoinGroupInviteInput,
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
  /** Opcional: só implementado por adapters que declaram a capability `messages.edit`. Ver ADR-0012. */
  edit?(input: EditMessageInput): Promise<SentMessage>;
  /** Opcional: só implementado por adapters que declaram a capability `messages.delete`. Ver ADR-0012. */
  delete?(input: DeleteMessageInput): Promise<void>;
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
  getInviteLink?(groupId: string): Promise<GroupInviteLink>;
  revokeInviteLink?(groupId: string): Promise<GroupInviteLink>;
  /** `input.invite` já chega normalizado como link completo (ver `normalizeInviteLink`). */
  joinViaInviteLink?(input: JoinGroupInviteInput): Promise<void>;
  leaveGroup?(groupId: string): Promise<void>;
}

/**
 * Todo método é opcional (ver ADR-0010, mesmo padrão de `GroupsApi`/ADR-0009). Diferente de
 * `groups`, o identificador de contato (`chatId`) NÃO é opaco — é o mesmo chatId canônico de
 * `messages.*`, normalizado pelo conector via `normalizeChatId` antes de chegar ao adapter.
 */
export interface ContactsApi {
  list?(): Promise<Contact[]>;
  get?(chatId: string): Promise<Contact>;
  checkExists?(phone: string): Promise<CheckExistsResult>;
  getProfilePicture?(chatId: string): Promise<ContactProfilePicture>;
  getAbout?(chatId: string): Promise<ContactAbout>;
  block?(chatId: string): Promise<void>;
  unblock?(chatId: string): Promise<void>;
  listBlocked?(): Promise<string[]>;
}

/**
 * Namespace de gestão de ESTADO da conversa (arquivar, silenciar, fixar, marcar como lida) — ver
 * ADR-0012. Distinto de `messages.*` (ação sobre UMA mensagem) e de `groups.*`/`contacts.*`
 * (metadados/participantes/perfil). Todo método é opcional, mesmo padrão de `GroupsApi`/
 * `ContactsApi` (ADR-0009/0010).
 *
 * `chatId` NÃO é opaco (diferente de `GroupInfo.id`) — é o mesmo chatId canônico de
 * `messages.*`/`contacts.*`, normalizado pelo conector via `normalizeChatId`.
 */
export interface ChatsApi {
  archive?(chatId: string): Promise<void>;
  unarchive?(chatId: string): Promise<void>;
  /** Silenciar notificações da conversa. Duração fica fora do contrato canônico nesta fase — ver ADR-0012. */
  mute?(chatId: string): Promise<void>;
  unmute?(chatId: string): Promise<void>;
  /** Fixa a CONVERSA no topo da lista — distinto de fixar uma mensagem dentro do chat (fora de escopo, ver ADR-0012). */
  pin?(chatId: string): Promise<void>;
  unpin?(chatId: string): Promise<void>;
  /** Marca a conversa INTEIRA como lida — distinto de marcar uma mensagem por id (fora de escopo, ver ADR-0012). */
  markRead?(chatId: string): Promise<void>;
  markUnread?(chatId: string): Promise<void>;
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
  readonly contacts: ContactsApi;
  /**
   * Namespace OPCIONAL — diferente de `groups`/`contacts` (ADR-0009/0010, campo obrigatório mesmo
   * com todo método interno opcional). Ver ADR-0012 para a justificativa da divergência: mudança
   * aditiva (evita o gate de breaking change pós-v1.0 do CONTRIBUTING.md) + cobertura por provider
   * real demais irregular para justificar um campo mandatório.
   */
  readonly chats?: ChatsApi;
  parseWebhook(input: WebhookInput): CanonicalEvent[];
}
