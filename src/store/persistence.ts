import { STORAGE_KEY, STORAGE_VERSION } from '@/domain/constants';
import type { DataState, SessionState } from '@/domain/types';
import type { StorageAdapter } from '@/lib/storage';

// 持久化：单键存储 + 安全解析 + 版本迁移 + 损坏恢复（设计文档 §5.3）。
// WHY 不直接用 zustand persist 中间件的 hydration：损坏恢复需要异步重放 seed，
// 中间件同步水合路径不适用；本模块以等价语义（partialize = session + data）手写实现。

export interface PersistedData {
  session: SessionState;
  data: DataState;
}

export interface PersistedEnvelope {
  version: number;
  savedAt: number;
  data: PersistedData;
}

export type LoadResult =
  | { ok: true; payload: PersistedData }
  | { ok: false; reason: 'empty' | 'corrupt' | 'future-version' };

/** 版本迁移表：migrations[n] 把 v(n) 数据升到 v(n+1)；当前 v1 无迁移，机制先行 */
const migrations: Record<number, (payload: PersistedData) => PersistedData> = {};

export function loadPersisted(adapter: StorageAdapter): LoadResult {
  const raw = adapter.getItem(STORAGE_KEY);
  if (raw === null) return { ok: false, reason: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isEnvelope(parsed)) return { ok: false, reason: 'corrupt' };
  // 版本高于当前（例如降级打开）→ 视为不可用，避免误读未来结构
  if (parsed.version > STORAGE_VERSION) return { ok: false, reason: 'future-version' };

  let payload = parsed.data;
  let version = parsed.version;
  while (version < STORAGE_VERSION) {
    const migrate = migrations[version];
    if (!migrate) return { ok: false, reason: 'corrupt' };
    payload = migrate(payload);
    version += 1;
  }
  return { ok: true, payload };
}

export function savePersisted(adapter: StorageAdapter, payload: PersistedData): void {
  const envelope: PersistedEnvelope = {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    data: payload,
  };
  adapter.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export function clearPersisted(adapter: StorageAdapter): void {
  adapter.removeItem(STORAGE_KEY);
}

/** 轻量结构校验：只检查恢复必需的关键字段，避免把 JSON 噪音当合法数据 */
function isEnvelope(value: unknown): value is PersistedEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as Partial<PersistedEnvelope>;
  if (typeof envelope.version !== 'number' || typeof envelope.savedAt !== 'number') return false;
  const payload = envelope.data as Partial<PersistedData> | undefined;
  if (typeof payload !== 'object' || payload === null) return false;
  const session = payload.session as Partial<SessionState> | undefined;
  const data = payload.data as Partial<DataState> | undefined;
  if (typeof session !== 'object' || session === null) return false;
  if (typeof data !== 'object' || data === null) return false;
  return (
    Array.isArray(data.customers) &&
    Array.isArray(data.wallets) &&
    Array.isArray(data.orders) &&
    Array.isArray(data.tickets) &&
    typeof data.fxConfig === 'object' &&
    data.fxConfig !== null
  );
}
