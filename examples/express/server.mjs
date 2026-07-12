// Bot mínimo: Express + waconector, usando MockAdapter por padrão (sem credenciais reais).
// Para conectar a um provider real, veja README.md deste diretório.
import express from 'express';
import { createConnector } from 'waconector';
import { MockAdapter } from 'waconector/testing';

const adapter = new MockAdapter();
const wa = createConnector(adapter);
adapter.simulateConnected();

wa.on('message.received', async (event) => {
  console.log(`[waconector] recebido de ${event.message.chatId}: ${event.message.text}`);
  if (event.message.text) {
    await wa.messages.sendText({ to: event.message.chatId, text: `Eco: ${event.message.text}` });
  }
});

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  await wa.webhooks.dispatch({ headers: req.headers, body: req.body });
  res.sendStatus(200);
});

app.post('/send', async (req, res) => {
  const { to, text } = req.body ?? {};
  if (typeof to !== 'string' || typeof text !== 'string') {
    res.status(400).json({ error: 'Body precisa de { to, text } como strings.' });
    return;
  }
  res.json(await wa.messages.sendText({ to, text }));
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`waconector example (Express) ouvindo em http://localhost:${port}`);
  console.log('Simule uma mensagem recebida:');
  console.log(
    `  curl -X POST http://localhost:${port}/webhook -H "content-type: application/json" -d '{"event":"message","from":"5585999999999","text":"oi"}'`,
  );
});
