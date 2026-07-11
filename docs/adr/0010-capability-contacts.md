# ADR-0010: Capability `contacts.*` — contrato de gestão de contato

- Status: aceito (PR1 — descoberta + perfil — implementado; PR2 — moderação — planejado)
- Data: 2026-07-11

## Contexto

Última capability grande pendente do roadmap F2 (ver ADR-0008/ADR-0009). Uma pesquisa dedicada
(mesma metodologia rigorosa das anteriores: 1 agente por provider, fontes primárias) investigou 9
operações de gestão de contato nos 5 adapters existentes (WAHA, Evolution GO, uazapi, Z-API,
Wuzapi): `listContacts`, `getContact`, `checkExists`, `getProfilePicture`, `getAbout`, `block`,
`unblock`, `listBlocked`, `getPresence`.

### Achados principais

- **Identificador de contato NÃO é opaco** (diferente do `groupId` de grupos, ADR-0009) — é o
  mesmo `chatId` canônico já usado por `messages.*` (telefone E.164 ou JID explícito). A Z-API
  pode devolver/aceitar um identificador `@lid` (Linked ID, esquema de privacidade mais recente do
  WhatsApp) no lugar do telefone em alguns casos, mas isso já é tratado pelo `isJid`/
  `normalizeChatId` existente (qualquer string com `@` passa intacta) — nenhum tipo/normalização
  nova é necessária no core para isso, diferente do que ADR-0009 precisou para `groupId`.
- **8 das 9 operações têm cobertura real e ampla**, mas com lacunas genuínas por provider (não
  universais como em grupos):
  - **`getAbout`**: uazapi **não suporta** — busca exaustiva nas ~132 rotas do OpenAPI bundled não
    achou nenhum campo/endpoint para o recado pessoal de um contato (só um achado adjacente,
    perfil de conta Business via `/business/get/profile`, que é uma feature diferente).
  - **`listBlocked`**: WAHA e Z-API **não suportam** — busca exaustiva confirmou ausência em
    ambos (WAHA: nenhuma rota "blocklist"/"blocked" nos 18 tags do OpenAPI; Z-API: distinguido
    conscientemente de `privacy/get-disallowed-contacts`, que é uma blacklist de *privacidade* por
    capability — quem não pode ver seu "visto por último"/foto/descrição —, não a lista de
    contatos efetivamente bloqueados).
- **`getContact` não é uma única chamada "completa" em 3 dos 5 providers**: WAHA (falta
  avatar/about, endpoints próprios), Evolution GO e Wuzapi (o endpoint mais próximo, `/user/info`,
  devolve `about`+id da foto mas não nome de exibição nem um booleano de "tem WhatsApp" — um
  contato "completo" exigiria compor 2-3 chamadas). Decisão: **cada adapter mapeia `getContact` a
  partir de UMA ÚNICA chamada HTTP** (o melhor match disponível), documentando no dossiê quais
  campos ficam `undefined` por limitação do provider — nunca compor múltiplas requisições por trás
  de uma única operação canônica (mesmo princípio de "adapter burro" / não inventar dado das ADRs
  anteriores; comportamento diferente teria custo de latência escondido e complicaria tratamento
  de erro parcial).
- **`getPresence` é estruturalmente diferente das demais 8** — não cabe no mesmo modelo
  request-response:
  - **WAHA**: única com consulta SÍNCRONA real (`GET /api/{session}/presence/{chatId}` devolve a
    presença atual na resposta, e auto-assina para atualizações futuras).
  - **Evolution GO**: sem suporte de fato — nenhum endpoint de consulta, e o próprio caminho de
    webhook está "morto" no código-fonte (nenhuma chamada a `SubscribePresence` existe no
    repositório, confirmado por busca de código completa).
  - **uazapi, Z-API, Wuzapi**: só via modelo assíncrono *subscribe-then-webhook* (uazapi com
    confiança média — nome do evento existe, formato do payload não confirmado; Z-API e Wuzapi
    com confiança alta — payloads documentados/reconstruídos).
  - Por isso `getPresence` fica **fora do escopo desta ADR** — é tratado como incremento futuro
    separado, exigindo seu próprio desenho (provavelmente um evento canônico novo tipo
    `presence.update` em vez de um método request-response, já que só 1 dos 5 providers suporta
    genuinely uma consulta síncrona). Mesma lógica já aplicada aos webhooks de grupo em ADR-0009.

## Decisão

1. **Novo namespace `ContactsApi`**, análogo a `GroupsApi`, exposto como `wa.contacts.*` no
   conector via `ConnectorContactsApi` sempre presente (mesmo padrão dual do ADR-0008/0009).
2. **Toda operação é opcional na interface do adapter** — mesmo padrão de `GroupsApi`. Cada
   operação vira sua própria capability (`contacts.list`, `contacts.get`, `contacts.checkExists`,
   `contacts.getProfilePicture`, `contacts.getAbout`, `contacts.block`, `contacts.unblock`,
   `contacts.listBlocked`), gateada + `PROVIDER_ERROR` de guard-rail.
3. **`chatId`/`phone` passam por `normalizeChatId`** no conector, igual `to` de mensagens — não
   são opacos como `groupId`.
4. **Tipos novos em `src/core/types.ts`**: `Contact { id, name?, about?, profilePictureUrl?,
   hasWhatsApp?, isBlocked?, raw }` (todos os campos de detalhe opcionais — nenhum provider
   confirma todos ao mesmo tempo em uma única chamada), `CheckExistsResult { exists, chatId?, raw
   }`, `ContactProfilePicture { url?, raw }`, `ContactAbout { about?, raw }`.
5. **Escopo fatiado em 2 PRs** (confirmado com o usuário, escopo menor que grupos):
   - **PR1 (implementado)**: descoberta + perfil — `list`, `get`, `checkExists`,
     `getProfilePicture`, `getAbout`. **uazapi não declara `contacts.getAbout`** — confirmado sem
     nenhum endpoint/campo para recado pessoal em toda a doc oficial (mesma lacuna já identificada
     na pesquisa). Os demais 4 adapters implementam as 5 operações completas.
   - **PR2 (pendente)**: moderação — `block`, `unblock`, `listBlocked`.
   - `getPresence`: fora do escopo, incremento futuro à parte (ver "Achados principais").

## Justificativa

- Reaproveita integralmente o padrão dual opcional-no-adapter/sempre-presente-no-conector já
  validado em `messages.sendReaction` (ADR-0008) e `groups.*` (ADR-0009) — nenhuma decisão
  arquitetural nova, só aplicação consistente do padrão.
- Não compor múltiplas chamadas HTTP por trás de uma operação canônica mantém o adapter "burro"
  (só traduz) e evita custo de latência/complexidade de erro parcial escondidos do consumidor.
- Separar `getPresence` evita forçar um contrato request-response sobre um mecanismo que é
  fundamentalmente assíncrono/webhook para 4 dos 5 providers — mesmo raciocínio que levou a tratar
  webhooks de grupo como incremento à parte em ADR-0009.

## Consequências

- `docs/providers/<nome>.md` de cada adapter ganha uma seção "Contatos" nova, documentando os
  campos que cada provider NÃO consegue popular numa única chamada (ex.: nome de exibição ausente
  em Evolution GO/Wuzapi via `/user/info`) e as 2 lacunas de capability confirmadas (uazapi sem
  `getAbout`, WAHA/Z-API sem `listBlocked`).
- Qualquer adapter futuro (F3+) que não suporte uma operação de contato simplesmente não a declara
  em `capabilities` — nenhuma mudança de contrato necessária.
- `getPresence`/eventos de presença ficam como trabalho de acompanhamento explícito, a ser
  desenhado separadamente (provavelmente como evento canônico novo, não capability request-response).
