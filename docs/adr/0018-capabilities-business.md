# ADR-0018: Namespace `business.*` (`getProfile`/`updateProfile`)

- Status: aceito
- Data: 2026-07-12

## Contexto

Sexto item da fila de capabilities novas (ver ADR-0013/0014/0015/0016/0017 para os cinco
primeiros). O plano original já sinalizava cobertura mais fraca para este item ("avaliar se vale
catálogo completo ou só perfil na primeira PR"). Reconfirmação de escopo (releitura dos 8
relatórios salvos da Epic 7 + verificação ao vivo via `gh api`/arquivos já cacheados para os 4
providers whatsmeow-based, que o research original não tinha investigado explicitamente para este
tópico):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `business.getProfile` | — | — | ✅ | — | — | ✅ | — | — | 2/8 |
| `business.updateProfile` | — | — | ✅ | — | — | ✅ | — | ✅ | 3/8 |

**Escopo deliberadamente restrito a perfil (`getProfile`/`updateProfile`), catálogo/produtos FORA
desta rodada** — decisão de desenho explícita, já antecipada pelo próprio plano da fila. Todos os 3
relatórios que mencionam `business.*` (uazapi, Z-API, Whapi) também documentam uma família bem
maior de endpoints de catálogo/produtos/coleções/pedidos (`business.catalog.*`,
`business.products.*`, `business.collections.*`, `business.getOrderItems`,
`business.sendProduct`/`sendCatalog`) — mas os 3 relatórios convergem em tratar isso como
"feature de e-commerce do WhatsApp Business, fora do foco de um conector de mensageria" (citação
literal do relatório da Z-API) ou de confiança/profundidade insuficiente (uazapi: "não abri o
schema completo de cada endpoint... confiança Baixa-Média para virar capability canônica"). Fica
fora desta ADR, ver Alternativas.

**uazapi 2/2, confiança Alta** — `POST /business/get/profile` (`getProfile`) e
`POST /business/update/profile` (`updateProfile`), ambos com payload real documentado.
**Nuance de resposta parcial**: `updateProfile` usa `207 Multi-Status` quando parte dos campos
falha (`{updated, failed}`, com detalhe por campo) — único endpoint do spec inteiro que usa `207`.
Tratado como falha total (`PROVIDER_ERROR`) se `failed` não estiver vazio — ver Decisão.

**Z-API 0/2, achado ao vivo que corrige a estimativa original do plano** — o relatório documenta
`GET /instances/{id}/token/{token}/business/profile?phone=...` com payload real capturado
(`description`, `address`, `email`, `websites`, `categories`, `businessHours`, `hasCoverPhoto`), e o
plano original contava isso como `business.getProfile` confirmado. Análise mais cuidadosa durante o
desenho, cruzando com o padrão já estabelecido no PRÓPRIO adapter Z-API (`contacts.getProfilePicture`/
`getAbout`, que recebem `chatId` e resolvem para o mesmo estilo de query param `?phone=...` de UM
CONTATO específico), mostra que este endpoint **exige um `phone` de destino** — ou seja, é uma
consulta ao perfil comercial de UM NÚMERO ESPECÍFICO (provavelmente um contato), não "meu próprio
perfil" (que é o que `BusinessApi.getProfile()` modela, sem nenhum parâmetro). Confirma isso o fato
de a Z-API não ter, nesta fase, nenhum endpoint implementado que devolva o número da própria
instância conectada (`GET /device`, que teria esse dado, não é usado por este adapter — citado no
relatório original só como candidata de prioridade baixa) — não há como este adapter obter
barato o "meu próprio telefone" para testar a hipótese de auto-consulta, e o formato do endpoint
(idêntico ao de `getProfilePicture`/`getAbout`) sugere fortemente que não é essa a semântica.
**Não é um gap de confiança no payload — é um descasamento de forma de capability**: o endpoint real
parece ser mais próximo de um futuro `contacts.getBusinessProfile(chatId)` do que de
`business.getProfile()`. Fica fora desta ADR (ver Alternativas), corrigindo a contagem original do
plano de "3 providers, Z-API incluído" para os 2 providers confirmados abaixo.

**Whapi 2/2, confiança Alta, achado ao vivo que corrige o relatório original** — o relatório
original documentava o endpoint de edição como `PATCH /business`; verificação ao vivo contra o
`openapi.yaml` cacheado (`operationId: editBusinessProfile`) mostra que o método real é
**`POST /business`**, não `PATCH`. `getProfile` via `GET /business` (`operationId:
getBusinessProfile`). Schema de resposta (`BusinessProfile`, via `allOf` de
`BusinessProfileCustom` + `id`) **não tem campo `categories`** — diferente de uazapi/Z-API/
WPPConnect, que têm. `BusinessProfileCustom` (usado tanto na resposta quanto no corpo de
`updateProfile`) também aceita `hours`/`websites` na edição, mas esses campos ficam FORA do
`UpdateBusinessProfileInput` desta rodada (ver Decisão) por não serem confirmados como suportados
em uazapi (que só documenta `description`/`address`/`email` como editáveis).

**Evolution GO e Wuzapi: 0/2, busca negativa confirmada ao vivo** — ambos baseados em whatsmeow;
verificação ao vivo dos arquivos já cacheados (`user_service.go` do Evolution GO,
`handlers.go` do Wuzapi) encontrou só um campo `BusinessName` no perfil de UM CONTATO (indicando se
esse contato é uma conta Business) — não uma API para ler/editar o PRÓPRIO perfil comercial da
instância. Limitação real, não gap de pesquisa.

**WAHA e QuePasa: 0/2** — nenhuma menção a perfil comercial em nenhum dos dois relatórios
originais; ambos por natureza mais próximos de "WhatsApp Web genérico" que de uma integração
específica com a API oficial de Business.

**WPPConnect 1/2 (só `updateProfile`), achado ao vivo que muda o cálculo de risco** — o relatório
original não tinha investigado este tópico. Busca ao vivo em `routes.ts` (cache já existente,
seção `// Business`) encontrou `POST /api/{session}/edit-business-profile`
(`SessionController.editBusinessProfile`) — mas **nenhuma rota de leitura** (`get-business-profile`
não existe; as duas outras rotas da seção, `get-business-profiles-products` e
`get-order-by-messageId`, são de catálogo/pedidos, fora de escopo). **Nuance real do payload**:
o campo de endereço se chama `adress` (sic — grafia incorreta do provider, confirmada no exemplo
`#swagger.parameters` do controller), não `address`; o adapter mapeia
`UpdateBusinessProfileInput.address` → `adress` na saída. Body aceito:
`{adress?, email?, categories?, websites?}` — `description` não é um campo aceito por este
endpoint (nuance real: `editBusinessProfile` do WPPConnect não tem campo de descrição, diferente de
uazapi/Whapi).

## Decisão

1. **Namespace novo `WaAdapter.business?: BusinessApi`, inteiramente OPCIONAL** — mesmo padrão de
   `chats?`/`presence?`/`labels?`/`channels?` (ADR-0012/0015/0016/0017): os 2 métodos também
   opcionais dentro da interface.
2. **Tipos novos em `src/core/types.ts`**:
   - `BusinessProfile { description?, address?, email?, websites?, categories?, raw }` —
     `categories` normalizado para `string[]` (só os nomes/labels de exibição): o shape completo do
     objeto categoria diverge entre providers que o documentam com payload real (uazapi:
     `{id, localized_display_name}`; Z-API, não implementado nesta ADR, ver Contexto:
     `{id, label, displayName}`; Whapi nem tem o campo) — mesmo critério de "opaco/simplificado no
     contrato, detalhe completo só em `raw`" já usado para `LabelInfo.color` (ADR-0016).
   - `UpdateBusinessProfileInput { description?, address?, email? }` — os 3 campos confirmados como
     editáveis em uazapi/Whapi (`description`/`address`/`email`); WPPConnect (ver Contexto) confirma
     `address`/`email` mas **não tem campo `description`** no seu endpoint — este adapter ignora
     silenciosamente `description` quando fornecido, caveat documentado no dossiê. `websites`/`hours`
     (aceitos só pelo Whapi) e `categories` (nenhum provider confirma edição de categoria via API)
     ficam fora desta rodada.
3. **`BusinessApi`**:
   ```ts
   interface BusinessApi {
     getProfile?(): Promise<BusinessProfile>;
     updateProfile?(input: UpdateBusinessProfileInput): Promise<void>;
   }
   ```
4. **`ConnectorBusinessApi`** — todo método sempre presente (namespace resolvido no conector),
   gateado por capability + guard-rail `PROVIDER_ERROR` via um novo `callBusinessMethod`, réplica
   exata de `callChannelsMethod`/`callLabelsMethod`.
5. **Validação no conector**: `updateProfile` exige ao menos 1 dos 3 campos (`description`/
   `address`/`email`) não-`undefined` — nenhum provider confirmado aceita um update vazio (uazapi
   documenta isso explicitamente como erro 400; escolhido como regra universal do conector por ser
   uma proteção óbvia contra uma chamada no-op, mesmo sem confirmação explícita nos outros 2
   providers).
6. **`updateProfile` retorna `Promise<void>`, não o perfil atualizado** — nenhum dos 3 providers
   confirma um retorno de corpo útil e uniforme (Whapi devolve um ack genérico `{sent: true}`-like;
   WPPConnect devolve o resultado bruto do client, shape não documentado com confiança; uazapi tem o
   caso especial do `207`) — mesmo critério de `groups.updateSubject`/`updateDescription`/
   `labels.update` (ADR-0009/0016), todos `Promise<void>`.

## Justificativa

- **Por que só perfil, sem catálogo/produtos nesta rodada**: os 3 relatórios de origem convergem em
  tratar catálogo como fora do foco do pacote (conector de MENSAGERIA, não e-commerce) e/ou de
  confiança insuficiente para virar capability canônica — mesmo critério de "não expandir escopo
  além do núcleo confirmado com confiança" já usado em ADR-0015 (`presence.get` fora)/ADR-0017
  (`updateName`/`mute`/etc. fora de `channels.*`).
- **Por que `categories` é `string[]` em vez de preservar `{id, ...}`**: o shape diverge entre os 3
  providers que o expõem (uazapi/Z-API têm formatos de objeto diferentes; Whapi nem tem o campo) —
  normalizar para os nomes de exibição dá um valor útil e comparável entre providers sem forçar um
  formato de objeto arbitrário; o objeto completo (com IDs específicos do provider) continua
  disponível via `raw`.
- **Por que `updateProfile` não devolve o perfil atualizado**: nenhum provider confirma um corpo de
  resposta útil e uniforme; forçar um refetch via `getProfile()` extra seria uma chamada HTTP a
  mais não pedida pelo chamador — decisão consistente com o restante do contrato (`void` para
  updates sem confirmação de retorno útil).
- **Por que a validação de "ao menos 1 campo" fica no conector, não em cada adapter**: é uma regra
  de negócio cross-provider (evitar um update vazio/no-op), não uma peculiaridade de um provider
  específico — mesmo critério de centralizar validação no conector já estabelecido no
  `CONTRIBUTING.md`/CLAUDE.md do projeto.
- **Por que o WPPConnect só implementa `updateProfile`, não `getProfile`**: busca exaustiva na
  seção `// Business` de `routes.ts` (fonte primária, live-verificada) não encontrou nenhuma rota
  de leitura — limitação real confirmada, não lacuna de pesquisa; mesmo critério de "declarar só o
  que está confirmado" já aplicado a coberturas assimétricas anteriores (ex.: Evolution GO sem
  `channels.delete`/`unfollow`, ADR-0017).

## Consequências

- Enum de capabilities cresce de 64 para 66.
- Cobertura concentrada em 3 dos 8 providers (uazapi 2/2, Whapi 2/2, WPPConnect 1/2 — só
  `updateProfile`, sem `description`); WAHA, Evolution GO, Z-API, Wuzapi e QuePasa ficam em 0/2
  (limitação real de plataforma para os 4 primeiros; para Z-API, ver Contexto — o único endpoint
  candidato tem forma incompatível com `getProfile()` sem parâmetro).
- `MockAdapter` implementa os 2 métodos em memória (`businessProfile`, patch parcial acumulado
  entre chamadas de `updateProfile`) — sem getter de inspeção extra, já que `getProfile()` já expõe
  o estado diretamente (diferente de `isFollowingChannel`/`getChatLabelIds`, que expõem estado NÃO
  coberto por um método de leitura do próprio contrato).
- Changeset `minor` — mudança aditiva, sem breaking change.
- Caveat documentado (não resolvido, por design): o `207 Multi-Status` de sucesso parcial da uazapi
  é tratado como falha total pelo adapter (lança `PROVIDER_ERROR` se `failed` não estiver vazio) —
  simplifica o contrato (`updateProfile` continua "tudo ou nada" para o chamador) ao custo de não
  expor qual campo especificamente falhou; um consumidor que precise desse detalhe hoje só o
  encontra inspecionando o erro via `raw`/mensagem, não um campo estruturado dedicado.
- Caveat documentado: o campo `adress` (grafia incorreta) do WPPConnect é uma peculiaridade
  exclusiva desse adapter — a tradução `address` → `adress` acontece só na camada do adapter, o
  contrato canônico continua com o nome correto.

## Alternativas consideradas

- **Implementar `business.getProfile` na Z-API usando o `phone` da própria instância**: rejeitado —
  exigiria um novo endpoint (`GET /device`) não implementado por nenhuma capability atual deste
  adapter só para obter o número próprio, e mesmo assim a semântica de auto-consulta não é
  confirmada (ver Contexto); o endpoint parece modelar antes uma consulta a UM CONTATO específico
  (mesmo padrão de `contacts.getProfilePicture`/`getAbout`), não `business.getProfile()` sem
  argumento. Fica como candidata para uma futura `contacts.getBusinessProfile(chatId)` — uma
  capability DIFERENTE desta ADR, não uma variante dela.
- **Incluir `business.catalog.*`/`business.products.*` nesta rodada**: rejeitado — os 3 relatórios
  de origem já sinalizam isso como fora do foco de mensageria e/ou confiança insuficiente; ficaria
  como candidata para uma ADR dedicada futura, caso o roadmap do produto decida expandir para
  e-commerce.
- **`websites`/`hours` em `UpdateBusinessProfileInput`**: rejeitado nesta rodada — só o Whapi
  confirma esses campos como editáveis; incluir agora quebraria a convenção de "campo no contrato
  == confirmado em múltiplos providers" sem trazer benefício imediato (WPPConnect aceita
  `websites` mas não via um campo já coberto pelos outros 2 providers com confiança).
- **Retornar o perfil atualizado em `updateProfile`**: rejeitado — nenhum provider confirma um
  corpo de resposta útil e uniforme (ver Decisão/Justificativa); forçar um `getProfile()` interno
  extra dentro do adapter adicionaria uma chamada HTTP não pedida pelo chamador, violando a
  convenção "uma operação canônica = uma chamada HTTP, sem round-trip extra" salvo necessidade
  genuína (não é o caso aqui).
- **Expor o detalhe do `207` da uazapi como um retorno estruturado** (ex.:
  `{updated: string[], failed: string[]}`): rejeitado — nenhum outro provider tem esse conceito de
  sucesso parcial, e introduzir um retorno rico só para 1/8 providers quebraria a uniformidade do
  contrato (`void` em todo o resto); tratado como `PROVIDER_ERROR` (ver Consequências).
