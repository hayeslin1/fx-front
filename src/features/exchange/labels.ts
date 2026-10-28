import type { TradeDirection } from '@/domain/types';

// 交易方向 → 中文展示名（设计文档 §4.2）
export const DIRECTION_LABELS: Record<TradeDirection, string> = {
  SELL_USD: '卖出 USD',
  BUY_USD: '买入 USD',
};
