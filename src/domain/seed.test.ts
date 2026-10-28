import { beforeAll, describe, expect, it } from 'vitest';
import { nextId } from './ids';
import { D } from './money';
import { buildSeed } from './seed';
import type { DataState } from './types';

// seed 金样（设计文档 §5.4）：到账金额、18 个钱包余额、流水恒等、工单/平仓状态
const ANCHOR = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeAll(async () => {
  state = await buildSeed(ANCHOR);
});

function balanceOf(customerId: string, currency: string): string {
  const wallet = state.wallets.find((w) => w.customerId === customerId && w.currency === currency);
  if (!wallet) throw new Error(`wallet not found: ${customerId} ${currency}`);
  return wallet.balance;
}

describe('订单与到账金额金样（9 笔，按时间序）', () => {
  it('订单数量与目标金额逐笔匹配', () => {
    expect(state.orders).toHaveLength(9);
    expect(state.orders.map((o) => o.targetAmount)).toEqual([
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

  it('客户成交价 = bid/ask（含 50bps 每侧点差）', () => {
    const first = state.orders[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(D(first.snapshot.clientRate).eq('0.9154')).toBe(true);
    expect(D(first.snapshot.mid).eq('0.92')).toBe(true);
    expect(first.snapshot.channelId).toBe('CH-01');
    // 快照采集时间 = 成交前 2 分钟
    expect(first.snapshot.executedAt - first.snapshot.priceCollectedAt).toBe(120_000);
  });
});

describe('18 个钱包最终余额金样', () => {
  it('C-001', () => {
    expect(D(balanceOf('C-001', 'USD')).eq('20500')).toBe(true);
    expect(D(balanceOf('C-001', 'EUR')).eq('8203.15')).toBe(true);
    expect(D(balanceOf('C-001', 'GBP')).eq('7686.45')).toBe(true);
    expect(D(balanceOf('C-001', 'JPY')).eq('500000')).toBe(true);
    expect(D(balanceOf('C-001', 'CNH')).eq('20000')).toBe(true);
    expect(D(balanceOf('C-001', 'HKD')).eq('30000')).toBe(true);
  });

  it('C-002（EX-2/EX-5/EX-8 均为买 USD，USD 腿为入账）', () => {
    expect(D(balanceOf('C-002', 'USD')).eq('20776.87')).toBe(true);
    expect(D(balanceOf('C-002', 'EUR')).eq('7259.92')).toBe(true);
    expect(D(balanceOf('C-002', 'GBP')).eq('2000')).toBe(true);
    expect(D(balanceOf('C-002', 'JPY')).eq('600000')).toBe(true);
    expect(D(balanceOf('C-002', 'CNH')).eq('50000')).toBe(true);
    expect(D(balanceOf('C-002', 'HKD')).eq('2149.94')).toBe(true);
  });

  it('C-003', () => {
    expect(D(balanceOf('C-003', 'USD')).eq('7800')).toBe(true);
    expect(D(balanceOf('C-003', 'EUR')).eq('2000')).toBe(true);
    expect(D(balanceOf('C-003', 'GBP')).eq('1000')).toBe(true);
    expect(D(balanceOf('C-003', 'JPY')).eq('2752220')).toBe(true);
    expect(D(balanceOf('C-003', 'CNH')).eq('26262.53')).toBe(true);
    expect(D(balanceOf('C-003', 'HKD')).eq('8108.38')).toBe(true);
  });
});

describe('账本一致性', () => {
  it('余额 = Σ 流水（逐客户逐币种恒等）', () => {
    expect(state.wallets).toHaveLength(18);
    for (const wallet of state.wallets) {
      const sum = state.bills
        .filter((b) => b.customerId === wallet.customerId && b.currency === wallet.currency)
        .reduce((acc, b) => acc.plus(b.amount), D(0));
      expect(sum.eq(wallet.balance), `${wallet.customerId} ${wallet.currency}`).toBe(true);
    }
  });

  it('流水条数 = 18 期初 + 18 交易腿 + 2 充值', () => {
    expect(state.bills).toHaveLength(38);
  });

  it('每条流水的 balanceAfter = balanceBefore + amount', () => {
    for (const bill of state.bills) {
      expect(D(bill.balanceBefore).plus(bill.amount).eq(bill.balanceAfter), bill.id).toBe(true);
    }
  });
});

describe('平仓批次与工单', () => {
  it('2 个批次：1 成功 1 失败，各 1 次尝试且事实中分配占位为空', () => {
    expect(state.closeBatches).toHaveLength(2);
    const [first, second] = state.closeBatches;
    expect(first?.status).toBe('SUCCESS');
    expect(second?.status).toBe('FAILED');
    expect(second?.attempts[0]?.failReason).toBe('模拟失败（演示）');
    for (const batch of state.closeBatches) {
      expect(batch.attempts).toHaveLength(1);
      expect(batch.attempts[0]?.allocations).toEqual([]);
    }
  });

  it('3 个工单覆盖三种状态，共 5 条消息', () => {
    expect(state.tickets.map((t) => t.status).sort()).toEqual(['CLOSED', 'IN_PROGRESS', 'PENDING']);
    expect(state.ticketMessages).toHaveLength(5);
  });
});

describe('汇率运营配置', () => {
  it('3 渠道（1 停用）、5 币对、15 条采集价、5 条路由与加点', () => {
    expect(state.fxConfig.channels).toHaveLength(3);
    expect(state.fxConfig.channels.filter((c) => !c.enabled)).toHaveLength(1);
    expect(state.fxConfig.pairs).toHaveLength(5);
    expect(state.fxConfig.rawPrices).toHaveLength(15);
    expect(state.fxConfig.routing).toHaveLength(5);
    expect(state.fxConfig.markups.every((m) => m.halfSpreadBps === 50)).toBe(true);
    expect(state.fxConfig.collectSteps).toHaveLength(5);
  });

  it('USD/JPY 主渠道为 CH-02；采集价带采集时间', () => {
    const jpyRouting = state.fxConfig.routing.find((r) => r.pairId === 'USD/JPY');
    expect(jpyRouting?.channelIds[0]).toBe('CH-02');
    for (const price of state.fxConfig.rawPrices) {
      expect(price.collectedAt).toBe(ANCHOR - 120_000);
      expect(price.quoteEnabled).toBe(true);
    }
  });
});

describe('编号计数器与既有事实一致（防新单重号）', () => {
  it('TK 计数器回填到既有最大值：新工单为当日 -0002，不与预置重号', () => {
    const { id } = nextId(state.counters, 'TK', ANCHOR);
    expect(state.tickets.some((t) => t.id === id)).toBe(false);
    expect(id).toBe('TK-20261028-0002');
  });
});
