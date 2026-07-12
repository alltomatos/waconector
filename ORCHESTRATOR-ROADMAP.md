# ORCHESTRATOR-ROADMAP.md

Roadmap **tático/operacional** do orchestrator — Epics, Milestones e estado de execução.

> Este arquivo **não** é a fonte da verdade do roadmap de produto/domínio do waconector — isso é
> [docs/CONTEXT.md](docs/CONTEXT.md) (fases F0-F3, princípios, linguagem do domínio). Aqui só
> rastreamos o trabalho operacional do próprio orchestrator sobre esse roadmap.

## Epic 1 — Fundação e F1 do produto

Estado: **done**

- [x] F0 — Fundação (core, MockAdapter, suite de contrato, CI/release) — ver docs/CONTEXT.md#roadmap
- [x] F1 — Adapters WAHA e Evolution GO, QA (cobertura, templates, CONTRIBUTING), skill
      `waconector`, modelo de branches (`main` protegido / `develop`) — mergeado via
      [PR #1](https://github.com/alltomatos/waconector/pull/1)

## Epic 2 — Governança de agente (orchestrator bootstrap)

Estado: **done**

- [x] `.claude/config.json` e `.claude/context7.json`
- [x] `docs/agents/` (issue-tracker.md, triage-labels.md, domain.md) via `/setup-skills --silent`
- [x] Labels de triage no GitHub (`needs-triage`, `needs-info`, `ready-for-agent`,
      `ready-for-human`; `wontfix` já existia)
- [x] Bloco `## Agent skills` em `CLAUDE.md`
- [x] Este arquivo (`ORCHESTRATOR-ROADMAP.md`)
- [x] Auditoria técnica (Fase 3): 8 GAPs (P1-P4) — ver `ESTADO_ORQUESTRATOR.md`
- [x] Aprovação do usuário e correção de todos os GAPs (incluindo GAP1, T3 — verificação HMAC de
      webhooks WAHA) — mergeado via [PR #6](https://github.com/alltomatos/waconector/pull/6)

## Epic 2.1 — Automação de CI (não planejada originalmente, adicionada a pedido do usuário)

Estado: **done**

- [x] `docs-sync.yml` — pós-merge em `main`, agente revisa o diff e atualiza docs/ADRs/wiki quando
      necessário, commitando em `develop`
- [x] `claude-code-review.yml` — revisão automática de código em todo PR (via `/install-github-app`)
- [x] Ambos mergeados em `main` via [PR #8](https://github.com/alltomatos/waconector/pull/8)
- [x] Bug real na primeira execução (`docs-sync` faltava `id-token: write`) — corrigido em
      `develop`, **pendente de PR para `main`** para a correção entrar em vigor

## Epic 3 — F2 do produto: largura

Estado: **done** (detalhe completo em docs/CONTEXT.md#roadmap). `getPresence` fica deliberadamente
fora do escopo original — majoritariamente assíncrono/webhook em 4 dos 5 providers, precisa de
desenho próprio (provavelmente um evento canônico novo, não uma capability request-response) —
tratado como incremento futuro separado, não uma pendência desta Epic.

- [x] Adapter uazapi (SaaS multi-tenant) — dossiê, implementação e auditoria adversarial (achou e
      corrigiu 2 issues "major": suposição errada de `messageType` e risco de formato de envelope
      de webhook) — [PR #11](https://github.com/alltomatos/waconector/pull/11)
- [x] Adapter Z-API (SaaS brasileiro) — dossiê, implementação e auditoria adversarial (achou e
      corrigiu 2 issues "major": endpoint /send-sticker existente mas descartado, e messageId de
      citação em /send-text não mapeado) — [PR #12](https://github.com/alltomatos/waconector/pull/12)
- [x] Adapter Wuzapi (self-hosted, whatsmeow) — dossiê pesquisado direto no código-fonte Go;
      auditoria adversarial achou e corrigiu 1 bug real e sutil (QR code nunca extraído do webhook
      porque o teste original mascarava o bug com um fixture que não refletia o payload real) —
      [PR #13](https://github.com/alltomatos/waconector/pull/13). **Fecha a lista original de 3
      providers da F2** (uazapi/Z-API/Wuzapi).
- [x] Capability `messages.sendReaction` — núcleo (ADR-0008) + retrofit adversarial nos 5
      adapters existentes (uazapi, Evolution GO, WAHA, Z-API, Wuzapi), cada um traduzindo a
      convenção canônica de "emoji vazio remove" para a particularidade real do provider
      (sentinel `"remove"` no Evolution GO/Wuzapi, endpoint dedicado `/send-remove-reaction` na
      Z-API). `reply/quote` já estava coberto via `quotedId` (nenhuma mudança necessária). Retrofit
      mergeado via [PR #16](https://github.com/alltomatos/waconector/pull/16).
- [x] Capability `groups.*` — PR1: núcleo + participantes (ADR-0009), pesquisa (14 operações nos 5
      providers) + implementação + auditoria adversarial via workflow. `create`/`getInfo`/`list`/
      `add`/`remove`/`promote`/`demoteParticipants` implementados nos 5 adapters, com atenção
      especial ao `groupId` opaco (a Z-API usa um ID sintético sem `@`, não um JID — os helpers de
      chatId de mensagem o corromperiam se reaproveitados cegamente). Bug real encontrado e
      corrigido na revisão própria (não pela verificação adversarial): os métodos `wa.groups.*` do
      conector lançavam sincronamente em vez de rejeitar a Promise em falhas de validação.
      Mergeado via [PR #17](https://github.com/alltomatos/waconector/pull/17).
- [x] Capability `groups.*` — PR2: configurações (`updateSubject`/`updateDescription`/
      `updatePicture`) nos 5 adapters, reaproveitando o `MediaRef` de `messages.sendMedia` para
      foto (com `media.kind` obrigatoriamente `'image'`). Cada adapter converteu para o formato
      de imagem exigido pelo provider — nem todos aceitam o mesmo formato de `sendMedia` (ex.:
      Evolution GO/Wuzapi exigem data-URI com prefixo explícito; Wuzapi só aceita JPEG de fato,
      verificado por magic bytes no servidor). Mergeado via
      [PR #18](https://github.com/alltomatos/waconector/pull/18).
- [x] Capability `groups.*` — PR3: convites + saída (`getInviteLink`/`revokeInviteLink`/
      `joinViaInviteLink`/`leaveGroup`) nos 5 adapters. Link de convite normalizado no core
      (`normalizeInviteLink`/`extractInviteCode` em `src/core/chat-id.ts`, diferente do `groupId`
      opaco — o formato do link é uma constante do protocolo WhatsApp, não do provider). Achado
      extra: uazapi devolve o link em campos com casing diferente por endpoint (`invite_link` em
      `/group/info`, `InviteLink` em `/group/resetInviteCode`) — mesmo provider, não é erro de
      digitação. **Fecha as 14 operações originalmente escopadas para `groups.*` (ADR-0009)** —
      resta só popular os webhooks de atualização de grupo (`GroupUpdateEvent`), tratado como
      incremento à parte pela confiança desigual dos payloads pesquisados por provider. Mergeado
      via [PR #19](https://github.com/alltomatos/waconector/pull/19).
- [x] Capability `groups.*` — webhooks (`GroupUpdateEvent`) populados em 4/5 adapters, por nível de
      confiança: WAHA completo (`group.v2.participants/update/join/leave`), Evolution GO/Wuzapi
      reconstruído do código-fonte whatsmeow (evento de diff `GroupInfo` pode gerar múltiplos
      `GroupUpdateEvent` — um por mudança identificada — e `JoinedGroup`), Z-API só as 5
      notificações de participante (não as de subject/description/ícone/criação, sem exemplo de
      payload). **uazapi deliberadamente sem parsing estruturado** — nenhum exemplo de payload de
      grupo existe na doc oficial; eventos continuam caindo em `unknown` (comportamento seguro por
      design, ADR-0002/ADR-0003). **Fecha o ADR-0009 por completo.** Mergeado via
      [PR #20](https://github.com/alltomatos/waconector/pull/20).
- [x] Capability `contacts.*` — PR1: descoberta + perfil (ADR-0010), pesquisa (9 operações nos 5
      providers) + implementação + auditoria adversarial via workflow. `list`/`get`/`checkExists`/
      `getProfilePicture`/`getAbout` implementados em 4/5 adapters — **uazapi não declara
      `contacts.getAbout`** (nenhum endpoint/campo para recado pessoal em toda a doc oficial,
      confirmado por busca exaustiva). Nenhum adapter compõe múltiplas chamadas HTTP atrás de uma
      operação (regra de ouro do ADR-0010) — campos ausentes ficam `undefined`, documentados.
      Mergeado via [PR #21](https://github.com/alltomatos/waconector/pull/21).
- [x] Capability `contacts.*` — PR2: moderação (`block`/`unblock`/`listBlocked`) nos 5 adapters.
      **WAHA e Z-API não declaram `contacts.listBlocked`** — nenhum endpoint de listagem de
      bloqueados existe na doc oficial de nenhum dos dois (Z-API distinguido conscientemente de
      `privacy/get-disallowed-contacts`, uma blacklist de privacidade diferente). `block`/`unblock`
      implementados nos 5. **Fecha as 8 operações request-response escopadas para `contacts.*`
      (ADR-0010).** `getPresence` fica fora do escopo (estruturalmente assíncrono/webhook para 4
      dos 5 providers, incremento futuro à parte, mesma lógica dos webhooks de grupo). Mergeado
      via [PR #22](https://github.com/alltomatos/waconector/pull/22).

## Marcos de release (v0.x)

- [x] **v0.1.0** publicado no npm (2026-07-10/11) — F1 completa (WAHA + Evolution GO)
- [x] **v0.2.0** publicado no npm (2026-07-11) — uazapi + Z-API + Wuzapi (F2) —
      [PR #14](https://github.com/alltomatos/waconector/pull/14)
- [x] **v0.3.0** publicado no npm (2026-07-11) — `messages.sendReaction` retrofit +
      `groups.*`/`contacts.*` completas (fecha F2) + adapters Whapi + QuePasa + WPPConnect (fecha
      os 3 adapters originalmente escopados para F3) —
      [PR #27](https://github.com/alltomatos/waconector/pull/27). Workflow `release.yml` não
      conseguiu abrir a PR de versão automaticamente (permissão "Allow GitHub Actions to create and
      approve pull requests" desabilitada + `guard-main-source` só aceita PRs de `develop`) —
      versão aplicada manualmente em `develop` (mesmo padrão de v0.1.0/v0.2.0). Publicação também
      bloqueada inicialmente por falta do secret `NPM_TOKEN`; usuário adicionou o secret e o
      workflow foi re-rodado com sucesso.
- [x] **v0.4.0** publicado no npm (2026-07-11) — CLI `npx waconector doctor` + exemplos de bot
      (fecha a F3 por completo) — [PR #30](https://github.com/alltomatos/waconector/pull/30).
      Publicação verificada de ponta a ponta via `npx -y waconector@0.4.0 doctor`/`--help` direto
      do registry.

## Epic 4 — F3 do produto: profundidade e DX

Estado: **done**

- [x] Adapter Whapi.Cloud (SaaS) — dossiê (pesquisa em 3 frentes: auth/instância, mensagens,
      webhooks), implementação das capabilities núcleo (`instance.connect/status/logout`,
      `messages.sendText/sendMedia`, `webhooks.parse`), auditoria adversarial encontrou e corrigiu
      1 bug real (legenda de mídia recebida via webhook — `image`/`video`/`document` — nunca
      extraída para `WaMessage.text`, inconsistente com o adapter Z-API que já fazia isso
      corretamente; o fixture de teste também mascarava o bug, mesmo padrão do bug histórico do QR
      no Wuzapi). `messages.sendReaction`/`instance.pairingCode`/`groups.*`/`contacts.*`
      confirmados suportados pelo provider mas deliberadamente adiados (fora do escopo desta fase).
      Mergeado via [PR #24](https://github.com/alltomatos/waconector/pull/24).
- [x] Adapter QuePasa (self-hosted, Docker) — dossiê e implementação das capabilities
      `instance.status/logout` (soft-stop), `messages.sendText/sendMedia`,
      `groups.getInviteLink`, `contacts.getProfilePicture`, `webhooks.parse`. **Achado crítico de
      sourcing**: a URL de docs originalmente listada (`docs.quepasa.ai`) é colisão de nome com um
      SaaS de RAG não relacionado; o repositório oficial (`nocodeleaks/quepasa`) está bloqueado no
      GitHub por aviso de DMCA (módulo de VoIP, não relacionado a mensagens/webhooks) — pesquisa
      feita em três forks/mirrors não bloqueados (2023/2025/2026-07-07), documentado com
      transparência total em `docs/providers/quepasa.md`. Apresentado ao usuário via
      AskUserQuestion dado o caráter T3 do achado (situação de sourcing materialmente diferente do
      assumido); usuário aprovou merge normal. `instance.connect`/`instance.pairingCode`
      deliberadamente não declaradas (QR via `GET /scan` devolve PNG binário cru, incompatível com
      o `HttpClient` atual). Auditoria adversarial encontrou e corrigiu 1 bug real
      (`contacts.getProfilePicture` lia o campo errado do envelope) e 3 afirmações incorretas de
      "recurso não existe" (sticker, `WhatsappAttachment`/media, escopo real de
      groups/contacts/sendReaction — na verdade existe uma API v5 mais recente do provider, mas
      gated por sessão JWT incompatível com o token por instância). Mergeado via
      [PR #25](https://github.com/alltomatos/waconector/pull/25).
- [x] Adapter WPPConnect Server (self-hosted, Docker) — substitui Zapo na lista de providers-alvo
      F3: Zapo (`zapo-js`) é uma biblioteca cliente Node importada diretamente, não uma API HTTP —
      incompatível com o modelo de adapter do waconector (`HttpClient`), confirmado pelo usuário.
      WPPConnect Server já trocado em `docs/providers/README.md`, `docs/CONTEXT.md`,
      `docs/adr/0009-capability-groups.md`, `package.json` (keywords) e `USAGE.md` via
      [PR #23](https://github.com/alltomatos/waconector/pull/23). Dossiê e implementação: sourcing
      limpo (docs Swagger acessíveis, repo oficial ativo — verificado antes de qualquer suposição,
      diferente do QuePasa). Capabilities amplas: `instance.connect/status/logout`,
      `messages.sendText/sendMedia/sendReaction`, 13 operações de `groups.*`,
      `contacts.checkExists/block/unblock/listBlocked`, `webhooks.parse`. Auditoria adversarial
      encontrou e corrigiu 2 bugs reais de corrupção silenciosa de dados (sem lançar exceção, só
      perdendo o id real): `/send-message` e endpoints de mídia devolvem `response` como array de
      um elemento, não objeto bare; `/create-group` aninha `id`/`name` em `groupInfo[0]`. Ambos
      mascarados pelos stubs de fetch originais da suite de contrato — corrigidos com testes de
      regressão explícitos. Mergeado via
      [PR #26](https://github.com/alltomatos/waconector/pull/26). **Fecha os 3 adapters
      originalmente escopados para F3 (Whapi/QuePasa/WPPConnect).**
- [x] Site de docs com matriz de capabilities gerada do código — VitePress publicado via GitHub
      Pages (`docs/.vitepress/`, consumindo `docs/` já existente sem duplicar conteúdo;
      `docs/agents/**` excluído da navegação pública via `srcExclude`). `docs/capabilities.md`
      gerado por `scripts/generate-capabilities-matrix.mjs`, reaproveitando a técnica de
      instanciação fake do `scripts/smoke.mjs` (lista `ADAPTER_SUBPATHS` extraída para
      `scripts/adapter-subpaths.mjs`, compartilhada pelos dois, para eliminar risco de divergência).
      CI (`ci.yml`) ganhou um step de drift-check (regenera e compara) e um job `docs-build`
      independente; deploy novo (`docs-deploy.yml`) só em push para `main`, usando
      `GITHUB_TOKEN`/OIDC nativo (sem secret novo). Pré-requisito manual do usuário: habilitar
      GitHub Pages nas configurações do repositório (Settings → Pages → Source: GitHub Actions).
- [x] CLI `npx waconector doctor --provider <nome>` (ADR-0011) — diagnóstico de conectividade/auth
      via variáveis `WACONECTOR_*` (mapeadas a partir dos campos string reais de cada `XxxOptions`,
      verificados um a um contra o código de todos os 8 adapters). Só chama `instance.status()`
      (leitura) — nunca `connect()`, que é side-effecting em alguns providers (WPPConnect,
      QuePasa). Implementado como entry point ESM-only próprio (`src/cli/`, build separado via
      `tsup` com `banner` de shebang — achado durante a implementação: colocar o shebang também no
      código-fonte gera uma segunda linha `#!/usr/bin/env node`, que quebra o parse), usando
      `node:util.parseArgs` (zero dependência de runtime nova, ADR-0004). `test/cli/doctor.test.ts`
      cobre a lógica pura; `scripts/smoke.mjs` estendido com checagem de subprocess real do
      binário compilado (shebang/argv de ponta a ponta). Exemplos executáveis em `examples/express`
      e `examples/nextjs` (App Router), usando `MockAdapter` por padrão (`npm install && npm
      start`/`npm run dev` sem nenhuma credencial), com job de CI `examples-smoke` (informativo,
      fora de `ci-required`). **Fecha o último item pendente da F3 — Epic 4 completa.** Mergeado
      via [PR #29](https://github.com/alltomatos/waconector/pull/29).

## Epic 5 — v1.0

Estado: **done**

- [x] 3+ adapters passando 100% da suite de contrato — 8 adapters reais (WAHA, Evolution GO,
      uazapi, Z-API, Wuzapi, Whapi, QuePasa, WPPConnect) + `MockAdapter`, confirmado rodando
      `test/contract/` diretamente antes do release (472 testes, 0 falhas, 2 skips condicionais
      esperados).
- [x] API pública estável (sem breaking changes não documentados) — auditoria do `CHANGELOG.md`
      completo: exatamente 1 breaking change em toda a história (`ConnectResult.raw`/
      `InstanceStatus.raw` obrigatórios, `v0.1.0`, antes de existir qualquer adapter além de
      WAHA/Evolution GO). `v0.2.0`→`v0.4.0` (6 adapters novos, `groups.*`/`contacts.*`/
      `sendReaction`, CLI, exemplos) foram 100% aditivos — nenhuma mudança nos formatos centrais
      (`WaMessage`/`SendTextInput`/`SendMediaInput`/`InstanceStatus`/`ConnectResult`). Sem
      marcadores `TODO`/`FIXME`/`@deprecated`/"unstable" em `src/core/`.
- [x] **v1.0.0 publicado no npm** — changeset `major` (semver de verdade: `0.4.0` → `1.0.0`).
      `README.md`/`CONTRIBUTING.md`/`docs/CONTEXT.md` atualizados para retirar a linguagem
      "pré-1.0: breaking changes em minors" — a partir de agora, breaking changes exigem bump
      major + issue de discussão prévia. Mergeado via
      [PR #31](https://github.com/alltomatos/waconector/pull/31), publicado no npm confirmado via
      `npm view waconector version`.

## Epic 6 — pós-v1.0: fechar gaps de capabilities nos adapters

Estado: **done**

Depois do v1.0, auditoria de gaps rodada nos 8 adapters (workflow paralelo, 1 agente de pesquisa
por provider + síntese consolidada) — comparou cada célula "—" da matriz de capabilities contra a
documentação/código-fonte real de cada provider (não só os dossiês), e também procurou
capabilities que nenhum dos 8 adapters modela hoje. Resultado: **5 adapters já estavam
essencialmente completos** (WAHA/Evolution GO/Wuzapi 28-29/30, uazapi/Z-API 28/30 — únicas células
"—" restantes são limitações reais confirmadas do próprio provider ou o obstáculo estrutural de
sempre em `instance.pairingCode`). Todo o trabalho de "gap rápido" concentrado em 3 adapters
(Whapi 6/30, QuePasa 7/30, WPPConnect 24/30) — usuário escolheu fechar os três em sequência
(Whapi → WPPConnect → QuePasa). Auditoria também rankeou candidatas a capabilities novas (fora do
enum atual): `messages.edit`/`messages.delete` (8/8 providers, payload uniforme) são as mais fortes
candidatas ao próximo ADR, seguidas de `chats.*` (archive/mute/pin/markUnread, também 8/8).

- [x] **Whapi**: `messages.sendReaction` + as 14 operações de `groups.*` + as 8 de `contacts.*`
      (22 capabilities), todas com endpoint confirmado contra o OpenAPI oficial v1.8.7 (sem
      deriva de spec). Leva o adapter de 6/30 para **29/30** (só `instance.pairingCode` fora, pelo
      obstáculo estrutural de sempre). Decisões de mapeamento não óbvias: `updateSubject`/
      `updateDescription` usam o MESMO endpoint `PUT /groups/{id}` (cada operação envia só o campo
      correspondente, para não sobrescrever o outro); `revokeInviteLink` encadeia DELETE+GET (o
      DELETE não devolve o novo código, diferente de outros adapters do pacote) — exceção
      documentada à regra de "uma chamada por operação"; `checkExists` usa `HEAD` e intercepta
      404 como resultado de domínio válido (único método do adapter que faz isso). Mergeado via
      [PR #32](https://github.com/alltomatos/waconector/pull/32).
- [x] **WPPConnect**: `groups.list` (`POST /list-chats`, substituto do `GET /all-groups`
      deprecated) + as 4 operações restantes de `contacts.*` (`list`/`get`/`getProfilePicture`/
      `getAbout`) — 5 capabilities, todas com shape confirmado descendo à lib
      `@wppconnect-team/wppconnect` (o gap original vinha de profundidade de pesquisa do dossiê
      anterior, que parou no controller fino do server). Leva o adapter de 24/30 para **29/30** (só
      `instance.pairingCode` fora, obstáculo estrutural de sempre). Verificação adversarial
      encontrou e corrigiu uma afirmação errada herdada do dossiê anterior: `POST /list-chats`
      responde SEM o envelope padrão `{status, response, mapper}` — única exceção confirmada entre
      todos os endpoints do provider; docstring, dossiê e stub de teste corrigidos para refletir o
      shape real (array bruto). Mergeado via
      [PR #33](https://github.com/alltomatos/waconector/pull/33).
- [x] **QuePasa**: as até 20 capabilities condicionais (`messages.sendReaction` + `groups.*`/
      `contacts.*` além de `getInviteLink`/`getProfilePicture`) foram **investigadas e recusadas
      com evidência** — não implementadas. Validação (leitura adicional de código-fonte do mesmo
      mirror `deivisonrpg/quepasa`) confirmou o indício técnico (`AuthenticatedAPIHandler` aceita o
      mesmo `X-QUEPASA-TOKEN` deste adapter como fallback sem JWT, corroborado por
      `docs/USAGE-authentication-modes.md` do próprio mirror, que recomenda esse modo "for headless
      bots"). Essa API `/api/v5` "canonical" existe no HEAD da branch `main` (commit `17c3b10b`,
      2026-07-07) e **não está em nenhuma tag git de nome de versão** — a mais recente é
      `3.25.0924.2015` (2025-09-24, ~9,5 meses atrás), não `3.25.2707.1705` como uma versão anterior
      deste registro afirmava (erro corrigido por verificação adversarial). **Mas** "sem tag git" não
      quer dizer "sem imagem Docker real": a tag `:latest` do Docker Hub (`codeleaks/quepasa`,
      publicada a cada push em `main` pelo workflow do próprio mirror) foi publicada ~3h depois do
      commit auditado e segue sendo puxada ativamente (29.965 pulls históricos, último pull hoje) —
      ou seja, a API v5 e o fallback de token JÁ estão numa imagem real, pública e usada por
      operadores, não é "trabalho em andamento que pode nunca chegar a produção". A decisão de não
      implementar segue de pé, mas apoiada só nos argumentos que resistem a essa correção: (1)
      nenhuma instância real foi de fato exercitada (só leitura de código-fonte e metadados Docker
      Hub/GitHub, zero tráfego HTTP real), e (2) o próprio pareamento anônimo (`GET /scan`) exige um
      parâmetro `user` sem fallback (`ScannerController` -> `GetUser`), tensão não resolvida com o
      modelo "token arbitrário, sem login" que este adapter assume — não confirmado se um token
      pareado por este adapter teria um `GetOwnedServerRecord` válido para as rotas v5.
      `QUEPASA_CAPABILITIES` permanece em 7/30 (inalterado). Decisão e evidência completa (incluindo
      a correção) registradas em `docs/providers/quepasa.md#follow-up-2026-07-12`. Reabrir exigiria
      uma instância Docker real (ex. `docker pull codeleaks/quepasa:latest`, publicamente disponível)
      exercitada de ponta a ponta contra tráfego real.

---

Atualize este arquivo ao concluir cada milestone; o detalhe de *por quê* de cada fase do produto
continua em [docs/CONTEXT.md](docs/CONTEXT.md) e nos [ADRs](docs/adr/).
