import { describe, expect, it } from 'vitest';
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
