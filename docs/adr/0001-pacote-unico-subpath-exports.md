# ADR-0001: Pacote único com subpath exports (não monorepo)

- Status: aceito
- Data: 2026-07-10

## Contexto

O waconector terá um core de contratos e ~8 adapters de providers. As opções eram monorepo com um
pacote npm por adapter (`@waconector/waha`, ...) ou um único pacote com subpath exports
(`waconector/waha`, ...).

## Decisão

Pacote único `waconector` com subpath exports por adapter.

## Justificativa

- Os adapters são REST puro sobre `fetch` nativo — nenhum tem dependências próprias, então N
  pacotes seriam apenas overhead de versionamento e publicação.
- Subpath exports + `sideEffects: false` mantêm tree-shaking: quem importa `waconector/waha` não
  carrega os outros adapters.
- Instalação única e versão única simplificam a vida do consumidor.

## Consequências

- Se um adapter futuro precisar de dependência pesada, migramos para monorepo mantendo o pacote
  `waconector` como meta-pacote que reexporta — sem quebrar consumidores.
- Bundles ESM/CJS distintos podem duplicar classes; por isso a checagem de erros usa duck-typing
  (`isWaConnectorError`), mesma estratégia do `axios.isAxiosError`.
