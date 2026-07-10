import { MockAdapter } from '../../src/testing';
import { describeAdapterContract } from './adapter-contract';

describeAdapterContract({
  name: 'MockAdapter (implementação de referência)',
  create() {
    const adapter = new MockAdapter();
    return {
      adapter,
      ready: async () => {
        await adapter.instance.connect();
        adapter.simulateConnected();
      },
      webhooks: {
        messageReceived: adapter.buildIncomingText('5585988887777', 'olá do contrato'),
      },
      recipient: '5585999999999',
    };
  },
});
