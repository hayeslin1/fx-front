// 统一 HTTP 封装（设计文档 §8.3）：全部 POST + JSON、统一包裹解包、错误归一、
// 15s 超时、幂等 requestId 注入、Bearer token 预留。
// 之所以集中在一处：对接期只需替换基地址/鉴权来源，各模块与 UI 无需改动。

/** 服务端统一响应包裹（§8.2）：code !== 0 一律视为业务失败 */
export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** 业务错误：code 取自服务端；网络/解析/超时等本地异常统一归一为 -1 */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    // 显式命名便于调用方按 name 区分超时与普通业务错误
    this.name = 'ApiError';
  }
}

export interface HttpConfig {
  /** 后端基地址；默认取 VITE_API_BASE_URL，空串表示同源 */
  baseUrl?: string;
  timeoutMs?: number;
  /** 注入式 fetch，测试替换；传 null 恢复 globalThis.fetch */
  fetchImpl?: FetchLike | null;
}

export interface RequestOptions {
  /**
   * 幂等写接口标记：自动在 body 注入 requestId（已有则保留原值）。
   * 只对 §8.4 标注 ✔ 的端点开启，避免把幂等字段扩散到登录等非幂等请求。
   */
  idempotent?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const NETWORK_ERROR_MESSAGE = '网络异常，请稍后重试';
const TIMEOUT_ERROR_MESSAGE = '请求超时，请稍后重试';

/** 基地址去掉尾部斜杠，避免拼出 `//api/...` */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

let baseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? '');
let timeoutMs = DEFAULT_TIMEOUT_MS;
let fetchImpl: FetchLike | null = null;
let authToken: string | null = null;

/** 运行期覆盖配置（测试与联调切换后端地址用） */
export function configureHttp(config: HttpConfig): void {
  if (config.baseUrl !== undefined) baseUrl = normalizeBaseUrl(config.baseUrl);
  if (config.timeoutMs !== undefined) timeoutMs = config.timeoutMs;
  if (config.fetchImpl !== undefined) fetchImpl = config.fetchImpl;
}

/** 恢复默认配置并清除 token；测试间隔离用 */
export function resetHttp(): void {
  baseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? '');
  timeoutMs = DEFAULT_TIMEOUT_MS;
  fetchImpl = null;
  authToken = null;
}

/** 登录成功后由会话层写入；传 null 表示登出/会话失效 */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * 生成一次用户操作对应的幂等键。
 * 优先 crypto.randomUUID；非安全上下文（如局域网 http）没有该 API 时
 * 回退到 v4 形式的随机串，保证 requestId 仍然可用。
 */
function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function resolveFetch(): FetchLike {
  // 绑定 globalThis：浏览器原生 fetch 脱离 window 调用会抛 Illegal invocation
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken !== null && authToken !== '') {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

/** 判断调用方是否已经显式提供有效 requestId（undefined/空串视为未提供） */
function hasRequestId(body: object): boolean {
  const value = (body as { requestId?: unknown }).requestId;
  return typeof value === 'string' && value.length > 0;
}

/**
 * 把任意异常归一为 ApiError：
 * - 已是 ApiError（业务失败）原样抛出；
 * - 超时/主动 abort 保留 AbortError 名称并归一 code=-1，便于上层区分“可重试超时”；
 * - 其余网络、JSON 解析异常统一为网络错误（§8.2）。
 */
function normalizeError(error: unknown, aborted: boolean): ApiError {
  if (error instanceof ApiError) return error;
  if (aborted || (error instanceof Error && error.name === 'AbortError')) {
    const timeoutError = new ApiError(-1, TIMEOUT_ERROR_MESSAGE);
    timeoutError.name = 'AbortError';
    return timeoutError;
  }
  return new ApiError(-1, NETWORK_ERROR_MESSAGE);
}

/**
 * 发起一次约定格式的 API 调用并返回解包后的 data。
 * @param path 以 `/api/...` 开头的端点数（与 §8.4 表逐条对应）
 * @param body JSON 请求体；无字段端点传 `{}`
 */
export async function request<TReq extends object, TResp>(
  path: string,
  body: TReq,
  options: RequestOptions = {},
): Promise<TResp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const payload: object =
    options.idempotent && !hasRequestId(body)
      ? { ...body, requestId: createRequestId() }
      : body;

  try {
    const response = await resolveFetch()(`${baseUrl}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // HTTP 非 2xx 不属于业务包裹，统一按网络异常处理（§8.2）
    if (!response.ok) {
      throw new ApiError(-1, NETWORK_ERROR_MESSAGE);
    }

    const envelope = (await response.json()) as Envelope<TResp> | null;
    if (
      envelope === null ||
      typeof envelope !== 'object' ||
      typeof envelope.code !== 'number'
    ) {
      throw new ApiError(-1, NETWORK_ERROR_MESSAGE);
    }
    if (envelope.code !== 0) {
      throw new ApiError(envelope.code, envelope.message || '请求失败');
    }
    return envelope.data;
  } catch (error) {
    throw normalizeError(error, controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }
}
