# CONTEXT — waconector

## Problema e visão

Existem várias APIs não-oficiais de WhatsApp (uazapi, WAHA, Evolution GO, Wuzapi, Whapi, Z-API,
WPPConnect, QuePasa), todas fazendo essencialmente as mesmas ~20 operações — conectar instância/QR,
enviar texto e mídia, receber mensagens, acks, grupos, contatos — mas com auth, endpoints,
payloads e webhooks diferentes.

O **waconector** é um pacote npm que fixa **um contrato único** e implementa **um adapter por
provider**, no espírito do Vercel AI SDK (um SDK, N providers de LLM). Trocar de provider deve
significar trocar apenas a configuração.

## Linguagem do domínio

| Termo | Significado |
| --- | --- |
| **Provider** | Uma API não-oficial de WhatsApp (WAHA, Evolution GO, Z-API, ...). |
| **Adapter** | Implementação do contrato `WaAdapter` para um provider. É "burro": só traduz (`map-out`/`map-in`). |
| **Conector** | `createConnector(adapter)` — camada de ergonomia/política: validação, capabilities, eventos, parsing seguro. |
| **Capability** | Operação que um adapter declara suportar (`messages.sendText`, `instance.connect`...). Chamar fora do conjunto lança `UnsupportedCapabilityError`. |
| **Evento canônico** | Formato único para webhooks de qualquer provider (`message.received`, `message.ack`, `connection.update`, `unknown`...). |
| **Instância** | Sessão de um número de WhatsApp no provider (Evolution chama "instance", WAHA "session", Whapi "channel"). |
| **Dossiê** | Documento por provider em `docs/providers/` com auth, endpoints e payloads reais de webhook, escrito ANTES do adapter. |
| **Fixture** | Payload real capturado de um provider, versionado em `src/adapters/<nome>/fixtures/`, base dos testes. |
| **Suite de contrato** | `test/contract/adapter-contract.ts` — testes que TODO adapter precisa passar. |
| **ChatId canônico** | Telefone só-dígitos (E.164 sem `+`) ou JID explícito (`...@g.us`, `...@s.whatsapp.net`). |

## Princípios (ver ADRs)

1. **Normalizar o comum, preservar o específico** — todo objeto normalizado carrega `raw` ([ADR-0002](adr/0002-normalizar-o-comum-preservar-raw.md)).
2. **Capabilities declaradas** — sem mínimo denominador comum, sem vazamento de especificidades ([ADR-0005](adr/0005-capabilities-declaradas.md)).
3. **Webhooks canônicos e framework-agnostic** — `parse` nunca lança; payload desconhecido vira evento `unknown` ([ADR-0003](adr/0003-webhooks-canonicos-framework-agnostic.md)).
4. **Zero dependências de runtime** — `fetch` nativo, Node ≥ 20 ([ADR-0004](adr/0004-zero-dependencias-runtime.md)).
5. **Pacote único com subpath exports** — `waconector/waha`, `waconector/evolution`... ([ADR-0001](adr/0001-pacote-unico-subpath-exports.md)).
6. **Segurança** — tokens nunca aparecem em logs/erros (redação via `redactSecrets`).

## Detalhes Técnicos

- **Linguagem/runtime:** TypeScript 5.9 strict, Node ≥ 20 (fetch nativo), ESM + CJS.
- **Build:** tsup (entradas `index`, `testing/index`, `adapters/<provider>/index`; ESM + CJS + `.d.ts`/`.d.cts`).
- **Testes:** vitest (unit + suite de contrato) + smoke test do pacote empacotado (`scripts/smoke.mjs`).
- **QA/cobertura:** `npm run test:coverage` (`@vitest/coverage-v8`). Thresholds em `vitest.config.ts` são um piso calibrado contra o baseline real (não uma meta aspiracional) — travam regressão, não medem "qualidade" por si só. CI roda a versão com cobertura e publica o relatório como artifact.
- **Lint/format:** Biome.
- **Versionamento/publicação:** changesets + GitHub Actions (`release.yml`, requer secret `NPM_TOKEN`; publica com provenance). Desde o v1.0 (semver de verdade): breaking changes exigem bump major + issue de discussão prévia — não são mais aceitáveis em minors como na fase 0.x.
- **Contribuição:** [CONTRIBUTING.md](../CONTRIBUTING.md), templates de issue (bug/feature/novo adapter) e template de PR com checklist de QA em `.github/`. Dependabot para deps (npm + GitHub Actions), semanal.
- **Branches:** `main` protegido (sem push/merge direto); `develop` é o branch de integração. PRs para `main` só são aceitos vindos de `develop` — aplicado pelo job `guard-main-source` em `ci.yml` (o GitHub não tem regra de proteção nativa para restringir a origem de um PR). A configuração de branch protection em si é feita pelo dono do repo no GitHub, não por um agente.
- **Docs/wiki sempre em dia:** `docs-sync.yml` roda a cada merge em `main` (Claude Code Action) e atualiza docs/ADRs/wiki quando o diff genuinamente exigir, commitando em `develop` (nunca em `main`). Requer secret `CLAUDE_CODE_OAUTH_TOKEN` (mesmo usado por `claude-code-review.yml`) — ver CONTRIBUTING.md.
- **Estrutura:**
  - `src/core/` — tipos, erros, capabilities, http client, eventos, conector.
  - `src/adapters/<provider>/` — (F1+) um diretório por adapter, com `fixtures/`.
  - `src/testing/` — `MockAdapter` publicado em `waconector/testing`.
  - `test/contract/` — suite de contrato compartilhada.
  - `docs/providers/` — dossiês.

## Metodologia por adapter (F1+)

1. Dossiê em `docs/providers/<nome>.md` (auth, modelo de sessão, endpoints, payloads reais de webhook).
2. Fixtures versionados.
3. Adapter: `map-out` (canônico → provider) e `map-in` (provider → canônico).
4. Suite de contrato passando 100%.
5. Smoke test contra instância real (WAHA/Evolution GO/Wuzapi/QuePasa rodam via Docker; comerciais exigem conta).

## Roadmap

- **F0 — Fundação** ✅ (2026-07-10): scaffold, core completo, MockAdapter, suite de contrato, CI/release.
- **F1 — Prova da abstração** ✅ (2026-07-11): adapters WAHA + Evolution GO (`instance.connect/status/logout`, `messages.sendText/sendMedia`, `webhooks.parse`), dossiês em `docs/providers/`, fixtures e testes de contrato próprios, auditados adversarialmente contra a documentação/código-fonte oficial de cada provider. `instance.pairingCode` deliberadamente fora do escopo (contrato `InstanceApi.connect()` não recebe telefone). `v0.1.0` publicado no npm.
- **F2 — Largura** ✅ (2026-07-11): adapters uazapi, Z-API e Wuzapi implementados e auditados adversarialmente (mesmo rigor da F1). `v0.2.0` publicado no npm. `reply/quote` já estava coberto (campo `quotedId`, ver ADR-0008). `messages.sendReaction` adicionado ao core e retrofitado nos 5 adapters existentes (ADR-0008), cada um mapeado para a particularidade real do provider de remover reação (sentinel `"remove"` no Evolution GO/Wuzapi, endpoint dedicado na Z-API, emoji vazio no WAHA/uazapi). Capability `groups.*` completa (ADR-0009): as 14 operações pesquisadas — núcleo (`create`/`getInfo`/`list`), participantes (`add`/`remove`/`promote`/`demoteParticipants`), configurações (`updateSubject`/`updateDescription`/`updatePicture`) e convites+saída (`getInviteLink`/`revokeInviteLink`/`joinViaInviteLink`/`leaveGroup`) — implementadas nos 5 adapters. Webhooks de grupo (`GroupUpdateEvent`) populados em 4/5 (WAHA completo, Evolution GO/Wuzapi reconstruído do whatsmeow, Z-API só participantes); uazapi sem parsing estruturado por falta de qualquer payload de exemplo na doc oficial. Capability `contacts.*` completa (ADR-0010): descoberta + perfil (`list`/`get`/`checkExists`/`getProfilePicture`/`getAbout`, 4/5 adapters — uazapi sem `getAbout`) e moderação (`block`/`unblock`/`listBlocked`, `listBlocked` em 3/5 — WAHA e Z-API sem endpoint) implementadas. `getPresence` fora do escopo por ser majoritariamente assíncrono/webhook (incremento futuro à parte).
- **F3 — Profundidade e DX** ✅: adapter **Whapi** ✅ (2026-07-11) — capabilities núcleo (`instance.connect/status/logout`, `messages.sendText/sendMedia`, `webhooks.parse`), dossiê em `docs/providers/whapi.md`, auditado adversarialmente (achou e corrigiu 1 bug real: legenda de mídia recebida via webhook nunca extraída para `WaMessage.text`, inconsistente com o adapter Z-API). `messages.sendReaction`/`instance.pairingCode`/`groups.*`/`contacts.*` confirmados suportados pelo provider mas deliberadamente não implementados nesta fase. Adapter **QuePasa** ✅ (2026-07-11) — capabilities núcleo menores que o padrão dos demais adapters: `instance.status/logout` (logout é soft-stop — desconecta mas preserva credenciais salvas), `messages.sendText/sendMedia`, `groups.getInviteLink`, `contacts.getProfilePicture`, `webhooks.parse`, dossiê em `docs/providers/quepasa.md`. `instance.connect` deliberadamente NÃO implementada (limitação técnica real: `GET /scan` devolve PNG binário cru, incompatível com o `HttpClient` atual, que decodifica toda resposta não-JSON como texto UTF-8); `instance.pairingCode` fora de escopo pelo motivo usual. Repositório oficial (`nocodeleaks/quepasa`) bloqueado no GitHub por DMCA (módulo de VoIP, não relacionado a mensagens) — pesquisa feita em três forks/mirrors não bloqueados, com o dossiê documentando a metodologia e o nível de confiança por seção. Auditoria adversarial achou e corrigiu 1 bug real (`getProfilePicture` lia o campo errado do envelope de resposta) e corrigiu 3 afirmações incorretas de "recurso não existe". Lista de providers-alvo atualizada: **Zapo saiu** (é uma lib cliente Node, sem endpoints HTTP — não se encaixa no modelo de adapter) e foi substituída por **WPPConnect Server** (self-hosted, Docker, mesmo perfil de WAHA/Evolution GO). Adapter **WPPConnect Server** ✅ (2026-07-11) — capabilities mais amplas entre os adapters F3 até agora: `instance.connect/status/logout`, `messages.sendText` (com `mentions` via `POST /send-mentioned`)/`sendMedia`/`sendReaction`, 13 operações de `groups.*` (create/getInfo/participantes/subject/description/picture/invite links/join/leave), `contacts.checkExists/block/unblock/listBlocked`, `webhooks.parse`, dossiê em `docs/providers/wppconnect.md`. Sourcing limpo (diferente do QuePasa): docs Swagger acessíveis e repositório oficial ativo, verificado antes de qualquer suposição. `instance.pairingCode` não declarada (mesmo obstáculo estrutural de todo adapter deste pacote); `groups.list` e `contacts.list/get/getProfilePicture/getAbout` deliberadamente fora do escopo (endpoints existem, mas sem shape de resposta confirmado pela pesquisa, ou marcados deprecated pelo próprio provider). Auditoria adversarial encontrou e corrigiu 2 bugs reais de corrupção silenciosa de dados (não lançavam exceção, apenas perdiam o id real): `POST /send-message` e os endpoints de mídia devolvem `response` como array de um elemento, não o objeto bare esperado; `POST /create-group` aninha `id`/`name` em `groupInfo[0]`, não diretamente na raiz. `v0.3.0` publicado no npm (fecha `messages.sendReaction`/`groups.*`/`contacts.*` da F2 e os adapters Whapi/QuePasa/WPPConnect da F3). Site de documentação (VitePress + GitHub Pages) publicado em `https://alltomatos.github.io/waconector/`, consumindo `docs/` existente (CONTEXT.md, ADRs, dossiês) sem duplicar conteúdo; página `docs/capabilities.md` gerada 100% do código (`scripts/generate-capabilities-matrix.mjs`, mesma técnica de instanciação fake do smoke test), com checagem de CI (`ci.yml`) garantindo que nunca fica desatualizada. Comando `npx waconector doctor --provider <nome>` (ADR-0011) para diagnóstico de conectividade/auth via variáveis `WACONECTOR_*` (só leitura, `instance.status()`, nunca `connect()`), implementado como entry point ESM-only próprio (`src/cli/`, `node:util.parseArgs`, zero dependência de runtime — ADR-0004). Exemplos executáveis em `examples/express` e `examples/nextjs` (App Router), usando `MockAdapter` por padrão. **Fecha a F3 por completo.**
- **v1.0** ✅ (2026-07-11): publicado no npm. 8 adapters passando 100% da suite de contrato (bem
  acima do piso de "3+"); API pública estável desde o `v0.1.0` (1 única breaking change em toda a
  história, ocorrida antes de existir qualquer adapter além de WAHA/Evolution GO — todas as
  releases seguintes foram 100% aditivas). A partir daqui, breaking changes exigem bump major.

## Riscos mapeados

- APIs não-oficiais mudam sem aviso → fixtures + suite de contrato tornam quebras detectáveis; cada adapter documenta a versão testada.
- ToS do WhatsApp → o pacote é um client HTTP para APIs de terceiros; disclaimer no README; sem afiliação com a Meta.
- Segredos → nunca logar tokens; `redactSecrets` em todo texto de erro.
