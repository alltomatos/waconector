# ADR-0016: Namespace `labels.*` (`list`/`create`/`update`/`delete`/`addToChat`/`removeFromChat`)

- Status: aceito
- Data: 2026-07-12

## Contexto

Quarto item da fila de capabilities novas (ver ADR-0013/0014/0015 para os três primeiros).
Reconfirmação de escopo (releitura dos 8 relatórios salvos da Epic 7 + verificação ao vivo via
`gh api` para QuePasa e WPPConnect, cujos relatórios originais não tinham aprofundado o assunto):

| Capability | waha | evolution | uazapi | zapi | wuzapi | whapi | quepasa | wppconnect | cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `labels.list` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 7/8 |
| `labels.create` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | 6/8 |
| `labels.update` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — | 5/8 |
| `labels.delete` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | 6/8 |
| `labels.addToChat` | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | 5/8 |
| `labels.removeFromChat` | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | 5/8 |

**Wuzapi tem 0/6, busca negativa explícita** — nenhuma rota de etiquetas no relatório original nem
em verificação adicional; documentado como limitação real do provider, não gap de pesquisa.

**Z-API tem 1/6** (só `labels.list`) — mesmo critério de "não arredondar cobertura" já aplicado em
ADRs anteriores (ex.: presence.* do próprio Z-API): só o que o relatório confirma com payload real
entra nesta rodada.

**WAHA declina `addToChat`/`removeFromChat`** — o endpoint nativo (`PUT /api/{session}/labels/chats/{chatId}`)
é bulk-replace (substitui a lista inteira de labels do chat), não add/remove incremental; emular
add/remove exigiria um GET prévio para montar a lista completa antes do PUT, violando a convenção já
estabelecida nesta sessão ("uma operação canônica = uma chamada HTTP, sem round-trip extra" —
precedente: `chats.markRead` da Wuzapi, ADR-0012).

**Evolution GO tem `labels.list`, achado ao vivo (`GET /label/list`)** — o relatório original
(`evo-go-label.yaml`, spec estático) não tinha encontrado esse endpoint ("Não existe endpoint de
listagem"); verificação ao vivo do código-fonte real (`label_handler.go`/`label_service.go`)
encontrou `GET /label/list`, que devolve os labels persistidos no banco do próprio Evolution GO a
partir de eventos de app-state sync — mesmo padrão de "achado que muda o cálculo de risco" já visto
para `presence.*` do WPPConnect (ADR-0015). **`labels.create`/`update`/`delete` convergem no MESMO
endpoint** (`POST /label/edit`, schema `EditLabel{labelId, name, color, deleted}`) — não existem
rotas separadas de criar/deletar; `deleted: true` é soft-delete. Duas nuances tratadas na
implementação: (1) o handler exige um `labelId` já escolhido pelo CHAMADOR mesmo para criar (sem
atribuição automática pelo servidor) — este adapter gera um `labelId` via `randomUUID()`,
documentado como caveat (ids fora do padrão numérico "1".."20" do app oficial WhatsApp Business
podem não exibir corretamente lá, embora funcionem para toda operação feita por este adapter); (2)
o handler exige `name` não vazio em TODA chamada a `/label/edit`, inclusive `delete` — como o
contrato canônico `delete(labelId)` não carrega `name`, este adapter busca o `name`/`color` atuais
via `GET /label/list` antes de enviar `deleted: true`, uma exceção deliberada à convenção de "uma
chamada HTTP por operação" (NECESSIDADE do único endpoint disponível, não uma escolha de emulação
como o caso da WAHA acima).

**WPPConnect não tem `labels.update`** — só `add-new-label` (criar), `get-all-labels` (listar),
`delete-label/:id` (deletar) e `add-or-remove-label` (associar/desassociar); nenhuma rota edita um
label existente. Verificado ao vivo via `gh api` contra `wppconnect-server@f09e2fed`
(`src/controller/labelsController.ts`).

**QuePasa tem 6/6, mas com uma ressalva documentada** — verificado ao vivo via `gh api` contra
`quepasa@17c3b10b` (`api_handlers+ConversationLabelController.go`): `PUT /labels` sobrescreve
incondicionalmente `current.Name`/`current.Color` com o que vier no corpo da requisição (sem merge
parcial no servidor). `name` é validado como obrigatório server-side (400 se ausente), mas `color`
NÃO é — omitir `color` num update apagaria silenciosamente a cor atual do label. Ver Decisão #2 para
como o contrato canônico mitiga a classe `name`-erasure; o caveat de `color` específico do QuePasa
fica documentado no dossiê e no comentário do adapter.

**Cor (`color`) é um valor OPACO, não um vocabulário canônico** — cada provider usa um formato
fundamentalmente diferente: WAHA aceita índice numérico OU hex; Evolution usa inteiro; uazapi usa
inteiro 0-19; Whapi usa um enum fechado de 20 cores nomeadas (ex.: `salmon`); QuePasa aceita string
livre; WPPConnect usa um inteiro ARGB grande. Nenhum converge o suficiente para justificar um
vocabulário compartilhado — mesmo critério já usado para duração de `chats.mute` (ADR-0012) e
`messages.pin` (ADR-0013).

## Decisão

1. **Namespace novo `WaAdapter.labels?: LabelsApi`, inteiramente OPCIONAL** — mesmo padrão de
   `chats?`/`presence?` (ADR-0012/0015): todos os 6 métodos também opcionais dentro da interface.
2. **Tipos novos em `src/core/types.ts`**:
   - `LabelInfo { id, name, color?, raw }` — `color` opaco (ver Contexto).
   - `CreateLabelInput { name, color? }`.
   - `UpdateLabelInput { labelId, name, color? }` — **`name` sempre obrigatório aqui**, diferente de
     `CreateLabelInput` (onde é obrigatório) e sobretudo diferente do que se esperaria de um PATCH
     parcial: exigir `name` no contrato canônico protege TODOS os adapters (não só QuePasa) contra a
     classe de bug "enviei só a cor e apaguei o nome sem querer". Não elimina o risco inverso
     (`color` ausente apagando a cor no QuePasa especificamente) — esse caveat fica no dossiê/adapter.
   - `LabelChatInput { chatId, labelId }` — usado por `addToChat`/`removeFromChat` (mesma forma para
     as duas direções, mesmo padrão de `StarMessageInput`/`PinMessageInput`, ADR-0013).
3. **`LabelsApi`**:
   ```ts
   interface LabelsApi {
     list?(): Promise<LabelInfo[]>;
     create?(input: CreateLabelInput): Promise<LabelInfo>;
     update?(input: UpdateLabelInput): Promise<void>;
     delete?(labelId: string): Promise<void>;
     addToChat?(input: LabelChatInput): Promise<void>;
     removeFromChat?(input: LabelChatInput): Promise<void>;
   }
   ```
4. **`ConnectorLabelsApi`** — todo método sempre presente (namespace resolvido no conector), gateado
   por capability + guard-rail `PROVIDER_ERROR` via um novo `callLabelsMethod`, réplica exata de
   `callPresenceMethod`/`callChatsMethod`.
5. **Validação no conector**: `name` obrigatório e não-vazio em `create`/`update`; `labelId`
   obrigatório e não-vazio em `update`/`delete`/`addToChat`/`removeFromChat` — tratado como valor
   OPACO (mesmo critério de `groupId`, ADR-0009), **não** passa por `normalizeChatId`; `chatId` em
   `addToChat`/`removeFromChat` normalizado via `normalizeChatId` (mesmo tratamento do resto de
   `messages.*`/`chats.*`/`presence.*`).

## Justificativa

- **Por que namespace novo em vez de métodos em `ChatsApi`**: etiquetas são metadados organizacionais
  compartilhados entre conversas (um label existe independente de qualquer chat específico, e pode
  ser associado a vários), distinto do estado por-conversa de `chats.*` (arquivar/silenciar/fixar,
  que não tem existência própria fora do chat). Mesmo critério que separou `presence.*` de
  `chats.*`/`messages.*` no ADR-0015.
- **Por que `UpdateLabelInput.name` é obrigatório e `CreateLabelInput.name` também, mas `color` é
  opcional nos dois**: o servidor QuePasa valida `name` mas não `color` — tornar `name` sempre
  obrigatório no contrato elimina essa classe de erasure-bug universalmente; `color` permanece
  opcional porque nem todo caller quer/precisa definir uma cor, e a alternativa (exigir sempre)
  forçaria todo chamador a redigitar uma cor que não queria mudar.
- **Por que `color` é uma string opaca em vez de um enum canônico**: nenhum vocabulário converge
  entre os 6 providers que suportam cor (índice numérico, hex, inteiro simples, enum nomeado, string
  livre, ARGB) — inventar uma tradução arriscaria perda de fidelidade ou mapeamentos incorretos sem
  benefício real, mesmo critério já usado para duração de mute/pin.
- **Por que WAHA declina `addToChat`/`removeFromChat`**: seguindo a convenção já estabelecida (ver
  Contexto) de nunca emular uma operação com um round-trip GET-then-PUT extra que o provider não
  oferece nativamente como chamada única.

## Consequências

- Enum de capabilities cresce de 52 para 58.
- Cobertura desigual entre os 6 métodos (7/8, 6/8, 5/8, 6/8, 5/8, 5/8) — Wuzapi fica sem nenhum dos 6
  (limitação real, busca negativa confirmada); Z-API só com `list` (1/6).
- `MockAdapter` implementa os 6 métodos em memória (`labelsById`, `labelIdsByChatId`) com um getter
  de inspeção (`getChatLabelIds`) só para teste — mesmo padrão de `getChatLabelIds`/`isChatArchived`.
- Changeset `minor` — mudança aditiva, sem breaking change.
- Caveat documentado (não resolvido, por design): `labels.update` no QuePasa apaga a cor atual se
  `color` for omitido — decisão consciente de expor o comportamento real do provider em vez de
  simular um merge parcial que o servidor não faz.

## Alternativas consideradas

- **`color` como enum canônico com paleta fixa**: rejeitado — exigiria uma tabela de tradução
  arbitrária entre 6 vocabulários incompatíveis (índice, hex, inteiro, nome, string livre, ARGB) sem
  garantia de fidelidade visual entre providers.
- **`UpdateLabelInput.name` opcional (patch parcial genuíno)**: rejeitado — mascararia o
  comportamento real do QuePasa (que sempre sobrescreve, nunca faz merge parcial) atrás de uma API
  que sugere o contrário; o consumidor pensaria que só a cor mudou e perderia o nome sem aviso.
- **Emular `addToChat`/`removeFromChat` da WAHA via GET + PUT bulk-replace**: rejeitado — violaria a
  convenção "uma operação canônica = uma chamada HTTP" já estabelecida nesta sessão; a condição de
  corrida entre o GET e o PUT (outro processo alterando os labels do chat nesse meio-tempo) também
  tornaria a emulação não-atômica de um jeito que o adapter não deveria mascarar.
