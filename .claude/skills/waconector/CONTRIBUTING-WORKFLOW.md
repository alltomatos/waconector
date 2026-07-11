# Workflow de contribuição (waconector)

Para quem está estendendo ou mantendo o pacote waconector em si — não para quem só o consome.

## Modelo mental

- `src/core/` = o contrato. Interface `WaAdapter`, tipos canônicos, enum de capabilities,
  `HttpClient`, eventos canônicos, normalização de chatId, `WaConnectorError`.
- `src/adapters/<provider>/` = um tradutor "burro" por provider (map-out/map-in). Nunca duplica
  validação, retry ou checagem de capabilities — isso é papel do conector.
- `createConnector(adapter)` = o único lugar onde validação, gating de capabilities, emissão de
  eventos e parsing seguro de webhook acontecem.
- `src/testing/mock-adapter.ts` = implementação de referência + test double, publicada como
  `waconector/testing`.

Leia [docs/CONTEXT.md](../../../docs/CONTEXT.md) e [docs/adr/](../../../docs/adr/) antes de mexer em
`src/core/` — toda regra não óbvia ali tem um porquê registrado num ADR.

## Adicionando um adapter de provider novo (dossiê primeiro)

1. **Dossiê antes de código.** Escreva `docs/providers/<nome>.md` a partir da documentação oficial
   e, se o provider for open source, do código-fonte real — a documentação de terceiros
   frequentemente diverge do comportamento real (aconteceu com o Evolution GO: a doc e o próprio
   wiki do repo erravam em vários pontos que só o `.go` fonte revelou). Marque todo fato como
   confirmado vs. suposição, e todo payload de exemplo como verbatim ou reconstruído.
2. **Fixtures.** Salve payloads de webhook reais (ou claramente marcados como reconstruídos) em
   `src/adapters/<nome>/fixtures/`.
3. **Implemente** `src/adapters/<nome>/index.ts`: uma função fábrica (`waha(options)`,
   `evolution(options)`) que devolve um `WaAdapter`. Use os adapters existentes como referência de
   estilo — type guards manuais (`asString`/`asNumber`/`asRecord`), nunca zod/bibliotecas de schema
   (ADR-0004).
4. **Declare capabilities com precisão** — só o que está de fato implementado
   (`src/core/capabilities.ts`). Não arredonde para cima.
5. **Registre na suite de contrato compartilhada** (`test/contract/adapter-contract.ts`, via
   `describeAdapterContract`) — todo adapter precisa passar, sem exceção. Adicione testes
   específicos do provider ao lado (mapeamento de chatId, endpoint por tipo de mídia, mapeamento de
   ack, etc.) usando um stub de `fetch` injetável — nunca rede real ou credenciais reais nos testes.
6. **Registre o subpath export**: entrada em `tsup.config.ts` (`entry`) + `exports` em
   `package.json`.
7. Adicione um changeset (`npx changeset`) descrevendo o impacto do ponto de vista de quem consome
   o pacote.

## Revisando um PR de adapter — o que checar de verdade

Não basta rodar os testes — eles foram escritos no mesmo PR. Verifique especificamente:

- O header/mecanismo de auth no código bate com o dossiê e (idealmente) com a doc real?
- Os paths/métodos dos endpoints batem com o dossiê, ou foram inventados?
- `parseWebhook` realmente nunca lança (type guards defensivos, sem acesso de propriedade sem
  guarda)?
- As `capabilities` declaradas batem exatamente com o implementado?
- Segredos passam por `HttpClient({ secrets: [...] })`?
- Direção do mapeamento de chatId: canônico → provider. Adapters recebem um `to` **já normalizado**
  pelo conector — nunca chame `normalizeChatId` de novo dentro de um adapter.

Este é essencialmente o checklist que uma passada de revisão adversarial deveria rodar.

## Gate de QA (todo PR)

```
npm run lint
npm run typecheck
npm test              # inclui a suite de contrato compartilhada
npm run test:coverage # thresholds em vitest.config.ts são um piso, não uma meta — ver docs/CONTEXT.md
npm run build
npm run smoke
```

Os thresholds de cobertura são calibrados contra o baseline real (não inventados) — subi-los nos
ramos de fallback/erro dos adapters é uma boa primeira contribuição, não um bloqueador para tudo o
resto.

## Mudanças no core (`src/core/`)

Barra mais alta: afetam todo adapter existente. Se for uma mudança que quebra `WaAdapter` /
`CanonicalEvent` / `CAPABILITIES`, ainda é aceitável pré-1.0, mas precisa ser consciente e
documentada — escreva um novo ADR em `docs/adr/` (numerado sequencialmente) explicando o porquê, não
só o quê.

## Referências

- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — a versão canônica e completa deste workflow.
- [docs/providers/README.md](../../../docs/providers/README.md) — template de dossiê.
- [.github/pull_request_template.md](../../../.github/pull_request_template.md) — checklist real de PR.
