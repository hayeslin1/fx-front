import type { Order, TradeDirection } from '@/domain/types';

// 订单状态 → 中文展示名（原型仅成功成交生成订单，PRD §3.3/§3.4）
export const ORDER_STATUS_LABELS: Record<Order['status'], string> = {
  COMPLETED: '已完成',
};

// 订单方向 → 客户视角的资金流向说明（客户成交价用 bid/ask，PRD §4.2）
export const ORDER_FLOW_LABELS: Record<TradeDirection, string> = {
  SELL_USD: 'USD 换入外币',
  BUY_USD: '外币换入 USD',
};
