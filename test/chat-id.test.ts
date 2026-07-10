import { describe, expect, it } from 'vitest';
import { digitsOnly, isGroupChatId, isJid, isWaConnectorError, normalizeChatId } from '../src';

describe('normalizeChatId', () => {
  it('remove pontuação e prefixo + de telefones', () => {
    expect(normalizeChatId('+55 (85) 99999-9999')).toBe('5585999999999');
    expect(normalizeChatId('5585999999999')).toBe('5585999999999');
  });

  it('preserva JIDs explícitos intactos', () => {
    expect(normalizeChatId('5585999999999@s.whatsapp.net')).toBe('5585999999999@s.whatsapp.net');
    expect(normalizeChatId('123456789-987654@g.us')).toBe('123456789-987654@g.us');
    expect(normalizeChatId('status@broadcast')).toBe('status@broadcast');
  });

  it('rejeita identificador vazio com INVALID_RECIPIENT', () => {
    const failure = capture(() => normalizeChatId('   '));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_RECIPIENT').toBe(true);
  });

  it('rejeita telefone sem dígitos suficientes', () => {
    const failure = capture(() => normalizeChatId('abc'));
    expect(isWaConnectorError(failure) && failure.code === 'INVALID_RECIPIENT').toBe(true);
    const tooLong = capture(() => normalizeChatId('1234567890123456'));
    expect(isWaConnectorError(tooLong) && tooLong.code === 'INVALID_RECIPIENT').toBe(true);
  });
});

describe('helpers de chat-id', () => {
  it('digitsOnly extrai apenas dígitos', () => {
    expect(digitsOnly('+55 (85) 9.9999-9999')).toBe('5585999999999');
  });

  it('isJid e isGroupChatId classificam identificadores', () => {
    expect(isJid('x@s.whatsapp.net')).toBe(true);
    expect(isJid('5585999999999')).toBe(false);
    expect(isGroupChatId('123@g.us')).toBe(true);
    expect(isGroupChatId('123@s.whatsapp.net')).toBe(false);
  });
});

function capture(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}
