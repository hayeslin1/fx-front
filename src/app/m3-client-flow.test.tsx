// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { now, setClock } from '@/lib/clock';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, useAppStore } from '@/store';
import { getQuote } from '@/domain/pricing';
import { exchangeCommands } from '@/domain/services/exchange.service';
import { walletCommands } from '@/domain/services/wallet.service';
import { AppRoutes } from './routes';

// M3 J1 跨页冒烟（jsdom）：真实 store + 真实领域服务 + 真实路由渲染，
// 验证“登录 → 钱包 → 充值 → 兑换 → 订单/详情 → 客服”页面能消费事实并出数。
// WHY 与路由冒烟分开：routes.test 只保证可达与守卫，本文件保证业务页面已替换占位并接真数据。

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let container: HTMLDivElement;
let root: Root;

async function mount(path: string): Promise<string> {
  await act(async () => {
    root.render(
      // key 随路径变化强制重建 Router：否则同一 Router 实例会保留上次导航位置
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
  return container.innerHTML;
}

async function loginSeedCustomer(): Promise<void> {
  const spec = SEED_CUSTOMERS[0];
  if (!spec) throw new Error('seed customer missing');
  const result = await loginClient(spec.email, spec.password);
  if (!result.ok) throw new Error(`login failed: ${result.message}`);
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('M3 客户端主链路渲染', () => {
  it('注册页渲染真实表单（替换占位）', async () => {
    const html = await mount('/app/register');
    expect(html).toContain('注册');
    expect(html).toContain('邮箱');
    expect(html).toContain('密码');
    expect(html).not.toContain('M3');
  });

  it('钱包页展示六币种余额与流水（金样 20,500.00 USD / 8,203.15 EUR）', async () => {
    await loginSeedCustomer();
    const html = await mount('/app/wallet');
    expect(html).toContain('20,500.00');
    expect(html).toContain('8,203.15');
    expect(html).toContain('美元 USD');
    expect(html).toContain('欧元 EUR');
    expect(html).toContain('资金流水');
    expect(html).toContain('初始演示资金');
  });

  it('充值成功后钱包页余额即时更新（20,500.00 → 20,600.00 USD）', async () => {
    await loginSeedCustomer();
    const topUpPage = await mount('/app/top-up');
    expect(topUpPage).toContain('自助充值');

    const result = await useAppStore
      .getState()
      .apply(walletCommands.selfTopUp('C-001', 'USD', '100.00'));
    expect(result.ok).toBe(true);

    const walletPage = await mount('/app/wallet');
    expect(walletPage).toContain('20,600.00');
  });

  it('兑换成交后订单列表与详情展示完整快照（本人订单）', async () => {
    await loginSeedCustomer();
    const state = useAppStore.getState().data;
    const quoteResult = getQuote(
      state.fxConfig,
      { pairId: 'USD/EUR', direction: 'SELL_USD', sourceAmount: '100.00' },
      now(),
    );
    expect(quoteResult.ok).toBe(true);
    if (!quoteResult.ok) return;

    const submit = await useAppStore
      .getState()
      .apply(exchangeCommands.submit('C-001', quoteResult.quote));
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;
    const order = submit.data.order;

    const listHtml = await mount('/app/orders');
    expect(listHtml).toContain(order.id);
    expect(listHtml).toContain('USD/EUR');

    const detailHtml = await mount(`/app/orders/${order.id}`);
    expect(detailHtml).toContain(`订单 ${order.id}`);
    expect(detailHtml).toContain('客户成交价');
    expect(detailHtml).toContain('成交时原始中间价');
    expect(detailHtml).toContain('华星清算');
    // 客户侧不展示平台损益（PRD §3.4）
    expect(detailHtml).not.toContain('收益单');
  });

  it('客服列表与详情展示本人工单及消息时间线', async () => {
    await loginSeedCustomer();
    const ticket = useAppStore
      .getState()
      .data.tickets.find((item) => item.customerId === 'C-001');
    expect(ticket).toBeDefined();
    if (!ticket) return;

    const listHtml = await mount('/app/support');
    expect(listHtml).toContain(ticket.subject);

    const detailHtml = await mount(`/app/support/${ticket.id}`);
    expect(detailHtml).toContain(ticket.subject);
    expect(detailHtml).toContain('你好，我前两天用 USD 兑换 EUR');
  });
});
