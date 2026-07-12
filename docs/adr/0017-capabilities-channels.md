# ADR-0017: Namespace `channels.*` (`list`/`create`/`getInfo`/`delete`/`follow`/`unfollow`)

- Status: aceito
- Data: 2026-07-12

## Contexto

Quinto item da fila de capabilities novas (ver ADR-0013/0014/0015/0016 para os quatro primeiros).
Reconfirmação de escopo (releitura dos 8 relatórios salvos da Epic 7 + verificação ao vivo via
`gh api` para QuePasa e WPPConnect, cujos relatórios originais não tinham aprofundado — ou, no caso
do WPPConnect, tinham simplesmente não encontrado — o assunto):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `channels.list` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | 5/8 |
| `channels.create` | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | 6/8 |
| `channels.getInfo` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | 4/8 |
| `channels.delete` | ✅ | — | ✅ | — | — | ✅ | — | ✅ | 4/8 |
| `channels.follow` | ✅ | ✅ | ✅ | — | — | ✅ | — | — | 4/8 |
| `channels.unfollow` | ✅ | — | ✅ | — | — | ✅ | — | — | 3/8 |

**Nome canônico: `channels`, não `newsletters`** — decisão de desenho explícita desta ADR. A
maioria dos providers usa "newsletter" internamente (Evolution GO, uazapi, Z-API, Wuzapi,
WPPConnect — herdado do protocolo reverso-projetado, onde o recurso whatsmeow se chama
`Newsletter`), mas o WAHA usa "channels" no próprio endpoint (`/api/{session}/channels`, tag "📢
Channels" na doc), e o Whapi — mesmo com o schema OpenAPI chamado `Newsletter` — usa "WhatsApp
Channel" na documentação renderizada e nas mensagens de erro ("Need channel authorization for..."). É
também o nome público do produto (Meta rebatizou a feature de "Newsletters" para "WhatsApp Channels"
para os usuários finais, embora o protocolo interno reverso-projetado ainda use o nome antigo) — o
nome que um consumidor do waconector mais provavelmente reconhece/procura. Mesmo critério de
"preferir o nome voltado ao usuário final do WhatsApp, não a nomenclatura interna do provider" já
usado para `labels.*` (ADR-0016).

**Wuzapi tem só `list` (1/6), somente leitura** — confirmado: `GET /newsletter/list` lista canais
já inscritos (`GetSubscribedNewsletters`), mas busca exaustiva em `routes.go` não encontrou nenhum
endpoint de `create`/`getInfo`/`delete`/`follow`/`unfollow` — mesmo critério de "não arredondar
cobertura" já aplicado a outros providers com cobertura mínima nesta sessão.

**Z-API tem só `create` (1/6)** — `POST /instances/{id}/token/{token}/create-newsletter` confirmado
com payload real (`{name, description?}` → `{id: "...@newsletter"}`), confiança Média-Alta; as
demais 8 operações do índice (`newsletter-list`, `update-newsletter-*`, `delete-newsletter`,
`follow`/`unfollow-newsletter`) só confirmadas por nome, confiança Baixa — mesmo critério de "só o
que o relatório confirma com payload real entra nesta rodada" já aplicado em `labels.*` (ADR-0016).

**Evolution GO não tem `delete` nem `unfollow`** — busca no `newsletter.yaml` oficial e no
código-fonte real (`newsletter_handler.go`/`newsletter_service.go`, verificado ao vivo via `gh api`)
não encontrou `DELETE /newsletter/{id}` nem `POST /newsletter/unsubscribe` — só `create`/`list`/
`info`(getInfo)/`subscribe`(follow) existem.

**Achado ao vivo que corrige uma leitura equivocada do OpenAPI estático**: o `newsletter.yaml` tipa
o campo `jid` das rotas de newsletter como um objeto ESTRUTURADO `{user, server, device, integrator,
rawAgent}` — reflexo ingênuo dos campos Go de `types.JID` (whatsmeow) pelo gerador de spec, que
inicialmente sugeria a necessidade de decompor o `channelId` canônico nesse formato antes de cada
chamada. Verificação ao vivo contra o código-fonte real de `types.JID` (`tulir/whatsmeow`,
`types/jid.go`) mostra que `JID` implementa `MarshalText`/`UnmarshalText` — Go's `encoding/json`
respeita essa interface e trata o campo inteiro como uma STRING opaca (`jid.String()` na saída,
`ParseJID(string)` na entrada), exatamente no formato canônico já usado pelo resto do pacote
(`"<dígitos>@newsletter"`). Ou seja, **o schema documentado no OpenAPI é enganoso** — o formato real
de wire é uma string simples, sem decomposição nenhuma (mesmo padrão de `toProviderNumber`, função
identidade). Mesmo critério de "verificação ao vivo corrige achado do relatório estático" já
aplicado a `presence.*` do WPPConnect (ADR-0015) e `labels.list` do próprio Evolution GO (ADR-0016)
— mas aqui a correção vai na direção oposta (simplifica em vez de expandir a superfície).

**QuePasa tem 0/6, busca negativa confirmada ao vivo** — `gh api` contra o código-fonte completo do
commit pinado não encontrou nenhum controller/rota de canais/newsletters (só referências internas ao
RECONHECER mensagens vindas de um newsletter, não uma API de gestão) — limitação real do provider,
não gap de pesquisa.

**WPPConnect tem 2/6 (`create`/`delete`), achado ao vivo que corrige o relatório original** — a
pesquisa original (baseada só no relatório estático) não tinha encontrado NADA sobre
canais/newsletters neste provider. Verificação ao vivo do código-fonte real (`routes.ts` +
`newsletterController.ts`, commit pinado `f09e2fed`) encontrou 4 rotas: `POST /newsletter`
(criar), `PUT /newsletter/{id}` (editar — fora do escopo desta ADR, ver Alternativas),
`DELETE /newsletter/{id}` (deletar) e `POST /mute-newsletter/{id}` (silenciar — fora do escopo).
**Sem `list`, sem `getInfo`, sem `follow`/`unfollow`** — mesmo padrão de "achado que muda o cálculo
de risco" já visto em ADR-0015 (presence.* do WPPConnect)/ADR-0016 (labels.list do Evolution GO),
mas aqui o achado é PARCIAL (2 operações novas, não a cobertura inteira).

## Decisão

1. **Namespace novo `WaAdapter.channels?: ChannelsApi`, inteiramente OPCIONAL** — mesmo padrão de
   `chats?`/`presence?`/`labels?` (ADR-0012/0015/0016): todos os 6 métodos também opcionais dentro
   da interface.
2. **Tipos novos em `src/core/types.ts`**:
   - `ChannelInfo { id, name, description?, subscribersCount?, raw }` — `id` OPACO (mesmo critério
     de `GroupInfo.id`, ADR-0009): normalmente um JID `<dígitos>@newsletter`, nunca passa por
     `normalizeChatId`.
   - `CreateChannelInput { name, description? }` — deliberadamente SEM `picture` (foto de capa na
     criação): só 3/8 providers confirmam esse campo opcional no `create`, e `channels.updatePicture`
     nem é uma capability desta rodada (ver Alternativas) — mesmo critério de escopo mínimo já usado
     para `CreateGroupInput` (sem `picture`, ADR-0009; foto é operação separada,
     `groups.updatePicture`).
3. **`ChannelsApi`**:
   ```ts
   interface ChannelsApi {
     list?(): Promise<ChannelInfo[]>;
     create?(input: CreateChannelInput): Promise<ChannelInfo>;
     getInfo?(channelId: string): Promise<ChannelInfo>;
     delete?(channelId: string): Promise<void>;
     follow?(channelId: string): Promise<void>;
     unfollow?(channelId: string): Promise<void>;
   }
   ```
4. **`ConnectorChannelsApi`** — todo método sempre presente (namespace resolvido no conector),
   gateado por capability + guard-rail `PROVIDER_ERROR` via um novo `callChannelsMethod`, réplica
   exata de `callLabelsMethod`/`callPresenceMethod`.
5. **Validação no conector**: `name` obrigatório e não-vazio em `create`; `channelId` obrigatório e
   não-vazio em `getInfo`/`delete`/`follow`/`unfollow` — tratado como valor OPACO (mesmo critério de
   `groupId`/`labelId`, ADR-0009/0016), **não** passa por `normalizeChatId`.

## Justificativa

- **Por que `channels` e não `newsletters`**: ver Contexto — o nome público do produto e a
  nomenclatura de 2 dos 6 providers com cobertura real (WAHA no endpoint, Whapi na doc renderizada)
  favorecem "channels"; os outros 4 usam "newsletter" só como legado do protocolo interno
  reverso-projetado, não como termo voltado ao usuário final.
- **Por que `follow`/`unfollow` em vez de `subscribe`/`unsubscribe`**: WAHA e Whapi (as 2 fontes de
  maior confiança) usam terminologia diferente entre si (WAHA: `follow`/`unfollow`; Whapi:
  `subscribe`/`unsubscribe`, ambos endpoints porém SIMÉTRICOS — par completo nos dois). A escolha de
  `follow`/`unfollow` como nome canônico segue o precedente de preferir o verbo mais comum em UX de
  redes sociais/mensageria (WhatsApp Channels usa "Follow" na própria UI do app) — é também o par
  SEMPRE simétrico entre os providers que declaram ambos (WAHA, uazapi via `/newsletter/follow`+
  `/unfollow`); Evolution GO só tem o equivalente a "subscribe" (sem par "unsubscribe"), reforçando
  que nomear o par symmetric como `follow`/`unfollow` (e mapear cada provider ao que ele de fato tem)
  é mais claro que introduzir uma segunda dupla de verbos (`subscribe`/`unsubscribe`) para o mesmo
  conceito.
- **Por que `channelId` é opaco, não normalizado como `chatId` de mensagem**: mesmo critério de
  `groupId` (ADR-0009) — o formato varia por provider (JID `@newsletter` na maioria, mas o campo é
  estruturado no Evolution GO) e a operação nunca é "enviar uma mensagem" (onde `normalizeChatId`
  faz sentido), é sempre "gerenciar o recurso canal em si".
- **Por que `CreateChannelInput` não inclui `picture`**: cobertura insuficiente (só 3/8 confirmam
  o campo no create) e adicionaria complexidade de upload (URL vs. base64 vs. multipart, cada
  provider com um formato) sem benefício claro nesta rodada — mesmo critério que já levou
  `CreateGroupInput` a não incluir foto (ADR-0009, `groups.updatePicture` é operação separada).

## Consequências

- Enum de capabilities cresce de 58 para 64.
- Cobertura desigual entre os 6 métodos (5/8, 6/8, 4/8, 4/8, 4/8, 3/8) — QuePasa fica sem nenhum dos
  6 (limitação real, busca negativa confirmada ao vivo); Z-API e Wuzapi com só 1/6 cada (`create` e
  `list`, respectivamente); WPPConnect com 2/6 (`create`/`delete`, achado ao vivo que corrigiu o
  relatório original que não tinha achado nada).
- `MockAdapter` implementa os 6 métodos em memória (`channelsById`, `followedChannelIds`) com um
  getter de inspeção (`isFollowingChannel`) só para teste — mesmo padrão de
  `getChatLabelIds`/`isSubscribedToPresence`.
- Changeset `minor` — mudança aditiva, sem breaking change.
- Caveat documentado (não resolvido, por design): a estrutura de `jid` do Evolution GO
  (`{user, server, device, integrator, rawAgent}`) é uma tradução exclusiva desse adapter,
  necessária porque o canonical `channelId` é uma string opaca e esse provider especificamente
  exige um objeto estruturado — nenhum outro adapter desta ADR precisa desse tratamento.

## Alternativas consideradas

- **Incluir `updateName`/`updateDescription`/`updatePicture`/`mute`/`unmute` nesta rodada**:
  rejeitado — cobertura mais fraca e heterogênea que as 6 operações centrais escolhidas (ex.:
  WPPConnect só tem `editNewsletter`/`muteNewsletter`, sem os pares base `list`/`getInfo`; uazapi
  tem os 24 endpoints completos mas o próprio relatório de pesquisa recomenda tratar
  `newsletters.*` "como fase própria" dada a extensão). Ficam como candidatas para uma rodada
  futura dedicada, mesmo critério de "não expandir escopo além do núcleo confirmado com confiança"
  já usado em ADRs anteriores (ex.: `presence.get` fora do ADR-0015).
- **`channels.sendMessage`**: rejeitado — a doc do Whapi sugere que publicar num canal reaproveita
  `messages.sendText`/`sendMedia` já existentes com o `channelId` como `to` (não haveria endpoint
  dedicado de "postar"), então não é uma capability nova — é potencialmente já coberta pelo
  contrato atual sem mudança nenhuma, algo a confirmar contra uma instância real numa rodada futura,
  não a introduzir agora sem validação.
- **`newsletters` como nome canônico** (em vez de `channels`): rejeitado — ver Justificativa; a
  maioria numérica de providers usando "newsletter" internamente reflete legado de protocolo
  reverso-projetado, não preferência de nomenclatura voltada ao consumidor do pacote.
