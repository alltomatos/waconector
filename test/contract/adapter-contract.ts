import { beforeEach, describe, expect, it } from 'vitest';
import {
  createConnector,
  isKnownCapability,
  isWaConnectorError,
  type WaAdapter,
  type WebhookInput,
} from '../../src';

export interface AdapterContractContext {
  adapter: WaAdapter;
  /** Prepara o adapter para aceitar envios (conecta instância real ou simulada). */
  ready(): Promise<void>;
  /** Payloads de webhook reais/representativos do provider (fixtures). */
  webhooks: {
    messageReceived: WebhookInput;
  };
  /** Destinatário válido para os envios de teste. */
  recipient: string;
}

export interface AdapterContractHarness {
  name: string;
  create(): Promise<AdapterContractContext> | AdapterContractContext;
}

/**
 * Suite de contrato do waconector: todo adapter (incluindo o MockAdapter de
 * referência) precisa passar exatamente nestes testes. É o que garante que
 * "trocar de provider" significa trocar apenas a configuração.
 */
export function describeAdapterContract(harness: AdapterContractHarness): void {
  describe(`contrato waconector: ${harness.name}`, () => {
    let ctx: AdapterContractContext;

    beforeEach(async () => {
      ctx = await harness.create();
    });

    it('declara provider e capabilities válidas, incluindo o mínimo do contrato', () => {
      expect(ctx.adapter.provider.length).toBeGreaterThan(0);
      expect(ctx.adapter.capabilities.length).toBeGreaterThan(0);
      for (const capability of ctx.adapter.capabilities) {
        expect(isKnownCapability(capability), `capability desconhecida: ${capability}`).toBe(true);
      }
      expect(ctx.adapter.capabilities).toContain('messages.sendText');
      expect(ctx.adapter.capabilities).toContain('webhooks.parse');
    });

    it('envia texto e retorna SentMessage normalizado', async () => {
      await ctx.ready();
      const wa = createConnector(ctx.adapter);
      const sent = await wa.messages.sendText({ to: ctx.recipient, text: 'contrato: ping' });
      expect(sent.id.length).toBeGreaterThan(0);
      expect(sent.chatId.length).toBeGreaterThan(0);
      expect(sent).toHaveProperty('raw');
    });

    it('instance.connect() e instance.status() sempre carregam "raw" (ADR-0002)', async () => {
      const connectResult = await ctx.adapter.instance.connect();
      expect(connectResult).toHaveProperty('raw');

      const status = await ctx.adapter.instance.status();
      expect(status).toHaveProperty('raw');
    });

    it('rejeita entrada inválida com erro tipado INVALID_INPUT', async () => {
      await ctx.ready();
      const wa = createConnector(ctx.adapter);
      const failure = await wa.messages
        .sendText({ to: '', text: 'x' })
        .catch((error: unknown) => error);
      expect(isWaConnectorError(failure)).toBe(true);
      if (isWaConnectorError(failure)) {
        expect(failure.code).toBe('INVALID_INPUT');
      }
    });

    it('normaliza webhook de mensagem recebida para evento canônico', () => {
      const wa = createConnector(ctx.adapter);
      const events = wa.webhooks.parse(ctx.webhooks.messageReceived);
      const received = events.find((event) => event.type === 'message.received');
      expect(received).toBeDefined();
      if (received && received.type === 'message.received') {
        expect(received.provider).toBe(ctx.adapter.provider);
        expect(received.message.id.length).toBeGreaterThan(0);
        expect(received.message.chatId.length).toBeGreaterThan(0);
        expect(received.message).toHaveProperty('raw');
      }
    });

    it('se declarar messages.sendReaction, envia reação e retorna SentMessage normalizado', async (ctxTest) => {
      if (!ctx.adapter.capabilities.includes('messages.sendReaction')) {
        ctxTest.skip();
        return;
      }
      await ctx.ready();
      const wa = createConnector(ctx.adapter);
      const sent = await wa.messages.sendReaction({
        to: ctx.recipient,
        messageId: 'contrato-msg-1',
        emoji: '👍',
      });
      expect(sent.id.length).toBeGreaterThan(0);
      expect(sent.chatId.length).toBeGreaterThan(0);
      expect(sent).toHaveProperty('raw');
    });

    it('não explode com webhook não reconhecido (vira evento unknown)', () => {
      const wa = createConnector(ctx.adapter);
      const events = wa.webhooks.parse({ body: { formato: 'totalmente-desconhecido' } });
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.type).toBe('unknown');
      }
    });
  });
}
