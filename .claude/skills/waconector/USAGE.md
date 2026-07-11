# Usando o waconector num app

Para quem está integrando o pacote `waconector` publicado num projeto próprio — não para quem
mexe no pacote em si.

## Instalar e escolher um adapter

```bash
npm install waconector
```

```ts
import { createConnector } from 'waconector';
import { waha } from 'waconector/waha'; // self-hosted, sessões, QR/pairing
// import { evolution } from 'waconector/evolution'; // self-hosted, token de instância
// import { MockAdapter } from 'waconector/testing';  // sem provider real, ótimo para testes

const wa = createConnector(
  waha({ baseUrl: 'http://localhost:3000', apiKey: process.env.WAHA_API_KEY! }),
);
```

Hoje só existem adapters WAHA e Evolution GO (fase F1). Se o pedido for outro provider (uazapi,
Z-API, Wuzapi, Whapi, Zapo, QuePasa), ele **não está implementado ainda** — aponte para o workflow
de contribuição ([CONTRIBUTING-WORKFLOW.md](CONTRIBUTING-WORKFLOW.md)) ou para o template de issue
"novo adapter" no repo; não invente um adapter inline.

## As três coisas que toda integração faz

**1. Conectar e obter QR/pairing code**

```ts
const { qr } = await wa.instance.connect();
// renderize `qr` para o usuário escanear, ou dê poll em wa.instance.status() até state === 'connected'
```

**2. Enviar**

```ts
await wa.messages.sendText({ to: '+55 85 99999-9999', text: 'Olá!' }); // qualquer pontuação de telefone ou JID funciona, normalizado internamente
await wa.messages.sendMedia({
  to: '5585999999999',
  media: { kind: 'image', url: 'https://...' },
  caption: 'legenda',
});
```

**3. Receber, em qualquer framework HTTP**

```ts
app.post('/webhook', async (req, res) => {
  await wa.webhooks.dispatch({ headers: req.headers, body: req.body });
  res.sendStatus(200); // dispatch nunca lança — sempre dê ack no webhook
});

wa.on('message.received', async (event) => {
  /* event.message.text, .chatId, .from, .media, .raw */
});
wa.on('message.ack', (event) => {
  /* event.ack: 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'error' */
});
wa.on('connection.update', (event) => {
  /* event.state */
});
wa.on('*', (event) => {
  /* catch-all, inclui 'unknown' para o que ainda não foi mapeado */
});
```

## Capabilities: confira antes de chamar

Nem todo adapter suporta tudo. Confira antes de assumir:

```ts
if (wa.supports('messages.sendMedia')) {
  /* ... */
}
```

Chamar algo não suportado lança `UnsupportedCapabilityError` (um `WaConnectorError` com
`code: 'UNSUPPORTED_CAPABILITY'`) em vez de silenciosamente não fazer nada ou bater num 404
confuso do provider.

## Tratamento de erros

Toda falha é um `WaConnectorError` — confira com `isWaConnectorError(err)` (duck-typed, seguro
entre bundles diferentes), não com `instanceof`.

```ts
try {
  await wa.messages.sendText({ to, text });
} catch (err) {
  if (isWaConnectorError(err)) {
    switch (err.code) {
      case 'INVALID_RECIPIENT': // telefone/JID inválido
      case 'INSTANCE_DISCONNECTED': // precisa reconectar antes
      case 'RATE_LIMITED': // dar um passo atrás
      case 'AUTH_FAILED': // apiKey/token errado
      // ...
    }
  }
  throw err;
}
```

`err.message` nunca contém segredos crus (adapters redigem via `HttpClient({ secrets })`) — seguro
para logar.

## Testando seu bot sem um número real de WhatsApp

Use `MockAdapter` de `waconector/testing` — simule estados de conexão, inspecione o `outbox` de
mensagens enviadas, e gere webhooks sintéticos (`buildIncomingText`, `buildAck`,
`buildConnectionUpdate`) para exercitar a lógica do seu bot em testes unitários. Não mocke `fetch`
você mesmo quando o `MockAdapter` já modela o ciclo de vida inteiro.

## Particularidades por provider que vale saber

- **WAHA**: chatId no formato `<dígitos>@c.us` para contatos individuais (não é E.164 cru); um
  endpoint por tipo de mídia (`sendImage`/`sendVideo`/`sendVoice`/`sendFile`), não um `sendMedia`
  genérico. `instance.pairingCode` não está implementado em F1.
- **Evolution GO**: `apiKey` aqui é o **token da instância**, não o `GLOBAL_API_KEY` (são famílias
  de credenciais diferentes que só coincidem no nome do header). Mensagens de mídia recebidas
  seguem o formato de fio do whatsmeow (campos capitalizados como `URL`, `Info`) refletido verbatim
  no payload do webhook.

O detalhe completo de cada provider está sempre em `docs/providers/<nome>.md` no repositório —
aponte o usuário para lá quando precisar de algo não coberto aqui.
