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
Z-API, Wuzapi, Whapi, WPPConnect, QuePasa), ele **não está implementado ainda** — aponte para o workflow
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

// Opcional (ADR-0008) — confira wa.supports('messages.sendReaction') antes: nem todo provider
// implementa. Emoji vazio ('') remove uma reação enviada antes.
if (wa.supports('messages.sendReaction')) {
  await wa.messages.sendReaction({ to: '5585999999999', messageId: 'ABC123', emoji: '👍' });
}

// Opcional (ADR-0009) — grupos: núcleo + participantes. groupId é opaco (não é
// necessariamente um JID — a Z-API, por exemplo, usa um ID sintético próprio).
if (wa.supports('groups.create')) {
  const group = await wa.groups.create({ subject: 'Equipe', participants: ['5585999999999'] });
  await wa.groups.addParticipants({ groupId: group.id, participants: ['5585988888888'] });
  await wa.groups.promoteParticipants({ groupId: group.id, participants: ['5585988888888'] });
}

// Opcional (ADR-0009) — configurações de grupo. description vazia limpa a descrição;
// updatePicture exige media.kind === 'image'.
if (wa.supports('groups.updateSubject')) {
  await wa.groups.updateSubject({ groupId: 'grupo-1', subject: 'Novo nome' });
  await wa.groups.updateDescription({ groupId: 'grupo-1', description: 'Nova descrição' });
  await wa.groups.updatePicture({
    groupId: 'grupo-1',
    media: { kind: 'image', url: 'https://...' },
  });
}

// Opcional (ADR-0009) — convites e saída. O link de convite é sempre normalizado para o
// formato completo (https://chat.whatsapp.com/<código>); joinViaInviteLink aceita tanto o
// código bare quanto o link completo.
if (wa.supports('groups.getInviteLink')) {
  const { link } = await wa.groups.getInviteLink('grupo-1');
  await wa.groups.joinViaInviteLink({ invite: link }); // ou só o código
  await wa.groups.leaveGroup('grupo-1');
}

// Opcional (ADR-0010) — contatos: descoberta + perfil. chatId NÃO é opaco (diferente de
// groupId) — é o mesmo chatId de mensagens. Campos de Contact são opcionais: nem todo
// provider confirma tudo numa única chamada (ex.: nome de exibição pode vir undefined).
if (wa.supports('contacts.checkExists')) {
  const { exists } = await wa.contacts.checkExists('5585999999999');
  if (exists && wa.supports('contacts.get')) {
    const contact = await wa.contacts.get('5585999999999');
    console.log(contact.name, contact.about, contact.profilePictureUrl);
  }
}

// Opcional (ADR-0010) — moderação. listBlocked não é suportado por todos os providers
// (ex. WAHA/Z-API) — confira wa.supports antes.
if (wa.supports('contacts.block')) {
  await wa.contacts.block('5585999999999');
  await wa.contacts.unblock('5585999999999');
}
if (wa.supports('contacts.listBlocked')) {
  const blocked = await wa.contacts.listBlocked();
}
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
