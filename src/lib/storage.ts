// 存储适配层：localStorage 不可用（无痕模式/配额异常）时降级为内存实现，
// 功能可用但刷新丢失，由 UI 层给出常驻提示（设计文档 §5.3）
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isLocalStorageAvailable(): boolean {
  try {
    const probe = '__fxprot_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function createBrowserAdapter(): StorageAdapter {
  if (isLocalStorageAvailable()) {
    return {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    };
  }
  return createMemoryAdapter();
}
