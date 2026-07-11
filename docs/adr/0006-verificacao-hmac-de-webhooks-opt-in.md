# ADR-0006: Verificação HMAC de webhooks é opt-in (adapter WAHA)

- Status: aceito
- Data: 2026-07-10

## Contexto

O adapter WAHA nunca verificava a assinatura dos webhooks, embora o próprio WAHA suporte isso:
quando `hmac.key` (por sessão) ou `WHATSAPP_HOOK_HMAC_KEY` (global) está configurado no servidor,
toda entrega de webhook carrega os headers `X-Webhook-Hmac` (HMAC-SHA512 do corpo) e
`X-Webhook-Hmac-Algorithm: sha512` (ver docs/providers/waha.md#webhooks). Sem verificação, qualquer
um que descubra a URL do webhook pode forjar eventos (`message`, `message.ack`, `session.status`)
e o adapter os processa como legítimos.

Verificar HMAC exige o **corpo bruto** do request (os bytes/string exatos recebidos, antes do
`JSON.parse` do body-parser do framework do consumidor) — não o objeto já parseado. Reserializar
um objeto JS com `JSON.stringify(JSON.parse(raw))` não é garantidamente idêntico byte-a-byte ao
`raw` original (ordem de chaves, espaçamento, escaping variam por implementação de parser/
stringifier), então comparar o HMAC contra essa reserialização seria incorreto e instável
("funciona no teste, falha em produção" dependendo do framework). O tipo `WebhookInput` do core
(`src/core/adapter.ts`) só tinha `{ headers?, query?, body: unknown }`, assumindo o corpo já
parseado — não havia como o adapter acessar os bytes originais.

## Decisão

1. `WebhookInput` ganha um campo opcional `rawBody?: string` (mudança aditiva — adapters e
   consumidores existentes que não leem esse campo continuam funcionando exatamente igual).
2. `WahaOptions` ganha um campo opcional `webhookHmacKey?: string`, espelhando a chave configurada
   no servidor WAHA.
3. Quando `webhookHmacKey` está configurada:
   - Se `input.rawBody` estiver presente: `parseWebhook` calcula
     `HMAC-SHA512(webhookHmacKey, rawBody)` e compara (via `crypto.timingSafeEqual`, com checagem
     de tamanho antes para não lançar por buffers de tamanho diferente) contra o header
     `X-Webhook-Hmac` (busca case-insensitive, já que frameworks normalizam nomes de header de
     formas diferentes). Assinatura ausente ou inválida ⇒ evento `unknown` com `reason`
     explicando o motivo; o payload NUNCA é processado como legítimo.
   - Se `input.rawBody` estiver ausente: **falha fechada** — tratado como não verificável, evento
     `unknown` com `reason` explicando que `rawBody` é necessário. Nunca assume "válido" só porque
     não dá para checar.
4. Quando `webhookHmacKey` **não** está configurada: comportamento idêntico ao anterior à mudança,
   sem verificação — nenhuma quebra para quem não configurar o campo.
5. Isso é **opt-in**, não obrigatório por padrão.

## Justificativa

- **Por que opt-in e não obrigatório**: verificação exige `rawBody`, e capturar o corpo bruto
  antes do body-parser é um passo extra que nem todo consumidor vai adicionar imediatamente (ex.:
  Express precisa de um `verify` callback no `express.json()`, ver docs/providers/waha.md). Tornar
  a verificação obrigatória quebraria toda integração existente que já usa `webhooks.parse`/
  `webhooks.dispatch` sem passar `rawBody` — inaceitável para uma mudança de segurança que deveria
  ser estritamente aditiva.
- **Por que falhar fechado quando `rawBody` falta mas a chave está configurada**: o consumidor que
  configurou `webhookHmacKey` está explicitamente pedindo verificação. Se o adapter não consegue
  verificar, processar o payload mesmo assim daria uma falsa sensação de segurança (a opção existe,
  mas silenciosamente não faz nada). Devolver `unknown` com `reason` claro é observável e não
  quebra o contrato "parse nunca lança" (ADR-0003).
- **Por que `rawBody` no core (`WebhookInput`) e não só no adapter WAHA**: o problema (verificação
  de assinatura exige bytes originais) não é específico do WAHA — qualquer futuro adapter com HMAC
  próprio (Z-API, Whapi, etc.) precisará do mesmo campo. Centralizar evita cada adapter inventar
  seu próprio nome de campo para a mesma necessidade.
- **Por que `timingSafeEqual` com checagem de tamanho manual**: comparação ingênua com `===`
  vaza timing information que facilita ataques de força bruta byte-a-byte contra a assinatura;
  `timingSafeEqual` do Node evita isso, mas lança se os buffers tiverem tamanhos diferentes — uma
  assinatura de tamanho errado é só "inválida", não deveria virar uma exceção não tratada.

## Consequências

- Consumidores que querem essa proteção precisam de duas mudanças no lado deles: (a) capturar o
  corpo bruto do request e passar como `rawBody` ao chamar `parseWebhook`/`webhooks.dispatch`, e
  (b) configurar `webhookHmacKey` no adapter com o mesmo valor de `hmac.key`/
  `WHATSAPP_HOOK_HMAC_KEY` do servidor WAHA. Documentado com exemplo Express em
  docs/providers/waha.md.
- Consumidores que não configurarem `webhookHmacKey` continuam expostos ao problema original
  (forjar eventos via URL do webhook) — a mitigação é opt-in, não automática. Fica registrado como
  risco aceito na documentação do provider.
- Futuros adapters com verificação de assinatura própria devem reusar `WebhookInput.rawBody` em vez
  de inventar um campo novo.
- A suite de contrato compartilhada (`test/contract/adapter-contract.ts`) não exige HMAC — é um
  comportamento específico do WAHA, testado em `test/contract/waha.contract.test.ts`.
