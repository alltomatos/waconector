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
- **Build:** tsup (entradas `index` e `testing/index`; ESM + CJS + `.d.ts`/`.d.cts`).
- **Testes:** vitest (unit + suite de contrato) + smoke test do pacote empacotado (`scripts/smoke.mjs`).
- **Lint/format:** Biome.
- **Versionamento/publicação:** changesets + GitHub Actions (`release.yml`, requer secret `NPM_TOKEN`; publica com provenance). Pré-1.0: breaking changes em minors, documentadas.
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
- **F1 — Prova da abstração**: adapters WAHA + Evolution GO (conectar/QR/status, sendText, sendMedia, webhook de mensagem + ack). Publicar v0.1.0.
- **F2 — Largura**: uazapi, Z-API, Wuzapi; grupos, contatos, reply/quote, reactions.
- **F3 — Profundidade e DX**: Whapi, Zapo, QuePasa; docs site com matriz de capabilities gerada do código; exemplos; `npx waconector doctor`.
- **v1.0**: 3+ adapters passando 100% da suite e API pública estável.

## Riscos mapeados

- APIs não-oficiais mudam sem aviso → fixtures + suite de contrato tornam quebras detectáveis; cada adapter documenta a versão testada.
- ToS do WhatsApp → o pacote é um client HTTP para APIs de terceiros; disclaimer no README; sem afiliação com a Meta.
- Segredos → nunca logar tokens; `redactSecrets` em todo texto de erro.
