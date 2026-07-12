# Exemplo: Express + waconector

Bot mínimo que expõe um webhook e um endpoint de envio, usando `MockAdapter` por padrão — roda
sem nenhuma credencial real.

## Rodar

```bash
npm install
npm start
```

O servidor sobe em `http://localhost:3001` (configurável via `PORT`). Assim que subir, ele
imprime um `curl` de exemplo pra simular uma mensagem recebida — copie e cole em outro terminal:

```bash
curl -X POST http://localhost:3001/webhook \
  -H "content-type: application/json" \
  -d '{"event":"message","from":"5585999999999","text":"oi"}'
```

O bot ecoa a mensagem de volta (via `MockAdapter`, então o "envio" só aparece no console/`outbox`
em memória — nada sai pela rede de verdade).

Envie uma mensagem diretamente:

```bash
curl -X POST http://localhost:3001/send \
  -H "content-type: application/json" \
  -d '{"to":"5585999999999","text":"oi do bot"}'
```

## Trocar para um provider real

Edite `server.mjs`: troque o import de `waconector/testing` (`MockAdapter`) e a linha
`adapter.simulateConnected()` por um adapter real, por exemplo:

```js
import { waha } from 'waconector/waha';

const adapter = waha({
  baseUrl: process.env.WACONECTOR_BASE_URL,
  apiKey: process.env.WACONECTOR_API_KEY,
});
```

Copie `.env.example` para `.env`, preencha com as credenciais reais do provider escolhido (as
mesmas variáveis `WACONECTOR_*` que `npx waconector doctor` usa — veja o README na raiz do
projeto para o esquema completo por provider) e rode com:

```bash
node --env-file=.env server.mjs
```

`--env-file` exige Node ≥ 20.6 — em versões 20.x mais antigas, exporte as variáveis manualmente no
shell antes de rodar `npm start`.
