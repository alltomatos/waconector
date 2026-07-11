# CONTEXT — waconector

## Problema e visão

Existem várias APIs não-oficiais de WhatsApp (uazapi, WAHA, Evolution GO, Wuzapi, Whapi, Z-API,
Zapo, QuePasa), todas fazendo essencialmente as mesmas ~20 operações — conectar instância/QR,
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
- **Versionamento/publicação:** changesets + GitHub Actions (`release.yml`, requer secret `NPM_TOKEN`; publica com provenance). Pré-1.0: breaking changes em minors, documentadas.
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
- **F3 — Profundidade e DX** 🔶: adapter **Whapi** ✅ (2026-07-11) — capabilities núcleo (`instance.connect/status/logout`, `messages.sendText/sendMedia`, `webhooks.parse`), dossiê em `docs/providers/whapi.md`, auditado adversarialmente (achou e corrigiu 1 bug real: legenda de mídia recebida via webhook nunca extraída para `WaMessage.text`, inconsistente com o adapter Z-API). `messages.sendReaction`/`instance.pairingCode`/`groups.*`/`contacts.*` confirmados suportados pelo provider mas deliberadamente não implementados nesta fase. Pendente: QuePasa (self-hosted); Zapo avaliado como fora de escopo — parece ser uma lib cliente, não uma API HTTP (a confirmar antes de decidir definitivamente). Também pendente: docs site com matriz de capabilities gerada do código; exemplos; `npx waconector doctor`.
- **v1.0**: 3+ adapters passando 100% da suite e API pública estável.

## Riscos mapeados

- APIs não-oficiais mudam sem aviso → fixtures + suite de contrato tornam quebras detectáveis; cada adapter documenta a versão testada.
- ToS do WhatsApp → o pacote é um client HTTP para APIs de terceiros; disclaimer no README; sem afiliação com a Meta.
- Segredos → nunca logar tokens; `redactSecrets` em todo texto de erro.
