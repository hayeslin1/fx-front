import { beforeEach, describe, expect, it } from 'vitest';
import { NEW_CUSTOMER_GIFT } from '../constants';
import { buildSeed } from '../seed';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';
import type { DataState, DomainResult } from '../types';
import { authCommands } from './auth.service';
import { customerCommands } from './customer.service';

// 客户服务：最近登录刷新、运营建户（含初始资金）、资料编辑、邮箱判重与重置密码
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

function stateJson(s: DataState): string {
  return JSON.stringify(s);
}

function expectFailedZero(result: DomainResult<unknown>, beforeJson: string): void {
  expect(result.ok).toBe(false);
  expect(stateJson(state)).toBe(beforeJson);
}

describe('touchLastLogin', () => {
  it('刷新最近登录时间', async () => {
    const result = await customerCommands.touchLastLogin('C-001').run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customer.lastLoginAt).toBe(NOW);
    expect(result.next.customers.find((c) => c.id === 'C-001')?.lastLoginAt).toBe(NOW);
  });

  it('客户不存在时拒绝且零变更', async () => {
    const beforeJson = stateJson(state);
    const result = await customerCommands.touchLastLogin('C-999').run(state, { now: NOW });
    expectFailedZero(result, beforeJson);
    if (!result.ok) expect(result.code).toBe('CUSTOMER_NOT_FOUND');
  });
});

describe('createCustomer（运营建户）', () => {
  it('成功：邮箱归一化、编号推进、六币种初始余额与流水、凭证可登录', async () => {
    const result = await customerCommands
      .createCustomer('OPS-001', {
        name: '  新客户  ',
        email: ' New.Customer@Example.COM ',
        password: 'abc12345',
      })
      .run(state, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const customer = result.data.customer;
    expect(customer.id).toBe('C-0004');
    expect(customer.name).toBe('新客户');
    expect(customer.email).toBe('new.customer@example.com');
    expect(customer.createdAt).toBe(NOW);
    expect(customer.lastLoginAt).toBeNull();

    const wallets = result.next.wallets.filter((w) => w.customerId === customer.id);
    const bills = result.next.bills.filter((b) => b.customerId === customer.id);
    expect(wallets).toHaveLength(6);
    expect(bills).toHaveLength(6);
    for (const wallet of wallets) {
      expect(wallet.balance).toBe(NEW_CUSTOMER_GIFT[wallet.currency]);
      const bill = bills.find((b) => b.currency === wallet.currency);
      expect(bill?.type).toBe('INITIAL_GIFT');
      expect(bill?.amount).toBe(NEW_CUSTOMER_GIFT[wallet.currency]);
      expect(bill?.balanceBefore).toBe('0');
      expect(bill?.balanceAfter).toBe(wallet.balance);
    }
    expect(result.next.counters.C?.seq).toBe(4);
    // seed 流水均落在历史日期，今日新建 6 条 INITIAL_GIFT 流水序号为 1..6
    expect(result.next.counters.BL?.seq).toBe(6);

    // 凭证走 SHA-256(salt:password)，可直接登录
    const login = await authCommands
      .loginClient('NEW.CUSTOMER@example.com', 'abc12345')
      .run(result.next, { now: NOW });
    expect(login.ok).toBe(true);
    if (login.ok) expect(login.data.customer.id).toBe(customer.id);
  });

  it('邮箱判重忽略大小写与空格，重复时拒绝且零变更', async () => {
    const existing = SEED_CUSTOMERS[0];
    expect(existing).toBeDefined();
    if (!existing) return;

    const beforeJson = stateJson(state);
    const result = await customerCommands
      .createCustomer('OPS-001', {
        name: '重复客户',
        email: ` ${existing.email.toUpperCase()} `,
        password: 'abc12345',
      })
      .run(state, { now: NOW });
    expectFailedZero(result, beforeJson);
    if (!result.ok) expect(result.code).toBe('EMAIL_TAKEN');
  });

  it('非法姓名/邮箱/弱密码/未知运营均拒绝且零变更', async () => {
    const cases: Array<{
      operatorId: string;
      input: { name: string; email: string; password: string };
      code: string;
    }> = [
      {
        operatorId: 'OPS-999',
        input: { name: '客户', email: 'ok@example.com', password: 'abc12345' },
        code: 'OPS_NOT_FOUND',
      },
      {
        operatorId: 'OPS-001',
        input: { name: '  ', email: 'ok@example.com', password: 'abc12345' },
        code: 'INVALID_NAME',
      },
      {
        operatorId: 'OPS-001',
        input: { name: '客户', email: 'not-an-email', password: 'abc12345' },
        code: 'INVALID_EMAIL',
      },
      {
        operatorId: 'OPS-001',
        input: { name: '客户', email: 'ok@example.com', password: '1234567' },
        code: 'WEAK_PASSWORD',
      },
    ];
    for (const item of cases) {
      const beforeJson = stateJson(state);
      const result = await customerCommands
        .createCustomer(item.operatorId, item.input)
        .run(state, { now: NOW });
      expectFailedZero(result, beforeJson);
      if (!result.ok) expect(result.code).toBe(item.code);
    }
  });
});

describe('updateCustomer（运营编辑）', () => {
  it('更新姓名与邮箱（归一化），其他客户不受影响', async () => {
    const result = await customerCommands
      .updateCustomer('OPS-001', 'C-001', {
        name: ' 林小满（改） ',
        email: ' New.Lin@Example.com ',
      })
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customer.name).toBe('林小满（改）');
    expect(result.data.customer.email).toBe('new.lin@example.com');
    expect(result.next.customers.find((c) => c.id === 'C-002')?.email).toBe(
      state.customers.find((c) => c.id === 'C-002')?.email,
    );
  });

  it('邮箱与其他客户重复（忽略大小写）拒绝且零变更', async () => {
    const other = SEED_CUSTOMERS[1];
    expect(other).toBeDefined();
    if (!other) return;

    const beforeJson = stateJson(state);
    const result = await customerCommands
      .updateCustomer('OPS-001', 'C-001', { email: other.email.toUpperCase() })
      .run(state, { now: NOW });
    expectFailedZero(result, beforeJson);
    if (!result.ok) expect(result.code).toBe('EMAIL_TAKEN');
  });

  it('未知运营/未知客户/非法邮箱拒绝且零变更', async () => {
    const beforeJson = stateJson(state);
    const noOps = await customerCommands
      .updateCustomer('OPS-999', 'C-001', { name: 'x' })
      .run(state, { now: NOW });
    expectFailedZero(noOps, beforeJson);
    if (!noOps.ok) expect(noOps.code).toBe('OPS_NOT_FOUND');

    const noCustomer = await customerCommands
      .updateCustomer('OPS-001', 'C-999', { name: 'x' })
      .run(state, { now: NOW });
    expectFailedZero(noCustomer, beforeJson);
    if (!noCustomer.ok) expect(noCustomer.code).toBe('CUSTOMER_NOT_FOUND');

    const badEmail = await customerCommands
      .updateCustomer('OPS-001', 'C-001', { email: 'bad' })
      .run(state, { now: NOW });
    expectFailedZero(badEmail, beforeJson);
    if (!badEmail.ok) expect(badEmail.code).toBe('INVALID_EMAIL');
  });
});

describe('resetPassword（运营重置密码）', () => {
  it('新密码可登录、旧密码失效，凭证盐值被更换', async () => {
    const oldCredential = state.credentials.find((c) => c.customerId === 'C-001');
    expect(oldCredential).toBeDefined();
    if (!oldCredential) return;

    const result = await customerCommands
      .resetPassword('OPS-001', 'C-001', 'NewPass123')
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customerId).toBe('C-001');

    const newCredential = result.next.credentials.find((c) => c.customerId === 'C-001');
    expect(newCredential?.salt).not.toBe(oldCredential.salt);
    expect(newCredential?.passwordHash).not.toBe(oldCredential.passwordHash);

    const oldLogin = await authCommands
      .loginClient('linxiaoman@demo.fx', 'Demo1234')
      .run(result.next, { now: NOW });
    expect(oldLogin.ok).toBe(false);

    const newLogin = await authCommands
      .loginClient('linxiaoman@demo.fx', 'NewPass123')
      .run(result.next, { now: NOW });
    expect(newLogin.ok).toBe(true);
    if (newLogin.ok) expect(newLogin.data.customer.id).toBe('C-001');
  });

  it('未知运营/未知客户/弱密码拒绝且零变更', async () => {
    const cases: Array<{ operatorId: string; customerId: string; password: string; code: string }> =
      [
        {
          operatorId: 'OPS-999',
          customerId: 'C-001',
          password: 'NewPass123',
          code: 'OPS_NOT_FOUND',
        },
        {
          operatorId: 'OPS-001',
          customerId: 'C-999',
          password: 'NewPass123',
          code: 'CUSTOMER_NOT_FOUND',
        },
        { operatorId: 'OPS-001', customerId: 'C-001', password: '1234567', code: 'WEAK_PASSWORD' },
      ];
    for (const item of cases) {
      const beforeJson = stateJson(state);
      const result = await customerCommands
        .resetPassword(item.operatorId, item.customerId, item.password)
        .run(state, { now: NOW });
      expectFailedZero(result, beforeJson);
      if (!result.ok) expect(result.code).toBe(item.code);
    }
  });
});
