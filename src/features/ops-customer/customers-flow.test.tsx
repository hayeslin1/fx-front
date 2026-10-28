// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';
import { AppRoutes } from '@/app/routes';

// M4 运营客户管理纵切（jsdom）：真实 store + 真实路由渲染。
// 覆盖：运营登录 → 客户列表（3 位预置客户、金样 USD 估值、六币种余额、邮箱）
// → 姓名/邮箱即时搜索（含“无匹配客户”空态）→ C-001 详情（六币种余额金样、最近订单/流水）。
// WHY 走 AppRoutes 而非单页挂载：同时验证 RequireOps 守卫与 OpsLayout 下的真实挂载形态。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
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

async function loginSeedOps(): Promise<void> {
  const spec = SEED_OPS_ACCOUNTS[0];
  if (!spec) throw new Error('seed ops account missing');
  const result = await loginOps(spec.email, spec.password);
  if (!result.ok) throw new Error(`ops login failed: ${result.message}`);
}

/** 向搜索框输入并触发 React onChange（受控输入需绕过 value tracker 的原生 setter） */
async function typeSearch(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (input === null) throw new Error('search input missing');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

describe('M4 运营客户管理：列表', () => {
  it('运营登录后列表列出 3 位预置客户（姓名/邮箱/金样 USD 估值/六币种余额）', async () => {
    await loginSeedOps();
    const html = await mount('/ops/customers');

    expect(html).toContain('客户管理');
    for (const spec of SEED_CUSTOMERS) {
      expect(html).toContain(spec.name);
      expect(html).toContain(spec.email);
    }
    // 金样估值：D6 口径（外币余额 ÷ 该币对最新原始中间价，USD 1:1），即 getCustomerUsdValuation 输出
    expect(html).toContain('49,116.76 USD'); // C-001
    expect(html).toContain('42,360.70 USD'); // C-002
    expect(html).toContain('34,113.43 USD'); // C-003
    // 六币种余额列（C-001 金样）
    expect(html).toContain('20,500.00 USD');
    expect(html).toContain('8,203.15 EUR');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('按姓名“苏晚”即时过滤只剩 1 行；无匹配关键词出现“无匹配客户”空态', async () => {
    await loginSeedOps();
    await mount('/ops/customers');

    await typeSearch('苏晚');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.innerHTML).toContain('苏晚');
    expect(container.innerHTML).toContain('suwan@demo.fx');
    expect(container.innerHTML).not.toContain('林小满');

    await typeSearch('不存在的客户');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.innerHTML).toContain('无匹配客户');
  });

  it('按邮箱关键词（大小写不敏感）过滤命中对应客户', async () => {
    await loginSeedOps();
    await mount('/ops/customers');

    await typeSearch('LINXIAOMAN@DEMO.FX');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.innerHTML).toContain('林小满');
  });
});

describe('M4 运营客户管理：详情', () => {
  it('C-001 详情展示资料、六币种余额金样、USD 估值与最近订单/流水概览', async () => {
    await loginSeedOps();
    const html = await mount('/ops/customers/C-001');

    expect(html).toContain('林小满');
    expect(html).toContain('linxiaoman@demo.fx');
    expect(html).toContain('C-001');
    // 六币种余额金样（设计文档 §5.4：C-001 余额）
    for (const gold of [
      '20,500.00 USD',
      '8,203.15 EUR',
      '7,686.45 GBP',
      '500,000 JPY',
      '20,000.00 CNH',
      '30,000.00 HKD',
    ]) {
      expect(html).toContain(gold);
    }
    expect(html).toContain('演示资金');
    expect(html).toContain('49,116.76 USD'); // USD 参考估值
    expect(html).toContain('最近订单');
    expect(html).toContain('最近流水');

    // 最近订单概览：C-001 三笔订单号全部出现（含币对与方向）
    const orders = useAppStore.getState().data.orders.filter((o) => o.customerId === 'C-001');
    expect(orders).toHaveLength(3);
    for (const order of orders) {
      expect(html).toContain(order.id);
    }
    expect(html).toContain('USD/EUR');
    expect(html).toContain('卖出 USD');

    // 最近流水概览：兑换扣款/到账与初始演示资金类型文案
    expect(html).toContain('兑换扣款');
    expect(html).toContain('兑换到账');
  });

  it('不存在的客户编号显示“客户不存在”空态并可返回列表', async () => {
    await loginSeedOps();
    const html = await mount('/ops/customers/C-404');
    expect(html).toContain('客户不存在');
    expect(html).toContain('返回客户列表');
  });

  it('列表“查看详情”链接指向 /ops/customers/:id', async () => {
    await loginSeedOps();
    await mount('/ops/customers');
    const links = container.querySelectorAll('a[href="/ops/customers/C-001"]');
    expect(links.length).toBeGreaterThan(0);
  });
});
