# Fixtures — izapia

Todos os payloads abaixo são **reconstruídos com alta confiança**: os nomes de campo vêm
diretamente do código-fonte do provider (`github.com/alltomatos/izapia`, repo privado, branch
`main`, lido em 2026-07-16 — ver `docs/providers/izapia.md`), não de tráfego real capturado contra
uma instância viva. Cada arquivo cita a função Go de onde o shape foi confirmado.

- `session-create-response.json` — `POST /api/v1/sessions/` (`internal/session/repo.go`, `Create`).
- `session-pair-qr-response.json` — `POST /api/v1/sessions/{sid}/pair` (OpenAPI: `data: {code,
  qr_png_base64}`).
- `session-status-connected.json` — `GET /api/v1/sessions/{sid}` (`internal/session/repo.go`,
  `Session` struct).
- `webhook-session-connected.json` — evento `session.connected` (`internal/session/manager.go`,
  `register`'s `case *waEvents.Connected`).
- `webhook-message-received.json` — evento `message.received` (`internal/session/message.go`,
  `receivedEvent`).
- `webhook-message-ack.json` — evento `message.ack` (`internal/session/message.go`, `ackEvent`).
- `webhook-group-update.json` — evento `group.update` (`internal/session/groupevents.go`,
  `groupUpdateEvent`).

Todo webhook usa o envelope canônico de evento (`internal/events/events.go`) como corpo bruto da
entrega HTTP — sem wrapper adicional. A assinatura (`X-izapia-Signature: sha256=<hmac hex>`) não
está representada aqui (é um header, não o corpo).
