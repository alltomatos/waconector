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
