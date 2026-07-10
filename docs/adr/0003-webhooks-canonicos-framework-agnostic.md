# ADR-0003: Webhooks canônicos, framework-agnostic, parse que nunca lança

- Status: aceito
- Data: 2026-07-10

## Contexto

Receber mensagens é o maior valor do pacote e a maior dor: cada provider envia webhooks com
formatos e nomes de evento próprios, e novos tipos de evento aparecem sem aviso.

## Decisão

1. Eventos canônicos (`message.received`, `message.sent`, `message.ack`, `connection.update`,
   `group.update`, `unknown`) definidos no core; todo adapter traduz para eles.
2. A entrada é `{ headers, body, query }` (`WebhookInput`), nunca o `req` de um framework.
3. `connector.webhooks.parse` **nunca lança**: payload irreconhecível ou exceção do adapter viram
   evento `unknown` com `reason`.

## Justificativa

- Framework-agnostic: funciona igual em Express, Fastify, Next.js e Cloudflare Workers.
- Um endpoint de webhook que responde 500 por causa de um evento novo do provider gera tempestade
  de retries — `unknown` degrada graciosamente e mantém o evento observável.

## Consequências

- Consumidores que precisam de eventos ainda não mapeados leem `raw` do evento `unknown`.
- Adapters DEVEM retornar `unknown` para o que não reconhecem, nunca lançar (o conector garante
  isso de qualquer forma, como cinto de segurança).
