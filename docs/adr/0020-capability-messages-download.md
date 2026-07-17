# ADR-0020: Capability `messages.download`

- Status: aceito
- Data: 2026-07-17

## Contexto

Motivada por uma pergunta direta do usuário durante a implementação do adapter izapia (Epic 10):
por que um provider tão completo (~100 endpoints) declara só 64/68 capabilities do contrato
central? A resposta é o design pretendido (ADR-0005 — o contrato é o vocabulário COMUM entre
providers, não o teto de nenhum um deles), mas isso levou a uma pesquisa dedicada (Epic 11, ver
`ORCHESTRATOR-ROADMAP.md`) sobre se algum dos "extras" do izapia convergia com outros providers já
implementados o suficiente para virar capability nova — mesmo processo histórico das ADR-0008 a
ADR-0019.

Duas rodadas iniciais (recombinando só os dossiês já escritos de WAHA/Evolution GO/Wuzapi/uazapi/
Z-API/Whapi/QuePasa/WPPConnect) não confirmaram convergência para `messages.download` — a maioria
das entradas "incerto/não pesquisado", não "confirmado ausente". Uma terceira rodada — baixando e
inspecionando ao vivo os specs OpenAPI reais de uazapi (`https://docs.uazapi.com/openapi-bundled.json`)
e Whapi (`https://raw.githubusercontent.com/Whapi-Cloud/whatsapp-api-docs/main/openapi.yaml`), em
vez de só reler dossiê — reverteu a conclusão por completo:

| Provider | Endpoint | Confiança |
| --- | --- | --- |
| Evolution GO | `messages.downloadMedia` (endpoint de download por descritor; bug de rate-limit 429 autodocumentado pelo próprio provider) | Alta |
| uazapi | `POST /message/download`, body `{id, return_base64?, generate_mp3?, return_link?, transcribe?, openai_apikey?, download_quoted?}` → `{fileURL?, mimetype, base64Data?, transcription?}` | Alta (spec OpenAPI real, ao vivo) |
| Whapi | `GET /media/{MediaID}` (`operationId: getMedia`) — todo objeto de mídia recebido (`MediaFile`) carrega um `id` **obrigatório**, diferente do campo `link` (opcional/best-effort, mecanismo já usado quando presente) | Alta (spec OpenAPI real, ao vivo) |
| izapia | `POST .../messages/download`, body rico `{direct_path?, file_enc_sha256?, file_length?, file_sha256?, kind, media_key?, mimetype?, url?}` (stateless — precisa do descritor bruto, não só um id) | Alta |

4 providers confirmados — bem acima do piso histórico de 2+ (ver ADR-0019, `calls.make` promovido
com só 2/8).

**Z-API, QuePasa, WPPConnect: descartados com confiança razoável.** Resolvem mídia recebida via
URL já pronta no próprio payload do webhook (`image.imageUrl`, `WhatsappAttachment.Url`, etc.) —
mecanismo diferente do "download por descritor" desta capability (não precisa de uma segunda
chamada). **WAHA**: mecanismo funcionalmente parecido (URL apontando de volta pra própria
instância) mas também não é o mesmo conceito. **Wuzapi**: entrega sempre via push
(`media_delivery: base64|s3|both` no webhook), sem endpoint de download por descritor.

## Decisão

1. **Capability nova `messages.download`**, método opcional em `MessagesApi` — mesmo padrão de
   `sendReaction`/`edit`/`delete`/etc. (ADR-0008/0012).
2. **Tipos novos em `src/core/types.ts`**:
   ```ts
   interface DownloadMediaInput {
     messageId: string;
     raw?: unknown;
   }
   interface DownloadedMedia {
     base64: string;
     mimeType?: string;
     filename?: string;
     raw: unknown;
   }
   ```
   `raw` é o `WaMessage.raw` da mensagem original — só consumido por providers **stateless** que
   não guardam histórico de mensagens no servidor (hoje, só izapia); os demais (uazapi, Evolution
   GO, Whapi) resolvem o download só com `messageId`, porque mantêm o histórico do lado deles.
3. **`MediaRef` ganha um campo novo `id?: string`** — identificador opaco do arquivo de mídia no
   provider, populado em `WaMessage.media` quando o provider NÃO entrega `url`/`base64` prontos no
   webhook de mensagem recebida (ex.: Whapi sem auto-download, Evolution GO, uazapi, izapia).
   Nunca usado como entrada de `sendMedia` (que continua exigindo `url` ou `base64`).
4. **`ConnectorMessagesApi.download`** sempre presente (gateado por capability, mesmo padrão dos
   demais métodos de `messages.*`), com validação de `messageId` não vazio no conector
   (`raw` é opaco, repassado sem validação).

## Justificativa

- **Por que `raw` opcional em vez de sempre obrigatório**: exigir `raw` sempre forçaria os
  consumidores de uazapi/Evolution GO/Whapi (que só precisam de `messageId`) a guardar e repassar
  o payload bruto da mensagem original sem necessidade real — atrito desnecessário para 3 dos 4
  providers. Deixar opcional, documentando explicitamente que só é consumido por providers
  stateless, é mais honesto sobre a divergência real de arquitetura entre os providers do que
  fingir uma interface uniforme que não existe de fato.
- **Por que `MediaRef.id` em vez de reaproveitar algum campo existente**: `url`/`base64` já têm
  semântica fixa (conteúdo pronto); usar um deles para um identificador opaco seria confuso e
  quebraria a suposição de outros pontos do código de que `url`/`base64` presentes = mídia já
  pronta para uso.
- **Por que a pesquisa nova (specs OpenAPI ao vivo) foi necessária**: as duas primeiras rodadas
  (só releitura de dossiê) concluíram "não promover" porque nenhuma pesquisa dedicada tinha ido
  atrás desses endpoints especificamente — "não documentado" não é o mesmo que "não existe". A
  lição registrada em `ORCHESTRATOR-ROADMAP.md` (Epic 11) é que recombinar pesquisa antiga tem
  valor limitado quando a pergunta é genuinamente nova.

## Consequências

- Enum de capabilities cresce de 68 para 69 (ver ADR-0021 para as +3 de `channels.*`, total 72).
- Cobertura inicial: 4/9 (Evolution GO, uazapi, Whapi, izapia) — os outros 5 (WAHA, Z-API, Wuzapi,
  QuePasa, WPPConnect) resolvem mídia recebida por outro mecanismo (URL já pronta no webhook) ou
  não confirmam suporte; podem ganhar a capability numa rodada futura se pesquisa nova confirmar.
- `MockAdapter` implementa como um retorno fixo determinístico (sem estado real de mensagens
  recebidas, mesmo padrão de `calls.make`/`reject` — ação transiente sem estado persistente
  natural para simular).
- Changeset `minor` — mudança aditiva, sem breaking change.

## Alternativas consideradas

- **Exigir `raw` sempre**: rejeitado — ver Justificativa acima.
- **Modelar como parte de `WaMessage` diretamente (ex.: um método `WaMessage.download()`)**:
  rejeitado — o pacote não expõe objetos com métodos anexados (todo tipo canônico é dado puro,
  serializável); manter `download` como uma operação do conector, recebendo o `messageId` (e
  opcionalmente `raw`) extraídos de um `WaMessage` já recebido, é consistente com o resto do
  contrato.
- **Um método por provider (`messages.downloadByDescriptor` vs. `messages.downloadById`)**:
  rejeitado — a distinção stateful/stateless é um detalhe de implementação do adapter, não algo
  que o consumidor deveria precisar saber para chamar a capability; uma única operação com `raw`
  opcional cobre os dois casos sem expor essa distinção na API pública.
