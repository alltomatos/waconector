# ADR-0011: CLI `doctor` e exemplos de bot como entregáveis separados do core

- Status: aceito
- Data: 2026-07-11

## Contexto

Último item pendente do roadmap da F3: "Exemplos de bot (Express/Next), `npx waconector doctor`".
Sem design prévio em nenhum lugar do repositório — precisava decidir de zero como um comando de
diagnóstico e exemplos de integração se encaixam num pacote com zero dependências de runtime
(ADR-0004) e sem nenhum entry point de CLI existente.

## Decisão

- **CLI em `src/cli/`, não `scripts/`**: `src/cli/doctor.ts` (lógica pura, testável) +
  `src/cli/index.ts` (parsing de argv + I/O + `process.exit`). Fica em `src/` porque é parte do
  pacote PUBLICADO (`package.json#bin`), diferente de `scripts/*.mjs` (dev-tooling nunca
  publicado).
- **`node:util.parseArgs`, não uma lib de CLI**: zero dependência de runtime nova — consistente com
  ADR-0004, que não abre exceção para um entry point de CLI.
- **Build ESM-only para a CLI**: `tsup.config.ts` vira array de 2 configs — a biblioteca (ESM+CJS+
  dts, como sempre) e um bloco só para `cli/index`, `format: ['esm']`, sem `.d.ts` (não existe
  subpath `waconector/cli` no mapa de `exports` — a CLI só é executada, nunca importada). O shebang
  vem do `banner` do tsup, não do código-fonte — colocar `#!/usr/bin/env node` nos DOIS lugares
  gera uma segunda linha começando com `#`, que quebra o parse (`#` fora da primeira linha não é
  sintaxe JS válida). Achado durante a implementação, não hipotético.
- **`doctor` só chama `instance.status()`, nunca `connect()`**: `connect()` é side-effecting em
  vários providers (WPPConnect pode disparar `waitQrCode`; QuePasa devolve QR como PNG binário cru,
  incompatível com o `HttpClient` atual — ver `docs/providers/quepasa.md`). Um comando de
  diagnóstico precisa ser seguro de rodar repetidamente, a qualquer momento, sem side effects no
  provider.
- **Configuração via variáveis `WACONECTOR_*`, não arquivo de config**: uma tabela
  (`PROVIDER_FIELDS` em `src/cli/doctor.ts`) mapeia os campos STRING de cada `XxxOptions` real para
  uma env var genérica (`WACONECTOR_BASE_URL`, `WACONECTOR_TOKEN`, etc.) — não prefixada por
  provider, já que cada invocação mira exatamente 1 provider via `--provider`. Mesmo esquema é
  reusado pelos exemplos (`examples/*/README.md`), para consistência entre as duas entregas.
- **Exemplos são projetos separados, não publicados**: `examples/express/` e `examples/nextjs/`
  têm `package.json` próprio (`"waconector"` do registry npm, não link local), fora de qualquer
  workspace na raiz. Consistente com o espírito "pacote único, não monorepo" do ADR-0001 — esse ADR
  é sobre o modelo de distribuição da BIBLIOTECA, não sobre se o repositório pode conter apps de
  demonstração com seu próprio `npm install`. Ambos usam `MockAdapter` por padrão, então rodam sem
  nenhuma credencial real.

## Justificativa

- Reaproveitar `node:util.parseArgs` em vez de `commander`/`yargs` evita a primeira dependência de
  runtime do pacote, mantendo ADR-0004 intacto mesmo com uma CLI de verdade.
- Separar `doctor.ts` (puro) de `index.ts` (I/O) segue o mesmo padrão já usado em todo o projeto
  para código testável sem rede real (injeção de `fetch`, ver qualquer adapter) — `fetchOverride`
  em `runDoctor`/`buildAdapterForDoctor` é só para teste, nunca uma flag real da CLI.
- Nunca chamar `connect()` no `doctor` evita repetir, num comando de diagnóstico, os mesmos riscos
  de side effect já documentados adapter a adapter (WPPConnect, QuePasa) — um comando cujo próprio
  propósito é "rodar sem medo" não pode ele mesmo introduzir um efeito colateral condicional por
  provider.

## Consequências

- `vitest.config.ts` ganhou `coverage.exclude: ['src/cli/index.ts']` — esse arquivo é só
  encanamento de processo, nunca exercitado por unit test. Compensado por uma extensão em
  `scripts/smoke.mjs` que spawna o binário compilado via subprocess (`--help`, provider
  desconhecido) para validar shebang/banner/argv de ponta a ponta depois do build.
- `PROVIDER_FIELDS` é uma tabela mantida à mão (mesmo espírito de `scripts/adapter-subpaths.mjs`)
  — ao adicionar um campo string novo a algum `XxxOptions`, ou um adapter novo, ela precisa ser
  atualizada também. Campos não-string (`subscribe`, `immediate`, `timeoutMs`, `waitQrCode`, etc.)
  ficam fora do `doctor` nesta fase — os defaults dos adapters se aplicam.
- Exemplos dependem da última versão publicada de `waconector`, não do código local em
  desenvolvimento — o job de CI `examples-smoke` valida contra o registry, não contra `dist/` local
  (mesma experiência de quem copia o exemplo, mas significa que uma mudança breaking ainda não
  publicada não é pega por esse job especificamente).
- `doctor` reporta sucesso (`exit 0`) sempre que a chamada a `status()` completa, independente do
  `state` resultante (`connected`/`disconnected`/etc.) — o escopo é conectividade/auth, não julgar
  se a instância está de fato logada. Qualquer ferramenta futura que precise dessa distinção mais
  forte (`state === 'connected'`) deve ser um comando novo, não uma mudança de contrato do
  `doctor`.
