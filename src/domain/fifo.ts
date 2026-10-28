import { QUOTE_CCY } from './constants';
import { deriveProfitOrderId } from './ids';
import { D, type Decimal } from './money';
import { segmentPnl, splitHalf } from './pnl';
import type {
  Currency,
  DecimalStr,
  OpenLot,
  Order,
  PairId,
  PlatformSide,
  PnlAllocation,
} from './types';

// FIFO 敞口台账（设计文档 §6.4/§6.5、附录 B）。
// 纯函数：接收当前 lot 快照，返回新快照 + 损益分配明细，便于重放引擎逐事件调用。

/** 一段 FIFO 匹配的审计结果（自然对冲时由 ledger 汇总，不直接持久化） */
export interface MatchSegment {
  pairId: PairId;
  /** 被匹配旧 lot 的平台方向 */
  side: PlatformSide;
  /** 本次平仓/新订单 id */
  matchedOrderId: string;
  /** 被匹配旧 lot 的订单 id */
  lotOrderId: string;
  /** 1 起，按 openedAt 升序 */
  fifoSeq: number;
  usdMatched: DecimalStr;
  openMid: DecimalStr;
  closeMid: DecimalStr;
  /** 该段总损益（高精度，未分摊） */
  pnl: DecimalStr;
  /** 损益币种 = 币对报价币 */
  currency: Currency;
  at: number;
}

/**
 * FIFO 排序：openedAt 升序；同一时刻用 orderId 字典序兜底，
 * 保证重放结果确定（设计文档 §6.7 事件流同刻按 id 排序的口径）。
 */
function compareFifo(a: OpenLot, b: OpenLot): number {
  if (a.openedAt !== b.openedAt) return a.openedAt - b.openedAt;
  return a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0;
}

/**
 * 确定性分摊明细 id（附录 D：AL- + 订单号/尝试号 + 序号）。
 * WHY 同时带归属单与对手单：同一订单可能被多笔反向订单分多次匹配，
 * 仅用自身订单号 + 序号会在跨事件重放时碰撞。
 */
function allocationId(ownerOrderId: string, refId: string, fifoSeq: number): string {
  return `AL-${ownerOrderId}-${refId}-${fifoSeq}`;
}

/** 订单的 USD 腿记账金额：卖 USD 取来源金额，买 USD 取目标金额（§6.2 步骤 6 舍入后值） */
function usdLegOf(order: Order): Decimal {
  return D(order.direction === 'SELL_USD' ? order.sourceAmount : order.targetAmount);
}

/**
 * 新订单入账（设计文档 §6.4）：
 * 1. 同币对反向未平 lot 按 FIFO 逐段匹配，每段按原始中间价计损益；
 * 2. 自然对冲损益 50/50 分摊，尾差归 FIFO 较早（被抵销）收益单；
 * 3. 旧 lot 匹配到 0 即关闭；新订单未匹配部分生成同方向新 lot。
 *
 * 返回的 lots 已剔除未平为 0 的 lot；其他币对/同方向 lot 原样保留。
 */
export function applyOrderToLots(
  lots: OpenLot[],
  order: Order,
): { lots: OpenLot[]; allocations: PnlAllocation[]; matches: MatchSegment[] } {
  const pairId = order.pairId;
  const side: PlatformSide = order.direction === 'SELL_USD' ? 'LONG' : 'SHORT';
  const currency = QUOTE_CCY[pairId];
  const closeMid = D(order.snapshot.mid);
  const usdNotional = usdLegOf(order);
  const newProfitOrderId = deriveProfitOrderId(order.id);
  const createdAt = order.snapshot.executedAt;

  // 防御性复制，避免调用方快照被原地修改
  const nextLots: OpenLot[] = lots.map((lot) => ({ ...lot }));

  // 只匹配同币对、反方向、仍有未平本金的 lot；FIFO 顺序在匹配前一次性排定
  const opposite = nextLots
    .map((lot, index) => ({ lot, index }))
    .filter(({ lot }) => lot.pairId === pairId && lot.side !== side && D(lot.usdRemaining).gt(0))
    .sort((a, b) => compareFifo(a.lot, b.lot));

  const allocations: PnlAllocation[] = [];
  const matches: MatchSegment[] = [];
  let remainingUsd = usdNotional;
  let fifoSeq = 0;

  for (const { lot, index } of opposite) {
    if (remainingUsd.lte(0)) break;
    fifoSeq += 1;

    const lotRemaining = D(lot.usdRemaining);
    const usdMatched = remainingUsd.lt(lotRemaining) ? remainingUsd : lotRemaining;
    const openMid = D(lot.openMid);
    const pnl = segmentPnl(lot.side, usdMatched, openMid, closeMid);
    const { first, second, remainderToFirst } = splitHalf(pnl);

    // 被抵销（FIFO 较早）的收益单：拿 first；有尾差时 isRemainder 标在这一条
    allocations.push({
      id: allocationId(lot.orderId, order.id, fifoSeq),
      profitOrderId: deriveProfitOrderId(lot.orderId),
      source: 'NATURAL_HEDGE',
      refId: order.id,
      counterpartyOrderId: order.id,
      fifoSeq,
      usdMatched: usdMatched.toString(),
      openMid: lot.openMid,
      closeMid: order.snapshot.mid,
      pnl: pnl.toString(),
      share: first.toString(),
      isRemainder: remainderToFirst,
      currency,
      createdAt,
    });

    // 新订单的收益单：拿 second
    allocations.push({
      id: allocationId(order.id, lot.orderId, fifoSeq),
      profitOrderId: newProfitOrderId,
      source: 'NATURAL_HEDGE',
      refId: lot.orderId,
      counterpartyOrderId: lot.orderId,
      fifoSeq,
      usdMatched: usdMatched.toString(),
      openMid: lot.openMid,
      closeMid: order.snapshot.mid,
      pnl: pnl.toString(),
      share: second.toString(),
      isRemainder: false,
      currency,
      createdAt,
    });

    matches.push({
      pairId,
      side: lot.side,
      matchedOrderId: order.id,
      lotOrderId: lot.orderId,
      fifoSeq,
      usdMatched: usdMatched.toString(),
      openMid: lot.openMid,
      closeMid: order.snapshot.mid,
      pnl: pnl.toString(),
      currency,
      at: createdAt,
    });

    nextLots[index] = {
      ...lot,
      usdRemaining: lotRemaining.minus(usdMatched).toString(),
    };
    remainingUsd = remainingUsd.minus(usdMatched);
  }

  // 已平尽的旧 lot 关闭；新订单余量生成同方向新 lot
  const kept = nextLots.filter((lot) => D(lot.usdRemaining).gt(0));
  if (remainingUsd.gt(0)) {
    kept.push({
      orderId: order.id,
      pairId,
      side,
      openMid: order.snapshot.mid,
      usdPrincipal: usdNotional.toString(),
      usdRemaining: remainingUsd.toString(),
      openedAt: order.createdAt,
    });
  }

  return { lots: kept, allocations, matches };
}

/**
 * 渠道平仓成功入账（设计文档 §6.5）：
 * 按 FIFO 冲减同币对“净敞口方向”的未平 lot，损益 100% 归属该 lot 的收益单，
 * 不做 50/50 分摊。
 *
 * 签名不含 side：平仓方向由传入 lot 的净敞口自动推导（净多头→冲减 LONG，
 * 净空头→冲减 SHORT），与 CloseBatch.side 的“与净敞口相反”语义一致。
 * 调用方负责校验 usdAmount ≤ 可平金额；本函数只消费实际存在的敞口。
 */
export function applyCloseSuccessToLots(
  lots: OpenLot[],
  params: {
    pairId: PairId;
    usdAmount: DecimalStr;
    lockedMid: DecimalStr;
    attemptId: string;
    at: number;
  },
): { lots: OpenLot[]; allocations: PnlAllocation[] } {
  const { pairId, usdAmount, lockedMid, attemptId, at } = params;
  const currency = QUOTE_CCY[pairId];
  const closeMid = D(lockedMid);
  let remainingUsd = D(usdAmount);

  const nextLots: OpenLot[] = lots.map((lot) => ({ ...lot }));
  const indexByOrder = new Map<string, number>();
  nextLots.forEach((lot, index) => indexByOrder.set(lot.orderId, index));

  if (remainingUsd.lte(0)) return { lots: nextLots, allocations: [] };

  // 净敞口 = Σ 多头未平 − Σ 空头未平；平台 FIFO 账本同币对只会保留单边敞口
  const pairLots = nextLots.filter(
    (lot) => lot.pairId === pairId && D(lot.usdRemaining).gt(0),
  );
  const netUsd = pairLots.reduce((acc, lot) => {
    const amount = D(lot.usdRemaining);
    return lot.side === 'LONG' ? acc.plus(amount) : acc.minus(amount);
  }, D(0));
  if (netUsd.eq(0)) return { lots: nextLots, allocations: [] };

  const closeSide: PlatformSide = netUsd.gt(0) ? 'LONG' : 'SHORT';
  const candidates = pairLots
    .filter((lot) => lot.side === closeSide)
    .sort(compareFifo);

  const allocations: PnlAllocation[] = [];
  let fifoSeq = 0;

  for (const lot of candidates) {
    if (remainingUsd.lte(0)) break;
    fifoSeq += 1;

    const lotRemaining = D(lot.usdRemaining);
    const usdMatched = remainingUsd.lt(lotRemaining) ? remainingUsd : lotRemaining;
    const pnl = segmentPnl(closeSide, usdMatched, D(lot.openMid), closeMid);

    // 渠道平仓不 50/50：share 即该段全部损益，永不标记尾差
    allocations.push({
      id: allocationId(lot.orderId, attemptId, fifoSeq),
      profitOrderId: deriveProfitOrderId(lot.orderId),
      source: 'CHANNEL_CLOSE',
      refId: attemptId,
      fifoSeq,
      usdMatched: usdMatched.toString(),
      openMid: lot.openMid,
      closeMid: lockedMid,
      pnl: pnl.toString(),
      share: pnl.toString(),
      isRemainder: false,
      currency,
      createdAt: at,
    });

    const index = indexByOrder.get(lot.orderId);
    if (index !== undefined) {
      nextLots[index] = {
        ...lot,
        usdRemaining: lotRemaining.minus(usdMatched).toString(),
      };
    }
    remainingUsd = remainingUsd.minus(usdMatched);
  }

  return {
    lots: nextLots.filter((lot) => D(lot.usdRemaining).gt(0)),
    allocations,
  };
}
