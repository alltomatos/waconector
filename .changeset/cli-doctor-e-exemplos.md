---
"waconector": minor
---

Novo comando `npx waconector doctor --provider <nome>`: diagnóstico de conectividade/auth contra
um provider real, configurado via variáveis `WACONECTOR_*` específicas de cada adapter. Só chama
`instance.status()` (checagem de leitura) — nunca `connect()`, então é seguro rodar repetidamente
sem alterar o estado da instância no provider. Sai com código `0` em sucesso, `1` em qualquer
falha (provider desconhecido, variável obrigatória ausente, ou erro na chamada).

Implementado como um novo entry point ESM-only em `src/cli/` (bundle separado via `tsup`, com
shebang), usando `node:util.parseArgs` — nenhuma dependência de runtime nova (ADR-0004).

Também adicionados dois exemplos executáveis em `examples/` (Express e Next.js/App Router),
usando `MockAdapter` por padrão — `npm install && npm start`/`npm run dev` funciona sem nenhuma
credencial real. Cada exemplo documenta como trocar para um provider real usando as mesmas
variáveis `WACONECTOR_*` do `doctor`.

Fecha o último item pendente do roadmap da F3.
