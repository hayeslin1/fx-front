import { beforeAll, describe, expect, it } from 'vitest';
import { buildLedger } from '../ledger';
import { D } from '../money';
import { getQuote } from '../pricing';
import { buildSeed } from '../seed';
import type { DataState, Order, Quote } from '../types';
import { closeBatchCommands } from './close-batch.service';
import { exchangeCommands } from './exchange.service';

// M2 集成：领域服务写入事实 → 账本重放派生（§12.1 要求服务单测无法覆盖的跨层断言）。
// 明确不 mock ledger：用真实 buildSeed 事实 + 服务产生的增量，验证“事实→派生”闭环。

const ANCHOR = new Date(2026, 9, 28, 10, 0, 0).getTime();
let base: DataState;

beforeAll(async () => {
  base = await buildSeed(ANCHOR);
});

function ledgerOf(state: DataState) {
  return buildLedger({ orders: state.orders, closeBatches: state.closeBatches });
}

/** 文档 EX-n 为业务编号，seed 订单按时间序生成；用业务键显式定位，禁止依赖下标 */
function orderByBusinessKey(
  state: DataState,
  pairId: Order['pairId'],
  direction: Order['direction'],
  usdSourceAmount: string,
): Order {
  const order = state.orders.find(
    (o) =>
      o.pairId === pairId &&
      o.direction === direction &&
      o.sourceAmount === usdSourceAmount &&
      o.sourceCurrency === 'USD',
  );
  if (!order) throw new Error(`order not found: ${pairId} ${direction} ${usdSourceAmount}`);
  return order;
}

function quoteFor(state: DataState, sourceAmount: string): Quote {
  const result = getQuote(
    state.fxConfig,
    { pairId: 'USD/EUR', direction: 'SELL_USD', sourceAmount },
    ANCHOR,
  );
  if (!result.ok) throw new Error(`quote failed: ${result.reason}`);
  return result.quote;
}

describe('exchange.submit → buildLedger 闭环', () => {
  it('成功兑换生成 1 个新 lot + 1 张待实现收益单，敞口同步增加', async () => {
    const state = structuredClone(base);
    const before = ledgerOf(state);
    const beforeNet = before.pairExposure.find((p) => p.pairId === 'USD/EUR');

    const result = await exchangeCommands
      .submit('C-001', quoteFor(state, '100.00'))
      .run(state, { now: ANCHOR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 事实层：1 张新订单，带 quoteId 与完整快照
    expect(result.next.orders).toHaveLength(state.orders.length + 1);
    const order = result.next.orders.at(-1);
    expect(order).toBeDefined();
    if (!order) return;
    expect(order.quoteId).toBeDefined();
    expect(order.snapshot.executedAt).toBe(ANCHOR);

    // 派生层：新增 1 个 lot + 1 张收益单
    const after = ledgerOf(result.next);
    const newLots = after.lots.filter((lot) => lot.orderId === order.id);
    expect(newLots).toHaveLength(1);
    expect(D(newLots[0]?.usdRemaining ?? '0').eq('100')).toBe(true);

    const profitOrder = after.profitOrders.find((p) => p.customerOrderId === order.id);
    expect(profitOrder).toBeDefined();
    expect(profitOrder?.id).toBe(`PO-${order.id}`);
    expect(profitOrder?.status).toBe('PENDING');
    // 账本金额为 Decimal 规范字符串（非展示层固定 2 位）
    expect(profitOrder?.usdNotional).toBe('100');
    expect(D(profitOrder?.realizedPnl ?? '1').isZero()).toBe(true);

    const afterNet = after.pairExposure.find((p) => p.pairId === 'USD/EUR');
    expect(D(afterNet?.netUsd ?? '').eq(D(beforeNet?.netUsd ?? '0').plus(100))).toBe(true);
    expect(afterNet?.side).toBe('LONG');
  });
});

describe('close-batch → buildLedger 闭环', () => {
  it('FAILED 尝试只记事实：账本/敞口/可平金额与提交前完全一致', async () => {
    const state = structuredClone(base);
    const before = ledgerOf(state);
    const exposure = before.pairExposure.find((p) => p.pairId === 'USD/EUR');
    expect(exposure).toBeDefined();
    if (!exposure) return;

    const result = await closeBatchCommands
      .createBatch({
        pairId: 'USD/EUR',
        usdAmount: '300.00',
        channelId: 'CH-01',
        simulatedResult: 'FAILED',
        failReason: '模拟失败（集成测试）',
        exposure: { netUsd: exposure.netUsd, side: exposure.side },
      })
      .run(state, { now: ANCHOR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.next.closeBatches).toHaveLength(state.closeBatches.length + 1);
    expect(result.next.closeBatches.at(-1)?.status).toBe('FAILED');

    const after = ledgerOf(result.next);
    expect(after).toEqual(before); // 失败尝试不进入事件流
    const afterExposure = after.pairExposure.find((p) => p.pairId === 'USD/EUR');
    expect(afterExposure?.closeableUsd).toBe(exposure.closeableUsd);
  });

  it('SUCCESS 按 FIFO 冲减且 100% 归属：EX-1 结算、EX-3 部分实现', async () => {
    const state = structuredClone(base);
    const before = ledgerOf(state);
    const exposure = before.pairExposure.find((p) => p.pairId === 'USD/EUR');
    expect(exposure).toBeDefined();
    if (!exposure) return;

    const ex1 = orderByBusinessKey(state, 'USD/EUR', 'SELL_USD', '2000.00');
    const ex3 = orderByBusinessKey(state, 'USD/EUR', 'SELL_USD', '1500.00');

    const result = await closeBatchCommands
      .createBatch({
        pairId: 'USD/EUR',
        usdAmount: '300.00',
        channelId: 'CH-01',
        simulatedResult: 'SUCCESS',
        exposure: { netUsd: exposure.netUsd, side: exposure.side },
      })
      .run(state, { now: ANCHOR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = ledgerOf(result.next);
    const po1 = after.profitOrders.find((p) => p.customerOrderId === ex1.id);
    const po3 = after.profitOrders.find((p) => p.customerOrderId === ex3.id);

    // 基线：EX-1 已由 CB-1 平 1000（+0.20 自然对冲 +0.20 渠道），剩余 200
    // 本次 CH-01 锁定 mid=0.9200：EX-1 余 200 按建仓价 0.9200 冲减 → 损益 0，结算
    expect(po1?.usdOpen).toBe('0');
    expect(po1?.status).toBe('SETTLED');
    expect(D(po1?.realizedPnl ?? '0').eq('0.4')).toBe(true);
    // 剩余 100 冲减 EX-3（建仓 0.9195）：100×(0.9200−0.9195)=+0.05
    expect(po3?.usdOpen).toBe('1400');
    expect(po3?.status).toBe('PARTIAL');
    expect(D(po3?.realizedPnl ?? '0').eq('0.05')).toBe(true);

    // 渠道平仓 100% 归属，不 50/50：本次两条明细 share = pnl
    const allocations = (po3?.allocations ?? []).filter(
      (a) => a.source === 'CHANNEL_CLOSE' && a.createdAt === ANCHOR,
    );
    expect(allocations).toHaveLength(1);
    expect(D(allocations[0]?.share ?? '').eq(allocations[0]?.pnl ?? '')).toBe(true);

    const afterExposure = after.pairExposure.find((p) => p.pairId === 'USD/EUR');
    expect(D(afterExposure?.closeableUsd ?? '').eq(D(exposure.closeableUsd).minus(300))).toBe(true);
  });
});
