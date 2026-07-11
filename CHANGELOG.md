# waconector

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
