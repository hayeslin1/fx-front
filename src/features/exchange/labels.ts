import type { ChannelDiag, NoQuoteReason } from '@/domain/pricing';
import type { Channel, TradeDirection } from '@/domain/types';

// 交易方向 → 中文展示名（设计文档 §4.2）
export const DIRECTION_LABELS: Record<TradeDirection, string> = {
  SELL_USD: '卖出 USD',
  BUY_USD: '买入 USD',
};

// 取价失败原因 → 客户可读文案（PRD §4.1：无有效报价须说明原因）
export const NO_QUOTE_REASON_LABELS: Record<NoQuoteReason, string> = {
  PAIR_DISABLED: '该币对已停用，暂不可兑换',
  NO_QUOTE: '暂无有效报价',
  BELOW_MIN: '金额低于单笔最低限额（等值 1 USD）',
  ABOVE_MAX: '金额超过单笔最高限额（等值 10,000 USD）',
  INVALID_AMOUNT: '金额格式不正确，请检查正数与币种精度',
};

// 逐渠道诊断 → 中文原因（PRD §4.1：展示“为什么该渠道不可用”）
export const CHANNEL_DIAG_REASON_LABELS: Record<ChannelDiag['reason'], string> = {
  CHANNEL_DISABLED: '渠道已停用',
  PRICE_DISABLED: '报价开关已停用',
  PRICE_STALE: '采集价已过期（超过 10 分钟）',
  NO_PRICE: '暂无采集价',
  NOT_IN_ROUTING: '不在该币对路由中',
};

/** 渠道 id → 展示名；配置缺失时回退 id，避免详情页出现空白 */
export function channelNameOf(channels: readonly Channel[], channelId: string): string {
  return channels.find((channel) => channel.id === channelId)?.name ?? channelId;
}
