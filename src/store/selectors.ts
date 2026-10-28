import dayjs from 'dayjs';
import { ALL_CURRENCIES, PAIR_IDS, PRICE_FRESH_MS, QUOTE_CCY } from '@/domain/constants';
import { buildLedger, type Ledger, type PairExposure } from '@/domain/ledger';
import { D, roundCcy, type Decimal } from '@/domain/money';
import type {
  BillType,
  CloseBatch,
  Currency,
  Customer,
  DataState,
  DecimalStr,
  OpenLot,
  OpsAccount,
  Order,
  PairId,
  ProfitOrder,
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
 * 客户资产 USD 参考估值（D6）：外币余额 ÷ 该币对最新原始中间价。
 * WHY 除法：币对统一按「1 USD = R 单位报价币」表示（PRD §3.4），故外币折 USD = 余额 ÷ R；
 * 无价格则不计入并提示。USD 本身按 1:1 计入。
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
    total = total.plus(D(wallet.balance).div(mid));
  }
  return { totalUsd: roundCcy(total, 'USD').toFixed(2), missing };
}

// ---------- 运营：总览序列（§7.3，筛选仅作用于此处） ----------

export type OverviewRangeType = 'TODAY' | 'LAST_7D' | 'LAST_30D' | 'CUSTOM';

export interface OverviewRange {
  type: OverviewRangeType;
  /** CUSTOM 必填；epoch 毫秒，起止含当天（页面负责 end >= start 校验） */
  dateFrom?: number;
  dateTo?: number;
}

export interface OverviewPoint {
  /** 本地日键 YYYYMMDD（与编号口径一致） */
  dayKey: string;
  /** 图表轴标签 MM-DD */
  label: string;
  /** 当日成交额（USD 腿合计，2 位） */
  volumeUsd: DecimalStr;
  /** 当日成功订单数 */
  orderCount: number;
}

export interface OverviewSummary {
  /** 区间成交额（USD 腿合计，2 位） */
  volumeUsd: DecimalStr;
  /** 区间订单数 */
  orderCount: number;
  /** 按日趋势（含零成交日，保证图表连续） */
  series: OverviewPoint[];
}

/** 解析筛选范围为 [start, end] 毫秒区间（含端点当天） */
function resolveRange(range: OverviewRange, now: number): { start: number; end: number } {
  const today = dayjs(now).startOf('day');
  switch (range.type) {
    case 'TODAY':
      return { start: today.valueOf(), end: now };
    case 'LAST_7D':
      return { start: today.subtract(6, 'day').valueOf(), end: now };
    case 'LAST_30D':
      return { start: today.subtract(29, 'day').valueOf(), end: now };
    case 'CUSTOM':
      return { start: range.dateFrom ?? now, end: range.dateTo ?? now };
  }
}

/** 订单 USD 腿记账金额：卖 USD 取来源、买 USD 取目标（与账本 §6.4 口径一致） */
function usdLegOf(order: Order): Decimal {
  return D(order.direction === 'SELL_USD' ? order.sourceAmount : order.targetAmount);
}

/**
 * 总览区间汇总与按日趋势（PRD §5.1）：筛选仅影响成交额/订单数；
 * 敞口与报价健康为不受筛选影响的当前快照（另行读取）。
 */
export function selectOverviewSummary(
  data: DataState,
  range: OverviewRange,
  now: number,
): OverviewSummary {
  const { start, end } = resolveRange(range, now);
  const inRange = data.orders.filter((order) => order.createdAt >= start && order.createdAt <= end);

  const buckets = new Map<string, OverviewPoint>();
  for (
    let cursor = dayjs(start).startOf('day');
    cursor.valueOf() <= end;
    cursor = cursor.add(1, 'day')
  ) {
    const dayKey = cursor.format('YYYYMMDD');
    buckets.set(dayKey, {
      dayKey,
      label: cursor.format('MM-DD'),
      volumeUsd: '0.00',
      orderCount: 0,
    });
  }

  let total = D('0');
  for (const order of inRange) {
    const dayKey = dayjs(order.createdAt).format('YYYYMMDD');
    const bucket = buckets.get(dayKey);
    if (bucket === undefined) continue; // 理论上不可达（区间已覆盖）
    const usd = usdLegOf(order);
    total = total.plus(usd);
    bucket.volumeUsd = roundCcy(D(bucket.volumeUsd).plus(usd), 'USD').toFixed(2);
    bucket.orderCount += 1;
  }

  return {
    volumeUsd: roundCcy(total, 'USD').toFixed(2),
    orderCount: inRange.length,
    series: [...buckets.values()],
  };
}

// ---------- 运营：报价健康（§7.3 / §10.3） ----------

export type QuoteHealthStatus = 'NORMAL' | 'FALLBACK' | 'NO_QUOTE';

export interface QuoteHealthRow {
  pairId: PairId;
  status: QuoteHealthStatus;
  /** 选中渠道（无有效报价时为空） */
  selectedChannelId?: string;
  selectedChannelName?: string;
  /** 选中渠道原始价采集时间（无则空） */
  collectedAt?: number;
  /** 剩余新鲜度毫秒（≥0；无有效报价为 0） */
  remainingMs: number;
  /** 是否命中非首位渠道（回退） */
  fallback: boolean;
}

/**
 * 各币对报价健康快照（不受总览筛选影响）。
 * 判定与报价引擎同口径（§6.2 步骤 2）：渠道启用 && 报价启用 && 有价格 && 10min 内；
 * 命中非首位渠道标记为 FALLBACK，逐渠道全不满足为 NO_QUOTE。
 */
export function selectQuoteHealth(data: DataState, now: number): QuoteHealthRow[] {
  return PAIR_IDS.map((pairId) => {
    const routingIds =
      data.fxConfig.routing.find((rule) => rule.pairId === pairId)?.channelIds ?? [];
    for (const [index, channelId] of routingIds.entries()) {
      const channel = data.fxConfig.channels.find((item) => item.id === channelId);
      if (channel === undefined || !channel.enabled) continue;

      // 该渠道该币对最新一条原始价（同采集时间保留先出现者，与报价引擎一致）
      let latest: { mid: DecimalStr; collectedAt: number; quoteEnabled: boolean } | undefined;
      for (const price of data.fxConfig.rawPrices) {
        if (price.pairId !== pairId || price.channelId !== channelId) continue;
        if (latest === undefined || price.collectedAt > latest.collectedAt) latest = price;
      }
      if (latest === undefined || !latest.quoteEnabled) continue;
      if (now - latest.collectedAt > PRICE_FRESH_MS) continue;

      return {
        pairId,
        status: index > 0 ? 'FALLBACK' : 'NORMAL',
        selectedChannelId: channelId,
        selectedChannelName: channel.name,
        collectedAt: latest.collectedAt,
        remainingMs: Math.max(0, PRICE_FRESH_MS - (now - latest.collectedAt)),
        fallback: index > 0,
      };
    }
    return { pairId, status: 'NO_QUOTE', remainingMs: 0, fallback: false };
  });
}

// ---------- 运营：交易与钱包列表 ----------

export interface ProfitOrderFilter {
  status?: ProfitOrder['status'];
  pairId?: PairId;
}

/** 收益单列表（§7.3）：按收益单号排序保证稳定；筛选状态/币对 */
export function selectProfitOrders(data: DataState, filter: ProfitOrderFilter = {}): ProfitOrder[] {
  return selectLedger(data)
    .profitOrders.filter((po) => filter.status === undefined || po.status === filter.status)
    .filter((po) => filter.pairId === undefined || po.pairId === filter.pairId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** 某币对未平 lot（敞口页展开明细）：按 FIFO 顺序（openedAt, orderId） */
export function selectPairLots(data: DataState, pairId: PairId): OpenLot[] {
  return selectLedger(data)
    .lots.filter((lot) => lot.pairId === pairId)
    .sort((a, b) => a.openedAt - b.openedAt || a.orderId.localeCompare(b.orderId));
}

export interface OpsBillFilter {
  customerId?: string;
  type?: BillType;
  /** epoch 毫秒，含端点 */
  from?: number;
  to?: number;
}

/** 运营账单列表（§10.3 钱包账单页）：客户/类型/日期筛选，时间倒序 */
export function getOpsBills(data: DataState, filter: OpsBillFilter = {}): WalletBill[] {
  return data.bills
    .filter((bill) => filter.customerId === undefined || bill.customerId === filter.customerId)
    .filter((bill) => filter.type === undefined || bill.type === filter.type)
    .filter((bill) => filter.from === undefined || bill.createdAt >= filter.from)
    .filter((bill) => filter.to === undefined || bill.createdAt <= filter.to)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
