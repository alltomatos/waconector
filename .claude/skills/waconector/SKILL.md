---
name: waconector
description: Domain expertise for the waconector project — a contract-first universal connector for unofficial WhatsApp APIs (WAHA, Evolution GO, uazapi, Z-API, Wuzapi, Whapi, Zapo, QuePasa). Covers both extending the package (adding/reviewing a provider adapter, core conventions) and consuming it (wiring an adapter, handling webhooks, testing with MockAdapter). Use when working in the waconector repo, implementing or reviewing a provider adapter, or integrating the `waconector` npm package into a bot/app.
---

# waconector

Duas audiências, dois workflows. Descubra qual se aplica antes de agir.

## Qual dos dois você é?

- **Estendendo/mantendo o waconector** (adicionar um adapter, mexer no core, revisar um PR) →
  [CONTRIBUTING-WORKFLOW.md](CONTRIBUTING-WORKFLOW.md).
- **Consumindo o pacote** (`npm install waconector` num projeto seu, construindo um bot) →
  [USAGE.md](USAGE.md).

## O que é o waconector (contexto rápido)

- Contrato único (`WaAdapter`) + um adapter por provider. WAHA e Evolution GO implementados (F1);
  demais providers planejados para F2/F3.
- `createConnector(adapter)` adiciona validação de entrada, checagem de capabilities, eventos
  canônicos e parsing seguro de webhook por cima de um adapter "burro" (que só traduz de/para o
  provider).
- Zero dependências de runtime (`fetch` nativo, Node ≥ 20). Pacote único com subpath exports
  (`waconector/waha`, `waconector/evolution`, `waconector/testing`).
- Fonte da verdade: [docs/CONTEXT.md](../../../docs/CONTEXT.md) (linguagem do domínio, roadmap) e
  [docs/adr/](../../../docs/adr/) (decisões e o porquê). Esta skill resume o suficiente para agir
  rápido — para o detalhe completo, vá sempre a esses documentos.

## Regras que nunca se quebram (qualquer um dos dois papéis)

- `raw` sempre presente em todo objeto normalizado ([ADR-0002](../../../docs/adr/0002-normalizar-o-comum-preservar-raw.md)).
- `parseWebhook`/`wa.webhooks.parse` nunca lança — payload não reconhecido vira evento `unknown`.
- Capabilities declaradas batem exatamente com o que está implementado (nem mais, nem menos).
- Segredos (`apiKey`/token) nunca em texto puro em erros/logs.

## Antes de qualquer PR

```
npm run lint && npm run typecheck && npm test && npm run build && npm run smoke
```

Checklist completo (incluindo o específico de PRs de adapter) em
[CONTRIBUTING-WORKFLOW.md](CONTRIBUTING-WORKFLOW.md) e em
[.github/pull_request_template.md](../../../.github/pull_request_template.md).
