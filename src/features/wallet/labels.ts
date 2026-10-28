import type { BillType, Currency } from '@/domain/types';

// 币种 → 中文展示名（钱包/充值筛选与下拉统一口径）
export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: '美元 USD',
  GBP: '英镑 GBP',
  EUR: '欧元 EUR',
  JPY: '日元 JPY',
  CNH: '离岸人民币 CNH',
  HKD: '港元 HKD',
};

/**
 * 币种账户展示名：旗帜 + 中文名（设计文档 §10.2）。
 * 用于首页六币种余额卡与钱包币种余额表这类“账户主体”展示；
 * 与 CURRENCY_LABELS（带 ISO 代码，用于流水币种列/下拉选项等需精确代码的场景）分工不同，勿混用。
 */
export const CURRENCY_ACCOUNT_LABELS: Record<Currency, string> = {
  USD: '🇺🇸 美元',
  GBP: '🇬🇧 英镑',
  EUR: '🇪🇺 欧元',
  JPY: '🇯🇵 日元',
  CNH: '🇨🇳 离岸人民币',
  HKD: '🇭🇰 港元',
};

// 钱包流水类型 → 中文展示名（设计文档 §4.2：枚举文案集中在 features/*/labels.ts）
export const BILL_TYPE_LABELS: Record<BillType, string> = {
  INITIAL_GIFT: '初始演示资金',
  TOPUP_SELF: '自助充值',
  TOPUP_OPS: '运营充值',
  EXCHANGE_DEBIT: '兑换扣款',
  EXCHANGE_CREDIT: '兑换到账',
};
