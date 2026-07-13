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
- [x] **v1.1.0** publicado no npm (2026-07-13) — consolida os 10 changesets `minor` acumulados
      desde o v1.0.0 (Epic 6/7/9 completas: `chats.*`, `messages.edit`/`delete`/`forward`/`star`/
      `unstar`/`pin`/`unpin`/`markRead`/`sendLocation`/`sendContactCard`/`sendPoll`, `presence.*`,
      `labels.*`, `channels.*`, `business.*`, `calls.*`, gaps de Whapi/WPPConnect) num único bump
      `1.0.0` → `1.1.0` — [PR #43](https://github.com/alltomatos/waconector/pull/43). Processo:
      `npm run version` (`changeset version`) rodado direto em `develop` (mesmo padrão de
      v0.1.0-v0.4.0, já que `guard-main-source` bloqueia a PR de versão que o bot `changesets/action`
      tentaria abrir contra `main`), consumindo os 10 changesets pendentes, commitado como
      "chore: release v1.1.0" e mergeado via PR normal `develop`→`main`. Merge do PR #43 exigiu
      reconciliar o MESMO tipo de conflito de squash-merge de todo PR desta sessão — desta vez só
      1 arquivo (`ORCHESTRATOR-ROADMAP.md`, placeholder desatualizado) mais uma nuance nova: o
      merge resolveu automaticamente ressuscitando `.changeset/capabilities-calls.md` (o
      merge-base não tinha esse arquivo, então o merge o tratou como "adicionado só em `main`", não
      "apagado em `develop`") — removido manualmente antes de commitar, já que já estava consumido
      no `CHANGELOG.md`/`package.json` (confirmado comparando o texto do changeset com a entrada já
      presente no changelog). QA gate completo verde na árvore final: 891 testes, build, smoke,
      `docs:capabilities` sem diff. Publicação confirmada no log do workflow `release.yml`
      (`🦋 success packages published successfully: waconector@1.1.0`, tag `v1.1.0` criada e
      enviada ao repositório). **Fecha as Epics 6/7/9 do ponto de vista de release.**

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

## Epic 7 — capabilities novas: `messages.edit`/`messages.delete` + namespace `chats.*`

Estado: **done**

Primeira iniciativa pós-v1.0 que **expande** o enum de 30 capabilities (não só fecha gaps dentro
dele, como a Epic 6) — aprovada pelo usuário após a síntese da Epic 6 apontar `messages.edit`/
`messages.delete` e `chats.*` (archive/mute/pin/markRead, todos com cobertura 8/8 ou próxima) como
as candidatas mais fortes ao próximo ADR.

- [x] **Pesquisa + desenho de contrato**: workflow com 8 agentes de pesquisa (1 por provider,
      lotes de 5+3 para respeitar o limite de 5 agents concorrentes) + 1 agente de desenho,
      produzindo o `ADR-0012` (`docs/adr/0012-capabilities-messages-edit-delete-chats.md`).
      Decisão central: `messages.edit`/`delete` opcionais em `MessagesApi` (mesmo padrão de
      `sendReaction`, ADR-0008); novo namespace `ChatsApi` com **`WaAdapter.chats?` OPCIONAL** —
      deliberadamente diferente do precedente de `groups`/`contacts` (ADR-0009/0010, campos
      obrigatórios), para manter a mudança 100% aditiva e evitar acionar o gate pós-v1.0 de
      "issue de discussão prévia + changeset major" do `CONTRIBUTING.md` sem necessidade técnica.
      10 capabilities novas no enum (40 no total): `messages.edit`, `messages.delete`,
      `chats.archive/unarchive/mute/unmute/pin/unpin/markRead/markUnread`.
- [x] **Implementação no core**: `src/core/types.ts` (`EditMessageInput`/`DeleteMessageInput`),
      `src/core/adapter.ts` (`ChatsApi`, `MessagesApi.edit?`/`delete?`, `WaAdapter.chats?`),
      `src/core/capabilities.ts` (10 entradas novas), `src/core/connector.ts`
      (`ConnectorChatsApi`/`callChatsMethod`, `callMessagesMethod` generalizado a partir do guard-
      rail antes inline de `sendReaction`), `src/testing/mock-adapter.ts` (implementação de
      referência em memória) — feito diretamente (não via agent), com testes unitários novos em
      `test/connector.test.ts`/`test/mock-adapter.test.ts`.
- [x] **Implementação nos 8 adapters**: workflow com 8 agentes (lotes de 5+3), cada um usando seu
      próprio relatório de pesquisa dedicado. Cobertura final por provider: uazapi/whapi/wppconnect
      fecharam as 10 capabilities completas (40/40 do total do adapter — só `instance.pairingCode`
      fora); waha/evolution/zapi fecharam um subconjunto por falta de endpoint inverso confirmado
      (`unarchive`/`unmute` ausentes no Evolution GO; `mute`/`pin` ausentes no WAHA — só
      `Channels`/mensagem, não conversa); wuzapi fechou só `edit`/`delete`/`archive`/`unarchive` (4,
      sem `mute`/`pin`/`markRead` confirmados em código); QuePasa fechou 6 (`edit`/`delete`/
      `archive`/`unarchive`/`markRead`/`markUnread`) usando rotas **legacy** (mesma família de
      `/scan`/`/command` já confiável, distinta da v5 canonical recusada na Epic 6 — sem contradição
      com aquela decisão).
- [x] **Verificação adversarial** (lotes de 5+3): achou e corrigiu 1 issue **blocker** real (Z-API
      não tinha implementado `chats.markRead`/`markUnread` apesar de endpoint confirmado em
      `developer.z-api.io/chats/read-chat` — mesmo `/modify-chat` já usado pelos outros 6 verbos;
      corrigido, zapi foi de 36/40 para 38/40) e 7 issues **minor** cosméticos (status HTTP de
      stub, texto de resposta de stub, comentário com afirmação matemática incorreta sobre limite
      de 32 bits, descrição de shape de resposta desatualizada, alegação sem fonte primária,
      duplicação de código) — todos corrigidos diretamente.
- [x] **QA gate completo** rodado do zero após cada rodada de mudança (lint/typecheck/test/
      coverage/build/smoke/docs:capabilities) — 670 testes passando, cobertura acima dos
      thresholds. `docs/capabilities.md` regenerado (40 capabilities × 8 providers).

## Epic 8 — bloqueada: reabrir `groups.*`/`contacts.*` do QuePasa

Estado: **blocked** (sem instância real disponível — não faz parte da fila de Epic 9)

Candidato natural de continuação da Epic 6 (QuePasa investigado e recusado com evidência,
`docs/providers/quepasa.md#follow-up-2026-07-12`). Usuário confirmou (2026-07-12) que não tem uma
instância QuePasa real disponível para validar contra tráfego real — sem isso, reabrir cairia
exatamente na razão que já bloqueou da última vez. Retomar quando houver instância disponível
(`docker pull codeleaks/quepasa:latest`, publicamente disponível, ver dossiê).

## Epic 9 — capabilities novas, rodada 2 (fila sequencial, sem multi-agent)

Estado: **done**

Continuação da Epic 7, cobrindo candidatas que ficaram fora do ADR-0012 (mensagens avançadas +
domínios inteiramente novos: presença, labels, canais, perfil comercial, chamadas). Diferença
explícita de processo, a pedido do usuário: fila sequencial, **um item por vez, sem múltiplos
agentes em paralelo** (nem `Workflow`, nem fan-out via `Agent`) — cada item implementado
diretamente, provider por provider. Plano completo em
`C:\Users\ronaldo\.claude\plans\scalable-dreaming-crayon.md`. Reaproveita os 8 relatórios de
pesquisa já produzidos na Epic 7 (`scratchpad/provider-reports/`), sem repetir pesquisa do zero.

- [x] **`messages.forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`** (ADR-0013) — nível de
      MENSAGEM, distintas de `chats.pin`/`markRead` (nível de conversa, já implementadas). Enum
      cresceu de 40 para 46. Cobertura por provider: whapi/waha fecharam as 6 completas (45/46 e
      40/46); zapi fechou 4 (forward/pin/unpin/markRead, sem star — busca negativa confirmada,
      42/46); uazapi fechou 3 (pin/unpin/markRead, sem forward/star — busca exaustiva em 132
      rotas do spec, 41/46); wppconnect fechou 3 (forward/star/unstar, sem pin/markRead de
      mensagem — só existe `/pin-chat` de nível de conversa, 42/46); evolution/wuzapi/quepasa
      fecharam só `markRead` (36/46, 34/46, 14/46) — sem `forward`/`star`/`pin` confirmados em
      nenhuma fonte primária (OpenAPI oficial, busca exaustiva em `handlers.go`, e rotas legacy,
      respectivamente). Implementado sem `Workflow`/`Agent` (diretamente, um provider por vez, a
      pedido do usuário). QA gate completo verde: 703 testes, cobertura acima dos thresholds.
- [x] **`messages.sendLocation`/`sendContactCard`/`sendPoll`** (ADR-0014,
      [PR #37](https://github.com/alltomatos/waconector/pull/37)) — fecha o par ENVIO do que
      `MessageKind` já classifica na recepção (`location`/`contact`/`poll`) desde a F1. Melhor
      cobertura da fila até agora: **3/3 nos 8 adapters** (49/49 no total, enum cresceu de 46 para
      49) — todos confirmam as 3 capabilities, com shapes de request heterogêneos entre si
      (`sendContactCard` ora aceita campos soltos — Evolution/uazapi/Z-API/QuePasa —, ora exige
      vCard já montado pelo adapter — Whapi/Wuzapi/WAHA/WPPConnect; `sendPoll` do Wuzapi é sempre
      escolha única, hardcoded no servidor). Gap-fix achado durante a pesquisa (não uma capability
      nova): `messages.sendMedia` do QuePasa agora envia `kind: 'sticker'` de verdade via
      `POST /send` (campo dedicado `sticker: {url|content}`, conversão para WebP via FFmpeg no
      servidor) em vez de lançar `INVALID_INPUT` — o caminho anterior (`/sendurl`/`/sendencoded`)
      de fato não suporta sticker, mas existe um endpoint irmão que sim. Implementado sem
      `Workflow`/`Agent`. QA gate completo verde: 737 testes, cobertura 90.19%/68.23%/99.36%/91.81%
      (acima dos thresholds 77/60/90/80).
- [x] **`presence.*`** (ADR-0015, [PR #38](https://github.com/alltomatos/waconector/pull/38)) —
      primeiro namespace inteiramente novo desta rodada (`WaAdapter.presence?`, mesmo padrão
      opcional de `chats?`). Cobertura por método: `setTyping` 7/8 (só Z-API sem), `set` 5/8
      (WAHA/uazapi/Wuzapi/Whapi/WPPConnect), `subscribe` 4/8 (WAHA/Wuzapi/Whapi/WPPConnect). Z-API
      fica sem nenhum dos 3 — busca negativa confirmada (só `delayTyping` como efeito colateral de
      `send-text`, e um webhook de recepção). Achado que mudou o cálculo de risco do WPPConnect: o
      relatório original só tinha encontrado o webhook `onPresenceChanged`; verificação ao vivo
      encontrou 4 rotas de ENVIO reais (`/typing`, `/recording`, `/set-online-presence`,
      `/subscribe-presence`), dando cobertura 3/3 ao adapter. `presence.get` deliberadamente fora
      de escopo (cobertura 2/8, shapes de resposta divergentes demais para unificar com confiança).
      Implementado sem `Workflow`/`Agent`. QA gate completo verde: 766 testes, cobertura
      90.41%/68.5%/99.38%/92% (acima dos thresholds 77/60/90/80). Merge da PR exigiu reconciliar um
      conflito com `main` causado pelo workflow de squash-merge (branch `develop` mantém histórico
      completo enquanto `main` recebe commits squashed por PR, fazendo o merge-base recuar a cada
      rodada) — resolvido mantendo o lado `develop` (superset estrito do conteúdo de `main` em
      todos os hunks, exceto `docs/capabilities.md`, regenerado do zero via
      `npm run docs:capabilities`).
- [x] **`labels.*`** (ADR-0016, [PR #39](https://github.com/alltomatos/waconector/pull/39)) —
      segundo namespace inteiramente novo desta rodada (`WaAdapter.labels?`, mesmo padrão opcional
      de `chats?`/`presence?`): CRUD de etiquetas estilo WhatsApp Business + associação/
      desassociação a uma conversa. Cobertura por adapter: WAHA 4/6 (declina `addToChat`/
      `removeFromChat` — endpoint nativo é bulk-replace, exigiria round-trip para emular add/
      remove), Evolution GO 6/6 (`list` achado ao vivo — a pesquisa original não tinha encontrado
      `GET /label/list`; `create`/`update`/`delete` convergem no mesmo `POST /label/edit`, `create`
      gera um `labelId` via `randomUUID()` já que o handler exige um id escolhido pelo chamador),
      uazapi 6/6 (`create` descobre o id atribuído pelo servidor por DIFF entre `GET /labels` antes/
      depois, já que `/label/edit` com `labelid:"new"` não devolve o id criado), Z-API 1/6 (só
      `list`, confiança baixa para o resto — só nome no índice da doc), Wuzapi 0/6 (busca negativa
      confirmada, sem nenhuma rota de etiquetas), Whapi 6/6 (`update` é rename-only, sem mudar cor;
      `create` escolhe o menor `labelId` numérico livre em 0-19 por causa do formato estrito do
      provider), QuePasa 6/6 (único provider onde `create` devolve o label criado com id sem
      round-trip extra; `update` sobrescreve `color` incondicionalmente — caveat documentado, não
      resolvido por design), WPPConnect 5/6 (sem `update`, sem endpoint de edição; `create`
      descobre o id por diff, igual à uazapi, já que o wrapper do provider tem um bug conhecido que
      não devolve o label criado). `color` é opaco por provider (6 vocabulários incompatíveis:
      índice numérico, hex, inteiro, enum nomeado, string livre, ARGB); `UpdateLabelInput.name` é
      sempre obrigatório (protege contra apagar o nome num update parcial, motivado por um
      comportamento real do QuePasa). Enum de capabilities cresce de 52 para 58. Implementado sem
      `Workflow`/`Agent`. QA gate completo verde: 816 testes, cobertura
      91.03%/68.33%/99.44%/92.53% (acima dos thresholds 77/60/90/80). Merge da PR exigiu reconciliar
      o MESMO tipo de conflito com `main` do PR #38 (squash-merge diverge `develop` de `main`) —
      resolvido da mesma forma verificada (superset estrito do `develop` em todos os hunks exceto
      `docs/capabilities.md`, regenerado via `npm run docs:capabilities`; e um hunk não-vazio em
      `ORCHESTRATOR-ROADMAP.md` onde o lado `main` era só um placeholder desatualizado do mesmo item
      já completo em `develop`).
- [x] **`channels.*`** (ADR-0017, [PR #40](https://github.com/alltomatos/waconector/pull/40)) —
      terceiro namespace inteiramente novo desta rodada (`WaAdapter.channels?`, mesmo padrão
      opcional de `chats?`/`presence?`/`labels?`): `list`/`create`/`getInfo`/`delete`/`follow`/
      `unfollow` de canais do WhatsApp ("WhatsApp Channels"). Nome canônico `channels` (não
      `newsletters`) escolhido por ser o nome público do produto e o termo literal do WAHA
      (`/channels`, tag "📢 Channels") e do Whapi renderizado, apesar da maioria dos providers
      (Evolution GO, uazapi, Z-API, Wuzapi, WPPConnect) usar "newsletter" internamente — herança do
      protocolo reverso-projetado (whatsmeow/Baileys). `follow`/`unfollow` escolhido sobre
      `subscribe`/`unsubscribe` por ser o par simétrico e literal do WAHA/uazapi/Whapi (Evolution GO
      só tem `subscribe`, sem `unsubscribe`). `ChannelInfo.id` é opaco (mesmo critério de
      `GroupInfo.id`, ADR-0009). Cobertura por adapter: WAHA 6/6, Evolution GO 4/6 (sem `delete`/
      `unfollow`; achado ao vivo que CORRIGE o research original: o `jid` de newsletter NÃO é objeto
      estruturado — `tulir/whatsmeow`'s `types.JID` implementa `MarshalText`/`UnmarshalText`,
      então é serializado como string simples, não decomposto em `{user, server, device, ...}` como
      o OpenAPI estático sugeria), uazapi 6/6 (confiança média para o shape de resposta, alta para
      os endpoints — schema `additionalProperties: true`), Z-API 1/6 (só `create`), Wuzapi 1/6 (só
      `list`, somente leitura), Whapi 6/6, QuePasa 0/6 (busca negativa confirmada ao vivo, nenhuma
      rota de newsletter/channel no código-fonte), WPPConnect 2/6 (`create`/`delete`, achado ao vivo
      — o research original não tinha encontrado nenhuma evidência de channels/newsletters no
      WPPConnect). `CreateChannelInput` deliberadamente sem `picture` (mesmo precedente de
      `CreateGroupInput`, ADR-0009). Enum de capabilities cresce de 58 para 64. Implementado sem
      `Workflow`/`Agent`. QA gate completo verde: 854 testes, cobertura
      91.49%/67.6%/99.47%/92.92% (acima dos thresholds 77/60/90/80). Merge da PR exigiu reconciliar
      o MESMO tipo de conflito com `main` dos PRs #38/#39 (squash-merge diverge `develop` de `main`)
      — resolvido da mesma forma verificada (superset estrito do `develop` em 26 dos 28 arquivos
      conflitantes; `docs/capabilities.md` regenerado via `npm run docs:capabilities`; e um hunk
      não-vazio em `ORCHESTRATOR-ROADMAP.md` onde o lado `main` era só um placeholder desatualizado
      do mesmo item já completo em `develop`).
- [x] **`business.*`** (ADR-0018, [PR #41](https://github.com/alltomatos/waconector/pull/41)) —
      quarto namespace inteiramente novo desta rodada (`WaAdapter.business?`, mesmo padrão opcional
      de `chats?`/`presence?`/`labels?`/`channels?`): `getProfile`/`updateProfile` do perfil
      comercial WhatsApp Business (endereço, e-mail, sites, categorias) — catálogo/produtos
      deliberadamente fora de escopo (feature de e-commerce, não de mensageria). Cobertura por
      adapter: uazapi 2/2 (confiança Alta; `updateProfile` trata o `207 Multi-Status` de sucesso
      parcial da uazapi como falha total, `PROVIDER_ERROR`, único endpoint do spec inteiro que usa
      esse código), Whapi 2/2 (achado ao vivo que corrige o relatório original: o método real de
      `updateProfile` é `POST /business`, não `PATCH /business`; schema de resposta sem campo
      `categories`, diferente de uazapi), WPPConnect 1/2 (só `updateProfile`, achado ao vivo em
      `routes.ts`; campo `adress` com grafia incorreta real do provider; sem campo `description` no
      endpoint — silenciosamente ignorado quando fornecido). **Z-API deliberadamente NÃO
      implementado**: o único endpoint candidato (`GET .../business/profile?phone=...`) exige um
      `phone` de destino, mesmo padrão de `contacts.getProfilePicture`/`getAbout` deste adapter —
      descasamento de FORMA de capability (consulta a UM CONTATO, não "meu próprio perfil"), não
      gap de confiança; candidata a um futuro `contacts.getBusinessProfile(chatId)`. WAHA, Evolution
      GO, Wuzapi e QuePasa confirmados sem essa API (busca negativa, incluindo verificação ao vivo
      dos 2 providers whatsmeow-based via arquivos já cacheados). `categories` normalizado para
      `string[]` (shape do objeto diverge entre providers). Enum de capabilities cresce de 64 para
      66. Implementado sem `Workflow`/`Agent`. QA gate completo verde: 866 testes, cobertura
      91.63%/67.74%/99.48%/93.03% (acima dos thresholds 77/60/90/80). Merge da PR exigiu reconciliar
      o MESMO tipo de conflito com `main` dos PRs #38/#39/#40 (squash-merge diverge `develop` de
      `main`) — resolvido da mesma forma verificada (superset estrito do `develop` em 20 dos 22
      arquivos conflitantes; `docs/capabilities.md` regenerado via `npm run docs:capabilities`; e um
      hunk não-vazio em `ORCHESTRATOR-ROADMAP.md` onde o lado `main` era só um placeholder
      desatualizado do mesmo item já completo em `develop`).
- [x] **`calls.*`** (ADR-0019, [PR #42](https://github.com/alltomatos/waconector/pull/42)) —
      quinto e ÚLTIMO namespace inteiramente novo da fila (`WaAdapter.calls?`, mesmo padrão
      opcional de `chats?`/`presence?`/`labels?`/`channels?`/`business?`): `make`/`reject` de
      chamadas de voz. `calls.make` é sempre uma "chamada vazia" (o telefone toca, mas nenhum áudio
      real é estabelecido em nenhuma direção — limitação estrutural, nenhum cliente não-oficial
      origina chamadas reais) — só uazapi e Z-API (2/8). `calls.reject` tem cobertura bem mais
      ampla (6/8): WAHA, Evolution GO (achado ao vivo em `call_handler.go`/`call_service.go`, não
      estava no relatório original), uazapi (único provider onde nem `callId` nem `callerId` são
      exigidos — corpo vazio rejeita a chamada ativa no momento), Whapi, Wuzapi e WPPConnect
      (achado ao vivo em `routes.ts`, só exige `callId`, sem `callerId` — diferente dos outros 4).
      **Correção em relação à estimativa do plano original**: Z-API NÃO implementa `calls.reject` —
      os campos candidatos (`callRejectAuto`/`callRejectMessage`, vistos em `GET /me`) são uma
      CONFIGURAÇÃO de conta, não uma ação invocável sob demanda. QuePasa confirmado sem API
      interativa de chamadas (chamadas recebidas viram uma mensagem sintética roteada pelo pipeline
      de mensagens, com rejeição automática via config do servidor — não uma ação). Validação de
      `callId`/`callerId` fica no ADAPTER, não no conector (a obrigatoriedade varia genuinamente por
      provider, sem regra universal). Enum de capabilities cresce de 66 para 68 — **fecha a fila
      planejada de 7 itens (ADR-0013 a ADR-0019)**. Implementado sem `Workflow`/`Agent`. QA gate
      completo verde: 891 testes, cobertura 91.75%/68.06%/99.49%/93.13% (acima dos thresholds
      77/60/90/80). Merge da PR exigiu reconciliar o MESMO tipo de conflito com `main` dos PRs
      #38/#39/#40/#41 (squash-merge diverge `develop` de `main`) — resolvido da mesma forma
      verificada (superset estrito do `develop` em 20 dos 22 arquivos conflitantes;
      `docs/capabilities.md` regenerado via `npm run docs:capabilities`; e um hunk não-vazio em
      `ORCHESTRATOR-ROADMAP.md` onde o lado `main` era só um placeholder desatualizado do mesmo item
      já completo em `develop`).

---

Atualize este arquivo ao concluir cada milestone; o detalhe de *por quê* de cada fase do produto
continua em [docs/CONTEXT.md](docs/CONTEXT.md) e nos [ADRs](docs/adr/).
