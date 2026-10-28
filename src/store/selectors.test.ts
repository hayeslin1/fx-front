import { beforeAll, describe, expect, it } from 'vitest';
import { D, roundCcy, type Decimal } from '@/domain/money';
import { buildSeed } from '@/domain/seed';
import type { DataState } from '@/domain/types';
import {
  getCustomerUsdValuation,
  getOpsBills,
  selectOverviewSummary,
  selectPairLots,
  selectProfitOrders,
  selectQuoteHealth,
} from './selectors';

// M4 运营选择器：总览序列/报价健康/收益单筛选/敞口明细/账单筛选（seed 金样）
const ANCHOR = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeAll(async () => {
  state = await buildSeed(ANCHOR);
});

describe('selectOverviewSummary（筛选仅作用于成交额/订单数）', () => {
  it('LAST_7D 覆盖全部 9 笔预置成交，成交额 = USD 腿合计 19,876.87', () => {
    const summary = selectOverviewSummary(state, { type: 'LAST_7D' }, ANCHOR);
    expect(summary.orderCount).toBe(9);
    expect(D(summary.volumeUsd).eq('19876.87')).toBe(true);
    expect(summary.series).toHaveLength(7);
    // 按日趋势金额合计恒等于区间合计
    const seriesTotal = summary.series.reduce<Decimal>(
      (acc, point) => acc.plus(D(point.volumeUsd)),
      D('0'),
    );
    expect(roundCcy(seriesTotal, 'USD').toFixed(2)).toBe(summary.volumeUsd);
  });

  it('TODAY 无预置成交（订单均在过去 5 天内），序列为单桶 0', () => {
    const summary = selectOverviewSummary(state, { type: 'TODAY' }, ANCHOR);
    expect(summary.orderCount).toBe(0);
    expect(summary.volumeUsd).toBe('0.00');
    expect(summary.series).toHaveLength(1);
  });

  it('CUSTOM 含端点：覆盖 T0-6d ~ 当前 = 9 笔', () => {
    const summary = selectOverviewSummary(
      state,
      { type: 'CUSTOM', dateFrom: ANCHOR - 6 * 24 * 3600 * 1000, dateTo: ANCHOR },
      ANCHOR,
    );
    expect(summary.orderCount).toBe(9);
  });
});

describe('selectQuoteHealth（与报价引擎同口径）', () => {
  it('预置配置下五币对全部 NORMAL，USD/JPY 首位即 CH-02', () => {
    const rows = selectQuoteHealth(state, ANCHOR);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === 'NORMAL')).toBe(true);
    const jpy = rows.find((row) => row.pairId === 'USD/JPY');
    expect(jpy?.selectedChannelId).toBe('CH-02');
    expect(jpy?.remainingMs).toBe(600_000 - 120_000);
  });

  it('停用主渠道 → 命中次渠道标记 FALLBACK；再停用次渠道 → NO_QUOTE', () => {
    const disabledPrimary = structuredClone(state);
    const ch01 = disabledPrimary.fxConfig.channels.find((c) => c.id === 'CH-01');
    if (ch01) ch01.enabled = false;
    const fallback = selectQuoteHealth(disabledPrimary, ANCHOR).find(
      (row) => row.pairId === 'USD/EUR',
    );
    expect(fallback?.status).toBe('FALLBACK');
    expect(fallback?.selectedChannelId).toBe('CH-02');
    expect(fallback?.fallback).toBe(true);

    const ch02 = disabledPrimary.fxConfig.channels.find((c) => c.id === 'CH-02');
    if (ch02) ch02.enabled = false;
    const none = selectQuoteHealth(disabledPrimary, ANCHOR).find((row) => row.pairId === 'USD/EUR');
    expect(none?.status).toBe('NO_QUOTE');
    expect(none?.selectedChannelId).toBeUndefined();
  });

  it('采集价超过 10 分钟 → 该渠道失效', () => {
    const stale = structuredClone(state);
    const jpyPrices = stale.fxConfig.rawPrices.filter(
      (price) => price.pairId === 'USD/JPY' && price.channelId === 'CH-02',
    );
    for (const price of jpyPrices) price.collectedAt = ANCHOR - 600_001;
    const row = selectQuoteHealth(stale, ANCHOR).find((item) => item.pairId === 'USD/JPY');
    expect(row?.selectedChannelId).toBe('CH-01');
    expect(row?.status).toBe('FALLBACK');
  });
});

describe('selectProfitOrders / selectPairLots / getOpsBills', () => {
  it('收益单：全量 9 张，SETTLED 3 张，USD/JPY 2 张', () => {
    expect(selectProfitOrders(state)).toHaveLength(9);
    expect(selectProfitOrders(state, { status: 'SETTLED' })).toHaveLength(3);
    expect(selectProfitOrders(state, { pairId: 'USD/JPY' })).toHaveLength(2);
  });

  it('USD/EUR 未平 lot 按 FIFO：EX-1 剩余 200 → EX-3 全部 1500', () => {
    const orderIdOf = (sourceAmount: string): string => {
      const order = state.orders.find(
        (item) =>
          item.pairId === 'USD/EUR' &&
          item.direction === 'SELL_USD' &&
          item.sourceAmount === sourceAmount,
      );
      if (!order) throw new Error(`order missing: ${sourceAmount}`);
      return order.id;
    };
    const lots = selectPairLots(state, 'USD/EUR');
    expect(lots.map((lot) => lot.orderId)).toEqual([orderIdOf('2000.00'), orderIdOf('1500.00')]);
    expect(D(lots[0]?.usdRemaining ?? '').eq('200')).toBe(true);
    expect(D(lots[1]?.usdRemaining ?? '').eq('1500')).toBe(true);
  });

  it('账单筛选：TOPUP_SELF 仅 1 笔（C-003 CNH 5000）；C-002 TOPUP_OPS 1 笔', () => {
    const selfTopUps = getOpsBills(state, { type: 'TOPUP_SELF' });
    expect(selfTopUps).toHaveLength(1);
    expect(selfTopUps[0]?.customerId).toBe('C-003');
    expect(D(selfTopUps[0]?.amount ?? '').eq('5000')).toBe(true);

    const opsTopUps = getOpsBills(state, { customerId: 'C-002', type: 'TOPUP_OPS' });
    expect(opsTopUps).toHaveLength(1);
  });
});

describe('getCustomerUsdValuation（D6：外币余额 ÷ 最新原始中间价）', () => {
  it('三维客户 ÷ 口径金样（曾误用 × 使 JPY 余额放大 151.2 倍）', () => {
    // C-001 推导：20500 + 7686.45/0.785 + 8203.15/0.92 + 500000/151.2 + 20000/7.245 + 30000/7.81
    expect(getCustomerUsdValuation(state, 'C-001')).toEqual({ totalUsd: '49116.76', missing: [] });
    expect(getCustomerUsdValuation(state, 'C-002').totalUsd).toBe('42360.70');
    expect(getCustomerUsdValuation(state, 'C-003').totalUsd).toBe('34113.43');
  });

  it('缺参考价的外币不计入并列入 missing；USD 恒按 1:1 计入', () => {
    const noEur = structuredClone(state);
    noEur.fxConfig.rawPrices = noEur.fxConfig.rawPrices.filter((p) => p.pairId !== 'USD/EUR');
    expect(getCustomerUsdValuation(noEur, 'C-001')).toEqual({
      totalUsd: '40200.29',
      missing: ['EUR'],
    });
  });
});
