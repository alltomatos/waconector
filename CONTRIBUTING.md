# Contribuindo com o waconector

Obrigado por considerar contribuir! Este guia cobre o setup local, as convenções do projeto e,
principalmente, como propor um adapter de provider novo — o tipo de contribuição mais comum aqui.

## Setup local

```bash
git clone https://github.com/alltomatos/waconector.git
cd waconector
npm install
npm test
```

Scripts disponíveis:

```bash
npm test              # vitest: unit + suite de contrato
npm run test:coverage # idem, com relatório e thresholds de cobertura (vitest.config.ts)
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # biome check .
npm run lint:fix      # biome check --write .
npm run build         # tsup → dist/ (ESM + CJS + tipos)
npm run smoke         # exercita o pacote empacotado (rode após build)

npm run docs:capabilities # gera docs/capabilities.md a partir do código (rode após build)
npm run docs:dev          # site de documentação (VitePress) local, com hot reload
npm run docs:build        # build de produção do site em docs/.vitepress/dist
```

## Antes de codificar

Leia:
- [docs/CONTEXT.md](docs/CONTEXT.md) — linguagem do domínio, princípios de design, roadmap.
- [docs/adr/](docs/adr/) — decisões de arquitetura e o porquê (pacote único, `raw` sempre presente,
  webhooks que nunca lançam, zero dependências de runtime, capabilities declaradas).

Essas decisões não são sugestões: uma mudança que as contradiga (ex.: adicionar uma dependência de
runtime, ou um adapter que lança em `parseWebhook`) provavelmente vai ser pedida para revisar antes
de ser aceita. Se você acha que uma delas deveria mudar, abra uma issue de discussão propondo um
novo ADR em vez de simplesmente divergir no código.

## Convenções inegociáveis

- **Zero dependências de runtime.** Toda chamada HTTP passa pelo `HttpClient` do core
  (`src/core/http.ts`) — nada de axios/got/zod/etc. no pacote publicado.
- **Adapter é "burro".** Ele só traduz de/para o provider (`map-out`/`map-in`). Validação de
  entrada, checagem de capabilities, retry e emissão de eventos são responsabilidade do conector
  (`src/core/connector.ts`) — não duplique essa lógica dentro de um adapter.
  **Exceção explícita:** uma função fábrica de adapter (ex.: `waha()`, `evolution()`) pode incluir
  uma checagem de último recurso equivalente à do conector (ex.: exigir `media.url` ou
  `media.base64` antes de montar o request de `sendMedia`) — é o cinto de segurança para quem
  instancia o adapter diretamente, sem passar por `createConnector`. Isso só é aceitável quando o
  código/mensagem de erro forem consistentes com o que o conector já valida (mesmo
  `WaConnectorError` code, mensagem equivalente) — não é uma licença para o adapter inventar sua
  própria política de validação.
- **`raw` sempre presente.** Todo objeto normalizado que o adapter retorna carrega o payload
  original do provider em `raw`.
- **`parseWebhook` nunca lança.** Payload não reconhecido (ou uma exceção interna) vira um evento
  `{ type: 'unknown', provider, raw, reason }`. O conector já tem uma rede de segurança para isso,
  mas o adapter deve se comportar assim por conta própria.
- **Capabilities declaradas com precisão.** `capabilities` no adapter deve listar exatamente (nem
  mais, nem menos) o que está implementado. Ver `src/core/capabilities.ts`.
- **Segredos nunca em texto puro em erros/logs.** Passe `apiKey`/token para
  `HttpClient({ secrets: [...] })` — ele redige (`***`) qualquer ocorrência em mensagens de erro.
- **Type guards manuais, não bibliotecas de schema.** Siga o padrão `asString`/`asNumber`/`asRecord`
  usado em `src/testing/mock-adapter.ts` e nos adapters existentes.

## Como propor um adapter de provider novo

A metodologia completa está em [docs/providers/README.md](docs/providers/README.md). Resumo:

1. **Dossiê primeiro.** Escreva `docs/providers/<nome>.md` a partir da documentação oficial (e,
   sempre que possível, do código-fonte, se o projeto for open source — a documentação de terceiros
   frequentemente diverge do comportamento real). Marque explicitamente o que é confirmado vs.
   suposição, e todo exemplo de payload como **verbatim** ou **reconstruído**.
2. **Fixtures.** Salve os payloads de webhook reais (mensagem recebida, ack, atualização de
   conexão) em `src/adapters/<nome>/fixtures/`.
3. **Implemente o adapter** em `src/adapters/<nome>/index.ts`, exportando uma função fábrica (ex.:
   `waha(options)`) que devolve um `WaAdapter`. Use os adapters existentes (`src/adapters/waha`,
   `src/adapters/evolution`) como referência de estilo.
4. **Registre na suite de contrato compartilhada** (`test/contract/adapter-contract.ts`, via
   `describeAdapterContract`) — todo adapter precisa passar nela, sem exceção.
5. **Adicione o subpath export**: entrada em `tsup.config.ts` (`entry`) e em `package.json`
   (`exports`), seguindo o padrão dos adapters existentes.
6. Rode `npm run lint && npm run typecheck && npm test && npm run build && npm run smoke` antes de
   abrir o PR. Se as capabilities mudaram, rode também `npm run docs:capabilities` e commite o
   `docs/capabilities.md` atualizado — o CI falha se ele ficar desatualizado.

Não é necessário implementar todas as capabilities de um provider de uma vez — declarar um
subconjunto honesto (documentado no dossiê) é melhor que fingir suporte completo.

## Modelo de branches

- **`main`** é protegido: nenhum push direto, nenhum merge direto. A única forma de atualizar
  `main` é via Pull Request **vindo de `develop`** (aplicado tecnicamente pelo job
  `guard-main-source` em [`.github/workflows/ci.yml`](.github/workflows/ci.yml), já que o GitHub
  não tem uma regra de proteção nativa para restringir de qual branch um PR pode vir).
- **`develop`** é o branch de integração. Trabalho novo (adapter, feature, fix) é commitado ali
  diretamente ou via um branch de feature de vida curta que abre PR para `develop`.
- Quando `develop` estiver pronto para virar release, abra um PR `develop` → `main`.

### Sincronização automática de docs/wiki após merge em main

Todo merge em `main` dispara [`.github/workflows/docs-sync.yml`](.github/workflows/docs-sync.yml):
um agente (Claude Code Action) olha o diff do PR mesclado e atualiza `docs/CONTEXT.md`,
`docs/adr/`, `docs/providers/*.md`, `README.md`, `CONTRIBUTING.md`, a skill `waconector` e/ou as
páginas da wiki quando genuinamente ficaram desatualizados — commitando direto em `develop` (nunca
em `main`) ou na wiki. Se nada precisar mudar, não faz nenhum commit.

Requer o secret `CLAUDE_CODE_OAUTH_TOKEN` no repositório (o mesmo usado por
[`claude-code-review.yml`](.github/workflows/claude-code-review.yml)) — configurado via
`/install-github-app` no `claude` CLI local, que instala o GitHub App e o secret
automaticamente. Sem o secret configurado, o job falha sem afetar o merge em si (não é um
required check).

## Commits e Pull Requests

- Mensagens de commit em português ou inglês, no imperativo, descrevendo o "porquê" quando não for
  óbvio pelo diff.
- Use o [template de PR](.github/pull_request_template.md) (preenchido automaticamente ao abrir um
  PR) — ele cobre o checklist de QA e, se aplicável, o checklist específico de adapter.
- Se sua mudança afeta o pacote publicado (qualquer coisa em `src/`, `package.json` de forma
  relevante), adicione um changeset: `npx changeset`. Descreva o impacto do ponto de vista de quem
  consome o pacote, não a implementação interna.
- Mudanças de contrato central (`src/core/`) que quebram compatibilidade exigem uma issue de
  discussão antes do PR e um changeset `major` — desde o v1.0, a API pública é estável e essas
  mudanças não são mais "aceitáveis em minors" como na fase 0.x. Documente a decisão em
  [docs/adr/](docs/adr/).

## Reportando bugs e propondo features

Use os [templates de issue](https://github.com/alltomatos/waconector/issues/new/choose) — há um
específico para "novo adapter" além dos de bug/feature genéricos.

## Código de conduta

Seja respeitoso e construtivo. Críticas ao código são bem-vindas; críticas às pessoas, não.
