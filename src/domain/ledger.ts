import { PAIR_IDS, QUOTE_CCY } from './constants';
import { applyCloseSuccessToLots, applyOrderToLots } from './fifo';
import { deriveProfitOrderId } from './ids';
import { D, roundCcy } from './money';
import { profitOrderStatus } from './pnl';
import type {
  CloseAttempt,
  CloseBatch,
  DecimalStr,
  OpenLot,
  Order,
  PairId,
  PlatformSide,
  PnlAllocation,
  ProfitOrder,
} from './types';

// 账本重放引擎（设计文档 §5.1 / §6.7 / 附录 B）。
// 输入只含业务事实（订单 + 平仓批次/尝试），输出全部为派生账本；
// 纯函数：不读时钟、不读写 store、不生成随机值，时间一律来自事实快照。

export interface LedgerFacts {
  orders: Order[];
  closeBatches: CloseBatch[];
}

/** 单币对净敞口（附录 B：五币对全量数组，正数 = 平台多头） */
export interface PairExposure {
  pairId: PairId;
  /** LONG 剩余合计 − SHORT 剩余合计，带符号、USD 2 位 */
  netUsd: DecimalStr;
  side: PlatformSide | 'FLAT';
  /** |netUsd|，运营平仓可平上限（§6.5） */
  closeableUsd: DecimalStr;
}

export interface Ledger {
  /** 重放结束后仍有余量的订单级敞口（已平尽的 lot 不出现） */
  lots: OpenLot[];
  /** 每笔订单恰好一张，顺序与订单事件重放顺序一致 */
  profitOrders: ProfitOrder[];
  pairExposure: PairExposure[];
}

/** 事件流元素：订单成交或一次成功的平仓尝试（失败尝试不进入事件流） */
type LedgerEvent =
  | { kind: 'ORDER'; id: string; at: number; order: Order }
  | {
      kind: 'CLOSE';
      id: string;
      at: number;
      batch: CloseBatch;
      attempt: CloseAttempt;
    };

/** 字符串字典序比较（用码点而非 locale，保证跨环境确定性） */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 重放确定性排序（§5.1 条件 1 / §6.7）：
 * 时间升序；同一时刻按事件 id（订单 id / 尝试 id）字典序。
 */
function compareEvents(a: LedgerEvent, b: LedgerEvent): number {
  if (a.at !== b.at) return a.at - b.at;
  return compareIds(a.id, b.id);
}

/** lot 的确定性输出顺序：建仓时间升序，同刻按订单 id */
function compareLots(a: OpenLot, b: OpenLot): number {
  if (a.openedAt !== b.openedAt) return a.openedAt - b.openedAt;
  return compareIds(a.orderId, b.orderId);
}

/**
 * 分配明细的确定性顺序：事件发生时间升序 → FIFO 分段序号 → 明细 id。
 * WHY 显式排序而非依赖 push 顺序：同一收益单的分摊来自多个事件，
 * 固定排序才能在任意事实数组顺序下得到相同输出。
 */
function compareAllocations(a: PnlAllocation, b: PnlAllocation): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.fifoSeq !== b.fifoSeq) return a.fifoSeq - b.fifoSeq;
  return compareIds(a.id, b.id);
}

/** 订单的 USD 腿记账金额：卖 USD 取来源、买 USD 取目标（§6.2 步骤 6 舍入后值） */
function usdLegOf(order: Order): DecimalStr {
  return order.direction === 'SELL_USD' ? order.sourceAmount : order.targetAmount;
}

/** 合并两类事实为统一事件流；失败尝试按 §6.5 跳过，不产生任何账本影响 */
function buildEventStream(facts: LedgerFacts): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const order of facts.orders) {
    events.push({ kind: 'ORDER', id: order.id, at: order.createdAt, order });
  }
  for (const batch of facts.closeBatches) {
    for (const attempt of batch.attempts) {
      if (attempt.status !== 'SUCCESS') continue;
      events.push({
        kind: 'CLOSE',
        id: attempt.id,
        at: attempt.createdAt,
        batch,
        attempt,
      });
    }
  }
  return events.sort(compareEvents);
}

/**
 * 账本重放（§6.7）：
 * 1. 订单事件走 §6.4（FIFO 自然对冲 + 50/50 分摊）；
 * 2. 成功平仓尝试走 §6.5（按 FIFO 冲减、损益 100% 归属）；
 * 3. 由最终 lot 推导每单未平本金与五币对净敞口，由分配明细汇总收益单损益。
 *
 * WHY 不复用持久化的 allocations：CloseAttempt.allocations 只是占位，
 * 账本必须每次从事实完整重建，才能保证“订单改了、敞口没改”类漂移不可能发生。
 */
export function buildLedger(facts: LedgerFacts): Ledger {
  const events = buildEventStream(facts);

  let lots: OpenLot[] = [];
  const allocations: PnlAllocation[] = [];

  for (const event of events) {
    if (event.kind === 'ORDER') {
      const result = applyOrderToLots(lots, event.order);
      lots = result.lots;
      allocations.push(...result.allocations);
      continue;
    }
    // 平仓金额取批次事实，锁定价与执行时间取本次尝试快照（§6.5 重试重新锁价）
    const result = applyCloseSuccessToLots(lots, {
      pairId: event.batch.pairId,
      usdAmount: event.batch.usdAmount,
      lockedMid: event.attempt.lockedMid,
      attemptId: event.attempt.id,
      at: event.attempt.executedAt,
    });
    lots = result.lots;
    allocations.push(...result.allocations);
  }

  // 输出顺序固定，避免调用方观察到与输入数组顺序相关的差异
  lots = [...lots].sort(compareLots);

  // 每单未平本金 = 其残留 lot 余量之和；已被全额对冲的订单没有 lot，即为 0
  const openByOrder = new Map<string, ReturnType<typeof D>>();
  for (const lot of lots) {
    const current = openByOrder.get(lot.orderId) ?? D(0);
    openByOrder.set(lot.orderId, current.plus(lot.usdRemaining));
  }

  // 按收益单归集明细；每笔订单恰好一张，id 由订单号 1:1 派生（§6.6）
  const allocationsByProfitOrder = new Map<string, PnlAllocation[]>();
  for (const allocation of allocations) {
    const list = allocationsByProfitOrder.get(allocation.profitOrderId);
    if (list) list.push(allocation);
    else allocationsByProfitOrder.set(allocation.profitOrderId, [allocation]);
  }
  for (const list of allocationsByProfitOrder.values()) list.sort(compareAllocations);

  const profitOrders: ProfitOrder[] = [];
  for (const event of events) {
    if (event.kind !== 'ORDER') continue;
    const { order } = event;
    const id = deriveProfitOrderId(order.id);
    const usdNotional = usdLegOf(order);
    const usdOpen = (openByOrder.get(order.id) ?? D(0)).toString();
    const own = allocationsByProfitOrder.get(id) ?? [];
    // 高精度累加、不逐段舍入（D7）；不同报价币的收益单各自独立，不相加
    const realizedPnl = own.reduce((acc, item) => acc.plus(item.share), D(0)).toString();

    profitOrders.push({
      id,
      customerOrderId: order.id,
      pairId: order.pairId,
      side: order.direction === 'SELL_USD' ? 'LONG' : 'SHORT',
      usdNotional: D(usdNotional).toString(),
      usdOpen,
      realizedPnl,
      pnlCurrency: QUOTE_CCY[order.pairId],
      status: profitOrderStatus(usdNotional, usdOpen),
      allocations: own,
    });
  }

  // 五币对全量敞口（附录 B）：正 = 多头（客户净卖 USD），负 = 空头
  const pairExposure: PairExposure[] = PAIR_IDS.map((pairId) => {
    const net = lots.reduce((acc, lot) => {
      if (lot.pairId !== pairId) return acc;
      const amount = D(lot.usdRemaining);
      return lot.side === 'LONG' ? acc.plus(amount) : acc.minus(amount);
    }, D(0));
    const rounded = roundCcy(net, 'USD');
    return {
      pairId,
      netUsd: rounded.toFixed(2),
      side: net.gt(0) ? 'LONG' : net.lt(0) ? 'SHORT' : 'FLAT',
      closeableUsd: rounded.abs().toFixed(2),
    };
  });

  return { lots, profitOrders, pairExposure };
}
