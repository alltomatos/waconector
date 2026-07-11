# waconector

> **Conector universal para APIs não-oficiais de WhatsApp.** Um contrato único, um adapter por
> provider — trocar de API vira trocar duas linhas de configuração.
>
> _Universal connector for unofficial WhatsApp APIs: one contract, one adapter per provider._

[![CI](https://github.com/alltomatos/waconector/actions/workflows/ci.yml/badge.svg)](https://github.com/alltomatos/waconector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/waconector)](https://www.npmjs.com/package/waconector)

**Status: em desenvolvimento (v0.x).** Core de contratos, conector, eventos canônicos, `MockAdapter`
e suite de contrato prontos; adapters **WAHA**, **Evolution GO** (F1), **uazapi** e **Z-API** (F2)
implementados e verificados. A API pública pode mudar entre minors até a v1.0.

## O problema

uazapi, WAHA, Evolution GO, Wuzapi, Whapi, Z-API, Zapo, QuePasa... todas fazem as mesmas
operações — conectar instância, enviar texto/mídia, receber mensagens via webhook — mas cada uma
com auth, endpoints, payloads e eventos diferentes. Integrar com uma é fácil; ficar refém dela,
também.

## A solução

```ts
import { createConnector } from 'waconector';
import { waha } from 'waconector/waha';
// ou: import { evolution } from 'waconector/evolution';
// ou, para testar sem provider real: import { MockAdapter } from 'waconector/testing';

const adapter = waha({ baseUrl: 'http://localhost:3000', apiKey: process.env.WAHA_API_KEY! });
const wa = createConnector(adapter);

// Instância: conectar e ler QR
const { qr } = await wa.instance.connect();
adapter.simulateConnected();

// Enviar (aceita E.164 com pontuação ou JID; o waconector normaliza)
await wa.messages.sendText({ to: '+55 (85) 99999-9999', text: 'Olá!' });

// Receber: webhooks de qualquer provider viram eventos canônicos
wa.on('message.received', async (event) => {
  console.log(`${event.message.chatId}: ${event.message.text}`);
});

// Em qualquer framework (Express, Fastify, Next.js, Workers):
// app.post('/webhook', (req, res) => {
//   wa.webhooks.dispatch({ headers: req.headers, body: req.body });
//   res.sendStatus(200);
// });
await wa.webhooks.dispatch(adapter.buildIncomingText('5585988887777', 'oi'));
```

## Princípios de design

- **Normalizar o comum, preservar o específico** — todo objeto normalizado carrega `raw` com o
  payload original do provider.
- **Capabilities declaradas** — cada adapter anuncia o que suporta; chamar fora do conjunto lança
  `UnsupportedCapabilityError`. Consulte com `wa.supports('messages.sendMedia')`.
- **Webhooks que nunca derrubam seu endpoint** — `wa.webhooks.parse` não lança: payload
  desconhecido vira evento `unknown` (com `raw` para você inspecionar).
- **Erros tipados** — `WaConnectorError` com `code` (`AUTH_FAILED`, `RATE_LIMITED`,
  `INSTANCE_DISCONNECTED`...), provider e causa original. Cheque com `isWaConnectorError(err)`.
- **Zero dependências de runtime** — `fetch` nativo, Node ≥ 20, ESM + CJS.

## Testando seu bot sem provider real

`waconector/testing` publica o `MockAdapter` — instância simulada, `outbox` de envios e webhooks
sintéticos (`buildIncomingText`, `buildAck`, `buildConnectionUpdate`). Seu bot inteiro é testável
em memória. Use `simulateConnected()` para pular direto ao estado `connected`, ou
`simulateState(state)` para forçar qualquer outro estado do ciclo de vida (ex.: `'qr'`).

## Providers

| Provider | Status | | Provider | Status |
| --- | --- | --- | --- | --- |
| WAHA | ✅ F1 | | Z-API | ✅ F2 |
| Evolution GO | ✅ F1 | | Whapi | F3 (planejado) |
| uazapi | ✅ F2 | | Zapo | F3 (planejado) |
| Wuzapi | F2 (planejado) | | QuePasa | F3 (planejado) |

Roadmap completo e arquitetura em [docs/CONTEXT.md](docs/CONTEXT.md); decisões registradas em
[docs/adr/](docs/adr/). Quer contribuir com um adapter? Veja
[CONTRIBUTING.md](CONTRIBUTING.md) e comece pelo dossiê:
[docs/providers/README.md](docs/providers/README.md).

## Desenvolvimento

```bash
npm install
npm test              # vitest (unit + suite de contrato)
npm run test:coverage # idem, com relatório e thresholds de cobertura
npm run typecheck     # tsc --noEmit
npm run lint          # biome
npm run build         # tsup → dist/ (ESM + CJS + tipos)
npm run smoke         # valida o pacote empacotado (exports ESM/CJS + fluxo completo)
```

Guia completo de contribuição (convenções, checklist de QA, como propor um adapter novo) em
[CONTRIBUTING.md](CONTRIBUTING.md).

Releases via [changesets](https://github.com/changesets/changesets): `npx changeset` no PR;
o merge em `main` abre o PR de versão e publica no npm com provenance (requer secret
`NPM_TOKEN` no repositório).

## Aviso legal

Este projeto é um **client HTTP para APIs de terceiros** e não é afiliado, associado, autorizado
ou endossado pela Meta/WhatsApp. APIs não-oficiais violam os Termos de Serviço do WhatsApp e podem
resultar em banimento de números. Use por sua conta e risco, preferencialmente em números
dedicados.

## Licença

[MIT](LICENSE)
