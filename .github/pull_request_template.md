## O quê e por quê

<!-- Descreva a mudança e a motivação. Se fecha uma issue, use "Closes #123". -->

## Checklist de QA

- [ ] `npm run lint` passa
- [ ] `npm run typecheck` passa
- [ ] `npm test` passa (suite completa, incluindo a suite de contrato)
- [ ] `npm run build` e `npm run smoke` passam (se você mexeu em `src/`, `package.json` ou `tsup.config.ts`)
- [ ] Cobertura não regrediu (`npm run test:coverage` — os thresholds em `vitest.config.ts` travam isso no CI, mas rode local antes de abrir o PR)
- [ ] Adicionei um changeset (`npx changeset`) se esta mudança afeta o pacote publicado

## Se este PR adiciona/altera um adapter de provider

- [ ] Dossiê em `docs/providers/<nome>.md` atualizado (auth, endpoints, payloads de webhook)
- [ ] Todo exemplo de payload está marcado como **verbatim** (copiado da doc oficial) ou
      **reconstruído** (inferido/heurística) — não deixe ambíguo
- [ ] `capabilities` declaradas batem exatamente com o que foi implementado (nem mais, nem menos)
- [ ] `parseWebhook` nunca lança (payload desconhecido vira evento `unknown`)
- [ ] Segredos (`apiKey`/token) passados em `HttpClient({ secrets: [...] })` para redação em erros
- [ ] Testado contra a suite de contrato compartilhada (`test/contract/adapter-contract.ts`)
