import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_CURRENCIES } from '@/domain/constants';
import { D } from '@/domain/money';
import { walletCommands } from '@/domain/services/wallet.service';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, type SeedCustomerSpec } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, registerCustomer, useAppStore } from '@/store';
import { getCustomerWallets, getWalletBills } from '@/store/selectors';
import { selectCustomerBills, validateTopUpAmount } from './hooks';
import { BILL_TYPE_LABELS, CURRENCY_LABELS } from './labels';

// 钱包/注册 feature 单测：纯函数（金额校验、流水筛选排序、标签）+ store 装配读取口径。
// hooks 的 React 部分只是薄封装，node 环境通过 useAppStore.getState() 验证其数据来源。

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();

function seedCustomer(): SeedCustomerSpec {
  const spec = SEED_CUSTOMERS[0];
  if (!spec) throw new Error('seed 客户缺失');
  return spec;
}

beforeEach(async () => {
  setClock(() => NOW);
  await bootstrapStore();
});

describe('validateTopUpAmount（正数 + 币种精度）', () => {
  it('空值与非法字符被拒绝', () => {
    expect(validateTopUpAmount('', 'USD')).toBe('请输入充值金额');
    expect(validateTopUpAmount('   ', 'USD')).toBe('请输入充值金额');
    expect(validateTopUpAmount('abc', 'USD')).not.toBeNull();
    expect(validateTopUpAmount('1,000', 'USD')).not.toBeNull();
    expect(validateTopUpAmount('1e3', 'USD')).not.toBeNull();
  });

  it('仅接受正数（0 与负数拒绝）', () => {
    expect(validateTopUpAmount('0', 'USD')).not.toBeNull();
    expect(validateTopUpAmount('0.00', 'USD')).not.toBeNull();
    expect(validateTopUpAmount('-1', 'USD')).not.toBeNull();
    expect(validateTopUpAmount('0.01', 'USD')).toBeNull();
  });

  it('小数位受币种精度约束（JPY 为 0 位，其余 2 位）', () => {
    expect(validateTopUpAmount('100.00', 'USD')).toBeNull();
    expect(validateTopUpAmount('100.5', 'EUR')).toBeNull();
    expect(validateTopUpAmount('100.123', 'USD')).not.toBeNull();
    expect(validateTopUpAmount('100.5', 'JPY')).not.toBeNull();
    expect(validateTopUpAmount('150000', 'JPY')).toBeNull();
  });

  it('首尾空格会被裁剪后校验', () => {
    expect(validateTopUpAmount(' 100.00 ', 'USD')).toBeNull();
  });
});

describe('selectCustomerBills（筛选 + 排序）', () => {
  it('仅返回该客户流水，按时间倒序，与 §7.3 选择器口径一致', async () => {
    const spec = seedCustomer();
    await loginClient(spec.email, spec.password);
    const data = useAppStore.getState().data;

    const bills = selectCustomerBills(data, spec.id);
    expect(bills.length).toBeGreaterThan(0);
    expect(bills.every((bill) => bill.customerId === spec.id)).toBe(true);

    const sorted = [...bills].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    expect(bills.map((bill) => bill.id)).toEqual(sorted.map((bill) => bill.id));
    expect(bills.map((bill) => bill.id)).toEqual(
      getWalletBills(data, spec.id).map((bill) => bill.id),
    );
  });

  it('按币种筛选后只保留该币种流水', async () => {
    const spec = seedCustomer();
    const data = useAppStore.getState().data;
    for (const currency of ALL_CURRENCIES) {
      const bills = selectCustomerBills(data, spec.id, currency);
      expect(bills.length).toBeGreaterThan(0);
      expect(bills.every((bill) => bill.currency === currency)).toBe(true);
    }
  });

  it('其他客户流水不会串入', async () => {
    const data = useAppStore.getState().data;
    const bills = selectCustomerBills(data, seedCustomer().id);
    const otherIds = new Set(
      data.customers.filter((c) => c.id !== seedCustomer().id).map((c) => c.id),
    );
    expect(bills.some((bill) => otherIds.has(bill.customerId))).toBe(false);
  });
});

describe('标签映射', () => {
  it('六币种与五类流水均有中文展示名', () => {
    for (const currency of ALL_CURRENCIES) {
      expect(CURRENCY_LABELS[currency]).toBeTruthy();
    }
    const types = [
      'INITIAL_GIFT',
      'TOPUP_SELF',
      'TOPUP_OPS',
      'EXCHANGE_DEBIT',
      'EXCHANGE_CREDIT',
    ] as const;
    for (const type of types) {
      expect(BILL_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe('store 装配（hooks 数据来源）', () => {
  it('登录后六币种钱包按固定顺序读取', async () => {
    const spec = seedCustomer();
    await loginClient(spec.email, spec.password);
    const data = useAppStore.getState().data;
    const wallets = getCustomerWallets(data, spec.id);
    expect(wallets.map((wallet) => wallet.currency)).toEqual([...ALL_CURRENCIES]);
  });

  it('注册动作自动登录并发放六条初始演示资金流水', async () => {
    const result = await registerCustomer({
      name: '测试客户',
      email: 'new-client@demo.fx',
      password: 'Demo1234',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const state = useAppStore.getState();
    expect(state.session.client?.customerId).toBe(result.data.customer.id);
    const gifts = selectCustomerBills(state.data, result.data.customer.id).filter(
      (bill) => bill.type === 'INITIAL_GIFT',
    );
    expect(gifts).toHaveLength(6);
  });

  it('充值经 store.apply 入账并生成流水；非法金额零变更', async () => {
    const spec = seedCustomer();
    await loginClient(spec.email, spec.password);
    const before = useAppStore.getState().data;
    const walletBefore = before.wallets.find(
      (wallet) => wallet.customerId === spec.id && wallet.currency === 'USD',
    );
    expect(walletBefore).toBeDefined();
    if (!walletBefore) return;

    const result = await useAppStore
      .getState()
      .apply(walletCommands.selfTopUp(spec.id, 'USD', '100.00'));
    expect(result.ok).toBe(true);

    const after = useAppStore.getState().data;
    const walletAfter = after.wallets.find(
      (wallet) => wallet.customerId === spec.id && wallet.currency === 'USD',
    );
    expect(walletAfter?.balance).toBe(D(walletBefore.balance).plus('100').toFixed(2));
    expect(
      selectCustomerBills(after, spec.id, 'USD').some(
        (bill) => bill.type === 'TOPUP_SELF' && bill.amount === '100.00',
      ),
    ).toBe(true);

    // 失败路径：返回 ok:false 且 data 引用不变（页面仅 toast 提示）
    const beforeFail = useAppStore.getState().data;
    const failed = await useAppStore
      .getState()
      .apply(walletCommands.selfTopUp(spec.id, 'USD', '0'));
    expect(failed.ok).toBe(false);
    expect(useAppStore.getState().data).toBe(beforeFail);
  });
});
