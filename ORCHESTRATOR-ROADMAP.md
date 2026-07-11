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

Estado: **in_progress**

- [x] `.claude/config.json` e `.claude/context7.json`
- [x] `docs/agents/` (issue-tracker.md, triage-labels.md, domain.md) via `/setup-skills --silent`
- [x] Labels de triage no GitHub (`needs-triage`, `needs-info`, `ready-for-agent`,
      `ready-for-human`; `wontfix` já existia)
- [x] Bloco `## Agent skills` em `CLAUDE.md`
- [x] Este arquivo (`ORCHESTRATOR-ROADMAP.md`)
- [ ] Auditoria técnica (Fase 3 do orchestrator): GAPs P1-P4 classificados por tier de risco
- [ ] Aprovação do usuário para GAPs T3 (bloqueantes), se houver

## Epic 3 — F2 do produto: largura

Estado: **todo** (detalhe completo em docs/CONTEXT.md#roadmap)

- [ ] Adapters: uazapi, Z-API, Wuzapi
- [ ] Capabilities novas: grupos, contatos, reply/quote, reactions

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
