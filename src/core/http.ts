import { redactSecrets, statusToErrorCode, WaConnectorError } from './errors';

/**
 * Remove barras finais sem regex. `/\/+$/` seria O(n²) em entradas com muitas barras repetidas
 * (CodeQL: "polynomial regular expression") — um loop simples é O(n) e evita o problema por
 * completo.
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return value.slice(0, end);
}

export interface HttpClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  /** Timeout por tentativa, em ms (padrão: 30_000). */
  timeoutMs?: number;
  /**
   * Retentativas para 429/5xx/erros de rede, com backoff exponencial (padrão: 2). Só se aplicam a
   * métodos idempotentes: GET/HEAD sempre, os demais (POST/PUT/PATCH/DELETE) só com
   * `idempotent: true` explícito em `HttpRequestOptions` (ver ADR-0007). Quando a resposta 429/503
   * traz o header `retry-after` numérico, ele tem precedência sobre o backoff calculado.
   */
  retries?: number;
  /** Valores sensíveis (tokens) redigidos em toda mensagem de erro. */
  secrets?: readonly string[];
  provider?: string;
  /** Injetável para testes. */
  fetch?: typeof globalThis.fetch;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Serializado como JSON quando presente. */
  body?: unknown;
  /**
   * Marca a requisição como idempotente (reenviá-la não duplica efeito colateral no provider).
   * GET/HEAD já são tratados como idempotentes por natureza; para POST/PUT/PATCH/DELETE, sem essa
   * flag em `true`, o retry NUNCA acontece (nem em NETWORK_ERROR, nem em 429/5xx) — evita reenviar
   * um `sendText`/`sendMedia` que o provider já processou antes da conexão cair (ver ADR-0007).
   */
  idempotent?: boolean;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
/** Teto de segurança para o delay vindo do header `Retry-After`, em ms. */
const RETRY_AFTER_MAX_MS = 30_000;

/**
 * Client HTTP mínimo sobre `fetch` nativo, compartilhado pelos adapters:
 * timeout, retry idempotente com backoff (ou `Retry-After` do provider quando presente),
 * mapeamento de status para erros tipados e redação de segredos. Zero dependências de runtime.
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
    this.baseUrl = stripTrailingSlashes(options.baseUrl);
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 2;
    this.secrets = options.secrets ?? [];
    this.provider = options.provider;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<T> {
    const url = this.buildUrl(options);
    const method = resolveMethod(options);
    // GET/HEAD são idempotentes por natureza; os demais métodos só entram no laço de retry com
    // `idempotent: true` explícito (GAP4 — evita duplicar sendText/sendMedia após NETWORK_ERROR).
    const canRetry = method === 'GET' || method === 'HEAD' || options.idempotent === true;
    let lastError: WaConnectorError | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        // `Retry-After` do provider (429/503) tem precedência sobre o backoff calculado.
        await sleep(lastError?.retryAfterMs ?? backoffMs(attempt));
      }
      try {
        return await this.attempt<T>(url, options);
      } catch (error) {
        if (!(error instanceof WaConnectorError)) {
          throw error;
        }
        lastError = error;
        const retryable =
          canRetry &&
          (error.code === 'NETWORK_ERROR' ||
            (error.status !== undefined && RETRYABLE_STATUSES.has(error.status)));
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
    const method = resolveMethod(options);

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
        // Só 429/503 costumam vir com `Retry-After` acionável; 502/504 raramente o incluem e o
        // backoff calculado já cobre esse caso.
        const retryAfterMs =
          response.status === 429 || response.status === 503
            ? parseRetryAfterMs(response.headers.get('retry-after'))
            : undefined;
        throw new WaConnectorError(
          statusToErrorCode(response.status),
          this.redact(
            `HTTP ${response.status} em ${method} ${options.path}: ${truncate(bodyText, 400)}`,
          ),
          { provider: this.provider, status: response.status, retryAfterMs },
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

function resolveMethod(options: HttpRequestOptions): NonNullable<HttpRequestOptions['method']> {
  return options.method ?? (options.body !== undefined ? 'POST' : 'GET');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(4_000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
}

/**
 * Só suporta o formato numérico (segundos) do header `Retry-After` — o formato de data HTTP
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`) não é necessário para os providers-alvo; se o
 * header estiver ausente ou não for um inteiro simples, o backoff calculado é usado (sem mudança
 * de comportamento). Sem regex por consistência com `stripTrailingSlashes` acima (evita qualquer
 * dúvida sobre custo de matching em headers vindos de fora).
 */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return undefined;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) return undefined;
  }
  const seconds = Number(trimmed);
  return Math.min(RETRY_AFTER_MAX_MS, seconds * 1000);
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
