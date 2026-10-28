// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, useAppStore } from '@/store';
import { getCustomerOrders } from '@/store/selectors';

// 兑换纵切交互测试（jsdom，真实 createRoot + 路由守卫）：
// 覆盖取价展示、非法金额/无报价零订单、成交原子写入 + 清空报价 + 跳详情、余额不足零变更。
// 时钟固定注入，保证 10 分钟新鲜度与 30 秒锁价边界可确定复现（设计文档 §4.4）。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const CUSTOMER = SEED_CUSTOMERS[0];

let container: HTMLDivElement;
let root: Root;

async function mount(path: string): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

function byId<T extends Element>(id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (element === null) throw new Error(`未找到元素 #${id}`);
  return element;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text,
  );
  if (button === undefined) throw new Error(`未找到按钮「${text}」`);
  return button;
}

function setInputValue(id: string, value: string): void {
  const input = byId<HTMLInputElement>(id);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelectValue(id: string, value: string): void {
  const select = byId<HTMLSelectElement>(id);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    // 等一拍宏任务，确保提交/导航的异步链路全部完成后再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function text(): string {
  return container.textContent ?? '';
}

function orderCount(): number {
  return useAppStore.getState().data.orders.length;
}

/** 当前客户订单数（seed 客户 C-001 预置 3 笔） */
function customerOrderCount(): number {
  const state = useAppStore.getState();
  const customerId = state.session.client?.customerId;
  return customerId === undefined ? 0 : getCustomerOrders(state.data, customerId).length;
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();

  if (CUSTOMER === undefined) throw new Error('缺少种子客户 C-001');
  const login = await loginClient(CUSTOMER.email, CUSTOMER.password);
  if (!login.ok) throw new Error('客户登录失败');
  await mount('/app/exchange');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('兑换页取价', () => {
  it('取价成功展示客户成交价、预计到账与 30 秒倒计时', async () => {
    setInputValue('source-amount', '1000');
    await click(buttonByText('获取报价'));

    const quote = useAppStore.getState().ui.quote;
    expect(quote).not.toBeNull();
    expect(quote?.pairId).toBe('USD/EUR');
    expect(quote?.direction).toBe('SELL_USD');
    expect(quote?.clientRate).toBe('0.9154');

    expect(text()).toContain('0.9154');
    expect(text()).toContain('915.40 EUR');
    expect(text()).toContain('华星清算');
    expect(text()).toContain('报价剩余 30 秒');
    expect(customerOrderCount()).toBe(3); // 仅 seed 预置订单，未成交
  });

  it('金额非法时不取价、不产生订单', async () => {
    setInputValue('source-amount', '0');

    expect(buttonByText('获取报价').disabled).toBe(true);
    expect(text()).toContain('请输入大于 0 的金额');
    expect(useAppStore.getState().ui.quote).toBeNull();
    expect(customerOrderCount()).toBe(3);
  });

  it('超过 10 分钟新鲜度时无报价，展示逐渠道诊断且不产生订单', async () => {
    // 原始价采集于 NOW-2min；把时钟推进 20 分钟后全部过期（PRD §4.1）
    setClock(() => NOW + 20 * 60_000);
    setInputValue('source-amount', '1000');
    await click(buttonByText('获取报价'));

    expect(useAppStore.getState().ui.quote).toBeNull();
    expect(customerOrderCount()).toBe(3);
    expect(text()).toContain('暂无有效报价');
    expect(text()).toContain('逐渠道诊断');
    expect(text()).toContain('华星清算');
    expect(text()).toContain('采集价已过期（超过 10 分钟）');
    expect(text()).toContain('渠道已停用'); // CH-03 预置停用
  });
});

describe('确认成交', () => {
  it('成交后新增 1 张订单、清空报价并跳转订单详情', async () => {
    const beforeAllOrders = orderCount();
    expect(customerOrderCount()).toBe(3);
    setInputValue('source-amount', '1000');
    await click(buttonByText('获取报价'));

    const quote = useAppStore.getState().ui.quote;
    expect(quote).not.toBeNull();
    await click(buttonByText('确认成交'));

    const state = useAppStore.getState();
    expect(state.data.orders).toHaveLength(beforeAllOrders + 1);
    expect(customerOrderCount()).toBe(4);
    expect(state.ui.quote).toBeNull();

    const order = state.data.orders[state.data.orders.length - 1];
    expect(order).toBeDefined();
    expect(order?.quoteId).toBe(quote?.quoteId);
    expect(order?.snapshot.clientRate).toBe(quote?.clientRate);
    expect(order?.snapshot.mid).toBe(quote?.mid);

    // 已跳转订单详情：展示快照与关联流水
    expect(text()).toContain(order?.id ?? '');
    expect(text()).toContain('价格快照');
    expect(text()).toContain('关联钱包流水');
  });

  it('余额不足时只提示、订单与余额零变更', async () => {
    // C-001 预置 JPY 余额 500,000；600,000 JPY 在等值 USD 限额内但超过余额
    setSelectValue('source-currency', 'JPY');
    setInputValue('source-amount', '600000');
    await click(buttonByText('获取报价'));

    const quote = useAppStore.getState().ui.quote;
    expect(quote?.sourceCurrency).toBe('JPY');
    expect(quote?.targetCurrency).toBe('USD');

    const beforeOrders = customerOrderCount();
    const beforeJpy = useAppStore
      .getState()
      .data.wallets.find(
        (wallet) => wallet.customerId === 'C-001' && wallet.currency === 'JPY',
      )?.balance;

    await click(buttonByText('确认成交'));

    const state = useAppStore.getState();
    expect(customerOrderCount()).toBe(beforeOrders);
    expect(
      state.data.wallets.find((w) => w.customerId === 'C-001' && w.currency === 'JPY')?.balance,
    ).toBe(beforeJpy);
    // 失败不清理报价，客户可下调金额后重新取价
    expect(state.ui.quote?.quoteId).toBe(quote?.quoteId);
  });
});
