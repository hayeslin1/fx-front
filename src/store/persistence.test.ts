import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, STORAGE_VERSION } from '@/domain/constants';
import { createMemoryAdapter, type StorageAdapter } from '@/lib/storage';
import { loadPersisted, savePersisted } from './persistence';
import { emptyData } from './slices/data.slice';
import { initialSession } from './slices/session.slice';

// 持久化安全读写的边界：空 / 损坏 / 高版本 / 往返（设计文档 §5.3，测试 §12.1）
let adapter: StorageAdapter;

beforeEach(() => {
  adapter = createMemoryAdapter();
});

describe('loadPersisted 失败分支', () => {
  it('无数据 → empty', () => {
    const result = loadPersisted(adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('非法 JSON → corrupt', () => {
    adapter.setItem(STORAGE_KEY, '{broken json');
    const result = loadPersisted(adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('corrupt');
  });

  it('结构缺关键字段 → corrupt', () => {
    adapter.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: 1, data: { session: {}, data: {} } }),
    );
    const result = loadPersisted(adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('corrupt');
  });

  it('版本高于当前 → future-version（不误读未来结构）', () => {
    adapter.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION + 1,
        savedAt: 1,
        data: { session: initialSession, data: emptyData },
      }),
    );
    const result = loadPersisted(adapter);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('future-version');
  });
});

describe('savePersisted / loadPersisted 往返', () => {
  it('恢复会话与数据，且 Decimal 字符串无科学计数法', () => {
    const data = {
      ...emptyData,
      wallets: [
        { customerId: 'C-9999', currency: 'USD' as const, balance: '0.00000000000000000001' },
      ],
    };
    savePersisted(adapter, { session: { client: { customerId: 'C-9999' }, ops: null }, data });

    const raw = adapter.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw ?? '').not.toContain('e-');

    const loaded = loadPersisted(adapter);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.payload.session.client).toEqual({ customerId: 'C-9999' });
      expect(loaded.payload.data.wallets[0]?.balance).toBe('0.00000000000000000001');
    }
  });
});
