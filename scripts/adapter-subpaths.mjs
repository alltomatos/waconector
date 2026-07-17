/**
 * Lista única de adapters e opções fake mínimas para instanciar cada fábrica sem rede real.
 * Compartilhada entre scripts/smoke.mjs e scripts/generate-capabilities-matrix.mjs — extraída
 * para eliminar o risco de as duas listas divergirem (mesmo motivo por trás de várias decisões
 * deste projeto: nunca duplicar uma fonte de verdade).
 *
 * Ao adicionar um adapter novo, estenda esta lista (não duplique em outro lugar).
 */
export const ADAPTER_SUBPATHS = [
  {
    name: 'izapia',
    factory: 'izapia',
    options: { baseUrl: 'http://localhost:1', apiKey: 'x', sid: 'x' },
  },
  {
    name: 'evolution',
    factory: 'evolution',
    options: { baseUrl: 'http://localhost:1', apiKey: 'x' },
  },
  { name: 'uazapi', factory: 'uazapi', options: { baseUrl: 'http://localhost:1', token: 'x' } },
  {
    name: 'zapi',
    factory: 'zapi',
    options: { baseUrl: 'http://localhost:1', instanceId: 'x', token: 'x' },
  },
  { name: 'wuzapi', factory: 'wuzapi', options: { baseUrl: 'http://localhost:1', token: 'x' } },
  { name: 'whapi', factory: 'whapi', options: { baseUrl: 'http://localhost:1', token: 'x' } },
  { name: 'quepasa', factory: 'quepasa', options: { baseUrl: 'http://localhost:1', token: 'x' } },
  {
    name: 'wppconnect',
    factory: 'wppconnect',
    options: { baseUrl: 'http://localhost:1', session: 'x', token: 'x' },
  },
  { name: 'waha', factory: 'waha', options: { baseUrl: 'http://localhost:1', apiKey: 'x' } },
];
