import type { InstanceApi, MessagesApi, WaAdapter, WebhookInput } from './adapter';
import { type Capability, type CapabilitySet, hasCapability } from './capabilities';
import { normalizeChatId } from './chat-id';
import { UnsupportedCapabilityError, WaConnectorError } from './errors';
import type { CanonicalEvent, CanonicalEventType, EventOf, UnknownEvent } from './events';
import type { SendMediaInput, SendTextInput } from './types';

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
 * Camada de ergonomia e política sobre um adapter: checagem de capabilities,
 * validação e normalização de entrada, eventos e parsing seguro de webhooks.
 */
export class WaConnector {
  readonly adapter: WaAdapter;
  readonly provider: string;
  readonly capabilities: CapabilitySet;
  readonly instance: InstanceApi;
  readonly messages: MessagesApi;
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
