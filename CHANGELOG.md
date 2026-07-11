# waconector

## 0.2.0

### Minor Changes

- 3b82fa6: Adapter **uazapi** (`waconector/uazapi`) — primeiro provider da fase F2, SaaS multi-tenant
  (auth via header `token` de instância). Implementa `instance.connect/status/logout`,
  `messages.sendText/sendMedia` e `webhooks.parse`, com dossiê próprio em `docs/providers/uazapi.md`
  e testes de contrato. Ver o dossiê para suposições não validadas contra uma instância real
  (formato exato do envelope de webhook e do campo `messageType`).
- 672e035: Adapter **Wuzapi** (`waconector/wuzapi`) — terceiro e último provider planejado da fase F2,
  self-hosted (construído sobre `tulir/whatsmeow`, mesma lib do Evolution GO). Implementa
  `instance.connect/status/logout`, `messages.sendText/sendMedia` e `webhooks.parse`, com dossiê
  próprio em `docs/providers/wuzapi.md` (pesquisado direto no código-fonte Go, com várias
  divergências doc-vs-código documentadas) e testes de contrato.
- 8d93b82: Adapter **Z-API** (`waconector/zapi`) — segundo provider da fase F2, SaaS brasileiro (auth via
  `instanceId`+`token` embutidos na URL, sem `Authorization: Bearer`). Implementa
  `instance.connect/status/logout`, `messages.sendText/sendMedia` (incluindo `sticker`) e
  `webhooks.parse`, com dossiê próprio em `docs/providers/zapi.md` e testes de contrato. Sem
  endpoint de criação de instância documentado (provisionamento é só via painel).

## 0.1.0

### Minor Changes

- Primeiro release com adapters de provider reais: **WAHA** (`waconector/waha`) e **Evolution GO**
  (`waconector/evolution`), implementados a partir de dossiês próprios em `docs/providers/` e
  auditados adversarialmente contra a documentação/código-fonte oficial de cada provider.

  Também incluído neste release:

  - Verificação HMAC opt-in de webhooks WAHA (`WahaOptions.webhookHmacKey` + `WebhookInput.rawBody`).
  - `HttpClient`: retry só para operações idempotentes por padrão (evita duplicar mensagens em
    retry) e suporte ao header `Retry-After`.
  - `ConnectResult.raw`/`InstanceStatus.raw` agora obrigatórios (alinhado ao ADR-0002) — breaking
    change de tipo, mas nenhum adapter existente precisou de correção.
  - Cobertura de testes com thresholds, templates de issue/PR, `CONTRIBUTING.md`, Dependabot.
  - Modelo de branches (`main` protegido, `develop` de integração) e automações de CI (revisão de
    código automática, sincronização de docs/wiki pós-merge).
