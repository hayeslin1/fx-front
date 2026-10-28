import type {
  Order,
  PlatformSide,
  PnlAllocation,
  PnlSource,
  ProfitOrderStatus,
  TradeDirection,
} from '@/domain/types';

// 交易管理枚举中文文案（设计文档 §4.2：枚举文案集中在 features/*/labels.ts）。
// 客户订单页与收益订单页共用同一份文案来源，避免两页各写一份导致口径漂移。

/** 客户订单方向（客户视角资金流向：卖 USD 买外币 / 卖外币买 USD，PRD §6.1） */
export const TRADE_DIRECTION_LABELS: Record<TradeDirection, string> = {
  SELL_USD: '卖出 USD',
  BUY_USD: '买入 USD',
};

/** 平台敞口方向（收益单方向列：多头 = 客户卖 USD，设计文档 §6.6） */
export const PLATFORM_SIDE_LABELS: Record<PlatformSide, string> = {
  LONG: '多头',
  SHORT: '空头',
};

/** 客户订单状态（原型仅成功成交生成订单，PRD §3.3） */
export const ORDER_STATUS_LABELS: Record<Order['status'], string> = {
  COMPLETED: '已完成',
};

/** 收益单状态（PRD §5.3/§6.6：待实现/部分实现/已结算） */
export const PROFIT_ORDER_STATUS_LABELS: Record<ProfitOrderStatus, string> = {
  PENDING: '待实现',
  PARTIAL: '部分实现',
  SETTLED: '已结算',
};

/**
 * 收益单状态徽标配色（与 common/StatusBadge 同色板：琥珀=未实现、天蓝=部分、翠绿=完成）。
 * WHY 自配色：StatusBadge 内置 PENDING=待处理、PARTIAL=部分结算，与收益单单据口径
 * （待实现/部分实现）不同；公共组件不在本纵切改动范围，故以 labels 为唯一文案来源并复用其色板，
 * 徽标外壳仍走 StatusBadge（文字 + 颜色，禁止只靠颜色传意，PRD §8）。
 */
export const PROFIT_ORDER_STATUS_BADGE_CLASS: Record<ProfitOrderStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  PARTIAL: 'border-sky-200 bg-sky-50 text-sky-700',
  SETTLED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

/** 损益实现来源（PRD §6.2 审计明细：自然对冲 / 渠道平仓） */
export const PNL_SOURCE_LABELS: Record<PnlSource, string> = {
  NATURAL_HEDGE: '自然对冲',
  CHANNEL_CLOSE: '渠道平仓',
};

/** 尾差标记文案（PRD §6.2：尾数舍入差归 FIFO 较早的收益订单） */
export const REMAINDER_LABELS: { yes: string; no: string } = { yes: '尾差', no: '—' };

/**
 * 分配明细的来源引用对象（PRD §6.2 审计明细）：
 * 自然对冲展示对手订单号，渠道平仓展示批次尝试号（refId 即 attemptId）。
 * WHY 回退到 refId：防御对手订单字段缺失，保证明细永远能追溯到一个业务对象。
 */
export function allocationRefLabel(allocation: PnlAllocation): string {
  if (allocation.source === 'NATURAL_HEDGE') {
    return allocation.counterpartyOrderId ?? allocation.refId;
  }
  return allocation.refId;
}
