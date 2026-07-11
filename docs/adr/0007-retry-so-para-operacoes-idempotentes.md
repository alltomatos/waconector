# ADR-0007: Retry só para operações idempotentes; `Retry-After` tem precedência sobre o backoff

- Status: aceito
- Data: 2026-07-10

## Contexto

`HttpClient.request()` retentava QUALQUER método (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) em
`NETWORK_ERROR`/`429`/`502`/`503`/`504`, com backoff exponencial fixo. Isso é seguro para leituras
(`instance.status`, `GET /instance/qr`), mas perigoso para escritas não idempotentes: se a conexão
cair (`NETWORK_ERROR`) ou o provider responder `503` **depois** de já ter processado o `POST`
original (ex.: `messages.sendText`, `messages.sendMedia`), o client não tem como saber se o efeito
colateral já aconteceu — reenviar duplica a mensagem de WhatsApp de verdade, entregue ao
destinatário duas vezes. Não existe um jeito genérico de detectar isso no client HTTP: o adapter é
"burro" (`docs/CONTEXT.md`) e não pode inspecionar o provider para confirmar se o envio anterior
teve efeito.

Separadamente, alguns providers já respondem `429`/`503` com o header `Retry-After` (em segundos),
uma instrução explícita de quanto esperar — ignorá-lo e usar sempre o backoff calculado
(300ms–4s + jitter) tanto pode esperar tempo de menos (martelando um provider que pediu mais tempo)
quanto tempo de mais (segurando uma retentativa que o provider já liberaria antes).

## Decisão

1. `HttpRequestOptions` ganha um campo opcional `idempotent?: boolean` (mudança aditiva).
2. Regra de elegibilidade para o laço de retry em `HttpClient.request()`: só entra se o método for
   `GET`/`HEAD` **ou** `idempotent === true` explicitamente. Para `POST`/`PUT`/`PATCH`/`DELETE` sem
   essa flag, qualquer erro (`NETWORK_ERROR`, `429`, `502`, `503`, `504`) propaga na primeira
   tentativa — nenhum call site de adapter precisou mudar; o comportamento deles simplesmente passa
   a ser "sem retry automático em escritas", que é o correto por padrão.
3. Quando a resposta é `429` ou `503` e traz o header `retry-after` no formato numérico (segundos),
   esse valor (convertido para ms, com teto de segurança de 30_000ms) é usado como delay antes da
   próxima tentativa, no lugar do backoff calculado. O formato de data HTTP do `Retry-After`
   (`Wed, 21 Oct 2026 07:28:00 GMT`) não é suportado — nenhum dos providers-alvo o usa na prática;
   header ausente ou não numérico cai para o backoff atual, sem mudança de comportamento.
4. O valor parseado do `Retry-After` viaja da resposta HTTP até o laço de retry via um novo campo
   `retryAfterMs?: number` em `WaConnectorErrorOptions`/`WaConnectorError` — preenchido só por
   `HttpClient` em respostas 429/503 com header numérico válido; `undefined` em todo o resto
   (mudança aditiva, não observável por quem já lê `WaConnectorError`).

## Justificativa

- **Por que opt-in (`idempotent`) e não uma lista fixa de operações idempotentes no core**: o core
  (`src/core/http.ts`) não conhece a semântica de cada endpoint de cada provider — só o adapter
  sabe se um `POST` específico é seguro para reenviar (ex.: um futuro `PUT
  /instance/{id}/settings` idempotente por natureza). Expor a flag na chamada, sem exigi-la, mantém
  o client genérico e a decisão no lugar certo, sem quebrar nenhum adapter existente.
- **Por que o padrão é "não retenta" e não "retenta com aviso"**: duplicar uma mensagem de
  WhatsApp é um efeito colateral real e visível para o usuário final do bot — o custo de uma falha
  visível (exceção propagada) é muito menor que o custo de uma duplicata silenciosa. Falha
  segura por padrão, opt-in explícito para relaxar.
- **Por que `Retry-After` tem precedência e não é só um teto/piso do backoff**: o provider que
  envia esse header está dizendo exatamente quanto tempo esperar (normalmente porque sabe sua
  própria janela de rate limit); ignorá-lo é pior nos dois sentidos (espera de menos ou de mais).
  Precedência total, não uma combinação com o backoff calculado, mantém a regra simples e
  previsível.
- **Por que só o formato numérico**: nenhum provider-alvo (WAHA, Evolution GO, uazapi, Z-API,
  Wuzapi, Whapi, Zapo, QuePasa) documenta o formato de data HTTP para esse header; suportar só
  segundos evita complexidade (parsing de datas, fuso horário) sem perda prática.
- **Por que o valor viaja via `WaConnectorError` e não por um campo separado no retorno de
  `attempt()`**: o laço de retry em `request()` já captura o erro lançado por `attempt()` para
  decidir se retenta; reaproveitar esse mesmo objeto evita uma segunda via de comunicação
  (ex.: uma tupla `[error, retryAfterMs]`) só para esse caso.

## Consequências

- Adapters que fazem `POST`/`PUT`/`PATCH`/`DELETE` sem passar `idempotent: true` (todos os
  existentes: `instance.connect`, `messages.sendText`, `messages.sendMedia`, `instance.logout`)
  perdem o retry automático que tinham antes em `NETWORK_ERROR`/`429`/`5xx` — comportamento
  pretendido; quem consome o pacote precisa tratar essas exceções e decidir se reenvia (idealmente
  com alguma forma de idempotência própria, ex.: ID de mensagem gerado pelo chamador, quando o
  provider suportar).
- Endpoints genuinamente idempotentes (ex.: um futuro endpoint de atualização de configuração via
  `PUT`) podem optar por retry passando `idempotent: true` explicitamente na chamada.
- `WaConnectorError` ganha um campo a mais (`retryAfterMs`); consumidores que fazem
  desestruturação estrita de todos os campos (incomum) precisam estar cientes, mas nada quebra por
  padrão.
- Se um provider futuro exigir o formato de data HTTP do `Retry-After`, revisitar `parseRetryAfterMs`
  em `src/core/http.ts` (novo ADR se a mudança for não trivial).
