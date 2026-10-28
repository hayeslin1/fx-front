import { describe, expect, it } from 'vitest';
import { DAY, HOUR, SEED_TRADES } from '@/mocks/seed-script';
import { DEFAULT_HALF_SPREAD_BPS } from './constants';
import { applyCloseSuccessToLots, applyOrderToLots } from './fifo';
import { D, ccyDp, deriveClientRate, roundCcy } from './money';
import { profitOrderStatus } from './pnl';
import { QUOTE_CCY } from './constants';
import type {
  Currency,
  OpenLot,
  Order,
  PairId,
  PnlAllocation,
  TradeDirection,
} from './types';

// FIFO 敞口与自然对冲/渠道平仓（设计文档 §6.4/§6.5、§12.1）

const T = new Date(2026, 9, 28, 10, 0, 0).getTime();

/** 构造订单夹具：USD 腿显式给定，客户成交价按 50bps 点差推导（与 seed/在线成交一致） */
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
  // 卖 USD：来源即 USD 腿；买 USD：目标即 USD 腿（§6.2 步骤 6 舍入后的记账值）
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

function mustLot(lots: OpenLot[], orderId: string): OpenLot {
  const lot = lots.find((item) => item.orderId === orderId);
  if (!lot) throw new Error(`lot not found: ${orderId}`);
  return lot;
}

function allocationsOf(
  allocations: PnlAllocation[],
  profitOrderId: string,
): PnlAllocation[] {
  return allocations.filter((item) => item.profitOrderId === profitOrderId);
}

function shareOf(allocations: PnlAllocation[], profitOrderId: string): string {
  return allocationsOf(allocations, profitOrderId)
    .reduce((acc, item) => acc.plus(item.share), D(0))
    .toString();
}

function usdLegOf(order: Order): string {
  return order.direction === 'SELL_USD' ? order.sourceAmount : order.targetAmount;
}

describe('applyOrderToLots：同向不匹配', () => {
  it('同币对同方向订单各自建 lot，不产生任何损益分配', () => {
    const first = makeOrder({
      id: 'EX-A',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const r1 = applyOrderToLots([], first);
    expect(r1.lots).toHaveLength(1);
    expect(r1.lots[0]?.side).toBe('LONG');
    expect(r1.allocations).toHaveLength(0);
    expect(r1.matches).toHaveLength(0);

    const second = makeOrder({
      id: 'EX-B',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '50.00',
      mid: '0.9300',
      at: T + 1_000,
    });
    const r2 = applyOrderToLots(r1.lots, second);
    expect(r2.lots).toHaveLength(2);
    expect(r2.allocations).toHaveLength(0);
    expect(r2.matches).toHaveLength(0);
  });
});

describe('applyOrderToLots：反向匹配 FIFO 顺序', () => {
  it('即使传入数组乱序，也按 openedAt 升序先匹配更早的 lot', () => {
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
      direction: 'SELL_USD',
      usdAmount: '50.00',
      mid: '0.9300',
      at: T + 1_000,
    });
    const built = applyOrderToLots(applyOrderToLots([], a).lots, b).lots;
    // 故意把较新的 lot 放在数组前面，验证 FIFO 由 openedAt 而非数组顺序决定
    const reversed = [mustLot(built, 'EX-B'), mustLot(built, 'EX-A')];

    const close = makeOrder({
      id: 'EX-C',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '120.00',
      mid: '0.9210',
      at: T + 2_000,
    });
    const result = applyOrderToLots(reversed, close);

    expect(result.matches.map((m) => m.lotOrderId)).toEqual(['EX-A', 'EX-B']);
    expect(result.matches.map((m) => m.usdMatched)).toEqual(['100', '20']);
    expect(result.matches.map((m) => m.fifoSeq)).toEqual([1, 2]);

    // EX-A 被平尽关闭；EX-B 消耗 20 后保留 30，新订单全额匹配不建 lot
    expect(result.lots.some((lot) => lot.orderId === 'EX-A')).toBe(false);
    expect(mustLot(result.lots, 'EX-B').usdRemaining).toBe('30');
    expect(result.lots.some((lot) => lot.orderId === 'EX-C')).toBe(false);

    // 多头损益：100×(0.9210−0.9200)=+0.10；20×(0.9210−0.9300)=−0.18，各 50/50
    expect(D(shareOf(result.allocations, 'PO-EX-A')).eq('0.05')).toBe(true);
    // 新订单跨两段：0.05 + (−0.09) = −0.04
    expect(D(shareOf(result.allocations, 'PO-EX-C')).eq('-0.04')).toBe(true);
    expect(D(shareOf(result.allocations, 'PO-EX-B')).eq('-0.09')).toBe(true);
  });
});

describe('applyOrderToLots：部分匹配与多 lot 逐段匹配', () => {
  it('新订单大于反向敞口：旧 lot 平尽，未匹配余量建同方向新 lot', () => {
    const long = makeOrder({
      id: 'EX-L',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const short = makeOrder({
      id: 'EX-S',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '150.00',
      mid: '0.9300',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], long).lots, short);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.usdMatched).toBe('100');
    expect(result.lots).toHaveLength(1);
    const residual = result.lots[0];
    expect(residual?.orderId).toBe('EX-S');
    expect(residual?.side).toBe('SHORT');
    expect(residual?.usdPrincipal).toBe('150');
    expect(residual?.usdRemaining).toBe('50');
    expect(residual?.openMid).toBe('0.93');
    // 100×(0.93−0.92)=1.00，各 0.50
    expect(D(shareOf(result.allocations, 'PO-EX-L')).eq('0.5')).toBe(true);
    expect(D(shareOf(result.allocations, 'PO-EX-S')).eq('0.5')).toBe(true);
  });

  it('旧 lot 大于新订单：旧 lot 保留部分余量，新订单不建 lot', () => {
    const long = makeOrder({
      id: 'EX-L',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const short = makeOrder({
      id: 'EX-S',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '40.00',
      mid: '0.9250',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], long).lots, short);

    expect(mustLot(result.lots, 'EX-L').usdRemaining).toBe('60');
    expect(result.lots).toHaveLength(1);
    expect(result.matches).toHaveLength(1);
  });

  it('一笔新订单跨多个旧 lot 逐段匹配，fifoSeq 连续', () => {
    const entries = [
      { id: 'EX-A', usd: '10.00', mid: '0.9200', at: T },
      { id: 'EX-B', usd: '20.00', mid: '0.9210', at: T + 1_000 },
      { id: 'EX-C', usd: '30.00', mid: '0.9220', at: T + 2_000 },
    ];
    let lots: OpenLot[] = [];
    for (const entry of entries) {
      lots = applyOrderToLots(
        lots,
        makeOrder({
          id: entry.id,
          pairId: 'USD/EUR',
          direction: 'SELL_USD',
          usdAmount: entry.usd,
          mid: entry.mid,
          at: entry.at,
        }),
      ).lots;
    }

    const short = makeOrder({
      id: 'EX-D',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '35.00',
      mid: '0.9230',
      at: T + 3_000,
    });
    const result = applyOrderToLots(lots, short);

    expect(result.matches.map((m) => m.lotOrderId)).toEqual(['EX-A', 'EX-B', 'EX-C']);
    expect(result.matches.map((m) => m.usdMatched)).toEqual(['10', '20', '5']);
    expect(result.matches.map((m) => m.fifoSeq)).toEqual([1, 2, 3]);
    expect(result.allocations).toHaveLength(6);
    // 仅 EX-C 剩余 25，新订单全额匹配不建 lot
    expect(result.lots).toHaveLength(1);
    expect(mustLot(result.lots, 'EX-C').usdRemaining).toBe('25');
    // 逐段多头损益：0.03 / 0.04 / 0.005
    expect(D(result.matches[0]?.pnl ?? '0').eq('0.03')).toBe(true);
    expect(D(result.matches[1]?.pnl ?? '0').eq('0.04')).toBe(true);
    expect(D(result.matches[2]?.pnl ?? '0').eq('0.005')).toBe(true);
  });
});

describe('applyOrderToLots：50/50 分摊与尾差', () => {
  it('可整除时对立两单各得一半，均不标记尾差', () => {
    const long = makeOrder({
      id: 'EX-OLD',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '800.00',
      mid: '0.9200',
      at: T,
    });
    const short = makeOrder({
      id: 'EX-NEW',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '800.00',
      mid: '0.9205',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], long).lots, short);

    expect(D(shareOf(result.allocations, 'PO-EX-OLD')).eq('0.2')).toBe(true);
    expect(D(shareOf(result.allocations, 'PO-EX-NEW')).eq('0.2')).toBe(true);
    expect(result.allocations.every((item) => !item.isRemainder)).toBe(true);
  });

  it('损益基准价用成交时原始中间价，绝不用含点差的客户成交价', () => {
    const long = makeOrder({
      id: 'EX-OLD',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '800.00',
      mid: '0.9200',
      at: T,
    });
    const short = makeOrder({
      id: 'EX-NEW',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '800.00',
      mid: '0.9205',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], long).lots, short);

    // 新订单客户成交价为 0.9251025（mid×1.005，展示 4 位为 0.9251），
    // 若误用客户成交价会把点差收益混入平台损益
    expect(D(short.snapshot.clientRate).eq('0.9251025')).toBe(true);
    expect(result.allocations[0]?.openMid).toBe('0.92');
    expect(result.allocations[0]?.closeMid).toBe('0.9205');
    expect(D(result.allocations[0]?.pnl ?? '0').eq('0.4')).toBe(true);
  });

  it('内部精度除不尽时，尾差归 FIFO 更早（被抵销）的收益单并标记', () => {
    // 3 × (1.25333333333333333333 − 0.92) = 0.99999999999999999999（20 位奇数）
    // ÷2 需要 21 位精度，产生 1e-20 尾差
    const long = makeOrder({
      id: 'EX-OLD',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '3',
      mid: '0.9200',
      at: T,
    });
    const short = makeOrder({
      id: 'EX-NEW',
      pairId: 'USD/EUR',
      direction: 'BUY_USD',
      usdAmount: '3',
      mid: '1.25333333333333333333',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], long).lots, short);

    const oldShare = allocationsOf(result.allocations, 'PO-EX-OLD');
    const newShare = allocationsOf(result.allocations, 'PO-EX-NEW');
    expect(oldShare).toHaveLength(1);
    expect(newShare).toHaveLength(1);

    const oldAlloc = oldShare[0];
    const newAlloc = newShare[0];
    expect(oldAlloc?.isRemainder).toBe(true);
    expect(newAlloc?.isRemainder).toBe(false);
    expect(D(oldAlloc?.share ?? '0').gt(D(newAlloc?.share ?? '0'))).toBe(true);
    // 尾差只改变归属，不改变总额
    expect(
      D(oldAlloc?.share ?? '0')
        .plus(newAlloc?.share ?? '0')
        .eq(oldAlloc?.pnl ?? '0'),
    ).toBe(true);
    expect(D(oldAlloc?.pnl ?? '0').eq('0.99999999999999999999')).toBe(true);
  });
});

describe('applyOrderToLots：多头/空头损益双向断言', () => {
  it('空头被平仓且平仓价更低时盈利', () => {
    const short = makeOrder({
      id: 'EX-SHORT',
      pairId: 'USD/HKD',
      direction: 'BUY_USD',
      usdAmount: '400.00',
      mid: '7.8110',
      at: T,
    });
    const long = makeOrder({
      id: 'EX-LONG',
      pairId: 'USD/HKD',
      direction: 'SELL_USD',
      usdAmount: '400.00',
      mid: '7.8100',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], short).lots, long);

    // 空头损益 = 400×(7.8110−7.8100)=+0.40，各 0.20
    expect(D(result.matches[0]?.pnl ?? '0').eq('0.4')).toBe(true);
    expect(D(shareOf(result.allocations, 'PO-EX-SHORT')).eq('0.2')).toBe(true);
    expect(D(shareOf(result.allocations, 'PO-EX-LONG')).eq('0.2')).toBe(true);
  });

  it('空头被平仓且平仓价更高时亏损', () => {
    const short = makeOrder({
      id: 'EX-SHORT',
      pairId: 'USD/HKD',
      direction: 'BUY_USD',
      usdAmount: '1000.00',
      mid: '7.8100',
      at: T,
    });
    const long = makeOrder({
      id: 'EX-LONG',
      pairId: 'USD/HKD',
      direction: 'SELL_USD',
      usdAmount: '1000.00',
      mid: '7.8110',
      at: T + 1_000,
    });
    const result = applyOrderToLots(applyOrderToLots([], short).lots, long);

    expect(D(result.matches[0]?.pnl ?? '0').eq('-1')).toBe(true);
    expect(D(shareOf(result.allocations, 'PO-EX-SHORT')).eq('-0.5')).toBe(true);
  });
});

describe('applyCloseSuccessToLots：渠道平仓 100% 归属', () => {
  it('按 FIFO 冲减净多头，每段损益全额归属对应收益单，不做 50/50', () => {
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
      direction: 'SELL_USD',
      usdAmount: '200.00',
      mid: '0.9300',
      at: T + 1_000,
    });
    const built = applyOrderToLots(applyOrderToLots([], a).lots, b).lots;

    const result = applyCloseSuccessToLots(built, {
      pairId: 'USD/EUR',
      usdAmount: '150.00',
      lockedMid: '0.9202',
      attemptId: 'CB-A1',
      at: T + 2_000,
    });

    expect(result.allocations).toHaveLength(2);
    expect(result.allocations.map((item) => item.source)).toEqual([
      'CHANNEL_CLOSE',
      'CHANNEL_CLOSE',
    ]);
    expect(result.allocations.map((item) => item.fifoSeq)).toEqual([1, 2]);
    expect(result.allocations.map((item) => item.profitOrderId)).toEqual([
      'PO-EX-A',
      'PO-EX-B',
    ]);
    // 100% 归属：share 恒等于该段 pnl
    for (const item of result.allocations) {
      expect(D(item.share).eq(item.pnl)).toBe(true);
      expect(item.isRemainder).toBe(false);
      expect(item.refId).toBe('CB-A1');
    }
    // A: 100×0.0002=+0.02；B: 50×(0.9202−0.9300)=−0.49
    expect(D(result.allocations[0]?.pnl ?? '0').eq('0.02')).toBe(true);
    expect(D(result.allocations[1]?.pnl ?? '0').eq('-0.49')).toBe(true);
    expect(result.lots.some((lot) => lot.orderId === 'EX-A')).toBe(false);
    expect(mustLot(result.lots, 'EX-B').usdRemaining).toBe('150');
  });

  it('净空头时自动冲减 SHORT lot（方向由净敞口推导）', () => {
    const short = makeOrder({
      id: 'EX-S',
      pairId: 'USD/HKD',
      direction: 'BUY_USD',
      usdAmount: '1000.00',
      mid: '7.8110',
      at: T,
    });
    const built = applyOrderToLots([], short).lots;

    const result = applyCloseSuccessToLots(built, {
      pairId: 'USD/HKD',
      usdAmount: '400.00',
      lockedMid: '7.8100',
      attemptId: 'CB-A2',
      at: T + 1_000,
    });

    expect(result.allocations).toHaveLength(1);
    expect(D(result.allocations[0]?.pnl ?? '0').eq('0.4')).toBe(true);
    expect(mustLot(result.lots, 'EX-S').usdRemaining).toBe('600');
  });

  it('金额超过实际可平敞口时只消费存在部分，不产生负 lot', () => {
    const long = makeOrder({
      id: 'EX-L',
      pairId: 'USD/EUR',
      direction: 'SELL_USD',
      usdAmount: '100.00',
      mid: '0.9200',
      at: T,
    });
    const built = applyOrderToLots([], long).lots;

    const result = applyCloseSuccessToLots(built, {
      pairId: 'USD/EUR',
      usdAmount: '150.00',
      lockedMid: '0.9202',
      attemptId: 'CB-A3',
      at: T + 1_000,
    });

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.usdMatched).toBe('100');
    expect(result.lots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §5.4 种子脚本夹具：9 笔订单 + CB-1 成功批次，断言收益金样
// ---------------------------------------------------------------------------

const ANCHOR = new Date(2026, 9, 28, 10, 0, 0).getTime();
const CLOSE_AT = ANCHOR - 2 * DAY + 3 * HOUR;

// SEED_TRADES 按时间序排列，而文档编号按业务序（EX-3 晚于 EX-4），
// 因此用“币对|方向|来源金额”显式映射回 §5.4 的订单号（收益单金样以编号为准）。
const SEED_ORDER_IDS: Record<string, string> = {
  'USD/EUR|SELL_USD|2000.00': 'EX-1',
  'USD/EUR|BUY_USD|740.08': 'EX-2',
  'USD/EUR|SELL_USD|1500.00': 'EX-3',
  'USD/JPY|SELL_USD|5000.00': 'EX-4',
  'USD/JPY|BUY_USD|300000': 'EX-5',
  'USD/GBP|SELL_USD|6000.00': 'EX-6',
  'USD/CNH|BUY_USD|8737.47': 'EX-7',
  'USD/HKD|BUY_USD|7850.06': 'EX-8',
  'USD/HKD|SELL_USD|400.00': 'EX-9',
};

/** 按 seed 脚本重建 9 笔订单（与 domain/seed.ts 的报价/到账计算口径一致） */
function buildSeedOrders(): Order[] {
  return SEED_TRADES.map((spec) => {
    const pairId = spec.pairId;
    const quote = QUOTE_CCY[pairId];
    const mid = D(spec.mid);
    const clientRate = deriveClientRate(mid, DEFAULT_HALF_SPREAD_BPS, spec.direction);
    const sourceCurrency: Currency = spec.direction === 'SELL_USD' ? 'USD' : quote;
    const targetCurrency: Currency = spec.direction === 'SELL_USD' ? quote : 'USD';
    const sourceAmount = D(spec.sourceAmount);
    const targetAmount =
      spec.direction === 'SELL_USD'
        ? roundCcy(sourceAmount.mul(clientRate), targetCurrency)
        : roundCcy(sourceAmount.div(clientRate), targetCurrency);
    const at = ANCHOR + spec.offsetMs;
    const docId =
      SEED_ORDER_IDS[`${spec.pairId}|${spec.direction}|${spec.sourceAmount}`];
    if (!docId) {
      throw new Error(
        `missing seed order id: ${spec.pairId}|${spec.direction}|${spec.sourceAmount}`,
      );
    }

    return {
      id: docId,
      customerId: spec.customerId,
      pairId,
      direction: spec.direction,
      sourceCurrency,
      targetCurrency,
      sourceAmount: sourceAmount.toFixed(ccyDp(sourceCurrency)),
      targetAmount: targetAmount.toFixed(ccyDp(targetCurrency)),
      fee: '0',
      status: 'COMPLETED',
      snapshot: {
        clientRate: clientRate.toString(),
        mid: mid.toString(),
        channelId: spec.channelId,
        priceCollectedAt: at - 120_000,
        executedAt: at,
      },
      createdAt: at,
    };
  });
}

interface SeedReplay {
  lots: OpenLot[];
  allocations: PnlAllocation[];
  orders: Order[];
}

/** 按时间序重放 9 笔订单，并在 CB-1 时点插入渠道平仓成功事件 */
function replaySeed(): SeedReplay {
  const orders = buildSeedOrders();
  let lots: OpenLot[] = [];
  const allocations: PnlAllocation[] = [];
  let closeApplied = false;

  const applyClose = (): void => {
    const result = applyCloseSuccessToLots(lots, {
      pairId: 'USD/EUR',
      usdAmount: '1000.00',
      lockedMid: '0.9202',
      attemptId: 'CB-1-A1',
      at: CLOSE_AT,
    });
    lots = result.lots;
    allocations.push(...result.allocations);
    closeApplied = true;
  };

  for (const order of orders) {
    if (!closeApplied && order.createdAt > CLOSE_AT) applyClose();
    const result = applyOrderToLots(lots, order);
    lots = result.lots;
    allocations.push(...result.allocations);
  }
  if (!closeApplied) applyClose();

  return { lots, allocations, orders };
}

describe('§5.4 种子金样：自然对冲、渠道平仓与结算状态', () => {
  const { lots, allocations, orders } = replaySeed();

  function usdOpenOf(orderId: string): string {
    return lots.find((lot) => lot.orderId === orderId)?.usdRemaining ?? '0';
  }

  function statusOf(orderId: string): string {
    const order = orders.find((item) => item.id === orderId);
    if (!order) throw new Error(`order not found: ${orderId}`);
    return profitOrderStatus(usdLegOf(order), usdOpenOf(orderId));
  }

  it('9 笔订单到账金额与文档一致（夹具自检）', () => {
    expect(orders.map((order) => order.targetAmount)).toEqual([
      '1830.80',
      '800.00',
      '752220',
      '1372.35',
      '4686.45',
      '1976.87',
      '1200.00',
      '1000.00',
      '3108.38',
    ]);
  });

  it('净敞口与文档金样一致（不同币对各算各的）', () => {
    const netOf = (pairId: PairId) =>
      lots
        .filter((lot) => lot.pairId === pairId)
        .reduce(
          (acc, lot) =>
            lot.side === 'LONG' ? acc.plus(lot.usdRemaining) : acc.minus(lot.usdRemaining),
          D(0),
        );

    expect(netOf('USD/EUR').eq('1700')).toBe(true);
    expect(netOf('USD/GBP').eq('6000')).toBe(true);
    expect(netOf('USD/JPY').eq('3023.13')).toBe(true);
    expect(netOf('USD/CNH').eq('-1200')).toBe(true);
    expect(netOf('USD/HKD').eq('-600')).toBe(true);
  });

  it('自然对冲金样：USD/JPY 各半 −197.687，USD/HKD 各半 +0.20', () => {
    expect(D(shareOf(allocations, 'PO-EX-4')).eq('-197.687')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-5')).eq('-197.687')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-8')).eq('0.2')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-9')).eq('0.2')).toBe(true);
  });

  it('渠道平仓金样：CB-1 按 FIFO 命中 EX-1，100% 归属且 USD 未平降为 200', () => {
    const channel = allocationsOf(allocations, 'PO-EX-1').filter(
      (item) => item.source === 'CHANNEL_CLOSE',
    );
    expect(channel).toHaveLength(1);
    const allocation = channel[0];
    expect(allocation?.refId).toBe('CB-1-A1');
    expect(allocation?.fifoSeq).toBe(1);
    expect(D(allocation?.usdMatched ?? '0').eq('1000')).toBe(true);
    // §6.4 公式：1000×(0.9202−0.9200)=+0.20；与文档表格的 ×10 数值差异见测试注释
    expect(D(allocation?.pnl ?? '0').eq('0.2')).toBe(true);
    expect(D(allocation?.share ?? '0').eq(allocation?.pnl ?? '0')).toBe(true);
    expect(allocation?.isRemainder).toBe(false);
    expect(D(usdOpenOf('EX-1')).eq('200')).toBe(true);
  });

  it('收益单状态与未平本金金样', () => {
    const expected: Array<[string, string, string]> = [
      // [订单, 状态, 未平 USD]
      ['EX-1', 'PARTIAL', '200'],
      ['EX-2', 'SETTLED', '0'],
      ['EX-3', 'PENDING', '1500'],
      ['EX-4', 'PARTIAL', '3023.13'],
      ['EX-5', 'SETTLED', '0'],
      ['EX-6', 'PENDING', '6000'],
      ['EX-7', 'PENDING', '1200'],
      ['EX-8', 'PARTIAL', '600'],
      ['EX-9', 'SETTLED', '0'],
    ];
    for (const [orderId, status, open] of expected) {
      expect(statusOf(orderId), orderId).toBe(status);
      expect(D(usdOpenOf(orderId)).eq(open), orderId).toBe(true);
    }
  });

  it('累计已实现损益按报价币分组，不跨币对相加', () => {
    // §5.4 表格 USD/EUR 行写作 +4.00，但按 §6.4 公式应为 +0.40：
    // 自然对冲 800×0.0005=0.40（各 0.20）+ 渠道平仓 1000×0.0002=0.20 = PO-EX-1 0.40。
    // 本测试按公式断言，文档表格的 ×10 笔误在实现报告中标注。
    expect(D(shareOf(allocations, 'PO-EX-1')).eq('0.4')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-2')).eq('0.2')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-3')).eq('0')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-6')).eq('0')).toBe(true);
    expect(D(shareOf(allocations, 'PO-EX-7')).eq('0')).toBe(true);

    // 各收益单的分摊明细币种必须等于其订单币对的报价币；不同报价币的金额不合并
    const pairByOrder = new Map(orders.map((order) => [order.id, order.pairId]));
    for (const allocation of allocations) {
      const orderId = allocation.profitOrderId.replace(/^PO-/, '');
      const pairId = pairByOrder.get(orderId);
      expect(pairId).toBeDefined();
      if (!pairId) continue;
      expect(allocation.currency).toBe(QUOTE_CCY[pairId]);
    }
    const currencies = new Set(allocations.map((item) => item.currency));
    expect(currencies).toEqual(new Set<Currency>(['EUR', 'JPY', 'HKD']));
  });
});
