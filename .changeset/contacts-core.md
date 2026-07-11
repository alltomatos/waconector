---
"waconector": minor
---

Nova capability `contacts.*` (ADR-0010) — descoberta + perfil: `wa.contacts.list`,
`wa.contacts.get`, `wa.contacts.checkExists`, `wa.contacts.getProfilePicture`,
`wa.contacts.getAbout`. Implementado em 4 dos 5 adapters existentes (WAHA, Evolution GO, Z-API,
Wuzapi) — **uazapi não declara `contacts.getAbout`**, por não expor nenhum endpoint/campo para o
recado pessoal de um contato em toda a sua documentação oficial (confirmado por busca exaustiva).

Diferente de `groupId`, o identificador de contato (`chatId`) não é opaco — é o mesmo chatId
canônico já usado por `messages.*`, normalizado da mesma forma. Nenhum adapter compõe múltiplas
chamadas HTTP atrás de uma única operação canônica: campos que o provider não devolve numa única
chamada (ex.: nome de exibição no Evolution GO/Wuzapi) ficam `undefined`, documentados no dossiê de
cada provider — nunca inventados nem obtidos via chamada adicional.

Moderação (`block`/`unblock`/`listBlocked`) fica para um PR seguinte; `getPresence` fica fora do
escopo por ser majoritariamente assíncrono/webhook (ver ADR-0010).
