import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  configureHttp,
  getAuthToken,
  request,
  resetHttp,
  setAuthToken,
} from './http';

interface Capture {
  url: string;
  init: RequestInit;
}

/** 安装可控 fetch 并记录每次调用，供断言 path/method/headers/body */
function installFetch(
  handler: (capture: Capture) => Promise<Response>,
): Capture[] {
  const captures: Capture[] = [];
  configureHttp({
    fetchImpl: async (url, init) => {
      const capture = { url, init };
      captures.push(capture);
      return handler(capture);
    },
  });
  return captures;
}

/** 构造成功包裹（code=0） */
function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBody(capture: Capture): Record<string, unknown> {
  return JSON.parse(String(capture.init.body)) as Record<string, unknown>;
}

describe('http.request', () => {
  beforeEach(() => {
    resetHttp();
  });

  afterEach(() => {
    resetHttp();
  });

  it('POST + JSON 发送请求，并解包返回 data', async () => {
    const captures = installFetch(async () => okResponse({ value: 1 }));

    const data = await request<{ a: number }, { value: number }>('/api/demo/action', { a: 1 });

    expect(data).toEqual({ value: 1 });
    expect(captures).toHaveLength(1);
    const capture = captures[0]!;
    expect(capture.url).toBe('/api/demo/action');
    expect(capture.init.method).toBe('POST');
    expect(parseBody(capture)).toEqual({ a: 1 });
    expect((capture.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('基地址配置生效并规范尾部斜杠', async () => {
    configureHttp({ baseUrl: 'https://api.example.com/' });
    const captures = installFetch(async () => okResponse({}));

    await request('/api/demo/action', {});

    expect(captures[0]!.url).toBe('https://api.example.com/api/demo/action');
  });

  it('code !== 0 归一为携带业务码的 ApiError', async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify({ code: 40902, message: '余额不足', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const error: unknown = await request('/api/wallet/top-up', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(40902);
    expect((error as ApiError).message).toBe('余额不足');
  });

  it('HTTP 非 2xx 归一为 code -1 的网络错误', async () => {
    installFetch(async () => new Response('internal error', { status: 500 }));

    const error: unknown = await request('/api/demo/action', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(-1);
  });

  it('响应包裹格式非法时归一为网络错误', async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const error: unknown = await request('/api/demo/action', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(-1);
  });

  it('网络异常（fetch reject）归一为 code -1', async () => {
    installFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const error: unknown = await request('/api/demo/action', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(-1);
  });

  it('超时触发 AbortError（极短超时）', async () => {
    configureHttp({ timeoutMs: 10 });
    installFetch(
      (_capture) =>
        new Promise<Response>((_resolve, reject) => {
          // 模拟真实 fetch：收到 abort 信号后以 AbortError 拒绝
          _capture.init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const error: unknown = await request('/api/demo/slow', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).name).toBe('AbortError');
    expect((error as ApiError).code).toBe(-1);
  });

  it('幂等请求自动注入 requestId，且每次操作不同', async () => {
    const captures = installFetch(async () => okResponse({}));

    await request('/api/auth/register', { name: '张三' }, { idempotent: true });
    await request('/api/auth/register', { name: '张三' }, { idempotent: true });

    const first = parseBody(captures[0]!).requestId;
    const second = parseBody(captures[1]!).requestId;
    expect(typeof first).toBe('string');
    expect(typeof second).toBe('string');
    expect((first as string).length).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });

  it('调用方显式传入 requestId 时保留原值（重试复用同一幂等键）', async () => {
    const captures = installFetch(async () => okResponse({}));

    await request('/api/exchange/execute', { quoteId: 'Q-1', requestId: 'fixed-key' }, {
      idempotent: true,
    });

    expect(parseBody(captures[0]!).requestId).toBe('fixed-key');
  });

  it('非幂等请求不注入 requestId', async () => {
    const captures = installFetch(async () => okResponse({}));

    await request('/api/auth/client/login', { email: 'demo@example.com', password: 'x' });

    expect(parseBody(captures[0]!)).not.toHaveProperty('requestId');
  });

  it('设置 token 后注入 Authorization: Bearer；清除后不再携带', async () => {
    expect(getAuthToken()).toBeNull();
    setAuthToken('token-abc');
    expect(getAuthToken()).toBe('token-abc');

    const captures = installFetch(async () => okResponse({}));
    await request('/api/auth/logout', {});
    expect((captures[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-abc',
    );

    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
    await request('/api/auth/logout', {});
    expect((captures[1]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
