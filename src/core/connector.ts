import type { GroupsApi, InstanceApi, WaAdapter, WebhookInput } from './adapter';
import { type Capability, type CapabilitySet, hasCapability } from './capabilities';
import { normalizeChatId, normalizeInviteLink } from './chat-id';
import { UnsupportedCapabilityError, WaConnectorError } from './errors';
import type { CanonicalEvent, CanonicalEventType, EventOf, UnknownEvent } from './events';
import type {
  CreateGroupInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipantsInput,
  JoinGroupInviteInput,
  MediaRef,
  SendMediaInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
} from './types';

export type WaEventListener<T extends CanonicalEventType | '*'> = (
  event: T extends '*' ? CanonicalEvent : EventOf<Exclude<T, '*'>>,
) => void | Promise<void>;

type AnyListener = (event: CanonicalEvent) => void | Promise<void>;

export interface WebhooksApi {
  /** Traduz um webhook do provider para eventos canônicos. Nunca lança: payloads irreconhecíveis viram `unknown`. */
  parse(input: WebhookInput): CanonicalEvent[];
  /** `parse` + emissão para os listeners registrados via `on()`. */
  dispatch(input: WebhookInput): Promise<CanonicalEvent[]>;
}

/**
 * `MessagesApi` exposta pelo conector: diferente da interface que o adapter implementa
 * (`sendReaction` é opcional lá, já que nem todo provider suporta), aqui todo método está sempre
 * presente — chamar uma capability não suportada lança `UnsupportedCapabilityError` de forma
 * uniforme, em vez de o consumidor precisar checar `typeof wa.messages.sendReaction === 'function'`.
 */
export interface ConnectorMessagesApi {
  sendText(input: SendTextInput): Promise<SentMessage>;
  sendMedia(input: SendMediaInput): Promise<SentMessage>;
  sendReaction(input: SendReactionInput): Promise<SentMessage>;
}

/**
 * `GroupsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde todos são opcionais — ver ADR-0009), gateado por capability + guard-rail
 * `PROVIDER_ERROR` quando o adapter declara a capability sem implementar o método.
 */
export interface ConnectorGroupsApi {
  create(input: CreateGroupInput): Promise<GroupInfo>;
  getInfo(groupId: string): Promise<GroupInfo>;
  list(): Promise<GroupInfo[]>;
  addParticipants(input: GroupParticipantsInput): Promise<void>;
  removeParticipants(input: GroupParticipantsInput): Promise<void>;
  promoteParticipants(input: GroupParticipantsInput): Promise<void>;
  demoteParticipants(input: GroupParticipantsInput): Promise<void>;
  updateSubject(input: UpdateGroupSubjectInput): Promise<void>;
  updateDescription(input: UpdateGroupDescriptionInput): Promise<void>;
  updatePicture(input: UpdateGroupPictureInput): Promise<void>;
  getInviteLink(groupId: string): Promise<GroupInviteLink>;
  revokeInviteLink(groupId: string): Promise<GroupInviteLink>;
  joinViaInviteLink(input: JoinGroupInviteInput): Promise<void>;
  leaveGroup(groupId: string): Promise<void>;
}

/**
 * Camada de ergonomia e política sobre um adapter: checagem de capabilities,
 * validação e normalização de entrada, eventos e parsing seguro de webhooks.
 */
export class WaConnector {
  readonly adapter: WaAdapter;
  readonly provider: string;
  readonly capabilities: CapabilitySet;
  readonly instance: InstanceApi;
  readonly messages: ConnectorMessagesApi;
  readonly groups: ConnectorGroupsApi;
  readonly webhooks: WebhooksApi;

  private readonly listeners = new Map<string, Set<AnyListener>>();

  constructor(adapter: WaAdapter) {
    this.adapter = adapter;
    this.provider = adapter.provider;
    this.capabilities = adapter.capabilities;

    this.instance = {
      connect: async () => {
        this.assertCapability('instance.connect');
        return adapter.instance.connect();
      },
      status: async () => {
        this.assertCapability('instance.status');
        return adapter.instance.status();
      },
      logout: async () => {
        this.assertCapability('instance.logout');
        return adapter.instance.logout();
      },
    };

    this.messages = {
      sendText: async (input) => {
        this.assertCapability('messages.sendText');
        return adapter.messages.sendText(this.prepareSendText(input));
      },
      sendMedia: async (input) => {
        this.assertCapability('messages.sendMedia');
        return adapter.messages.sendMedia(this.prepareSendMedia(input));
      },
      sendReaction: async (input) => {
        this.assertCapability('messages.sendReaction');
        if (!adapter.messages.sendReaction) {
          throw new WaConnectorError(
            'PROVIDER_ERROR',
            `Adapter "${this.provider}" declara a capability "messages.sendReaction" mas não ` +
              'implementa messages.sendReaction — isso é um bug no adapter, não uma entrada inválida.',
            { provider: this.provider },
          );
        }
        return adapter.messages.sendReaction(this.prepareSendReaction(input));
      },
    };

    this.groups = {
      create: (input) =>
        this.callGroupsMethod('create', 'groups.create', (fn) =>
          fn(this.prepareCreateGroup(input)),
        ),
      getInfo: (groupId) =>
        this.callGroupsMethod('getInfo', 'groups.getInfo', (fn) =>
          fn(this.requireGroupId(groupId)),
        ),
      list: () => this.callGroupsMethod('list', 'groups.list', (fn) => fn()),
      addParticipants: (input) =>
        this.callGroupsMethod('addParticipants', 'groups.addParticipants', (fn) =>
          fn(this.prepareGroupParticipants(input)),
        ),
      removeParticipants: (input) =>
        this.callGroupsMethod('removeParticipants', 'groups.removeParticipants', (fn) =>
          fn(this.prepareGroupParticipants(input)),
        ),
      promoteParticipants: (input) =>
        this.callGroupsMethod('promoteParticipants', 'groups.promoteParticipants', (fn) =>
          fn(this.prepareGroupParticipants(input)),
        ),
      demoteParticipants: (input) =>
        this.callGroupsMethod('demoteParticipants', 'groups.demoteParticipants', (fn) =>
          fn(this.prepareGroupParticipants(input)),
        ),
      updateSubject: (input) =>
        this.callGroupsMethod('updateSubject', 'groups.updateSubject', (fn) =>
          fn(this.prepareUpdateGroupSubject(input)),
        ),
      updateDescription: (input) =>
        this.callGroupsMethod('updateDescription', 'groups.updateDescription', (fn) =>
          fn(this.prepareUpdateGroupDescription(input)),
        ),
      updatePicture: (input) =>
        this.callGroupsMethod('updatePicture', 'groups.updatePicture', (fn) =>
          fn(this.prepareUpdateGroupPicture(input)),
        ),
      getInviteLink: (groupId) =>
        this.callGroupsMethod('getInviteLink', 'groups.getInviteLink', (fn) =>
          fn(this.requireGroupId(groupId)),
        ),
      revokeInviteLink: (groupId) =>
        this.callGroupsMethod('revokeInviteLink', 'groups.revokeInviteLink', (fn) =>
          fn(this.requireGroupId(groupId)),
        ),
      joinViaInviteLink: (input) =>
        this.callGroupsMethod('joinViaInviteLink', 'groups.joinViaInviteLink', (fn) =>
          fn(this.prepareJoinViaInviteLink(input)),
        ),
      leaveGroup: (groupId) =>
        this.callGroupsMethod('leaveGroup', 'groups.leaveGroup', (fn) =>
          fn(this.requireGroupId(groupId)),
        ),
    };

    this.webhooks = {
      parse: (input) => this.parseWebhook(input),
      dispatch: async (input) => {
        const events = this.parseWebhook(input);
        for (const event of events) {
          await this.emit(event);
        }
        return events;
      },
    };
  }

  supports(capability: Capability): boolean {
    return hasCapability(this.capabilities, capability);
  }

  /** Registra um listener para um tipo de evento canônico (ou `*` para todos). Retorna o unsubscribe. */
  on<T extends CanonicalEventType | '*'>(type: T, listener: WaEventListener<T>): () => void {
    const set = this.listeners.get(type) ?? new Set<AnyListener>();
    set.add(listener as AnyListener);
    this.listeners.set(type, set);
    return () => {
      set.delete(listener as AnyListener);
    };
  }

  async emit(event: CanonicalEvent): Promise<void> {
    for (const listener of this.listeners.get(event.type) ?? []) {
      await listener(event);
    }
    for (const listener of this.listeners.get('*') ?? []) {
      await listener(event);
    }
  }

  private assertCapability(capability: Capability): void {
    if (!this.supports(capability)) {
      throw new UnsupportedCapabilityError(capability, this.provider);
    }
  }

  private prepareSendText(input: SendTextInput): SendTextInput {
    if (typeof input.text !== 'string' || input.text.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'sendText exige "text" não vazio.', {
        provider: this.provider,
      });
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareSendMedia(input: SendMediaInput): SendMediaInput {
    if (!input.media || (input.media.url === undefined && input.media.base64 === undefined)) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'sendMedia exige "media.url" ou "media.base64".',
        {
          provider: this.provider,
        },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareSendReaction(input: SendReactionInput): SendReactionInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'sendReaction exige "messageId" não vazio.', {
        provider: this.provider,
      });
    }
    if (typeof input.emoji !== 'string') {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'sendReaction exige "emoji" (string vazia remove uma reação anterior).',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  /**
   * Guard-rail comum aos 7 métodos de `groups.*`: checa a capability e, se o adapter a declarou
   * sem de fato implementar o método correspondente, lança `PROVIDER_ERROR` (bug do adapter, não
   * entrada inválida) — mesmo padrão do `sendReaction` (ADR-0008), reaproveitado (ADR-0009).
   */
  private async callGroupsMethod<K extends keyof GroupsApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<GroupsApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.groups[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `groups.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<GroupsApi[K]>);
  }

  private prepareCreateGroup(input: CreateGroupInput): CreateGroupInput {
    if (typeof input.subject !== 'string' || input.subject.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'groups.create exige "subject" não vazio.', {
        provider: this.provider,
      });
    }
    return { ...input, participants: this.normalizeParticipants(input.participants) };
  }

  private prepareGroupParticipants(input: GroupParticipantsInput): GroupParticipantsInput {
    return {
      groupId: this.requireGroupId(input.groupId),
      participants: this.normalizeParticipants(input.participants),
    };
  }

  private prepareUpdateGroupSubject(input: UpdateGroupSubjectInput): UpdateGroupSubjectInput {
    if (typeof input.subject !== 'string' || input.subject.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'groups.updateSubject exige "subject" não vazio.',
        { provider: this.provider },
      );
    }
    return { groupId: this.requireGroupId(input.groupId), subject: input.subject };
  }

  /** Descrição vazia é válida: limpa a descrição do grupo (suportado por todos os providers pesquisados). */
  private prepareUpdateGroupDescription(
    input: UpdateGroupDescriptionInput,
  ): UpdateGroupDescriptionInput {
    if (typeof input.description !== 'string') {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'groups.updateDescription exige "description" (string vazia limpa a descrição).',
        { provider: this.provider },
      );
    }
    return { groupId: this.requireGroupId(input.groupId), description: input.description };
  }

  private prepareUpdateGroupPicture(input: UpdateGroupPictureInput): UpdateGroupPictureInput {
    const media = this.requireImageMedia(input.media);
    return { groupId: this.requireGroupId(input.groupId), media };
  }

  private requireImageMedia(media: MediaRef): MediaRef {
    if (media?.kind !== 'image') {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'groups.updatePicture exige "media.kind" igual a "image".',
        { provider: this.provider },
      );
    }
    if (media.url === undefined && media.base64 === undefined) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'groups.updatePicture exige "media.url" ou "media.base64".',
        { provider: this.provider },
      );
    }
    return media;
  }

  /**
   * `invite` aceita código bare ou link completo do chamador — normalizado aqui para SEMPRE o
   * link completo antes de chegar ao adapter (constante universal do protocolo WhatsApp, não
   * opaca por provider como `groupId` — ver `normalizeInviteLink`/ADR-0009). Adapters que
   * precisam só do código (ex.: Wuzapi) usam `extractInviteCode` por conta própria.
   */
  private prepareJoinViaInviteLink(input: JoinGroupInviteInput): JoinGroupInviteInput {
    if (typeof input.invite !== 'string' || input.invite.trim().length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'groups.joinViaInviteLink exige "invite" (código ou link do convite) não vazio.',
        { provider: this.provider },
      );
    }
    return { invite: normalizeInviteLink(input.invite.trim()) };
  }

  private normalizeParticipants(participants: unknown): string[] {
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'groups.* exige "participants" com ao menos um telefone/JID.',
        { provider: this.provider },
      );
    }
    return participants.map((participant) => normalizeChatId(this.requireTo(participant)));
  }

  /**
   * `groupId` é opaco (ver ADR-0009 e `GroupInfo.id`) — diferente de `to`, NÃO passa por
   * `normalizeChatId` (a Z-API usa um ID sintético sem `@` que `normalizeChatId` corromperia).
   */
  private requireGroupId(groupId: unknown): string {
    if (typeof groupId !== 'string' || groupId.trim().length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'Campo "groupId" é obrigatório.', {
        provider: this.provider,
      });
    }
    return groupId;
  }

  private requireTo(to: unknown): string {
    if (typeof to !== 'string' || to.trim().length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'Campo "to" é obrigatório.', {
        provider: this.provider,
      });
    }
    return to;
  }

  private parseWebhook(input: WebhookInput): CanonicalEvent[] {
    try {
      const events = this.adapter.parseWebhook(input);
      if (!Array.isArray(events)) {
        return [this.unknownEvent(input, 'Adapter retornou valor não-array em parseWebhook.')];
      }
      return events;
    } catch (error) {
      return [this.unknownEvent(input, error instanceof Error ? error.message : String(error))];
    }
  }

  private unknownEvent(input: WebhookInput, reason: string): UnknownEvent {
    return { type: 'unknown', provider: this.provider, raw: input.body, reason };
  }
}

export function createConnector(adapter: WaAdapter): WaConnector {
  return new WaConnector(adapter);
}
