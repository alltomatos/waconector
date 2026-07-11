---
"waconector": minor
---

`messages.sendReaction` implementado nos 5 adapters existentes (uazapi, Evolution GO, WAHA,
Z-API, Wuzapi) — retrofit previsto pelo ADR-0008 (que introduziu a capability opcional no core
sem alterar nenhum adapter). Cada adapter passa a declarar `messages.sendReaction` em seu
`CapabilitySet` e a implementar `MessagesApi.sendReaction`, traduzindo `SendReactionInput` para o
endpoint de reação nativo do provider; emoji vazio (`''`) remove uma reação já enviada, seguindo a
convenção do próprio WhatsApp. Dossiês atualizados em `docs/providers/*.md` e cobertura estendida
em `test/contract/*.contract.test.ts` (via o teste condicional já preparado em
`test/contract/adapter-contract.ts`).
