# Domain layout

**Single-context.** O waconector é um domínio coeso — conector universal de WhatsApp — sem
sub-bounded-contexts que justifiquem um `CONTEXT-MAP.md`.

- Fonte da verdade do domínio: [`docs/CONTEXT.md`](../CONTEXT.md) (não na raiz do repo — convenção
  já estabelecida antes deste setup; mantida por consistência com o restante da documentação).
- Decisões de arquitetura: [`docs/adr/`](../adr/) (5 ADRs até o momento).
- Dossiês por provider (sub-domínio de integração, não bounded context separado):
  [`docs/providers/`](../providers/).
- Guia de contribuição: [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- Skill de domínio para agentes: [`.claude/skills/waconector/`](../../.claude/skills/waconector/)
  (cobre contribuidores e consumidores do pacote).

Se o projeto crescer para múltiplos bounded contexts (pouco provável dado o escopo — é um SDK
único), revisite esta decisão e migre para `CONTEXT-MAP.md`.
