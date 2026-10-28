import { beforeEach, describe, expect, it } from 'vitest';
import { D } from '../money';
import { buildSeed } from '../seed';
import type { Currency, DataState, Wallet } from '../types';
import { walletCommands } from './wallet.service';

// 钱包服务：充值入账原子性、金额/精度边界、余额链、运营权限与失败零变更
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

function stateJson(s: DataState): string {
  return JSON.stringify(s);
}

function walletOf(s: DataState, customerId: string, currency: Currency): Wallet {
  const wallet = s.wallets.find((w) => w.customerId === customerId && w.currency === currency);
  if (!wallet) throw new Error(`wallet missing: ${customerId} ${currency}`);
  return wallet;
}

function assertFailedWithoutChange(
  result: Awaited<ReturnType<ReturnType<typeof walletCommands.selfTopUp>['run']>>,
  beforeJson: string,
): void {
  expect(result.ok).toBe(false);
  expect(stateJson(state)).toBe(beforeJson);
}

describe('selfTopUp', () => {
  it('成功：余额增加、TOPUP_SELF 流水字段完整且余额链衔接', async () => {
    const before = walletOf(state, 'C-001', 'USD');
    const beforeJson = stateJson(state);
    const result = await walletCommands.selfTopUp('C-001', 'USD', '100.50').run(state, {
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const beforeValue = D(before.balance);
    const expectedAfter = beforeValue.plus('100.50').toFixed(2);
    expect(result.data.wallet.balance).toBe(expectedAfter);
    expect(result.data.bill.type).toBe('TOPUP_SELF');
    expect(result.data.bill.currency).toBe('USD');
    expect(result.data.bill.amount).toBe('100.50');
    expect(result.data.bill.balanceBefore).toBe(before.balance);
    expect(result.data.bill.balanceAfter).toBe(expectedAfter);
    expect(result.data.bill.createdAt).toBe(NOW);
    expect(result.data.bill.id).toMatch(/^BL-\d{8}-\d{4}$/);
    expect(result.data.bill.operatorId).toBeUndefined();

    expect(walletOf(result.next, 'C-001', 'USD').balance).toBe(expectedAfter);
    expect(result.next.bills).toHaveLength(state.bills.length + 1);
    // seed 流水均落在历史日期，今日首笔流水序号为 1，且计数器日期与流水号一致
    expect(result.next.counters.BL?.seq).toBe(1);
    expect(result.next.counters.BL?.day).toBe(result.data.bill.id.split('-')[1]);
    // 其他钱包不受影响
    expect(walletOf(result.next, 'C-001', 'EUR').balance).toBe(
      walletOf(state, 'C-001', 'EUR').balance,
    );
    expect(stateJson(state)).toBe(beforeJson);
  });

  it('币种精度边界：JPY 仅整数；USD 两位小数；0/负数/超精度/非法字符串拒绝且零变更', async () => {
    const jpy = await walletCommands.selfTopUp('C-001', 'JPY', '100').run(state, { now: NOW });
    expect(jpy.ok).toBe(true);

    const cases: Array<{ customerId: string; currency: Currency; amount: string; code: string }> = [
      { customerId: 'C-001', currency: 'USD', amount: '0', code: 'INVALID_AMOUNT' },
      { customerId: 'C-001', currency: 'USD', amount: '-1', code: 'INVALID_AMOUNT' },
      { customerId: 'C-001', currency: 'USD', amount: '10.001', code: 'INVALID_AMOUNT' },
      { customerId: 'C-001', currency: 'JPY', amount: '100.5', code: 'INVALID_AMOUNT' },
      { customerId: 'C-001', currency: 'USD', amount: 'abc', code: 'INVALID_AMOUNT' },
      { customerId: 'C-001', currency: 'USD', amount: '', code: 'INVALID_AMOUNT' },
    ];
    for (const item of cases) {
      const beforeJson = stateJson(state);
      const result = await walletCommands
        .selfTopUp(item.customerId, item.currency, item.amount)
        .run(state, { now: NOW });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(item.code);
      expect(stateJson(state)).toBe(beforeJson);
    }
  });

  it('未知客户/非法币种拒绝且零变更', async () => {
    const beforeJson = stateJson(state);
    const unknown = await walletCommands.selfTopUp('C-999', 'USD', '10').run(state, { now: NOW });
    assertFailedWithoutChange(unknown, beforeJson);
    if (!unknown.ok) expect(unknown.code).toBe('CUSTOMER_NOT_FOUND');

    const badCurrency = await walletCommands
      .selfTopUp('C-001', 'AUD' as Currency, '10')
      .run(state, { now: NOW });
    assertFailedWithoutChange(badCurrency, beforeJson);
    if (!badCurrency.ok) expect(badCurrency.code).toBe('INVALID_CURRENCY');
  });

  it('连续充值：第二条流水 balanceBefore 等于第一条 balanceAfter（余额链）', async () => {
    const first = await walletCommands.selfTopUp('C-002', 'EUR', '10.00').run(state, { now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await walletCommands
      .selfTopUp('C-002', 'EUR', '0.50')
      .run(first.next, { now: NOW + 1000 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.data.bill.balanceBefore).toBe(first.data.bill.balanceAfter);
    expect(second.data.wallet.balance).toBe(second.data.bill.balanceAfter);
    expect(second.data.bill.createdAt).toBe(NOW + 1000);

    // 恒等式：余额 = Σ该客户该币种流水
    const sum = second.next.bills
      .filter((b) => b.customerId === 'C-002' && b.currency === 'EUR')
      .reduce((acc, b) => acc.plus(b.amount), D(0));
    expect(sum.eq(second.data.wallet.balance)).toBe(true);
  });
});

describe('opsTopUp', () => {
  it('成功：记录运营账号与备注，金额入账并留 TOPUP_OPS 流水', async () => {
    const before = walletOf(state, 'C-002', 'USD');
    const result = await walletCommands
      .opsTopUp('OPS-001', 'C-002', 'USD', '200.00', '  演示：客诉补偿入账  ')
      .run(state, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.bill.type).toBe('TOPUP_OPS');
    expect(result.data.bill.operatorId).toBe('OPS-001');
    expect(result.data.bill.remark).toBe('演示：客诉补偿入账');
    expect(result.data.bill.amount).toBe('200.00');
    expect(result.data.bill.balanceBefore).toBe(before.balance);
    expect(result.data.wallet.balance).toBe(D(before.balance).plus('200').toFixed(2));
    expect(walletOf(result.next, 'C-002', 'USD').balance).toBe(result.data.wallet.balance);
  });

  it('运营账号不存在/备注为空/客户不存在/金额非法均拒绝且零变更', async () => {
    const cases: Array<{
      operatorId: string;
      customerId: string;
      currency: Currency;
      amount: string;
      remark: string;
      code: string;
    }> = [
      {
        operatorId: 'OPS-999',
        customerId: 'C-002',
        currency: 'USD',
        amount: '10.00',
        remark: '备注',
        code: 'OPS_NOT_FOUND',
      },
      {
        operatorId: 'OPS-001',
        customerId: 'C-002',
        currency: 'USD',
        amount: '10.00',
        remark: '   ',
        code: 'REMARK_REQUIRED',
      },
      {
        operatorId: 'OPS-001',
        customerId: 'C-999',
        currency: 'USD',
        amount: '10.00',
        remark: '备注',
        code: 'CUSTOMER_NOT_FOUND',
      },
      {
        operatorId: 'OPS-001',
        customerId: 'C-002',
        currency: 'USD',
        amount: '0.001',
        remark: '备注',
        code: 'INVALID_AMOUNT',
      },
    ];

    for (const item of cases) {
      const beforeJson = stateJson(state);
      const result = await walletCommands
        .opsTopUp(item.operatorId, item.customerId, item.currency, item.amount, item.remark)
        .run(state, { now: NOW });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(item.code);
      expect(stateJson(state)).toBe(beforeJson);
    }
  });
});
