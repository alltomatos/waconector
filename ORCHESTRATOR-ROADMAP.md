# ORCHESTRATOR-ROADMAP.md

Roadmap **tático/operacional** do orchestrator — Epics, Milestones e estado de execução.

> Este arquivo **não** é a fonte da verdade do roadmap de produto/domínio do waconector — isso é
> [docs/CONTEXT.md](docs/CONTEXT.md) (fases F0-F3, princípios, linguagem do domínio). Aqui só
> rastreamos o trabalho operacional do próprio orchestrator sobre esse roadmap.

## Epic 1 — Fundação e F1 do produto

Estado: **done**

- [x] F0 — Fundação (core, MockAdapter, suite de contrato, CI/release) — ver docs/CONTEXT.md#roadmap
- [x] F1 — Adapters WAHA e Evolution GO, QA (cobertura, templates, CONTRIBUTING), skill
      `waconector`, modelo de branches (`main` protegido / `develop`) — mergeado via
      [PR #1](https://github.com/alltomatos/waconector/pull/1)

## Epic 2 — Governança de agente (orchestrator bootstrap)

Estado: **done**

- [x] `.claude/config.json` e `.claude/context7.json`
- [x] `docs/agents/` (issue-tracker.md, triage-labels.md, domain.md) via `/setup-skills --silent`
- [x] Labels de triage no GitHub (`needs-triage`, `needs-info`, `ready-for-agent`,
      `ready-for-human`; `wontfix` já existia)
- [x] Bloco `## Agent skills` em `CLAUDE.md`
- [x] Este arquivo (`ORCHESTRATOR-ROADMAP.md`)
- [x] Auditoria técnica (Fase 3): 8 GAPs (P1-P4) — ver `ESTADO_ORQUESTRATOR.md`
- [x] Aprovação do usuário e correção de todos os GAPs (incluindo GAP1, T3 — verificação HMAC de
      webhooks WAHA) — mergeado via [PR #6](https://github.com/alltomatos/waconector/pull/6)

## Epic 2.1 — Automação de CI (não planejada originalmente, adicionada a pedido do usuário)

Estado: **done**

- [x] `docs-sync.yml` — pós-merge em `main`, agente revisa o diff e atualiza docs/ADRs/wiki quando
      necessário, commitando em `develop`
- [x] `claude-code-review.yml` — revisão automática de código em todo PR (via `/install-github-app`)
- [x] Ambos mergeados em `main` via [PR #8](https://github.com/alltomatos/waconector/pull/8)
- [x] Bug real na primeira execução (`docs-sync` faltava `id-token: write`) — corrigido em
      `develop`, **pendente de PR para `main`** para a correção entrar em vigor

## Epic 3 — F2 do produto: largura

Estado: **in_progress** (detalhe completo em docs/CONTEXT.md#roadmap)

- [x] Adapter uazapi (SaaS multi-tenant) — dossiê, implementação e auditoria adversarial (achou e
      corrigiu 2 issues "major": suposição errada de `messageType` e risco de formato de envelope
      de webhook) — [PR #11](https://github.com/alltomatos/waconector/pull/11)
- [x] Adapter Z-API (SaaS brasileiro) — dossiê, implementação e auditoria adversarial (achou e
      corrigiu 2 issues "major": endpoint /send-sticker existente mas descartado, e messageId de
      citação em /send-text não mapeado) — [PR #12](https://github.com/alltomatos/waconector/pull/12)
- [x] Adapter Wuzapi (self-hosted, whatsmeow) — dossiê pesquisado direto no código-fonte Go;
      auditoria adversarial achou e corrigiu 1 bug real e sutil (QR code nunca extraído do webhook
      porque o teste original mascarava o bug com um fixture que não refletia o payload real) —
      PR pendente de abertura. **Fecha a lista original de 3 providers da F2** (uazapi/Z-API/Wuzapi).
- [ ] Capabilities novas: grupos, contatos, reply/quote, reactions (ainda não iniciado)

## Marcos de release (v0.x)

- [x] **v0.1.0** publicado no npm (2026-07-10/11) — F1 completa (WAHA + Evolution GO)
- [ ] **v0.2.0** — uazapi + Z-API + Wuzapi (3 changesets pendentes, aguardando decisão de quando
      publicar)

## Epic 4 — F3 do produto: profundidade e DX

Estado: **todo**

- [ ] Adapters: Whapi, Zapo, QuePasa
- [ ] Site de docs com matriz de capabilities gerada do código
- [ ] Exemplos de bot (Express/Next), `npx waconector doctor`

## Epic 5 — v1.0

Estado: **todo**

- [ ] 3+ adapters passando 100% da suite de contrato
- [ ] API pública estável (sem breaking changes não documentados)

---

Atualize este arquivo ao concluir cada milestone; o detalhe de *por quê* de cada fase do produto
continua em [docs/CONTEXT.md](docs/CONTEXT.md) e nos [ADRs](docs/adr/).
