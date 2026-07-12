# Exemplo: Next.js (App Router) + waconector

Bot mínimo com um webhook via API route, usando `MockAdapter` por padrão — roda sem nenhuma
credencial real.

## Rodar

```bash
npm install
npm run dev
```

Com o servidor rodando em `http://localhost:3000`, simule uma mensagem recebida:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "content-type: application/json" \
  -d '{"event":"message","from":"5585999999999","text":"oi"}'
```

O console do `next dev` imprime a mensagem recebida (via `MockAdapter`, sem rede real).

## Trocar para um provider real

Edite `app/api/webhook/route.js`: troque o import de `waconector/testing` (`MockAdapter`) e a
linha `adapter.simulateConnected()` por um adapter real, por exemplo:

```js
import { waha } from 'waconector/waha';

const adapter = waha({
  baseUrl: process.env.WACONECTOR_BASE_URL,
  apiKey: process.env.WACONECTOR_API_KEY,
});
```

Copie `.env.example` para `.env.local` (convenção do Next.js) e preencha com as credenciais reais
do provider escolhido — as mesmas variáveis `WACONECTOR_*` que `npx waconector doctor` usa (veja o
README na raiz do projeto para o esquema completo por provider).
