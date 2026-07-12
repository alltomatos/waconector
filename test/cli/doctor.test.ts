import { describe, expect, it } from 'vitest';
import { formatDoctorReport, resolveProviderOptions, runDoctor } from '../../src/cli/doctor';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveProviderOptions', () => {
  it('reporta env vars obrigatórias ausentes', () => {
    const result = resolveProviderOptions('waha', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('WACONECTOR_BASE_URL');
      expect(result.error).toContain('WACONECTOR_API_KEY');
    }
  });

  it('rejeita provider desconhecido', () => {
    const result = resolveProviderOptions('bogus', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('bogus');
    }
  });

  it('resolve as opções obrigatórias e opcionais quando presentes', () => {
    const result = resolveProviderOptions('wppconnect', {
      WACONECTOR_BASE_URL: 'https://wpp.example.com',
      WACONECTOR_SESSION: 'minha-sessao',
      WACONECTOR_TOKEN: 'segredo',
    });
    expect(result).toEqual({
      ok: true,
      options: {
        baseUrl: 'https://wpp.example.com',
        session: 'minha-sessao',
        token: 'segredo',
      },
    });
  });

  it('não exige campos opcionais (ex.: token/baseUrl da Whapi)', () => {
    const result = resolveProviderOptions('whapi', { WACONECTOR_TOKEN: 'segredo' });
    expect(result).toEqual({ ok: true, options: { token: 'segredo' } });
  });
});

describe('runDoctor', () => {
  const wahaEnv = { WACONECTOR_BASE_URL: 'https://waha.example.com', WACONECTOR_API_KEY: 'secret' };

  it('reporta sucesso quando o status responde 200', async () => {
    const fetchStub: typeof fetch = async () =>
      jsonResponse(200, { name: 'default', status: 'WORKING' });
    const report = await runDoctor('waha', wahaEnv, fetchStub);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.provider).toBe('waha');
      expect(Array.isArray(report.capabilities)).toBe(true);
    }
  });

  it('reporta AUTH_FAILED quando o status responde 401', async () => {
    const fetchStub: typeof fetch = async () => jsonResponse(401, { message: 'unauthorized' });
    const report = await runDoctor('waha', wahaEnv, fetchStub);
    expect(report).toMatchObject({ ok: false, reason: 'runtime', code: 'AUTH_FAILED' });
  });

  it('não bate rede quando falta env var obrigatória (erro de config)', async () => {
    const report = await runDoctor('waha', {});
    expect(report).toMatchObject({ ok: false, reason: 'config' });
  });

  it('reporta erro de config para provider desconhecido', async () => {
    const report = await runDoctor('bogus', {});
    expect(report).toMatchObject({ ok: false, reason: 'config' });
  });
});

describe('formatDoctorReport', () => {
  it('formata sucesso sem cor por padrão', () => {
    const text = formatDoctorReport({
      ok: true,
      provider: 'waha',
      state: 'connected',
      capabilities: ['instance.status'],
    });
    expect(text).toContain('OK');
    expect(text).toContain('waha');
    expect(text).toContain('connected');
    expect(text).not.toContain('\x1b[');
  });

  it('formata erro de config', () => {
    const text = formatDoctorReport({
      ok: false,
      reason: 'config',
      provider: 'x',
      message: 'falhou',
    });
    expect(text).toContain('ERRO');
    expect(text).toContain('falhou');
  });

  it('formata erro de runtime com código e mensagem', () => {
    const text = formatDoctorReport({
      ok: false,
      reason: 'runtime',
      provider: 'waha',
      code: 'AUTH_FAILED',
      message: 'token inválido',
    });
    expect(text).toContain('AUTH_FAILED');
    expect(text).toContain('token inválido');
  });

  it('aplica cor ANSI quando format.color é true', () => {
    const text = formatDoctorReport(
      { ok: true, provider: 'waha', state: 'connected', capabilities: [] },
      { color: true },
    );
    expect(text).toContain('\x1b[32m');
  });
});
