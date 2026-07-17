import { describe, expect, it, vi } from 'vitest';
import { HttpClient, isWaConnectorError } from '../src';

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function fetchStub(
  responses: Array<() => Response | Error>,
  calls: RecordedCall[] = [],
): typeof globalThis.fetch {
  let index = 0;
  return async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    if (!next) {
      throw new Error('fetchStub sem respostas configuradas');
    }
    const result = next();
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpClient: requisições', () => {
  it('monta URL com query e headers padrão, e parseia JSON', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com/base/',
      headers: { apikey: 'chave' },
      fetch: fetchStub([() => jsonResponse(200, { ok: true })], calls),
    });

    const result = await client.request<{ ok: boolean }>({
      path: 'status',
      query: { instance: 'loja1', vazio: undefined },
    });

    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://api.exemplo.com/base/status?instance=loja1');
    expect(new Headers(calls[0]?.init?.headers).get('apikey')).toBe('chave');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('serializa body como JSON com POST implícito', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      fetch: fetchStub([() => jsonResponse(200, { id: '1' })], calls),
    });

    await client.request({ path: '/send/text', body: { to: '558599', text: 'oi' } });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ to: '558599', text: 'oi' }));
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
  });

  it('parseia JSON mesmo sem content-type correto', async () => {
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      fetch: fetchStub([() => new Response('{"solto":true}', { status: 200 })]),
    });
    const result = await client.request<{ solto: boolean }>({ path: '/x' });
    expect(result).toEqual({ solto: true });
  });

  it('responseType: "base64" lê o corpo como binário e devolve base64 (ADR-0020)', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      fetch: fetchStub([
        () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      ]),
    });
    const result = await client.request<string>({ path: '/media/abc', responseType: 'base64' });
    expect(result).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('HttpClient: erros e retry', () => {
  it('401 vira AUTH_FAILED sem retry', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      fetch: fetchStub([() => jsonResponse(401, { error: 'unauthorized' })], calls),
    });

    const failure = await client.request({ path: '/x' }).catch((error: unknown) => error);
    expect(isWaConnectorError(failure) && failure.code === 'AUTH_FAILED').toBe(true);
    expect(isWaConnectorError(failure) && failure.status === 401).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('429 é retentado até suceder', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      retries: 2,
      fetch: fetchStub(
        [() => jsonResponse(429, { error: 'slow down' }), () => jsonResponse(200, { ok: true })],
        calls,
      ),
    });

    const result = await client.request<{ ok: boolean }>({ path: '/x' });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('erro de rede é retentado e esgota em NETWORK_ERROR', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      retries: 1,
      fetch: fetchStub([() => new TypeError('fetch failed')], calls),
    });

    const failure = await client.request({ path: '/x' }).catch((error: unknown) => error);
    expect(isWaConnectorError(failure) && failure.code === 'NETWORK_ERROR').toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('timeout vira TIMEOUT', async () => {
    const neverFetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, rejectPromise) => {
        init?.signal?.addEventListener('abort', () => {
          rejectPromise(new DOMException('The operation was aborted', 'AbortError'));
        });
      });

    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      timeoutMs: 25,
      retries: 0,
      fetch: neverFetch,
    });

    const failure = await client.request({ path: '/lento' }).catch((error: unknown) => error);
    expect(isWaConnectorError(failure) && failure.code === 'TIMEOUT').toBe(true);
  });

  it('redige segredos nas mensagens de erro', async () => {
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      secrets: ['token-super-secreto'],
      fetch: fetchStub([() => jsonResponse(401, { error: 'bad token token-super-secreto' })]),
    });

    const failure = await client.request({ path: '/x' }).catch((error: unknown) => error);
    expect(isWaConnectorError(failure)).toBe(true);
    if (isWaConnectorError(failure)) {
      expect(failure.message).not.toContain('token-super-secreto');
      expect(failure.message).toContain('***');
    }
  });
});

describe('HttpClient: retry idempotente (ADR-0007)', () => {
  it('POST com NETWORK_ERROR não é retentado por padrão (método não idempotente)', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      retries: 2,
      fetch: fetchStub([() => new TypeError('fetch failed')], calls),
    });

    const failure = await client
      .request({ method: 'POST', path: '/send/text', body: { to: '558599', text: 'oi' } })
      .catch((error: unknown) => error);

    expect(isWaConnectorError(failure) && failure.code === 'NETWORK_ERROR').toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('POST com idempotent:true É retentado em NETWORK_ERROR', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      retries: 1,
      fetch: fetchStub(
        [() => new TypeError('fetch failed'), () => jsonResponse(200, { ok: true })],
        calls,
      ),
    });

    const result = await client.request<{ ok: boolean }>({
      method: 'POST',
      path: '/send/text',
      idempotent: true,
      body: { to: '558599', text: 'oi' },
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('GET com NETWORK_ERROR continua sendo retentado (idempotente por natureza)', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      retries: 1,
      fetch: fetchStub(
        [() => new TypeError('fetch failed'), () => jsonResponse(200, { ok: true })],
        calls,
      ),
    });

    const result = await client.request<{ ok: boolean }>({ path: '/status' });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('429 com header retry-after usa esse valor (em ms) em vez do backoff calculado', async () => {
    vi.useFakeTimers();
    try {
      const calls: RecordedCall[] = [];
      const client = new HttpClient({
        baseUrl: 'https://api.exemplo.com',
        retries: 1,
        fetch: fetchStub(
          [
            () =>
              new Response(JSON.stringify({ error: 'slow down' }), {
                status: 429,
                headers: { 'content-type': 'application/json', 'retry-after': '2' },
              }),
            () => jsonResponse(200, { ok: true }),
          ],
          calls,
        ),
      });

      const resultPromise = client.request<{ ok: boolean }>({ path: '/x' });

      // backoff calculado (sem retry-after) fica na casa de 300-400ms; se o client tivesse
      // ignorado o header, o segundo call já teria acontecido bem antes de 1900ms.
      await vi.advanceTimersByTimeAsync(1900);
      expect(calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(150);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('429 sem header retry-after usa o backoff calculado (sem mudança de comportamento)', async () => {
    const calls: RecordedCall[] = [];
    const client = new HttpClient({
      baseUrl: 'https://api.exemplo.com',
      retries: 1,
      fetch: fetchStub(
        [() => jsonResponse(429, { error: 'slow down' }), () => jsonResponse(200, { ok: true })],
        calls,
      ),
    });

    const result = await client.request<{ ok: boolean }>({ path: '/x' });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });
});
