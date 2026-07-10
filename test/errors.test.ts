import { describe, expect, it } from 'vitest';
import {
  isWaConnectorError,
  redactSecrets,
  statusToErrorCode,
  UnsupportedCapabilityError,
  WaConnectorError,
} from '../src';

describe('statusToErrorCode', () => {
  it('mapeia status HTTP para códigos tipados', () => {
    expect(statusToErrorCode(401)).toBe('AUTH_FAILED');
    expect(statusToErrorCode(403)).toBe('AUTH_FAILED');
    expect(statusToErrorCode(429)).toBe('RATE_LIMITED');
    expect(statusToErrorCode(500)).toBe('PROVIDER_ERROR');
    expect(statusToErrorCode(400)).toBe('PROVIDER_ERROR');
  });
});

describe('redactSecrets', () => {
  it('substitui todas as ocorrências de cada segredo', () => {
    const text = 'token=abc123 e de novo abc123, além de xyz';
    expect(redactSecrets(text, ['abc123', 'xyz'])).toBe('token=*** e de novo ***, além de ***');
  });

  it('ignora segredos vazios', () => {
    expect(redactSecrets('nada muda', [''])).toBe('nada muda');
  });
});

describe('isWaConnectorError', () => {
  it('reconhece instâncias reais', () => {
    const error = new WaConnectorError('PROVIDER_ERROR', 'x');
    expect(isWaConnectorError(error)).toBe(true);
  });

  it('reconhece cópias duck-typed (bundles distintos)', () => {
    const foreign = { isWaConnectorError: true, code: 'TIMEOUT', message: 'x' };
    expect(isWaConnectorError(foreign)).toBe(true);
  });

  it('rejeita erros comuns e valores arbitrários', () => {
    expect(isWaConnectorError(new Error('x'))).toBe(false);
    expect(isWaConnectorError(null)).toBe(false);
    expect(isWaConnectorError('erro')).toBe(false);
  });
});

describe('UnsupportedCapabilityError', () => {
  it('carrega código, capability e provider', () => {
    const error = new UnsupportedCapabilityError('messages.sendMedia', 'mock');
    expect(error.code).toBe('UNSUPPORTED_CAPABILITY');
    expect(error.capability).toBe('messages.sendMedia');
    expect(error.provider).toBe('mock');
    expect(error.message).toContain('mock');
    expect(error.message).toContain('messages.sendMedia');
  });
});
