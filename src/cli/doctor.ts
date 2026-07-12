import { type EvolutionOptions, evolution } from '../adapters/evolution';
import { type QuepasaOptions, quepasa } from '../adapters/quepasa';
import { type UazapiOptions, uazapi } from '../adapters/uazapi';
import { type WahaOptions, waha } from '../adapters/waha';
import { type WhapiOptions, whapi } from '../adapters/whapi';
import { type WppconnectOptions, wppconnect } from '../adapters/wppconnect';
import { type WuzapiOptions, wuzapi } from '../adapters/wuzapi';
import { type ZapiOptions, zapi } from '../adapters/zapi';
import type { WaAdapter } from '../core/adapter';
import type { CapabilitySet } from '../core/capabilities';
import type { WaErrorCode } from '../core/errors';
import { isWaConnectorError } from '../core/errors';
import type { InstanceState } from '../core/types';

export const PROVIDER_NAMES = [
  'waha',
  'evolution',
  'uazapi',
  'zapi',
  'wuzapi',
  'whapi',
  'quepasa',
  'wppconnect',
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

interface FieldSpec {
  /** Nome do campo na interface Options do adapter. */
  field: string;
  /**
   * Env var correspondente — esquema GENÉRICO (WACONECTOR_*), não prefixado por provider: cada
   * invocação do doctor mira exatamente 1 provider via --provider, então não há ambiguidade em
   * reusar o mesmo nome (ex.: WACONECTOR_TOKEN) entre providers diferentes.
   */
  envVar: string;
  required: boolean;
}

/**
 * Tabela mantida à mão (mesmo espírito de scripts/adapter-subpaths.mjs — uma fonte única, nunca
 * duplicada em outro lugar). Cobre só os campos STRING de cada interface Options — campos
 * array/boolean/number (subscribe, immediate, timeoutMs, retries, waitQrCode) ficam fora do v1;
 * os defaults internos dos adapters se aplicam. `fetch` nunca aparece aqui: é só injeção de teste.
 * Ao adicionar/alterar um adapter, atualize esta tabela também.
 */
const PROVIDER_FIELDS: Record<ProviderName, readonly FieldSpec[]> = {
  waha: [
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: true },
    { field: 'apiKey', envVar: 'WACONECTOR_API_KEY', required: true },
    { field: 'session', envVar: 'WACONECTOR_SESSION', required: false },
    { field: 'webhookHmacKey', envVar: 'WACONECTOR_WEBHOOK_HMAC_KEY', required: false },
  ],
  evolution: [
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: true },
    { field: 'apiKey', envVar: 'WACONECTOR_API_KEY', required: true },
    { field: 'instance', envVar: 'WACONECTOR_INSTANCE', required: false },
    { field: 'webhookUrl', envVar: 'WACONECTOR_WEBHOOK_URL', required: false },
  ],
  uazapi: [
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: true },
    { field: 'token', envVar: 'WACONECTOR_TOKEN', required: true },
    { field: 'adminToken', envVar: 'WACONECTOR_ADMIN_TOKEN', required: false },
    { field: 'instance', envVar: 'WACONECTOR_INSTANCE', required: false },
  ],
  zapi: [
    { field: 'instanceId', envVar: 'WACONECTOR_INSTANCE_ID', required: true },
    { field: 'token', envVar: 'WACONECTOR_TOKEN', required: true },
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: false },
    { field: 'clientToken', envVar: 'WACONECTOR_CLIENT_TOKEN', required: false },
  ],
  wuzapi: [
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: true },
    { field: 'token', envVar: 'WACONECTOR_TOKEN', required: true },
    { field: 'adminToken', envVar: 'WACONECTOR_ADMIN_TOKEN', required: false },
    { field: 'instance', envVar: 'WACONECTOR_INSTANCE', required: false },
  ],
  whapi: [
    { field: 'token', envVar: 'WACONECTOR_TOKEN', required: true },
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: false },
  ],
  quepasa: [
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: true },
    { field: 'token', envVar: 'WACONECTOR_TOKEN', required: true },
  ],
  wppconnect: [
    { field: 'baseUrl', envVar: 'WACONECTOR_BASE_URL', required: true },
    { field: 'session', envVar: 'WACONECTOR_SESSION', required: true },
    { field: 'token', envVar: 'WACONECTOR_TOKEN', required: true },
    { field: 'webhook', envVar: 'WACONECTOR_WEBHOOK', required: false },
  ],
};

export type ResolveOptionsResult =
  | { ok: true; options: Record<string, string> }
  | { ok: false; error: string };

/** Lê as env vars WACONECTOR_* relevantes para `provider` e valida as obrigatórias. Pura, sem I/O. */
export function resolveProviderOptions(
  provider: string,
  env: NodeJS.ProcessEnv,
): ResolveOptionsResult {
  if (!isProviderName(provider)) {
    return {
      ok: false,
      error: `Provider desconhecido: "${provider}". Providers válidos: ${PROVIDER_NAMES.join(', ')}.`,
    };
  }
  const options: Record<string, string> = {};
  const missing: string[] = [];
  for (const spec of PROVIDER_FIELDS[provider]) {
    const value = env[spec.envVar];
    if (value) {
      options[spec.field] = value;
    } else if (spec.required) {
      missing.push(spec.envVar);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Variáveis de ambiente obrigatórias ausentes para "${provider}": ${missing.join(', ')}.`,
    };
  }
  return { ok: true, options };
}

/**
 * Instancia o adapter do provider a partir das opções já resolvidas. `fetchOverride` existe só
 * para teste (mesmo padrão do `fetch?` de cada Options de adapter) — nunca é uma flag real da CLI.
 */
export function buildAdapterForDoctor(
  provider: ProviderName,
  options: Record<string, string>,
  fetchOverride?: typeof globalThis.fetch,
): WaAdapter {
  const withFetch = fetchOverride ? { ...options, fetch: fetchOverride } : options;
  switch (provider) {
    case 'waha':
      return waha(withFetch as unknown as WahaOptions);
    case 'evolution':
      return evolution(withFetch as unknown as EvolutionOptions);
    case 'uazapi':
      return uazapi(withFetch as unknown as UazapiOptions);
    case 'zapi':
      return zapi(withFetch as unknown as ZapiOptions);
    case 'wuzapi':
      return wuzapi(withFetch as unknown as WuzapiOptions);
    case 'whapi':
      return whapi(withFetch as unknown as WhapiOptions);
    case 'quepasa':
      return quepasa(withFetch as unknown as QuepasaOptions);
    case 'wppconnect':
      return wppconnect(withFetch as unknown as WppconnectOptions);
  }
}

export type DoctorReport =
  | { ok: true; provider: ProviderName; state: InstanceState; capabilities: CapabilitySet }
  | { ok: false; reason: 'config'; provider: string; message: string }
  | {
      ok: false;
      reason: 'runtime';
      provider: ProviderName;
      code: WaErrorCode | 'UNKNOWN';
      message: string;
    };

/**
 * Checagem read-only: resolve opções, instancia o adapter e chama SÓ `instance.status()`.
 * Deliberadamente NUNCA chama `instance.connect()`: connect() é side-effecting em alguns
 * providers (ex.: WPPConnect pode disparar `waitQrCode`; QuePasa expõe o QR como PNG binário cru,
 * incompatível com o `HttpClient` atual) — "doctor" precisa ser seguro de rodar repetidamente, a
 * qualquer momento, sem alterar o estado da instância no provider.
 */
export async function runDoctor(
  provider: string,
  env: NodeJS.ProcessEnv,
  fetchOverride?: typeof globalThis.fetch,
): Promise<DoctorReport> {
  const resolved = resolveProviderOptions(provider, env);
  if (!resolved.ok) {
    return { ok: false, reason: 'config', provider, message: resolved.error };
  }
  const providerName = provider as ProviderName;
  const adapter = buildAdapterForDoctor(providerName, resolved.options, fetchOverride);
  try {
    const status = await adapter.instance.status();
    return {
      ok: true,
      provider: providerName,
      state: status.state,
      capabilities: adapter.capabilities,
    };
  } catch (error) {
    if (isWaConnectorError(error)) {
      return {
        ok: false,
        reason: 'runtime',
        provider: providerName,
        code: error.code,
        message: error.message,
      };
    }
    return {
      ok: false,
      reason: 'runtime',
      provider: providerName,
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const ANSI = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' } as const;

function paint(text: string, color: 'red' | 'green', enabled: boolean): string {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

export interface FormatOptions {
  color: boolean;
}

/** Formata um `DoctorReport` como texto legível de console. Pura, sem I/O. */
export function formatDoctorReport(
  report: DoctorReport,
  format: FormatOptions = { color: false },
): string {
  if (report.ok) {
    return [
      `${paint('OK', 'green', format.color)} provider "${report.provider}" — estado: ${report.state}`,
      `Capabilities declaradas (${report.capabilities.length}): ${report.capabilities.join(', ')}`,
    ].join('\n');
  }
  if (report.reason === 'config') {
    return `${paint('ERRO', 'red', format.color)} configuração inválida: ${report.message}`;
  }
  return [
    `${paint('ERRO', 'red', format.color)} provider "${report.provider}" — falha ao consultar status`,
    `Código: ${report.code}`,
    `Mensagem: ${report.message}`,
  ].join('\n');
}
