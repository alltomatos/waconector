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
      [PR #27](https://github.com/alltomatos/waconector/pull/27)

## Epic 4 — F3 do produto: profundidade e DX

Estado: **in_progress**

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
- [ ] Site de docs com matriz de capabilities gerada do código
- [ ] Exemplos de bot (Express/Next), `npx waconector doctor`

## Epic 5 — v1.0

Estado: **todo**

- [ ] 3+ adapters passando 100% da suite de contrato
- [ ] API pública estável (sem breaking changes não documentados)

---

Atualize este arquivo ao concluir cada milestone; o detalhe de *por quê* de cada fase do produto
continua em [docs/CONTEXT.md](docs/CONTEXT.md) e nos [ADRs](docs/adr/).
