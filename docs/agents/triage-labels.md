# Vocabulário de triage

Labels no GitHub (`alltomatos/waconector`), vocabulário padrão do `/setup-skills`:

| Label | Significado |
| --- | --- |
| `needs-triage` | Ainda não avaliada — estado inicial de toda issue nova. |
| `needs-info` | Falta informação de quem abriu para prosseguir. |
| `ready-for-agent` | Escopo claro o suficiente para um agente implementar. |
| `ready-for-human` | Precisa de decisão de arquitetura/produto antes de codificar. |
| `wontfix` | Não será feita (label padrão do GitHub, reaproveitada). |

Labels específicas deste projeto (já existiam antes deste setup, mantidas):

| Label | Uso |
| --- | --- |
| `bug`, `enhancement`, `documentation`, `question`, `duplicate`, `invalid`, `good first issue`, `help wanted` | Padrão do GitHub. |
| `dependencies`, `github_actions`, `javascript` | Aplicadas automaticamente pelo Dependabot. |

O template de issue "novo adapter" (`.github/ISSUE_TEMPLATE/new_adapter.yml`) não aplica label de
triage automaticamente — quem for triar decide entre `ready-for-agent` (se o dossiê já vier
completo) ou `needs-info` (se faltar auth/endpoints).
