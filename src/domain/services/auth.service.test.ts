import { beforeEach, describe, expect, it } from 'vitest';
import { NEW_CUSTOMER_GIFT } from '../constants';
import { D } from '../money';
import { buildSeed } from '../seed';
import type { DataState } from '../types';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { authCommands } from './auth.service';

// 认证服务（演示级）：注册发放初始资金、邮箱判重、双端登录隔离
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

describe('register', () => {
  it('成功：去空格小写邮箱、六币种钱包与 6 条 INITIAL_GIFT 流水', async () => {
    const result = await authCommands
      .register({ name: ' 测试客户 ', email: ' Test.User@Example.COM ', password: 'abc12345' })
      .run(state, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const customer = result.data.customer;
    expect(customer.name).toBe('测试客户');
    expect(customer.email).toBe('test.user@example.com');

    const wallets = result.next.wallets.filter((w) => w.customerId === customer.id);
    const bills = result.next.bills.filter((b) => b.customerId === customer.id);
    expect(wallets).toHaveLength(6);
    expect(bills).toHaveLength(6);

    for (const wallet of wallets) {
      expect(D(wallet.balance).eq(NEW_CUSTOMER_GIFT[wallet.currency])).toBe(true);
      const bill = bills.find((b) => b.currency === wallet.currency);
      expect(bill?.type).toBe('INITIAL_GIFT');
      expect(bill?.balanceBefore).toBe('0');
      expect(bill?.balanceAfter).toBe(wallet.balance);
    }
  });

  it('邮箱判重忽略大小写与空格', async () => {
    const existing = SEED_CUSTOMERS[0];
    expect(existing).toBeDefined();
    if (!existing) return;
    const result = await authCommands
      .register({ name: '重复', email: ` ${existing.email.toUpperCase()} `, password: 'abc12345' })
      .run(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMAIL_TAKEN');
  });

  it('弱密码与非法邮箱被拒绝', async () => {
    const weak = await authCommands
      .register({ name: '弱密码', email: 'weak@example.com', password: '1234567' })
      .run(state, { now: NOW });
    expect(weak.ok).toBe(false);
    if (!weak.ok) expect(weak.code).toBe('WEAK_PASSWORD');

    const badEmail = await authCommands
      .register({ name: '坏邮箱', email: 'not-an-email', password: 'abc12345' })
      .run(state, { now: NOW });
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.code).toBe('INVALID_EMAIL');
  });
});

describe('loginClient', () => {
  it('预置客户正确密码可登录，并刷新最近登录时间', async () => {
    const spec = SEED_CUSTOMERS[0];
    expect(spec).toBeDefined();
    if (!spec) return;
    const result = await authCommands
      .loginClient(spec.email, spec.password)
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customer.id).toBe(spec.id);
    expect(result.data.customer.lastLoginAt).toBe(NOW);
  });

  it('错误密码与未知邮箱返回统一错误信息', async () => {
    const spec = SEED_CUSTOMERS[0];
    if (!spec) return;
    const wrong = await authCommands.loginClient(spec.email, 'wrong-pass').run(state, { now: NOW });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toBe('邮箱或密码不正确');

    const unknown = await authCommands
      .loginClient('nobody@demo.fx', 'abc12345')
      .run(state, { now: NOW });
    expect(unknown.ok).toBe(false);
  });
});

describe('loginOps（双端隔离）', () => {
  it('运营账号可登录', async () => {
    const spec = SEED_OPS_ACCOUNTS[0];
    expect(spec).toBeDefined();
    if (!spec) return;
    const result = await authCommands.loginOps(spec.email, spec.password).run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.opsAccount.id).toBe(spec.id);
  });

  it('客户账号不可进入运营端', async () => {
    const spec = SEED_CUSTOMERS[0];
    if (!spec) return;
    const result = await authCommands.loginOps(spec.email, spec.password).run(state, { now: NOW });
    expect(result.ok).toBe(false);
  });
});
