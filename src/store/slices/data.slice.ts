import { STORAGE_VERSION } from '@/domain/constants';
import type { DataState } from '@/domain/types';

// 业务事实切片（持久化核心，设计文档 §5.1/§7.1）。
// 引导流程（bootstrapStore）必定会在渲染前把本值替换为“已恢复数据”或“新建 seed”，
// 此空值仅作为 store 创建的占位与测试夹具基座。
export const emptyData: DataState = {
  customers: [],
  credentials: [],
  opsAccounts: [],
  assignees: [],
  wallets: [],
  bills: [],
  orders: [],
  closeBatches: [],
  tickets: [],
  ticketMessages: [],
  fxConfig: {
    channels: [],
    pairs: [],
    rawPrices: [],
    routing: [],
    markups: [],
    collectSteps: [],
  },
  counters: {},
  meta: { schemaVersion: STORAGE_VERSION, seededAt: 0, resetCount: 0, anchorAt: 0 },
};
