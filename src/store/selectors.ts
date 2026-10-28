import { ALL_CURRENCIES, QUOTE_CCY } from '@/domain/constants';
import { buildLedger, type Ledger, type PairExposure } from '@/domain/ledger';
import { D, roundCcy } from '@/domain/money';
import type {
  CloseBatch,
  Currency,
  Customer,
  DataState,
  DecimalStr,
  OpsAccount,
  Order,
  PairId,
  Ticket,
  TicketMessage,
  Wallet,
  WalletBill,
} from '@/domain/types';

// 派生选择器（设计文档 §7.3）。纯读取，不修改入参。

export function getCustomerById(data: DataState, customerId: string): Customer | undefined {
  return data.customers.find((c) => c.id === customerId);
}

export function getOpsAccountById(data: DataState, opsAccountId: string): OpsAccount | undefined {
  return data.opsAccounts.find((a) => a.id === opsAccountId);
}

/** 客户六币种钱包（按固定币种顺序 USD/GBP/EUR/JPY/CNH/HKD 输出，缺项不补） */
export function getCustomerWallets(data: DataState, customerId: string): Wallet[] {
  const order = new Map(ALL_CURRENCIES.map((ccy, index) => [ccy, index]));
  return data.wallets
    .filter((w) => w.customerId === customerId)
    .sort((a, b) => (order.get(a.currency) ?? 0) - (order.get(b.currency) ?? 0));
}

export function getWallet(
  data: DataState,
  customerId: string,
  currency: Currency,
): Wallet | undefined {
  return data.wallets.find((w) => w.customerId === customerId && w.currency === currency);
}

// ---------- 账本（memoized：以 facts 引用为键，immer/不可变更新保证变更即新引用） ----------

interface LedgerCache {
  orders: Order[];
  closeBatches: CloseBatch[];
  ledger: Ledger;
}

let ledgerCache: LedgerCache | null = null;

/** 全量账本；同一 facts 引用重复调用返回同一对象，避免每次渲染重复重放 */
export function selectLedger(data: DataState): Ledger {
  if (
    ledgerCache !== null &&
    ledgerCache.orders === data.orders &&
    ledgerCache.closeBatches === data.closeBatches
  ) {
    return ledgerCache.ledger;
  }
  const ledger = buildLedger({ orders: data.orders, closeBatches: data.closeBatches });
  ledgerCache = { orders: data.orders, closeBatches: data.closeBatches, ledger };
  return ledger;
}

/** 单币对敞口/可平金额；未知币对返回 FLAT 0（仅防御，正常五币对全量） */
export function selectPairExposure(data: DataState, pairId: PairId): PairExposure {
  return (
    selectLedger(data).pairExposure.find((exposure) => exposure.pairId === pairId) ?? {
      pairId,
      netUsd: '0.00',
      side: 'FLAT',
      closeableUsd: '0.00',
    }
  );
}

// ---------- 客户视角列表 ----------

/** 客户订单（成交时间倒序；同刻按 id 倒序保证稳定） */
export function getCustomerOrders(data: DataState, customerId: string): Order[] {
  return data.orders
    .filter((order) => order.customerId === customerId)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function getOrderById(data: DataState, orderId: string): Order | undefined {
  return data.orders.find((order) => order.id === orderId);
}

export interface BillFilter {
  currency?: Currency;
}

/** 客户钱包流水（时间倒序；可按币种筛选） */
export function getWalletBills(
  data: DataState,
  customerId: string,
  filter: BillFilter = {},
): WalletBill[] {
  return data.bills
    .filter((bill) => bill.customerId === customerId)
    .filter((bill) => filter.currency === undefined || bill.currency === filter.currency)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function getOrderBills(data: DataState, orderId: string): WalletBill[] {
  return data.bills
    .filter((bill) => bill.relatedOrderId === orderId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

// ---------- 客服 ----------

/** 客户工单（最近更新在前） */
export function getCustomerTickets(data: DataState, customerId: string): Ticket[] {
  return data.tickets
    .filter((ticket) => ticket.customerId === customerId)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
}

export function getTicketById(data: DataState, ticketId: string): Ticket | undefined {
  return data.tickets.find((ticket) => ticket.id === ticketId);
}

/** 工单消息（时间正序，时间线展示） */
export function getTicketMessages(data: DataState, ticketId: string): TicketMessage[] {
  return data.ticketMessages
    .filter((message) => message.ticketId === ticketId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

// ---------- 估值（D6） ----------

/**
 * 某币对最新原始中间价（跨全部渠道、按 collectedAt 取最新）。
 * WHY 忽略渠道启停与新鲜度：首页/客户管理只做“参考估值”（D6），不是可成交价。
 */
export function getLatestRawMid(data: DataState, pairId: PairId): DecimalStr | undefined {
  let latest: { mid: DecimalStr; collectedAt: number } | undefined;
  for (const price of data.fxConfig.rawPrices) {
    if (price.pairId !== pairId) continue;
    if (latest === undefined || price.collectedAt > latest.collectedAt) latest = price;
  }
  return latest?.mid;
}

export interface UsdValuation {
  /** 六币种余额折算 USD 合计（2 位） */
  totalUsd: DecimalStr;
  /** 缺参考价而未计入的币种（USD 恒计入，不会出现在此） */
  missing: Currency[];
}

/**
 * 客户资产 USD 参考估值（D6）：非 USD 余额 × 该币对最新原始中间价；无价格则不计入并提示。
 * USD 本身按 1:1 计入。
 */
export function getCustomerUsdValuation(data: DataState, customerId: string): UsdValuation {
  let total = D('0');
  const missing: Currency[] = [];
  for (const wallet of getCustomerWallets(data, customerId)) {
    if (wallet.currency === 'USD') {
      total = total.plus(D(wallet.balance));
      continue;
    }
    const pairId = `${'USD'}/${wallet.currency}` as PairId;
    // 仅五币对内的外币能用中间价折算；其余币种理论上不存在（类型已收窄）
    if (!(pairId in QUOTE_CCY)) {
      missing.push(wallet.currency);
      continue;
    }
    const mid = getLatestRawMid(data, pairId);
    if (mid === undefined) {
      missing.push(wallet.currency);
      continue;
    }
    total = total.plus(D(wallet.balance).times(D(mid)));
  }
  return { totalUsd: roundCcy(total, 'USD').toFixed(2), missing };
}
