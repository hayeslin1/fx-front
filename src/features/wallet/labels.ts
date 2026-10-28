import type { BillType } from '@/domain/types';

// 钱包流水类型 → 中文展示名（设计文档 §4.2：枚举文案集中在 features/*/labels.ts）
export const BILL_TYPE_LABELS: Record<BillType, string> = {
  INITIAL_GIFT: '初始演示资金',
  TOPUP_SELF: '自助充值',
  TOPUP_OPS: '运营充值',
  EXCHANGE_DEBIT: '兑换扣款',
  EXCHANGE_CREDIT: '兑换到账',
};
