import { WaConnectorError } from './errors';

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/** Identificador já no formato JID do WhatsApp (`...@s.whatsapp.net`, `...@c.us`, `...@g.us`). */
export function isJid(value: string): boolean {
  return value.includes('@');
}

export function isGroupChatId(value: string): boolean {
  return value.endsWith('@g.us');
}

/**
 * Prefixo do link de convite de grupo — constante do PRÓPRIO protocolo WhatsApp (gerado pelos
 * servidores do WhatsApp, não pelo provider), portanto universal entre os 5 adapters. Diferente do
 * `groupId` (opaco por provider, ver ADR-0009), o link/código de convite tem o mesmo formato em
 * qualquer provider — por isso normalizado aqui no core, não deixado a cargo de cada adapter.
 */
const WHATSAPP_INVITE_PREFIX = 'https://chat.whatsapp.com/';

/** Garante o link completo (`https://chat.whatsapp.com/<código>`) a partir de um código bare ou já-link. */
export function normalizeInviteLink(value: string): string {
  return value.startsWith(WHATSAPP_INVITE_PREFIX) ? value : `${WHATSAPP_INVITE_PREFIX}${value}`;
}

/** Extrai só o código do convite a partir de um link completo (ou repassa se já for só o código). */
export function extractInviteCode(value: string): string {
  return value.startsWith(WHATSAPP_INVITE_PREFIX)
    ? value.slice(WHATSAPP_INVITE_PREFIX.length)
    : value;
}

/**
 * Normaliza o identificador de chat para o formato canônico do waconector:
 * - JIDs explícitos passam intactos (grupos, broadcast, LID);
 * - telefones viram apenas dígitos (E.164 sem `+` nem pontuação).
 *
 * Cada adapter converte deste formato canônico para o que o provider espera.
 */
export function normalizeChatId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new WaConnectorError('INVALID_RECIPIENT', 'Identificador de chat vazio.');
  }
  if (isJid(trimmed)) {
    return trimmed;
  }
  const digits = digitsOnly(trimmed);
  if (digits.length < 7 || digits.length > 15) {
    throw new WaConnectorError(
      'INVALID_RECIPIENT',
      `Número de telefone inválido: "${trimmed}" (esperado E.164 com 7 a 15 dígitos).`,
    );
  }
  return digits;
}
