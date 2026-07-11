# Dossiês de providers

Antes de implementar qualquer adapter, escreva o dossiê do provider aqui seguindo o template
abaixo. O dossiê é a fonte de verdade do adapter; os payloads capturados viram fixtures em
`src/adapters/<nome>/fixtures/`.

## Providers-alvo

| Provider | Docs | Hospedagem | Status |
| --- | --- | --- | --- |
| WAHA | <https://waha.devlike.pro/swagger/> | self-hosted (Docker) | F1 — feito, ver [waha.md](waha.md) |
| Evolution GO | <https://docs.evolutionfoundation.com.br/evolution-go> | self-hosted | F1 — feito, ver [evolution.md](evolution.md) |
| uazapi | <https://docs.uazapi.com/> | SaaS/self | F2 — feito, ver [uazapi.md](uazapi.md) |
| Z-API | <https://developer.z-api.io/api-reference/introduction> | SaaS | F2 — feito, ver [zapi.md](zapi.md) |
| Wuzapi | <https://github.com/asternic/wuzapi/blob/main/API.md> | self-hosted | F2 — feito, ver [wuzapi.md](wuzapi.md) |
| Whapi | <https://whapi.readme.io/> | SaaS | F3 — feito, ver [whapi.md](whapi.md) |
| Zapo | <https://zapo.to/en/introduction> | SaaS | F3 |
| QuePasa | <https://docs.quepasa.ai/reference> | self-hosted | F3 |

## Template do dossiê (`<nome>.md`)

```markdown
# Dossiê: <Provider>

- Docs oficiais: <url>
- Versão testada: <versão/data>
- Hospedagem: SaaS | self-hosted (imagem Docker: ...)

## Autenticação

Como o token é enviado (header? qual? na URL? bearer?). Existe token global vs por instância?

## Modelo de instância/sessão

Como criar, conectar (QR/pairing), consultar status e desconectar. Nome que o provider usa
("instance", "session", "channel").

## Operações core

| Operação canônica | Endpoint | Observações |
| --- | --- | --- |
| instance.connect | ... | |
| instance.status | ... | |
| instance.logout | ... | |
| messages.sendText | ... | formato do destinatário (E.164? JID?) |
| messages.sendMedia | ... | url? base64? multipart? |

## Webhooks

Como configurar. Nomes dos eventos. **Payloads reais capturados** (mensagem recebida, ack,
conexão) — colar aqui e salvar como fixtures.

## Limites e particularidades

Rate limits, formatos de telefone, peculiaridades de grupos/LID, capabilities não suportadas.
```
