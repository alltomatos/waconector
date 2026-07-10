# waconector

> **Conector universal para APIs não-oficiais de WhatsApp.** Um contrato único, um adapter por
> provider — trocar de API vira trocar duas linhas de configuração.
>
> _Universal connector for unofficial WhatsApp APIs: one contract, one adapter per provider._

[![CI](https://github.com/alltomatos/waconector/actions/workflows/ci.yml/badge.svg)](https://github.com/alltomatos/waconector/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/waconector)](https://www.npmjs.com/package/waconector)

**Status: em desenvolvimento (v0.x).** A fundação (core de contratos, conector, eventos canônicos,
`MockAdapter` e suite de contrato) está pronta; os adapters de providers reais chegam na F1
(WAHA e Evolution GO primeiro). A API pública pode mudar entre minors até a v1.0.

## O problema

uazapi, WAHA, Evolution GO, Wuzapi, Whapi, Z-API, Zapo, QuePasa... todas fazem as mesmas
operações — conectar instância, enviar texto/mídia, receber mensagens via webhook — mas cada uma
com auth, endpoints, payloads e eventos diferentes. Integrar com uma é fácil; ficar refém dela,
também.

## A solução

```ts
import { createConnector } from 'waconector';
// F1+: import { waha } from 'waconector/waha';
// F1+: import { evolution } from 'waconector/evolution';
import { MockAdapter } from 'waconector/testing';

const adapter = new MockAdapter(); // hoje: adapter de referência em memória
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
em memória.

## Providers planejados

| Provider | Fase | | Provider | Fase |
| --- | --- | --- | --- | --- |
| WAHA | F1 | | Z-API | F2 |
| Evolution GO | F1 | | Whapi | F3 |
| uazapi | F2 | | Zapo | F3 |
| Wuzapi | F2 | | QuePasa | F3 |

Roadmap completo e arquitetura em [docs/CONTEXT.md](docs/CONTEXT.md); decisões registradas em
[docs/adr/](docs/adr/). Quer contribuir com um adapter? Comece pelo dossiê:
[docs/providers/README.md](docs/providers/README.md).

## Desenvolvimento

```bash
npm install
npm test            # vitest (unit + suite de contrato)
npm run typecheck   # tsc --noEmit
npm run lint        # biome
npm run build       # tsup → dist/ (ESM + CJS + tipos)
npm run smoke       # valida o pacote empacotado (exports ESM/CJS + fluxo completo)
```

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
