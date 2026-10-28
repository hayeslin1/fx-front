import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_HALF_SPREAD_BPS, QUOTE_CCY } from './constants';
import { deriveProfitOrderId } from './ids';
import { buildLedger, type Ledger } from './ledger';
import { D, ccyDp, deriveClientRate, roundCcy } from './money';
import { buildSeed } from './seed';
import type {
  CloseBatch,
  Currency,
  Order,
  PairId,
  PnlAllocation,
  ProfitOrder,
  SimulatedResult,
  TradeDirection,
} from './types';

// 账本重放引擎（设计文档 §5.1 / §5.4 / §6.7、附录 B、§12.1）

const ANCHOR = new Date(2026, 9, 28, 12, 0, 0).getTime();
const T = ANCHOR - 5 * 86_400_000;

/** 构造订单夹具：USD 腿显式给定，客户成交价按 50bps 点差推导（与 seed/在线成交口径一致） */
function makeOrder(input: {
  id: string;
  pairId: PairId;
  direction: TradeDirection;
  usdAmount: string;
  mid: string;
  at: number;
}): Order {
  const quote = QUOTE_CCY[input.pairId];
  const mid = D(input.mid);
  const clientRate = deriveClientRate(mid, DEFAULT_HALF_SPREAD_BPS, input.direction);
  const sourceCurrency: Currency = input.direction === 'SELL_USD' ? 'USD' : quote;
  const targetCurrency: Currency = input.direction === 'SELL_USD' ? quote : 'USD';
  const usd = D(input.usdAmount);
  const sourceAmount =
    input.direction === 'SELL_USD' ? usd : roundCcy(usd.div(clientRate), sourceCurrency);
  const targetAmount =
    input.direction === 'SELL_USD' ? roundCcy(usd.mul(clientRate), targetCurrency) : usd;

  return {
    id: input.id,
    customerId: 'C-TEST',
    pairId: input.pairId,
    direction: input.direction,
    sourceCurrency,
    targetCurrency,
    sourceAmount: sourceAmount.toFixed(ccyDp(sourceCurrency)),
    targetAmount: targetAmount.toFixed(ccyDp(targetCurrency)),
    fee: '0',
    status: 'COMPLETED',
    snapshot: {
      clientRate: clientRate.toString(),
      mid: mid.toString(),
      channelId: 'CH-01',
      priceCollectedAt: input.at - 120_000,
      executedAt: input.at,
    },
    createdAt: input.at,
  };
}

/** 构造单次尝试的平仓批次夹具（side 不参与重放，方向由现有 lot 推导） */
function makeCloseBatch(input: {
  id: string;
  pairId: PairId;
  usdAmount: string;
  lockedMid: string;
  result: SimulatedResult;
  at: number;
  attemptId?: string;
}): CloseBatch {
  const attemptId = input.attemptId ?? `${input.id}-A1`;
  return {
    id: input.id,
    pairId: input.pairId,
    side: 'SHORT',
    usdAmount: D(input.usdAmount).toFixed(2),
    channelId: 'CH-01',
    createdAt: input.at,
    status: input.result,
    attempts: [
      {
        id: attemptId,
        index: 1,
        simulatedResult: input.result,
        status: input.result,
        channelId: 'CH-01',
        lockedMid: D(input.lockedMid).toString(),
        priceCollectedAt: input.at - 120_000,
        createdAt: input.at,
        executedAt: input.at,
        allocations: [],
      },
    ],
  };
}

function profitOrderOf(ledger: Ledger, orderId: string): ProfitOrder {
  const profitOrder = ledger.profitOrders.find(
    (item) => item.customerOrderId === orderId,
  );
  if (!profitOrder) throw new Error(`profit order not found: ${orderId}`);
  return profitOrder;
}

function exposureOf(ledger: Ledger, pairId: PairId) {
  const exposure = ledger.pairExposure.find((item) => item.pairId === pairId);
  if (!exposure) throw new Error(`exposure not found: ${pairId}`);
  return exposure;
}

function sharesOf(allocations: PnlAllocation[]): string {
  return allocations.reduce((acc, item) => acc.plus(item.share), D(0)).toString();
}

describe('buildLedger：空事实与失败尝试', () => {
  it('空事实输出空账本与五币对全 FLAT 敞口', () => {
    const ledger = buildLedger({ orders: [], closeBatches: [] });

    expect(ledger.lots).toEqual([]);
    expect(ledger.profitOrders).toEqual([]);
    expect(ledger.pairExposure).toEqual([
      { pairId: 'USD/EUR', netUsd: '0.00', side: 'FLAT', closeableUsd: '0.00' },
      { pairId: 'USD/GBP', netUsd: '0.00', side: 'FLAT', closeableUsd: '0.00' },
      { pairId: 'USD/JPY', netUsd: '0.00', side: 'FLAT', closeableUsd: '0.00' },
      { pairId: 'USD/CNH', netUsd: '0.00', side: 'FLAT', closeableUsd: '0.00' },
      { pairId: 'USD/HKD', netUsd: '0.00', side: 'FLAT', closeableUsd: '0.00' },
    ]);
  });

  it('只有失败尝试时不产生任何账本变化（与无批次结果深等）', () => {
    const order = makeOrder({
      id: 'EX-L',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const failed = makeCloseBatch({
      id: 'CB-F',
      pairId: 'USD/EUR',
      usdAmount: '100.00',
      lockedMid: '0.9300',
      result: 'FAILED',
      at: T + 1_000,
    });

    const withFailed = buildLedger({ orders: [order], closeBatches: [failed] });
    const withoutBatch = buildLedger({ orders: [order], closeBatches: [] });

    expect(withFailed).toEqual(withoutBatch);
    expect(withFailed.profitOrders[0]?.allocations).toEqual([]);
    expect(withFailed.profitOrders[0]?.realizedPnl).toBe('0');
    expect(exposureOf(withFailed, 'USD/EUR').netUsd).toBe('100.00');
  });
});

describe('buildLedger：事件流确定性排序', () => {
  it('同刻订单按 id 字典序重放，与输入数组顺序无关', () => {
    const a = makeOrder({
      id: 'EX-A',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const b = makeOrder({
      id: 'EX-B',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '150.00',
      mid: '0.9400',
      at: T,
    });
    const c = makeOrder({
      id: 'EX-C',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '60.00',
      mid: '0.9500',
      at: T,
    });

    // 输入逆序，重放必须按 EX-A → EX-B → EX-C
    const ledger = buildLedger({ orders: [c, b, a], closeBatches: [] });

    // A 建多头 100；B 冲减 100 后余 50 空头；C 冲减空头 50 后余 10 多头
    expect(ledger.lots).toHaveLength(1);
    expect(ledger.lots[0]?.orderId).toBe('EX-C');
    expect(ledger.lots[0]?.side).toBe('LONG');
    expect(D(ledger.lots[0]?.usdRemaining ?? '0').eq('10')).toBe(true);
    expect(D(ledger.lots[0]?.openMid ?? '0').eq('0.95')).toBe(true);

    expect(D(profitOrderOf(ledger, 'EX-A').realizedPnl).eq('1')).toBe(true);
    expect(D(profitOrderOf(ledger, 'EX-B').realizedPnl).eq('0.75')).toBe(true);
    expect(D(profitOrderOf(ledger, 'EX-C').realizedPnl).eq('-0.25')).toBe(true);
    expect(profitOrderOf(ledger, 'EX-C').usdOpen).toBe('10');
    expect(profitOrderOf(ledger, 'EX-C').status).toBe('PARTIAL');
  });

  it('同刻尝试与订单按 id 字典序：尝试 id 在前则先执行平仓', () => {
    const base = makeOrder({
      id: 'EX-BASE',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T - 1_000,
    });
    const order = makeOrder({
      id: 'EX-MID',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '50.00',
      mid: '0.9300',
      at: T,
    });
    const batch = makeCloseBatch({
      id: 'CB-A1',
      pairId: 'USD/EUR',
      usdAmount: '100.00',
      lockedMid: '0.9400',
      result: 'SUCCESS',
      at: T,
    });

    const ledger = buildLedger({ orders: [order, base], closeBatches: [batch] });

    // "CB-A1-A1" < "EX-MID"：先整笔平掉 EX-BASE，再建 EX-MID 空头
    expect(ledger.lots).toHaveLength(1);
    expect(ledger.lots[0]?.orderId).toBe('EX-MID');
    expect(ledger.lots[0]?.side).toBe('SHORT');
    expect(D(ledger.lots[0]?.usdRemaining ?? '0').eq('50')).toBe(true);

    const baseProfit = profitOrderOf(ledger, 'EX-BASE');
    expect(baseProfit.status).toBe('SETTLED');
    expect(D(baseProfit.realizedPnl).eq('2')).toBe(true);
    expect(baseProfit.allocations).toHaveLength(1);
    expect(baseProfit.allocations[0]?.source).toBe('CHANNEL_CLOSE');
    expect(baseProfit.allocations[0]?.refId).toBe('CB-A1-A1');
    expect(profitOrderOf(ledger, 'EX-MID').realizedPnl).toBe('0');
  });
});

describe('buildLedger：跨多 lot 部分冲减', () => {
  it('一笔反向订单按 FIFO 跨两个 lot 逐段匹配，fifoSeq 连续', () => {
    const first = makeOrder({
      id: 'EX-L1',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const second = makeOrder({
      id: 'EX-L2',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '200.00',
      mid: '0.9300',
      at: T + 1_000,
    });
    const close = makeOrder({
      id: 'EX-CLOSE',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '250.00',
      mid: '0.9400',
      at: T + 2_000,
    });

    const ledger = buildLedger({ orders: [first, second, close], closeBatches: [] });

    const closeProfit = profitOrderOf(ledger, 'EX-CLOSE');
    expect(closeProfit.status).toBe('SETTLED');
    expect(closeProfit.allocations.map((item) => item.fifoSeq)).toEqual([1, 2]);
    expect(closeProfit.allocations.map((item) => item.usdMatched)).toEqual(['100', '150']);
    expect(D(closeProfit.realizedPnl).eq('1.75')).toBe(true);

    expect(profitOrderOf(ledger, 'EX-L1').status).toBe('SETTLED');
    expect(D(profitOrderOf(ledger, 'EX-L1').realizedPnl).eq('1')).toBe(true);

    const l2 = profitOrderOf(ledger, 'EX-L2');
    expect(l2.status).toBe('PARTIAL');
    expect(l2.usdOpen).toBe('50');
    expect(D(l2.realizedPnl).eq('0.75')).toBe(true);
  });
});

describe('buildLedger：重放幂等', () => {
  it('同一事实集重复调用结果深等；订单数组逆序亦深等', () => {
    const a = makeOrder({
      id: 'EX-A',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const b = makeOrder({
      id: 'EX-B',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '60.00',
      mid: '0.9300',
      at: T + 1_000,
    });
    const facts = { orders: [a, b], closeBatches: [] };

    expect(buildLedger(facts)).toEqual(buildLedger(facts));
    expect(buildLedger(facts)).toEqual(
      buildLedger({ orders: [b, a], closeBatches: [] }),
    );
  });
});

// ---------------------------------------------------------------------------
// §5.4 金样：buildSeed 生成事实 → buildLedger 推导账本
// ---------------------------------------------------------------------------

/** 文档业务编号 → 事实定位（SEED_TRADES 按时间排序，不得用数组下标推断 EX-n） */
interface DocOrderSpec {
  ex: string;
  pairId: PairId;
  direction: TradeDirection;
  sourceAmount: string;
}

const DOC_ORDERS: DocOrderSpec[] = [
  { ex: 'EX-1', pairId: 'USD/EUR', direction: 'SELL_USD', sourceAmount: '2000.00' },
  { ex: 'EX-2', pairId: 'USD/EUR', direction: 'BUY_USD', sourceAmount: '740.08' },
  { ex: 'EX-3', pairId: 'USD/EUR', direction: 'SELL_USD', sourceAmount: '1500.00' },
  { ex: 'EX-4', pairId: 'USD/JPY', direction: 'SELL_USD', sourceAmount: '5000.00' },
  { ex: 'EX-5', pairId: 'USD/JPY', direction: 'BUY_USD', sourceAmount: '300000' },
  { ex: 'EX-6', pairId: 'USD/GBP', direction: 'SELL_USD', sourceAmount: '6000.00' },
  { ex: 'EX-7', pairId: 'USD/CNH', direction: 'BUY_USD', sourceAmount: '8737.47' },
  { ex: 'EX-8', pairId: 'USD/HKD', direction: 'BUY_USD', sourceAmount: '7850.06' },
  { ex: 'EX-9', pairId: 'USD/HKD', direction: 'SELL_USD', sourceAmount: '400.00' },
];

interface DocProfitExpectation {
  ex: string;
  status: ProfitOrder['status'];
  realizedPnl: string;
  usdNotional: string;
  usdOpen: string;
  pnlCurrency: Currency;
}

const DOC_PROFITS: DocProfitExpectation[] = [
  { ex: 'EX-1', status: 'PARTIAL', realizedPnl: '0.4', usdNotional: '2000', usdOpen: '200', pnlCurrency: 'EUR' },
  { ex: 'EX-2', status: 'SETTLED', realizedPnl: '0.2', usdNotional: '800', usdOpen: '0', pnlCurrency: 'EUR' },
  { ex: 'EX-3', status: 'PENDING', realizedPnl: '0', usdNotional: '1500', usdOpen: '1500', pnlCurrency: 'EUR' },
  { ex: 'EX-4', status: 'PARTIAL', realizedPnl: '-197.687', usdNotional: '5000', usdOpen: '3023.13', pnlCurrency: 'JPY' },
  { ex: 'EX-5', status: 'SETTLED', realizedPnl: '-197.687', usdNotional: '1976.87', usdOpen: '0', pnlCurrency: 'JPY' },
  { ex: 'EX-6', status: 'PENDING', realizedPnl: '0', usdNotional: '6000', usdOpen: '6000', pnlCurrency: 'GBP' },
  { ex: 'EX-7', status: 'PENDING', realizedPnl: '0', usdNotional: '1200', usdOpen: '1200', pnlCurrency: 'CNH' },
  { ex: 'EX-8', status: 'PARTIAL', realizedPnl: '0.2', usdNotional: '1000', usdOpen: '600', pnlCurrency: 'HKD' },
  { ex: 'EX-9', status: 'SETTLED', realizedPnl: '0.2', usdNotional: '400', usdOpen: '0', pnlCurrency: 'HKD' },
];

function docSpecOf(ex: string): DocOrderSpec {
  const spec = DOC_ORDERS.find((item) => item.ex === ex);
  if (!spec) throw new Error(`missing doc spec: ${ex}`);
  return spec;
}

function findDocOrder(orders: Order[], spec: DocOrderSpec): Order {
  const order = orders.find(
    (item) =>
      item.pairId === spec.pairId &&
      item.direction === spec.direction &&
      D(item.sourceAmount).eq(spec.sourceAmount),
  );
  if (!order) {
    throw new Error(
      `seed order missing for ${spec.ex}: ${spec.pairId}|${spec.direction}|${spec.sourceAmount}`,
    );
  }
  return order;
}

describe('§5.4 金样：9 张收益单', () => {
  let ledger: Ledger;
  let orders: Order[];
  let closeBatches: CloseBatch[];

  beforeAll(async () => {
    const state = await buildSeed(ANCHOR);
    orders = state.orders;
    closeBatches = state.closeBatches;
    ledger = buildLedger({ orders, closeBatches });
  });

  it('每笔订单恰好一张收益单，id 由订单号 1:1 派生', () => {
    expect(ledger.profitOrders).toHaveLength(9);
    expect(ledger.profitOrders.map((item) => item.id).sort()).toEqual(
      orders.map((order) => deriveProfitOrderId(order.id)).sort(),
    );
    for (const profitOrder of ledger.profitOrders) {
      expect(profitOrder.id).toBe(deriveProfitOrderId(profitOrder.customerOrderId));
    }
  });

  it('9 张收益单状态、损益、USD 名义/未平与文档金样一致', () => {
    for (const expected of DOC_PROFITS) {
      const spec = docSpecOf(expected.ex);
      const order = findDocOrder(orders, spec);
      const profitOrder = profitOrderOf(ledger, order.id);

      expect(profitOrder.id, expected.ex).toBe(deriveProfitOrderId(order.id));
      expect(profitOrder.pairId, expected.ex).toBe(spec.pairId);
      expect(profitOrder.side, expected.ex).toBe(
        spec.direction === 'SELL_USD' ? 'LONG' : 'SHORT',
      );
      expect(D(profitOrder.usdNotional).eq(expected.usdNotional), expected.ex).toBe(true);
      expect(D(profitOrder.usdOpen).eq(expected.usdOpen), expected.ex).toBe(true);
      expect(D(profitOrder.realizedPnl).eq(expected.realizedPnl), expected.ex).toBe(true);
      expect(profitOrder.pnlCurrency, expected.ex).toBe(expected.pnlCurrency);
      expect(profitOrder.status, expected.ex).toBe(expected.status);
    }
  });

  it('五币对净敞口与文档金样一致（正=多头，closeable=|net|）', () => {
    expect(ledger.pairExposure).toEqual([
      { pairId: 'USD/EUR', netUsd: '1700.00', side: 'LONG', closeableUsd: '1700.00' },
      { pairId: 'USD/GBP', netUsd: '6000.00', side: 'LONG', closeableUsd: '6000.00' },
      { pairId: 'USD/JPY', netUsd: '3023.13', side: 'LONG', closeableUsd: '3023.13' },
      { pairId: 'USD/CNH', netUsd: '-1200.00', side: 'SHORT', closeableUsd: '1200.00' },
      { pairId: 'USD/HKD', netUsd: '-600.00', side: 'SHORT', closeableUsd: '600.00' },
    ]);
  });

  it('CB-1 成功按 FIFO 命中 EX-1（USD/EUR 平 1000），100% 归属且与自然对冲各 +0.20', () => {
    const ex1 = findDocOrder(orders, docSpecOf('EX-1'));
    const ex2 = findDocOrder(orders, docSpecOf('EX-2'));
    const profitOrder = profitOrderOf(ledger, ex1.id);

    const successBatch = closeBatches.find(
      (batch) =>
        batch.pairId === 'USD/EUR' &&
        batch.attempts.some((attempt) => attempt.status === 'SUCCESS'),
    );
    expect(successBatch).toBeDefined();
    const attemptId = successBatch?.attempts[0]?.id;
    expect(attemptId).toBeDefined();

    const channelAllocations = profitOrder.allocations.filter(
      (item) => item.source === 'CHANNEL_CLOSE',
    );
    expect(channelAllocations).toHaveLength(1);
    const channel = channelAllocations[0];
    expect(channel?.refId).toBe(attemptId);
    expect(channel?.fifoSeq).toBe(1);
    expect(D(channel?.usdMatched ?? '0').eq('1000')).toBe(true);
    expect(D(channel?.openMid ?? '0').eq('0.92')).toBe(true);
    expect(D(channel?.closeMid ?? '0').eq('0.9202')).toBe(true);
    expect(D(channel?.pnl ?? '0').eq('0.2')).toBe(true);
    expect(D(channel?.share ?? '0').eq(channel?.pnl ?? '0')).toBe(true);
    expect(channel?.isRemainder).toBe(false);

    const hedgeAllocations = profitOrder.allocations.filter(
      (item) => item.source === 'NATURAL_HEDGE',
    );
    expect(hedgeAllocations).toHaveLength(1);
    expect(hedgeAllocations[0]?.refId).toBe(ex2.id);
    expect(D(hedgeAllocations[0]?.share ?? '0').eq('0.2')).toBe(true);
    expect(D(profitOrder.realizedPnl).eq('0.4')).toBe(true);
  });

  it('CB-2 失败不影响任何数值（含收益单与敞口）', () => {
    const failedBatch = closeBatches.find((batch) =>
      batch.attempts.some((attempt) => attempt.status === 'FAILED'),
    );
    expect(failedBatch).toBeDefined();
    const failedAttemptId = failedBatch?.attempts[0]?.id ?? '';

    const withoutFailed = buildLedger({
      orders,
      closeBatches: closeBatches.filter((batch) => batch.id !== failedBatch?.id),
    });
    expect(withoutFailed).toEqual(ledger);

    const refIds = ledger.profitOrders.flatMap((item) =>
      item.allocations.map((allocation) => allocation.refId),
    );
    expect(refIds).not.toContain(failedAttemptId);
  });

  it('每张收益单的明细归属正确，share 之和 = realizedPnl，名义 − 已匹配 = 未平', () => {
    for (const profitOrder of ledger.profitOrders) {
      for (const allocation of profitOrder.allocations) {
        expect(allocation.profitOrderId).toBe(profitOrder.id);
      }

      // 明细按 (createdAt, fifoSeq, id) 升序，确定性可复现
      const sorted = [...profitOrder.allocations].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        if (a.fifoSeq !== b.fifoSeq) return a.fifoSeq - b.fifoSeq;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      expect(profitOrder.allocations).toEqual(sorted);

      expect(D(sharesOf(profitOrder.allocations)).eq(profitOrder.realizedPnl)).toBe(true);

      const matched = profitOrder.allocations.reduce(
        (acc, item) => acc.plus(item.usdMatched),
        D(0),
      );
      expect(
        D(profitOrder.usdNotional).minus(matched).eq(profitOrder.usdOpen),
        profitOrder.id,
      ).toBe(true);
    }
  });
});
