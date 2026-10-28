import type { Quote } from '@/domain/types';

// UI 临时态切片：不持久化（设计文档 §7.1 partialize 语义）
export interface UiState {
  /** 本地数据损坏/版本不兼容后已恢复为预置样例 → 顶部轻提示（PRD §9-11） */
  storageRecovered: boolean;
  /** localStorage 不可用已降级为内存存储 → 常驻提示刷新丢失 */
  storagePersistent: boolean;
  /** 当前报价（30 秒内存态，不持久化；刷新即失效，需重新取价，PRD §4.1） */
  quote: Quote | null;
  /** 运营端侧边栏是否折叠（内存态，不持久化——刷新回到展开态） */
  sidebarCollapsed: boolean;
}

export const initialUi: UiState = {
  storageRecovered: false,
  storagePersistent: true,
  quote: null,
  sidebarCollapsed: false,
};
