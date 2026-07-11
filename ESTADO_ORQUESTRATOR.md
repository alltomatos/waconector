# ESTADO_ORQUESTRATOR.md

Matriz DAG da Fase 4 — GAPs aprovados em 2026-07-10 (ver histórico da conversa para o diagnóstico
completo da Fase 3).

### Tarefas

- [x] T1: GAP1 — Verificação HMAC de webhooks WAHA (T3, aprovado) | depends_on: []
- [x] T2: GAP3 — `raw` obrigatório em ConnectResult/InstanceStatus (T2) | depends_on: []
- [x] T3: GAP4+GAP5 — Retry idempotente + `Retry-After` no HttpClient (T2) | depends_on: []
- [x] T4: GAP6 — Smoke test cobrindo subpath exports de adapter (T2) | depends_on: []
- [x] T5: GAP8 — Testes/doc de `MockAdapter.simulateState`/`sendMedia` (T2) | depends_on: []
- [x] T6: GAP2+GAP7 — Fork-check no `guard-main-source` + nota de exceção no CONTRIBUTING (T2/T1) | depends_on: [T1]

**Status**: todas as 6 tarefas concluídas em 2026-07-10. Validação independente após a execução:
lint limpo, typecheck limpo, 87/87 testes, cobertura acima dos thresholds (79.9/64.4/96.0/83.5%,
subiu do baseline 78.5/62.3/94.2/81.9%), build e smoke (incluindo os subpath exports de adapter)
passando. Nenhum commit/push foi feito pelos agentes — feito manualmente após revisão.

Motivo da dependência T6→T1: GAP7 adiciona um comentário em `src/adapters/waha/index.ts`, o
mesmo arquivo que T1 (GAP1) reescreve substancialmente. Rodar em paralelo arriscaria conflito de
edição no mesmo arquivo — por isso T6 espera T1 terminar. As demais tarefas (T2-T5) não têm
sobreposição de arquivo entre si nem com T1, então rodam em paralelo sem isolamento de worktree.

### Execução

1. T1 sozinho (worktree, por ser "grande fatia" — múltiplos arquivos, lógica nova, ADR novo).
2. T2, T3, T4, T5, T6 em paralelo após T1 validar (sem worktree — arquivos disjuntos confirmados).
3. Consolidação: revisão manual + suite completa (lint/typecheck/test/coverage/build/smoke) antes
   de commitar.
