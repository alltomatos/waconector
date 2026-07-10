# ADR-0004: Zero dependências de runtime

- Status: aceito
- Data: 2026-07-10

## Contexto

Todos os providers-alvo expõem APIs REST/JSON. Node ≥ 20 tem `fetch`, `AbortController`, `URL` e
`crypto` nativos.

## Decisão

O pacote publicado não tem NENHUMA dependência de runtime. HTTP via `fetch` nativo encapsulado no
`HttpClient` do core (timeout, retry/backoff, erros tipados, redação de segredos). Validação de
payloads via type guards manuais, não via bibliotecas de schema.

## Justificativa

- Selling point de adoção: instalação instantânea, zero superfície de supply chain, sem conflitos
  de versão com o app hospedeiro.
- APIs REST simples não justificam axios/zod.

## Consequências

- `engines.node >= 20` obrigatório.
- Type guards manuais dão mais trabalho que zod; o padrão `asString`/`asNumber` do MockAdapter é o
  modelo a seguir nos adapters.
- Revisitar apenas se validação manual virar gargalo comprovado (novo ADR).
