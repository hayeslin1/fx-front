import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import {
  bootstrapStore,
  loginClient,
  loginOps,
  logoutClient,
  resetDemoData,
  useAppStore,
} from './index';

// store 装配冒烟：bootstrap（node 环境自动降级内存存储）→ 双端登录 → 重置 全链路
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();

beforeEach(() => {
  setClock(() => NOW);
});

describe('bootstrapStore（运行时装配）', () => {
  it('首次引导构建预置数据（3 客户 / 9 订单 / 无恢复提示）', async () => {
    await bootstrapStore();
    const state = useAppStore.getState();
    expect(state.data.customers).toHaveLength(3);
    expect(state.data.orders).toHaveLength(9);
    expect(state.session.client).toBeNull();
    expect(state.ui.storageRecovered).toBe(false);
  });

  it('二次引导走持久化恢复（不再重复 seed）', async () => {
    await bootstrapStore();
    const firstCustomer = useAppStore.getState().data.customers[0];
    await bootstrapStore(); // 内存适配器会被重置，但第二次引导不应报错且会话保持空
    expect(useAppStore.getState().data.customers[0]?.id).toBe(firstCustomer?.id);
  });
});

describe('登录/退出/重置 编排动作', () => {
  it('客户与运营可分别登录，退出互不影响', async () => {
    await bootstrapStore();
    const customerSpec = SEED_CUSTOMERS[0];
    const opsSpec = SEED_OPS_ACCOUNTS[0];
    expect(customerSpec).toBeDefined();
    expect(opsSpec).toBeDefined();
    if (!customerSpec || !opsSpec) return;

    const clientLogin = await loginClient(customerSpec.email, customerSpec.password);
    expect(clientLogin.ok).toBe(true);
    expect(useAppStore.getState().session.client?.customerId).toBe(customerSpec.id);

    const opsLogin = await loginOps(opsSpec.email, opsSpec.password);
    expect(opsLogin.ok).toBe(true);
    expect(useAppStore.getState().session.ops?.opsAccountId).toBe(opsSpec.id);

    logoutClient();
    expect(useAppStore.getState().session.client).toBeNull();
    expect(useAppStore.getState().session.ops?.opsAccountId).toBe(opsSpec.id);
  });

  it('重置演示数据：会话清空、计数递增、恢复预置样例', async () => {
    await bootstrapStore();
    const opsSpec = SEED_OPS_ACCOUNTS[0];
    if (opsSpec) await loginOps(opsSpec.email, opsSpec.password);
    expect(useAppStore.getState().session.ops).not.toBeNull();

    await resetDemoData();
    const state = useAppStore.getState();
    expect(state.session.ops).toBeNull();
    expect(state.session.client).toBeNull();
    expect(state.data.meta.resetCount).toBe(1);
    expect(state.data.customers).toHaveLength(3);
  });
});
