// UI 临时态切片：不持久化（设计文档 §7.1 partialize 语义）
export interface UiState {
  /** 本地数据损坏/版本不兼容后已恢复为预置样例 → 顶部轻提示（PRD §9-11） */
  storageRecovered: boolean;
  /** localStorage 不可用已降级为内存存储 → 常驻提示刷新丢失 */
  storagePersistent: boolean;
}

export const initialUi: UiState = {
  storageRecovered: false,
  storagePersistent: true,
};
