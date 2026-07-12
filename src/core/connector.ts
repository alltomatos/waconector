import type {
  ChannelsApi,
  ChatsApi,
  ContactsApi,
  GroupsApi,
  InstanceApi,
  LabelsApi,
  MessagesApi,
  PresenceApi,
  WaAdapter,
  WebhookInput,
} from './adapter';
import { type Capability, type CapabilitySet, hasCapability } from './capabilities';
import { normalizeChatId, normalizeInviteLink } from './chat-id';
import { UnsupportedCapabilityError, WaConnectorError } from './errors';
import type { CanonicalEvent, CanonicalEventType, EventOf, UnknownEvent } from './events';
import type {
  ChannelInfo,
  CheckExistsResult,
  Contact,
  ContactAbout,
  ContactProfilePicture,
  CreateChannelInput,
  CreateGroupInput,
  CreateLabelInput,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  GroupInfo,
  GroupInviteLink,
  GroupParticipantsInput,
  JoinGroupInviteInput,
  LabelChatInput,
  LabelInfo,
  MarkMessageReadInput,
  MediaRef,
  PinMessageInput,
  PresenceState,
  SendContactCardInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendReactionInput,
  SendTextInput,
  SentMessage,
  SetTypingInput,
  StarMessageInput,
  TypingState,
  UpdateGroupDescriptionInput,
  UpdateGroupPictureInput,
  UpdateGroupSubjectInput,
  UpdateLabelInput,
} from './types';

export type WaEventListener<T extends CanonicalEventType | '*'> = (
  event: T extends '*' ? CanonicalEvent : EventOf<Exclude<T, '*'>>,
) => void | Promise<void>;

type AnyListener = (event: CanonicalEvent) => void | Promise<void>;

/** Validação em runtime de `SetTypingInput.state` — mesma rede de segurança para chamadores JS sem checagem de tipo em tempo de compilação, já usada em outros pontos do conector. */
const TYPING_STATES: readonly TypingState[] = ['composing', 'recording', 'paused'];

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
  edit(input: EditMessageInput): Promise<SentMessage>;
  delete(input: DeleteMessageInput): Promise<void>;
  forward(input: ForwardMessageInput): Promise<SentMessage>;
  star(input: StarMessageInput): Promise<void>;
  unstar(input: StarMessageInput): Promise<void>;
  pin(input: PinMessageInput): Promise<void>;
  unpin(input: PinMessageInput): Promise<void>;
  markRead(input: MarkMessageReadInput): Promise<void>;
  sendLocation(input: SendLocationInput): Promise<SentMessage>;
  sendContactCard(input: SendContactCardInput): Promise<SentMessage>;
  sendPoll(input: SendPollInput): Promise<SentMessage>;
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
 * `ContactsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde todos são opcionais — ver ADR-0010), gateado por capability + guard-rail
 * `PROVIDER_ERROR` quando o adapter declara a capability sem implementar o método.
 */
export interface ConnectorContactsApi {
  list(): Promise<Contact[]>;
  get(chatId: string): Promise<Contact>;
  checkExists(phone: string): Promise<CheckExistsResult>;
  getProfilePicture(chatId: string): Promise<ContactProfilePicture>;
  getAbout(chatId: string): Promise<ContactAbout>;
  block(chatId: string): Promise<void>;
  unblock(chatId: string): Promise<void>;
  listBlocked(): Promise<string[]>;
}

/**
 * `ChatsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0012), gateado por capability +
 * guard-rail `PROVIDER_ERROR`. `this.adapter.chats` pode ser `undefined`; o guard-rail trata isso
 * exatamente como "método ausente" (nunca deixa um `TypeError` vazar).
 */
export interface ConnectorChatsApi {
  archive(chatId: string): Promise<void>;
  unarchive(chatId: string): Promise<void>;
  mute(chatId: string): Promise<void>;
  unmute(chatId: string): Promise<void>;
  pin(chatId: string): Promise<void>;
  unpin(chatId: string): Promise<void>;
  markRead(chatId: string): Promise<void>;
  markUnread(chatId: string): Promise<void>;
}

/**
 * `PresenceApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0015, mesmo critério de `ChatsApi`).
 */
export interface ConnectorPresenceApi {
  setTyping(input: SetTypingInput): Promise<void>;
  set(state: PresenceState): Promise<void>;
  subscribe(chatId: string): Promise<void>;
}

/**
 * `LabelsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0016, mesmo critério de `ChatsApi`/
 * `PresenceApi`).
 */
export interface ConnectorLabelsApi {
  list(): Promise<LabelInfo[]>;
  create(input: CreateLabelInput): Promise<LabelInfo>;
  update(input: UpdateLabelInput): Promise<void>;
  delete(labelId: string): Promise<void>;
  addToChat(input: LabelChatInput): Promise<void>;
  removeFromChat(input: LabelChatInput): Promise<void>;
}

/**
 * `ChannelsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0017, mesmo critério de `ChatsApi`/
 * `PresenceApi`/`LabelsApi`).
 */
export interface ConnectorChannelsApi {
  list(): Promise<ChannelInfo[]>;
  create(input: CreateChannelInput): Promise<ChannelInfo>;
  getInfo(channelId: string): Promise<ChannelInfo>;
  delete(channelId: string): Promise<void>;
  follow(channelId: string): Promise<void>;
  unfollow(channelId: string): Promise<void>;
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
  readonly contacts: ConnectorContactsApi;
  readonly chats: ConnectorChatsApi;
  readonly presence: ConnectorPresenceApi;
  readonly labels: ConnectorLabelsApi;
  readonly channels: ConnectorChannelsApi;
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
      sendReaction: (input) =>
        this.callMessagesMethod('sendReaction', 'messages.sendReaction', (fn) =>
          fn(this.prepareSendReaction(input)),
        ),
      edit: (input) =>
        this.callMessagesMethod('edit', 'messages.edit', (fn) =>
          fn(this.prepareEditMessage(input)),
        ),
      delete: (input) =>
        this.callMessagesMethod('delete', 'messages.delete', (fn) =>
          fn(this.prepareDeleteMessage(input)),
        ),
      forward: (input) =>
        this.callMessagesMethod('forward', 'messages.forward', (fn) =>
          fn(this.prepareForwardMessage(input)),
        ),
      star: (input) =>
        this.callMessagesMethod('star', 'messages.star', (fn) =>
          fn(this.prepareStarMessage(input)),
        ),
      unstar: (input) =>
        this.callMessagesMethod('unstar', 'messages.unstar', (fn) =>
          fn(this.prepareStarMessage(input)),
        ),
      pin: (input) =>
        this.callMessagesMethod('pin', 'messages.pin', (fn) => fn(this.preparePinMessage(input))),
      unpin: (input) =>
        this.callMessagesMethod('unpin', 'messages.unpin', (fn) =>
          fn(this.preparePinMessage(input)),
        ),
      markRead: (input) =>
        this.callMessagesMethod('markRead', 'messages.markRead', (fn) =>
          fn(this.prepareMarkMessageRead(input)),
        ),
      sendLocation: (input) =>
        this.callMessagesMethod('sendLocation', 'messages.sendLocation', (fn) =>
          fn(this.prepareSendLocation(input)),
        ),
      sendContactCard: (input) =>
        this.callMessagesMethod('sendContactCard', 'messages.sendContactCard', (fn) =>
          fn(this.prepareSendContactCard(input)),
        ),
      sendPoll: (input) =>
        this.callMessagesMethod('sendPoll', 'messages.sendPoll', (fn) =>
          fn(this.prepareSendPoll(input)),
        ),
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

    this.contacts = {
      list: () => this.callContactsMethod('list', 'contacts.list', (fn) => fn()),
      get: (chatId) =>
        this.callContactsMethod('get', 'contacts.get', (fn) => fn(this.requireChatId(chatId))),
      checkExists: (phone) =>
        this.callContactsMethod('checkExists', 'contacts.checkExists', (fn) =>
          fn(normalizeChatId(this.requireTo(phone))),
        ),
      getProfilePicture: (chatId) =>
        this.callContactsMethod('getProfilePicture', 'contacts.getProfilePicture', (fn) =>
          fn(this.requireChatId(chatId)),
        ),
      getAbout: (chatId) =>
        this.callContactsMethod('getAbout', 'contacts.getAbout', (fn) =>
          fn(this.requireChatId(chatId)),
        ),
      block: (chatId) =>
        this.callContactsMethod('block', 'contacts.block', (fn) => fn(this.requireChatId(chatId))),
      unblock: (chatId) =>
        this.callContactsMethod('unblock', 'contacts.unblock', (fn) =>
          fn(this.requireChatId(chatId)),
        ),
      listBlocked: () =>
        this.callContactsMethod('listBlocked', 'contacts.listBlocked', (fn) => fn()),
    };

    this.chats = {
      archive: (chatId) =>
        this.callChatsMethod('archive', 'chats.archive', (fn) => fn(this.requireChatId(chatId))),
      unarchive: (chatId) =>
        this.callChatsMethod('unarchive', 'chats.unarchive', (fn) =>
          fn(this.requireChatId(chatId)),
        ),
      mute: (chatId) =>
        this.callChatsMethod('mute', 'chats.mute', (fn) => fn(this.requireChatId(chatId))),
      unmute: (chatId) =>
        this.callChatsMethod('unmute', 'chats.unmute', (fn) => fn(this.requireChatId(chatId))),
      pin: (chatId) =>
        this.callChatsMethod('pin', 'chats.pin', (fn) => fn(this.requireChatId(chatId))),
      unpin: (chatId) =>
        this.callChatsMethod('unpin', 'chats.unpin', (fn) => fn(this.requireChatId(chatId))),
      markRead: (chatId) =>
        this.callChatsMethod('markRead', 'chats.markRead', (fn) => fn(this.requireChatId(chatId))),
      markUnread: (chatId) =>
        this.callChatsMethod('markUnread', 'chats.markUnread', (fn) =>
          fn(this.requireChatId(chatId)),
        ),
    };

    this.presence = {
      setTyping: (input) =>
        this.callPresenceMethod('setTyping', 'presence.setTyping', (fn) =>
          fn(this.prepareSetTyping(input)),
        ),
      set: (state) => this.callPresenceMethod('set', 'presence.set', (fn) => fn(state)),
      subscribe: (chatId) =>
        this.callPresenceMethod('subscribe', 'presence.subscribe', (fn) =>
          fn(this.requireChatId(chatId)),
        ),
    };

    this.labels = {
      list: () => this.callLabelsMethod('list', 'labels.list', (fn) => fn()),
      create: (input) =>
        this.callLabelsMethod('create', 'labels.create', (fn) =>
          fn(this.prepareCreateLabel(input)),
        ),
      update: (input) =>
        this.callLabelsMethod('update', 'labels.update', (fn) =>
          fn(this.prepareUpdateLabel(input)),
        ),
      delete: (labelId) =>
        this.callLabelsMethod('delete', 'labels.delete', (fn) => fn(this.requireLabelId(labelId))),
      addToChat: (input) =>
        this.callLabelsMethod('addToChat', 'labels.addToChat', (fn) =>
          fn(this.prepareLabelChat(input)),
        ),
      removeFromChat: (input) =>
        this.callLabelsMethod('removeFromChat', 'labels.removeFromChat', (fn) =>
          fn(this.prepareLabelChat(input)),
        ),
    };

    this.channels = {
      list: () => this.callChannelsMethod('list', 'channels.list', (fn) => fn()),
      create: (input) =>
        this.callChannelsMethod('create', 'channels.create', (fn) =>
          fn(this.prepareCreateChannel(input)),
        ),
      getInfo: (channelId) =>
        this.callChannelsMethod('getInfo', 'channels.getInfo', (fn) =>
          fn(this.requireChannelId(channelId)),
        ),
      delete: (channelId) =>
        this.callChannelsMethod('delete', 'channels.delete', (fn) =>
          fn(this.requireChannelId(channelId)),
        ),
      follow: (channelId) =>
        this.callChannelsMethod('follow', 'channels.follow', (fn) =>
          fn(this.requireChannelId(channelId)),
        ),
      unfollow: (channelId) =>
        this.callChannelsMethod('unfollow', 'channels.unfollow', (fn) =>
          fn(this.requireChannelId(channelId)),
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

  private prepareEditMessage(input: EditMessageInput): EditMessageInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'messages.edit exige "messageId" não vazio.', {
        provider: this.provider,
      });
    }
    if (typeof input.text !== 'string' || input.text.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'messages.edit exige "text" não vazio.', {
        provider: this.provider,
      });
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareDeleteMessage(input: DeleteMessageInput): DeleteMessageInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'messages.delete exige "messageId" não vazio.', {
        provider: this.provider,
      });
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareForwardMessage(input: ForwardMessageInput): ForwardMessageInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'messages.forward exige "messageId" não vazio.', {
        provider: this.provider,
      });
    }
    return {
      ...input,
      to: normalizeChatId(this.requireTo(input.to)),
      fromChatId: input.fromChatId ? normalizeChatId(input.fromChatId) : undefined,
    };
  }

  private prepareStarMessage(input: StarMessageInput): StarMessageInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.star/unstar exige "messageId" não vazio.',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private preparePinMessage(input: PinMessageInput): PinMessageInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.pin/unpin exige "messageId" não vazio.',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareMarkMessageRead(input: MarkMessageReadInput): MarkMessageReadInput {
    if (typeof input.messageId !== 'string' || input.messageId.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.markRead exige "messageId" não vazio.',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareSendLocation(input: SendLocationInput): SendLocationInput {
    if (typeof input.latitude !== 'number' || !Number.isFinite(input.latitude)) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.sendLocation exige "latitude" numérica.',
        {
          provider: this.provider,
        },
      );
    }
    if (typeof input.longitude !== 'number' || !Number.isFinite(input.longitude)) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.sendLocation exige "longitude" numérica.',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareSendContactCard(input: SendContactCardInput): SendContactCardInput {
    if (typeof input.contactName !== 'string' || input.contactName.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.sendContactCard exige "contactName" não vazio.',
        { provider: this.provider },
      );
    }
    if (typeof input.contactPhone !== 'string' || input.contactPhone.length === 0) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.sendContactCard exige "contactPhone" não vazio.',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareSendPoll(input: SendPollInput): SendPollInput {
    if (typeof input.question !== 'string' || input.question.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'messages.sendPoll exige "question" não vazia.', {
        provider: this.provider,
      });
    }
    if (!Array.isArray(input.options) || input.options.length < 2) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        'messages.sendPoll exige "options" com pelo menos 2 itens.',
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareSetTyping(input: SetTypingInput): SetTypingInput {
    if (!TYPING_STATES.includes(input.state)) {
      throw new WaConnectorError(
        'INVALID_INPUT',
        `presence.setTyping exige "state" em ${TYPING_STATES.join('|')}.`,
        { provider: this.provider },
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }

  private prepareCreateLabel(input: CreateLabelInput): CreateLabelInput {
    if (typeof input.name !== 'string' || input.name.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'labels.create exige "name" não vazio.', {
        provider: this.provider,
      });
    }
    return input;
  }

  /**
   * `name` é sempre obrigatório aqui (ver `UpdateLabelInput`/ADR-0016) — nunca um patch parcial,
   * mesmo quando só a cor muda.
   */
  private prepareUpdateLabel(input: UpdateLabelInput): UpdateLabelInput {
    return {
      labelId: this.requireLabelId(input.labelId),
      name: this.requireLabelName(input.name),
      color: input.color,
    };
  }

  private requireLabelName(name: unknown): string {
    if (typeof name !== 'string' || name.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'labels.update exige "name" não vazio.', {
        provider: this.provider,
      });
    }
    return name;
  }

  private prepareLabelChat(input: LabelChatInput): LabelChatInput {
    return {
      chatId: normalizeChatId(this.requireTo(input.chatId)),
      labelId: this.requireLabelId(input.labelId),
    };
  }

  /** `labelId` é opaco (mesmo critério de `groupId` — ver ADR-0009): não passa por `normalizeChatId`. */
  private requireLabelId(labelId: unknown): string {
    if (typeof labelId !== 'string' || labelId.trim().length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'Campo "labelId" é obrigatório.', {
        provider: this.provider,
      });
    }
    return labelId;
  }

  private prepareCreateChannel(input: CreateChannelInput): CreateChannelInput {
    if (typeof input.name !== 'string' || input.name.length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'channels.create exige "name" não vazio.', {
        provider: this.provider,
      });
    }
    return input;
  }

  /** `channelId` é opaco (mesmo critério de `groupId`/`labelId` — ver ADR-0009/0016): não passa por `normalizeChatId`. */
  private requireChannelId(channelId: unknown): string {
    if (typeof channelId !== 'string' || channelId.trim().length === 0) {
      throw new WaConnectorError('INVALID_INPUT', 'Campo "channelId" é obrigatório.', {
        provider: this.provider,
      });
    }
    return channelId;
  }

  /**
   * Guard-rail comum aos métodos opcionais de `MessagesApi` (`sendReaction`/`edit`/`delete`/
   * `forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`/`sendLocation`/`sendContactCard`/
   * `sendPoll`) — generaliza o que antes era inline só para `sendReaction` (ADR-0008), sem mudar o
   * texto do erro nem o comportamento observável. Reaproveitado para `edit`/`delete` (ADR-0012),
   * `forward`/`star`/`unstar`/`pin`/`unpin`/`markRead` (ADR-0013) e `sendLocation`/
   * `sendContactCard`/`sendPoll` (ADR-0014).
   */
  private async callMessagesMethod<K extends keyof MessagesApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<MessagesApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.messages[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `messages.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<MessagesApi[K]>);
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

  /**
   * Guard-rail comum aos 5 métodos de `contacts.*`: mesmo padrão de `callGroupsMethod` (ADR-0009),
   * reaproveitado para `contacts.*` (ADR-0010).
   */
  private async callContactsMethod<K extends keyof ContactsApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<ContactsApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.contacts[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `contacts.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<ContactsApi[K]>);
  }

  /**
   * Guard-rail de `chats.*` — mesmo padrão de `callGroupsMethod`/`callContactsMethod`, com uma
   * diferença: `this.adapter.chats` pode ser `undefined` inteiro (namespace opcional, ver
   * ADR-0012), não só o método individual. `?.` cobre os dois casos com o mesmo `PROVIDER_ERROR`
   * — nunca um `TypeError` por acessar propriedade de `undefined`.
   */
  private async callChatsMethod<K extends keyof ChatsApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<ChatsApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.chats?.[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `chats.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<ChatsApi[K]>);
  }

  /**
   * Guard-rail de `presence.*` — mesmo padrão de `callChatsMethod` (namespace inteiro opcional no
   * adapter, ver ADR-0015).
   */
  private async callPresenceMethod<K extends keyof PresenceApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<PresenceApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.presence?.[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `presence.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<PresenceApi[K]>);
  }

  /**
   * Guard-rail de `labels.*` — mesmo padrão de `callPresenceMethod`/`callChatsMethod` (namespace
   * inteiro opcional no adapter, ver ADR-0016).
   */
  private async callLabelsMethod<K extends keyof LabelsApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<LabelsApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.labels?.[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `labels.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<LabelsApi[K]>);
  }

  /**
   * Guard-rail de `channels.*` — mesmo padrão de `callLabelsMethod`/`callPresenceMethod` (namespace
   * inteiro opcional no adapter, ver ADR-0017).
   */
  private async callChannelsMethod<K extends keyof ChannelsApi, R>(
    method: K,
    capability: Capability,
    invoke: (fn: NonNullable<ChannelsApi[K]>) => Promise<R>,
  ): Promise<R> {
    this.assertCapability(capability);
    const fn = this.adapter.channels?.[method];
    if (!fn) {
      throw new WaConnectorError(
        'PROVIDER_ERROR',
        `Adapter "${this.provider}" declara a capability "${capability}" mas não implementa ` +
          `channels.${String(method)} — isso é um bug no adapter, não uma entrada inválida.`,
        { provider: this.provider },
      );
    }
    return invoke(fn as NonNullable<ChannelsApi[K]>);
  }

  /**
   * `chatId` de contato NÃO é opaco (diferente de `groupId` — ver ADR-0010): é o mesmo chatId
   * canônico de `messages.*`, então passa por `normalizeChatId` normalmente.
   */
  private requireChatId(chatId: unknown): string {
    return normalizeChatId(this.requireTo(chatId));
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
