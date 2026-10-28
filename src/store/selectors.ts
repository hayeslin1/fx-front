import { ALL_CURRENCIES } from '@/domain/constants';
import type { Customer, DataState, OpsAccount, Wallet } from '@/domain/types';

// M1 仅提供基础读取函数；账本类派生选择器（memoized，设计文档 §7.3）
// 随 M2 重放引擎落地后补充。

export function getCustomerById(data: DataState, customerId: string): Customer | undefined {
  return data.customers.find((c) => c.id === customerId);
}

export function getOpsAccountById(data: DataState, opsAccountId: string): OpsAccount | undefined {
  return data.opsAccounts.find((a) => a.id === opsAccountId);
}

/** 客户六币种钱包（按固定币种顺序 USP/GBP/EUR/JPY/CNH/HKD 输出，缺项不补） */
export function getCustomerWallets(data: DataState, customerId: string): Wallet[] {
  const order = new Map(ALL_CURRENCIES.map((ccy, index) => [ccy, index]));
  return data.wallets
    .filter((w) => w.customerId === customerId)
    .sort((a, b) => (order.get(a.currency) ?? 0) - (order.get(b.currency) ?? 0));
}

export function getWallet(
  data: DataState,
  customerId: string,
  currency: Wallet['currency'],
): Wallet | undefined {
  return data.wallets.find((w) => w.customerId === customerId && w.currency === currency);
}
