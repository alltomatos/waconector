import type { Capability } from './capabilities';

export type WaErrorCode =
  | 'AUTH_FAILED'
  | 'INSTANCE_DISCONNECTED'
  | 'RATE_LIMITED'
  | 'INVALID_RECIPIENT'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_CAPABILITY'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'WEBHOOK_PARSE_ERROR'
  | 'PROVIDER_ERROR';

export interface WaConnectorErrorOptions {
  provider?: string;
  status?: number;
  cause?: unknown;
}

export class WaConnectorError extends Error {
  /** Marcador estável para `isWaConnectorError` (sobrevive a cópias do módulo em bundles distintos). */
  readonly isWaConnectorError = true as const;
  readonly code: WaErrorCode;
  readonly provider?: string;
  readonly status?: number;

  constructor(code: WaErrorCode, message: string, options: WaConnectorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WaConnectorError';
    this.code = code;
    this.provider = options.provider;
    this.status = options.status;
  }
}

export class UnsupportedCapabilityError extends WaConnectorError {
  readonly capability: Capability;

  constructor(capability: Capability, provider?: string) {
    const message = provider
      ? `O provider "${provider}" não suporta a capability "${capability}".`
      : `Capability não suportada: "${capability}".`;
    super('UNSUPPORTED_CAPABILITY', message, { provider });
    this.name = 'UnsupportedCapabilityError';
    this.capability = capability;
  }
}

/**
 * Type guard por duck-typing (mesma estratégia do `axios.isAxiosError`):
 * `instanceof` falharia entre cópias do módulo em bundles ESM/CJS distintos.
 */
export function isWaConnectorError(value: unknown): value is WaConnectorError {
  if (value instanceof WaConnectorError) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isWaConnectorError?: unknown }).isWaConnectorError === true
  );
}

export function statusToErrorCode(status: number): WaErrorCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  return 'PROVIDER_ERROR';
}

/** Substitui valores sensíveis (tokens, apikeys) por `***` em textos de erro/log. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join('***');
    }
  }
  return result;
}
