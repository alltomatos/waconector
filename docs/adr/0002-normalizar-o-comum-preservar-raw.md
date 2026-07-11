# ADR-0002: Normalizar o comum, preservar o específico (`raw`)

- Status: aceito
- Data: 2026-07-10

## Contexto

Cada provider tem payloads próprios. Uma abstração que só expõe o mínimo comum empobrece; uma que
expõe tudo de todos vaza especificidades e quebra a portabilidade.

## Decisão

Todo objeto normalizado (`WaMessage`, `SentMessage`, eventos canônicos, `ConnectResult`,
`InstanceStatus`) carrega um campo `raw` com o payload original do provider.

## Justificativa

- O modelo canônico cobre 90% dos casos de uso de forma portável.
- `raw` é a válvula de escape tipável (`raw: unknown`) para os 10% específicos, sem comprometer o
  contrato.

## Consequências

- Código que depende de `raw` é explicitamente não-portável entre providers — decisão consciente
  do consumidor, visível no type system (`unknown` exige narrowing).

## Nota (2026-07-10)

O invariante deixou de depender só de convenção: `raw` é `unknown` obrigatório (sem `?`) em todos
os tipos normalizados de `src/core/types.ts` (incluindo `ConnectResult` e `InstanceStatus`, que
antes eram `raw?: unknown`), e a suite de contrato compartilhada
(`test/contract/adapter-contract.ts`) faz `expect(...).toHaveProperty('raw')` em `instance.connect()`
e `instance.status()` — qualquer adapter que deixar de popular `raw` falha o typecheck e/ou o
contrato, não só uma revisão de código.
