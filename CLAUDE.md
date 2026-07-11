# waconector — guia do agente

Pacote npm TypeScript: conector universal para APIs não-oficiais de WhatsApp. Contrato único no
core + um adapter por provider, publicado como pacote único com subpath exports.

## Leia antes de mexer

- `docs/CONTEXT.md` — linguagem do domínio, princípios, roadmap (F0 ✅ → F1 adapters WAHA/Evolution GO).
- `docs/adr/` — decisões: pacote único (0001), `raw` sempre presente (0002), webhooks canônicos que
  nunca lançam (0003), zero dependências de runtime (0004), capabilities declaradas (0005).

## Comandos

```bash
npm test            # vitest: unit + suite de contrato
npm run typecheck   # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run lint        # biome check .
npm run build       # tsup → dist/
npm run smoke       # exercita o dist/ (rodar após build)
```

## Convenções inegociáveis

- **Zero dependências de runtime.** HTTP só via `HttpClient` do core (`src/core/http.ts`).
- **Adapter é burro**: só traduz de/para o provider. Validação, capabilities, retry e eventos são
  do conector (`src/core/connector.ts`).
- Todo objeto normalizado carrega `raw`. Parsing de payloads externos com type guards manuais
  (padrão `asString`/`asNumber` de `src/testing/mock-adapter.ts`).
- `parseWebhook` retorna evento `unknown` para o que não reconhece — nunca lança.
- Tokens jamais em mensagens de erro/log: registre-os em `secrets` do `HttpClient`.
- Erros sempre `WaConnectorError` com `code`; checagem por `isWaConnectorError` (duck-typing), não
  `instanceof`.

## Para criar um adapter novo (F1+)

1. Dossiê primeiro: `docs/providers/<nome>.md` (template no README da pasta) com payloads reais.
2. `src/adapters/<nome>/` com `fixtures/` dos payloads.
3. Implementar `WaAdapter`; declarar apenas capabilities realmente suportadas.
4. Registrar na suite de contrato (`test/contract/`) — precisa passar 100%.
5. Adicionar subpath export em `package.json` + entrada no `tsup.config.ts`.
6. `npx changeset` descrevendo a mudança.

## Agent skills

- **Domain skill**: `.claude/skills/waconector/` — SKILL.md roteia para
  `CONTRIBUTING-WORKFLOW.md` (contribuidores) ou `USAGE.md` (consumidores do pacote).
- **Governança de docs/tracker**: `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`,
  `docs/agents/domain.md` (single-context; ver `docs/agents/domain.md`).
- **Modelo de branches**: `main` protegido, `develop` de integração — ver
  [CONTRIBUTING.md#modelo-de-branches](../CONTRIBUTING.md) e o job `guard-main-source` em
  `.github/workflows/ci.yml`.
- **Roadmap operacional do orchestrator**: `ORCHESTRATOR-ROADMAP.md` (raiz) — estado tático de
  Epics/tarefas; `docs/CONTEXT.md` continua sendo a fonte da verdade do domínio e do roadmap de
  produto (F0/F1/F2/F3).
