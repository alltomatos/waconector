import { redactSecrets, statusToErrorCode, WaConnectorError } from './errors';

export interface HttpClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  /** Timeout por tentativa, em ms (padrão: 30_000). */
  timeoutMs?: number;
  /** Retentativas para 429/5xx/erros de rede, com backoff exponencial (padrão: 2). */
  retries?: number;
  /** Valores sensíveis (tokens) redigidos em toda mensagem de erro. */
  secrets?: readonly string[];
  provider?: string;
  /** Injetável para testes. */
  fetch?: typeof globalThis.fetch;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Serializado como JSON quando presente. */
  body?: unknown;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Client HTTP mínimo sobre `fetch` nativo, compartilhado pelos adapters:
 * timeout, retry com backoff, mapeamento de status para erros tipados e
 * redação de segredos. Zero dependências de runtime.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly secrets: readonly string[];
  private readonly provider?: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 2;
    this.secrets = options.secrets ?? [];
    this.provider = options.provider;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<T> {
    const url = this.buildUrl(options);
    let lastError: WaConnectorError | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffMs(attempt));
      }
      try {
        return await this.attempt<T>(url, options);
      } catch (error) {
        if (!(error instanceof WaConnectorError)) {
          throw error;
        }
        lastError = error;
        const retryable =
          error.code === 'NETWORK_ERROR' ||
          (error.status !== undefined && RETRYABLE_STATUSES.has(error.status));
        if (!retryable) {
          throw error;
        }
      }
    }

    throw (
      lastError ??
      new WaConnectorError('NETWORK_ERROR', 'Falha de rede sem detalhes.', {
        provider: this.provider,
      })
    );
  }

  private async attempt<T>(url: string, options: HttpRequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');

    try {
      const hasJsonBody = options.body !== undefined;
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          ...(hasJsonBody ? { 'content-type': 'application/json' } : {}),
          ...this.headers,
          ...options.headers,
        },
        body: hasJsonBody ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await safeText(response);
        throw new WaConnectorError(
          statusToErrorCode(response.status),
          this.redact(
            `HTTP ${response.status} em ${method} ${options.path}: ${truncate(bodyText, 400)}`,
          ),
          { provider: this.provider, status: response.status },
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }
      const text = await safeText(response);
      if (text.length === 0) {
        return undefined as T;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('json') || looksLikeJson(text)) {
        try {
          return JSON.parse(text) as T;
        } catch {
          // alguns providers anunciam JSON e devolvem texto puro; cai para texto
        }
      }
      return text as T;
    } catch (error) {
      if (error instanceof WaConnectorError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new WaConnectorError(
          'TIMEOUT',
          this.redact(`Timeout após ${this.timeoutMs}ms em ${method} ${options.path}.`),
          { provider: this.provider, cause: error },
        );
      }
      throw new WaConnectorError(
        'NETWORK_ERROR',
        this.redact(`Erro de rede em ${method} ${options.path}: ${errorMessage(error)}`),
        { provider: this.provider, cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUrl(options: HttpRequestOptions): string {
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private redact(text: string): string {
    return redactSecrets(text, this.secrets);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(4_000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeJson(text: string): boolean {
  const first = text.trimStart().charAt(0);
  return first === '{' || first === '[';
}
