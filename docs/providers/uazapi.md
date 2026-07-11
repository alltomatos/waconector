# Dossiê: uazapi

- Docs oficiais: <https://docs.uazapi.com/> (OpenAPI bundled: <https://docs.uazapi.com/openapi-bundled.json>)
- Versão testada: documentação consultada em 2026-07-10 (produto "uazapiGO - WhatsApp API", v2.1.1)
- Hospedagem: SaaS multi-tenant por subdomínio — `servers` do OpenAPI usa o template
  `https://{subdomain}.uazapi.com` (exemplos de enum: `free`, `api`). Não foi encontrado
  repositório público nem imagem Docker para self-hosting durante a pesquisa (diferente de
  WAHA/Evolution GO); `baseUrl` em `UazapiOptions` é sempre fornecido pelo consumidor, com o
  subdomínio do próprio cliente.

## Autenticação

Mecanismo de API-key custom em header — **não** `Authorization: Bearer`, sem OAuth/JWT/cookies em
toda a especificação. Dois níveis, ambos declarados como `securitySchemes` tipo `apiKey`/`in:header`
no OpenAPI:

- **`token`** (token de instância): header `token: <valor cru, sem prefixo>`. Exigido pela maioria
  dos endpoints operacionais regulares (send, chat, group, profile, connect, status, disconnect,
  delete instance, config de webhook por instância, sse). É o único token usado pelas capabilities
  implementadas nesta fase (F2).
- **`admintoken`** (token administrativo): header `admintoken: <valor cru>`. Exigido só em
  endpoints administrativos (`POST /instance/create`, listar todas as instâncias, webhook global,
  rotacionar admin token, reiniciar app, editar campos administrativos). **Nenhuma capability
  implementada nesta fase usa `admintoken`** — `UazapiOptions.adminToken` existe apenas para
  permitir que o consumidor guarde os dois tokens num único lugar e para uma fase futura que exponha
  provisionamento de instância (`instance.create`, fora do contrato atual). Rotação
  (`POST /admin/token/rotate`) é limitada a 1x/24h — não implementada.
- Exceção documentada: o endpoint `/sse` (Server-Sent Events, fora do escopo desta fase) aceita o
  token também via query string (`?token=...`), porque `EventSource` não permite headers
  customizados. Nenhum outro endpoint documenta autenticação via query string.

## Modelo de instância/sessão

Termo do provider: **"instância"** (`Instance`). Campos documentados do objeto `Instance`: `id`,
`token`, `status`, `qrcode` (PNG base64), `paircode`, `name`, `profileName`, `profilePicUrl`,
`isBusiness`, `plataform`, `systemName`, `owner`, `current_presence`, `lastDisconnect`,
`lastDisconnectReason`, `adminField01/02`, além de campos de CRM/chatbot (`openai_apikey`,
`chatbot_enabled`, ...), `created`/`updated`.

- **Criar** (fora do escopo desta fase — exige `admintoken`): `POST /instance/create`, body
  `{ name, adminField01?, adminField02? }`; cria em estado `disconnected` e devolve um `token`
  único a ser guardado pelo consumidor. Em servidores free/demo a instância é "automaticamente
  desconectada e deletada após 1 hora".
- **Conectar**: `POST /instance/connect` (header `token`). Body opcional
  `{ phone?, browser?, systemName?, proxy_managed_country?/state?/city? }`. Se `phone` for
  informado (`^\d{10,15}$`), o provider gera **código de pareamento** em vez de QR; se omitido,
  gera QR code. Coloca a instância em `connecting`. **Esta fase não expõe pairing code**: o
  contrato `InstanceApi.connect()` não recebe telefone como parâmetro, então o adapter sempre chama
  `/instance/connect` sem `phone` (fluxo de QR exclusivamente) — ver seção "Capabilities" abaixo.
- **Status**: `GET /instance/status` (header `token`). Resposta confirmada literalmente na doc:
  `{ instance: Instance (inclui qrcode/paircode atualizados durante a conexão), status: { connected, loggedIn, jid } }`,
  com `jid` no formato `{ user, agent, device, server: 's.whatsapp.net' }`.
- **Desconectar (soft)**: `POST /instance/disconnect` (header `token`) — encerra a sessão WhatsApp
  ativa mas **mantém o registro da instância**; reconectar exige novo QR/pairing code. É este
  endpoint que o adapter usa para `instance.logout()` (mesma semântica do `logout` do WAHA: revoga
  o device, mas não apaga a instância).
- **Deletar (hard)**: `DELETE /instance` — remove completamente a instância e seu token do banco.
  **Não implementado nesta fase** (fora do escopo de `InstanceApi`, que não tem operação de
  exclusão de instância).
- **Reset de runtime**: `POST /instance/reset` — reinicia sessão travada sem exigir novo QR e sem
  apagar a instância. Não implementado nesta fase.
- Valores de `status`: `disconnected | connecting | connected | hibernated`. Timeouts documentados
  do fluxo de conexão: 2 minutos para QR code, 5 minutos para pairing code.

## Capabilities implementadas nesta fase (F2)

`instance.connect`, `instance.status`, `instance.logout`, `messages.sendText`,
`messages.sendMedia`, `webhooks.parse`.

`instance.pairingCode` **não** foi declarada: embora o provider suporte pareamento por código
(`POST /instance/connect` com `phone`), `InstanceApi.connect()` não recebe telefone como parâmetro
nesta versão do contrato — expor esse fluxo exigiria mudar o contrato central, fora do escopo desta
fase (mesma decisão tomada no adapter WAHA).

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| `instance.connect` | `POST /instance/connect` | Sem `phone` no body (só fluxo de QR). Resposta não tem exemplo literal completo na doc — assumida com o mesmo formato do envelope de `GET /instance/status` (`{ instance: Instance, status? }`), já que ambos manipulam o mesmo objeto `Instance`; `ConnectResult.qr` é extraído de `instance.qrcode` (com fallback para um `qrcode` de topo, defensivo). **Assunção a validar contra uma instância real.** |
| `instance.status` | `GET /instance/status` | Verbatim na doc. `InstanceStatus.state` mapeado a partir de `instance.status` (tabela abaixo); quando `status === 'connecting'` e `instance.qrcode` está presente e não-vazio, o adapter refina para `'qr'` (o provider não expõe um valor de status dedicado para "aguardando scan", só o campo `qrcode` populado durante `connecting`). |
| `instance.logout` | `POST /instance/disconnect` | Soft-disconnect: mantém a instância, exige novo QR/pairing code para reconectar. `DELETE /instance` (hard-delete, apaga a instância) **não** é usado aqui — semântica diferente e fora do escopo de "logout". |
| `messages.sendText` | `POST /send/text` | Body `{ number, text, replyid?, mentions? }`. `number` é o chatId canônico repassado sem transformação (campo polimórfico: dígitos sem `+` OU JID completo — já é o formato canônico do waconector). `replyid` recebe `SendTextInput.quotedId`. `mentions` é uma STRING (não array) com números separados por vírgula ou o valor especial `"all"`; `SendTextInput.mentions: string[]` é convertido: cada entrada `"all"` passa intacta, entradas JID têm o sufixo removido e ficam só dígitos, entradas já em dígitos passam direto. Campos opcionais não expostos por `SendTextInput` (`linkPreview`, `readchat`, `readmessages`, `delay`, `forward`, `async`, `track_source`, `track_id`) não são enviados — o adapter não usa `async:true` (ver quirks: uma resposta 200 com `async` só indica enfileiramento, não sucesso de entrega). |
| `messages.sendMedia` | `POST /send/media` | Body `{ number, type, file, text?, docName?, mimetype? }`. `type` é derivado de `MediaKind` (mapeamento 1:1: `image→image`, `video→video`, `audio→audio`, `document→document`, `sticker→sticker`; o provider também aceita `videoplay`, `myaudio`, `ptt`, `ptv` para variantes que `MediaKind` não distingue — não expostos por este adapter). `file` recebe `media.url` (preferencial) ou `media.base64` (o provider aceita ambos nesse mesmo campo). `docName` só é enviado quando `kind === 'document'` e `media.filename` está presente. `viewOnce` (recurso real da doc) não é exposto — `SendMediaInput` não tem esse campo. |

### Formato de resposta de envio (assunção)

A doc não mostra um exemplo JSON literal completo do corpo de resposta de `POST /send/text` /
`POST /send/media`. O adapter assume que a resposta é (ou contém, no nível raiz) um objeto com o
mesmo shape do schema `Message` documentado (`id`, `messageid`, `chatid`, `messageTimestamp`,
`status`, ...) — mapeado para `SentMessage` como: `id` de `messageid` (fallback `id`, fallback
`uazapi-<timestamp>`), `chatId` de `chatid` (fallback: o `number` enviado na requisição),
`timestamp` de `messageTimestamp` (já em epoch-ms, conforme os demais exemplos do dossiê). **A
confirmar contra uma instância real.**

### Mapeamento de status → `InstanceState`

| uazapi `status` | `InstanceState` |
| --- | --- |
| `disconnected` | `disconnected` |
| `connecting` (sem `qrcode` presente) | `connecting` |
| `connecting` (com `qrcode` presente e não-vazio) | `qr` |
| `connected` | `connected` |
| `hibernated` | `disconnected` (escolha do adapter — decisão explícita, não fallback: uma instância hibernada não tem sessão WhatsApp ativa, mas o dossiê não documenta um endpoint dedicado para causar/reverter esse estado nem se ele se comporta como uma desconexão comum; tratar diferente exigiria um estado dedicado que `InstanceState` não tem. **A confirmar contra uma instância real.**) |
| qualquer outro valor não reconhecido | `unknown` (fallback seguro, nunca lança) |

### Mapeamento de `chatId` canônico → uazapi

O conector já normaliza o `to` recebido do usuário (`normalizeChatId`) antes de chamar o adapter:
telefone vira só-dígitos (E.164 sem `+`), JIDs explícitos passam intactos. O campo `number` do
uazapi é documentado como polimórfico — aceita exatamente os mesmos dois formatos (dígitos
internacionais sem `+` para chat 1:1, OU um JID completo: grupo `@g.us`, usuário
`@s.whatsapp.net`/`@lid`, canal/newsletter `@newsletter`) — então o adapter repassa o chatId
canônico sem nenhuma transformação (função `toUazapiNumber`, identidade — existe só como ponto único
de mudança, mesmo padrão do adapter Evolution GO).

`mentions`, ao contrário de `number`, precisa ser uma string de dígitos separados por vírgula (não
aceita JID) — o adapter extrai os dígitos de qualquer entrada em formato JID antes de juntar.

## Webhooks

Dois níveis de configuração: por instância (`GET`/`POST /webhook`, header `token`) e global
(`GET`/`POST /globalwebhook`, header `admintoken` — fora do escopo desta fase). Body do `POST`:
`{ url, events: string[], excludeMessages?: string[], enabled?, addUrlEvents?, addUrlTypesMessages? }`.
A doc recomenda explicitamente sempre configurar `excludeMessages: ['wasSentByApi']` para evitar
loops de automação quando a própria integração envia mensagens pela API. **Nenhum header de
assinatura/HMAC é documentado** para verificar autenticidade do payload recebido — diferente do
WAHA, este adapter não implementa (nem pode implementar) verificação de assinatura de webhook.

### ⚠️ Payloads RECONSTRUÍDOS — não são exemplos literais da documentação

A documentação oficial não publica um exemplo JSON completo e literal do corpo `POST` entregue ao
webhook para nenhum dos três eventos abaixo. O que existe é: (a) o schema genérico `WebhookEvent`
(`{ event, instance, data }`, `additionalProperties: true`, com `event` documentado como enum
`['message', 'status', 'presence', 'group', 'connection']` — **note o singular**), e (b) os schemas
`Message`/`Instance` documentados separadamente. As três fixtures em `fixtures/` foram **montadas**
combinando esses dois pedaços — tratar como plausíveis, não como capturas reais, e **validar
empiricamente contra uma instância real antes de travar o parser em produção**.

Há também uma inconsistência real na própria especificação, não resolvida pela pesquisa: a lista de
`events` aceita na *configuração* do webhook usa nomes no plural/diferentes (`messages`,
`messages_update`, `newsletter_messages`, ...), enquanto o enum do envelope `WebhookEvent` usa
singular (`message`, `status`, ...). Não ficou claro se isso é um erro de documentação ou se o
envelope realmente entrega nomes diferentes dos configurados. **Decisão defensiva do adapter**:
`parseWebhook` reconhece **ambas** as grafias para cada categoria de evento:

### ⚠️ Risco alto, não apenas rodapé: o schema `WebhookEvent` não é referenciado por nenhum endpoint

O schema `WebhookEvent` (`{ event, instance, data }`) existe nos `components` do OpenAPI, mas
**nenhum endpoint documentado o referencia via `$ref`** — ou seja, não há exemplo confirmado do
payload realmente entregue ao webhook configurado pelo cliente. Uma pista adicional (não presente
em versões anteriores deste dossiê): o exemplo de resposta de `GET /webhook/errors` (log de
tentativas de entrega) mostra um payload de tentativa real com o shape
`{"EventType": "messages", "token": "instance-token"}` — nomes de campo diferentes (PascalCase
`EventType`, e um `token` no nível raiz) do envelope `{ event, instance, data }` que o parser
espera. Se a entrega real de fato usar `EventType` em vez de `event`, isso derrubaria o
reconhecimento de qualquer webhook até essa mudança. **Mitigação aplicada**: `parseWebhookUnsafe`
aceita `envelope.EventType` como sinônimo defensivo de `envelope.event` (mesma lógica case-tolerante
usada para as grafias plural/singular abaixo). Isso reduz o risco de silêncio total, mas **não
substitui validar ao menos um payload de webhook genuíno (instância de teste/trial) antes de
habilitar este adapter contra tráfego real**.

| Categoria canônica | Nomes de `event` aceitos (case-insensitive) |
| --- | --- |
| `message.received` / `message.sent` | `"message"` (enum do envelope) OU `"messages"` (nome de configuração) |
| `message.ack` | `"status"` (enum do envelope) OU `"messages_update"` (nome de configuração) OU `"message.ack"` |
| `connection.update` | `"connection"` (usado em ambos os enums) OU `"connection.update"` |

Qualquer outro valor de `event` (incluindo `presence`, `group`, `newsletter_messages`, `call`,
`contacts`, `chats`, `labels`, `blocks`, `sender`, etc. — todos fora do escopo desta fase) vira
evento canônico `unknown`, nunca lança.

- **`fixtures/webhook-message-received.json`** — RECONSTRUÍDO (ver aviso acima). `data.messageType`
  **não** tem nenhum exemplo literal confirmado no OpenAPI oficial para texto recebido via webhook
  (o schema `Message` documenta o campo como `type: string` livre, sem enum). `"conversation"` é
  uma suposição herdada de terminologia comum em outros providers baseados em Baileys — os únicos
  valores literais de `messageType` encontrados na especificação (respostas de
  `POST /message/react` e `POST /message/edit`) usam `"text"`. Por isso o adapter aceita **ambos**
  `"conversation"` e `"text"` como sinônimos de `MessageKind: 'text'`; qualquer outro valor
  (presumivelmente tipos de mídia, não enumerados pela doc) vira `MessageKind: 'unknown'` — `data.text`
  ainda é populado quando presente, independente do `kind` resultante. **Nenhum dos dois valores foi
  validado contra uma instância uazapi real** — tratar como suposição, não como fato confirmado, até
  essa validação empírica acontecer. `data` também não documenta um campo de mídia (URL/mimetype) —
  `WaMessage.media` fica sempre `undefined` nesta fase. `data.quoted` (ID da mensagem citada,
  documentado no schema `Message`) é mapeado para `WaMessage.quotedId`, alinhado com o padrão dos
  adapters WAHA/Evolution GO.
- **`fixtures/webhook-ack.json`** — RECONSTRUÍDO. Mapeamento de `data.status` → `MessageAck`:
  `Queued→pending`, `Sent→sent`, `Delivered→delivered`, `Read→read`, `Failed→error`,
  `Canceled→error`; qualquer valor não reconhecido cai em `sent` (fallback neutro — o evento em si
  já implica que a mensagem foi processada, mesmo padrão do adapter WAHA/Evolution GO).
- **`fixtures/webhook-connection-update.json`** — RECONSTRUÍDO, reaproveitando o exemplo real
  (literal) de `GET /instance/status` dentro do envelope `{event, instance, data}`. `data.instance`
  e `data.status` seguem exatamente os shapes documentados desses dois schemas.

## Limites e particularidades

- WhatsApp Business é recomendado explicitamente sobre conta pessoal; contas pessoais podem sofrer
  "inconsistências, desconexões, limitações e instabilidades" segundo a doc.
- Servidores gratuitos/demo têm TTL de instância: exemplo documentado de "automaticamente
  desconectada e deletada após 1 hora".
- Limite máximo de instâncias conectadas por servidor não tem valor numérico publicado; ao atingir
  o limite, criar/conectar responde `429`.
- Sem rate limit numérico publicado para envio de mensagens — só a resposta genérica `429 Rate
  limit exceeded` quando algum limite interno é atingido. `HttpClient` deste pacote não retenta
  automaticamente `POST`/`PUT`/`PATCH`/`DELETE` (ver ADR-0007) — inclui `sendText`/`sendMedia`.
- Timeout do fluxo de conexão: QR expira em 2 minutos, pairing code em 5 minutos.
- Rotação de `admintoken` (`POST /admin/token/rotate`) é limitada a 1x/24h.
- Proxy interno usa IPs brasileiros por padrão; proxy gerenciado regional só documenta suporte a
  `country=br` — fora do escopo desta fase (`instance.connect()` do adapter não expõe os campos de
  proxy do dossiê).
- Sem assinatura/HMAC documentada para webhooks — diferente do adapter WAHA, este adapter **não**
  verifica autenticidade de payload recebido (não há mecanismo do provider para isso).
- Campo `async: true` em `/send/text`/`/send/media` enfileira o envio sem bloquear a resposta HTTP
  — uma resposta `200` só indica enfileiramento, não sucesso de entrega (falhas exigem consultar
  `GET/POST /message/find?status=failed`, fora do escopo desta fase). O adapter nunca envia
  `async:true`.
- Suporta placeholders estilo Mustache (`{{name}}`, `{{wa_name}}`, `{{lead_*}}`) em texto/legenda —
  recurso de CRM embutido do provider, tratado como texto opaco por este adapter (nenhuma
  substituição client-side).
- Usa tanto JIDs tradicionais (`@s.whatsapp.net`) quanto o novo "LID" (Linked ID) de privacidade do
  WhatsApp (`@lid`) — o schema `Message` documentado expõe `sender_pn`/`sender_lid` separadamente,
  não capturado por este adapter nesta fase (`WaMessage.from` usa apenas `data.sender`).
- Não foi possível confirmar de forma independente (site institucional é uma SPA não renderizável
  via fetch simples) se existe alguma oferta de self-hosting/on-premise além do modelo SaaS por
  subdomínio — presume-se SaaS-only.
