// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { setClock } from '@/lib/clock';
import { SEED_OPS_ACCOUNTS, SEED_TRADES } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';

// 交易管理纵切（M4 C：客户订单 + 收益订单）渲染用例。
// 装配范式同 app/routes.test.tsx（真实 createRoot + MemoryRouter + 真实守卫/账本重放），
// 断言 DOM 与 store 事实双口径。EX-n / PO-EX-n 是设计文档 §5.4 的业务编号，
// 测试一律用「币对|方向|来源金额」「币对|方向|名义 USD」业务键定位行与订单，禁止按下标取行。

// jsdom 不实现 SubtleCrypto；登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

/** 表格数据行文案（仅 tbody 的 tr，不含筛选下拉里的 option 文案） */
function rowTexts(): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
}

/** 按业务键（多个文案片段同时命中）定位数据行 */
function findRow(needles: string[]): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((item) =>
    needles.every((needle) => item.textContent?.includes(needle)),
  );
  if (!row) throw new Error(`按业务键未找到行：${needles.join(' + ')}`);
  return row;
}

/** 按业务键定位订单 id（币对|方向|来源金额），避免依赖 seed 生成顺序与下标 */
function orderIdOf(pairId: string, direction: string, sourceAmount: string): string {
  const order = useAppStore
    .getState()
    .data.orders.find(
      (item) =>
        item.pairId === pairId &&
        item.direction === direction &&
        item.sourceAmount === sourceAmount,
    );
  if (!order) throw new Error(`按业务键未找到订单：${pairId}|${direction}|${sourceAmount}`);
  return order.id;
}

async function mount(path: string): Promise<void> {
  await act(async () => {
    root.render(
      // key 用 path：同一测试内切换页面时强制重建 Router（MemoryRouter 的 initialEntries 仅首次生效）
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

async function loginAsOps(): Promise<void> {
  const spec = SEED_OPS_ACCOUNTS[0];
  if (!spec) throw new Error('预置运营账号缺失');
  const result = await loginOps(spec.email, spec.password);
  expect(result.ok).toBe(true);
}

/** 以原生 setter + input 事件写入输入框（React 19 监听原生 input） */
async function fill(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`输入控件不存在：${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 以原生 setter + change 事件写入下拉（select 的 React onChange 走原生 change） */
async function setSelect(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`下拉控件不存在：${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
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
  setClock(null);
});

describe('运营-客户订单', () => {
  it('列表出现 9 笔预置订单与全部列表列，按币对筛选后行数收窄', async () => {
    await loginAsOps();
    const allOrders = useAppStore.getState().data.orders;
    expect(allOrders.length).toBe(SEED_TRADES.length);
    expect(allOrders.length).toBe(9);

    await mount('/ops/trading/orders');
    expect(html()).toContain('客户订单');
    for (const header of [
      '订单号',
      '时间',
      '客户',
      '币对',
      '方向',
      '来源金额',
      '成交价',
      '到账',
      '渠道',
      '状态',
    ]) {
      expect(html()).toContain(header);
    }
    // 全量出数（运营视角：跨客户），且带已完成状态徽标
    expect(rowTexts().length).toBe(9);
    expect(rowTexts().every((text) => text.includes('已完成'))).toBe(true);
    expect(rowTexts().some((text) => text.includes('林小满'))).toBe(true);
    expect(rowTexts().some((text) => text.includes('陈屿'))).toBe(true);

    // 筛选：币对 = USD/EUR（期望条数由 seed 事件脚本按业务键推导，不硬编码）
    const eurTrades = SEED_TRADES.filter((trade) => trade.pairId === 'USD/EUR');
    await setSelect('#order-pair', 'USD/EUR');
    const filtered = rowTexts();
    expect(filtered.length).toBe(eurTrades.length);
    expect(filtered.length).toBeLessThan(9);
    expect(filtered.every((text) => text.includes('USD/EUR'))).toBe(true);
    // EX-1（USD/EUR 卖 USD 2,000.00）在结果内
    expect(filtered.some((text) => text.includes('2,000.00 USD'))).toBe(true);
  });

  it('日期筛选起止含当天；开始日期晚于结束日期时拒绝并保持列表不变', async () => {
    await loginAsOps();
    await mount('/ops/trading/orders');
    expect(rowTexts().length).toBe(9);

    // 非法区间：就地提示且不改列表
    await fill('#order-date-from', '2026-10-27');
    await fill('#order-date-to', '2026-10-20');
    expect(html()).toContain('开始日期不能晚于结束日期');
    expect(rowTexts().length).toBe(9);

    // 单日区间含当天：10-23 仅有 EX-1（T0-5d 卖 USD 2,000.00）
    await fill('#order-date-from', '2026-10-23');
    await fill('#order-date-to', '2026-10-23');
    expect(rowTexts().length).toBe(1);
    expect(rowTexts()[0]).toContain('2,000.00 USD');

    // 10-26 ~ 10-28：EX-5/EX-7（10-26）与 EX-8/EX-9（10-27）
    await fill('#order-date-from', '2026-10-26');
    await fill('#order-date-to', '2026-10-28');
    expect(rowTexts().length).toBe(4);
  });

  it('行展开出现关联钱包流水、该订单未平敞口与关联收益单分配明细', async () => {
    await loginAsOps();
    const ex1Id = orderIdOf('USD/EUR', 'SELL_USD', '2000.00'); // EX-1
    const ex2Id = orderIdOf('USD/EUR', 'BUY_USD', '740.08'); // EX-2（自然对冲对手单）
    const closeBatch = useAppStore
      .getState()
      .data.closeBatches.find((batch) => batch.pairId === 'USD/EUR' && batch.status === 'SUCCESS');
    const attemptId = closeBatch?.attempts[0]?.id;
    expect(attemptId).toBeDefined();

    await mount('/ops/trading/orders');
    // 业务键定位：USD/EUR + 卖出 USD + 来源 2,000.00 USD（= EX-1）
    await click(findRow(['USD/EUR', '卖出 USD', '2,000.00 USD']));

    expect(html()).toContain('订单详情');
    expect(html()).toContain(ex1Id);
    // 关联钱包流水：两条（兑换扣款 + 兑换到账）
    expect(html()).toContain('关联钱包流水');
    expect(html()).toContain('兑换扣款');
    expect(html()).toContain('兑换到账');
    // 该订单未平敞口：EX-1 剩余 200 USD（§5.4 金样）+ 建仓基准价 0.9200
    expect(html()).toContain('该订单未平敞口');
    expect(html()).toContain('200.00 USD');
    expect(html()).toContain('0.9200');
    // 关联收益单（1:1）：PO-EX-1 部分实现，累计 +0.40 EUR，含两段分配明细
    expect(html()).toContain(`PO-${ex1Id}`);
    expect(html()).toContain('部分实现');
    expect(html()).toContain('+0.40 EUR');
    expect(html()).toContain('自然对冲');
    expect(html()).toContain('渠道平仓');
    expect(html()).toContain(ex2Id);
    expect(html()).toContain(attemptId ?? '');
  });

  it('敞口两态：EX-2 全额对冲显示“已平尽”，EX-3 未平显示剩余 USD 合计', async () => {
    await loginAsOps();
    await mount('/ops/trading/orders');

    // EX-2（USD/EUR 买 USD，来源 740.08 EUR）成立即与 EX-1 全额自然对冲 → 该订单已平尽
    await click(findRow(['USD/EUR', '买入 USD', '740.08 EUR']));
    expect(html()).toContain('已平尽');
    expect(html()).not.toContain('剩余未平 USD 合计');
    expect(html()).toContain('已结算'); // PO-EX-2 状态徽标

    // EX-3（USD/EUR 卖 USD，来源 1,500.00 USD）全额未平 → 显示剩余合计（§5.4：1,500）
    await click(findRow(['USD/EUR', '卖出 USD', '1,500.00 USD']));
    expect(html()).toContain('剩余未平 USD 合计');
    expect(html()).toContain('1,500.00 USD');
    expect(html()).not.toContain('已平尽');
    expect(html()).toContain('待实现'); // PO-EX-3 状态徽标
  });
});

describe('运营-收益订单', () => {
  it('列表出现 9 张收益单与全部列表列，筛选“已结算”后 3 行', async () => {
    await loginAsOps();
    await mount('/ops/trading/profit-orders');

    expect(html()).toContain('收益订单');
    for (const header of [
      '收益单号',
      '关联订单',
      '客户',
      '币对',
      '方向',
      '名义 USD',
      '已平 USD',
      '未平 USD',
      '累计损益（币种）',
      '状态',
    ]) {
      expect(html()).toContain(header);
    }
    expect(rowTexts().length).toBe(9);
    // PO-EX-1：USD/EUR 多头，名义 2,000.00 USD、已平 1,800.00、未平 200.00、累计 +0.40 EUR、部分实现
    const ex1Row = rowTexts().find((text) => text.includes('2,000.00 USD'));
    expect(ex1Row).toBeDefined();
    expect(ex1Row).toContain('多头');
    expect(ex1Row).toContain('1,800.00 USD');
    expect(ex1Row).toContain('200.00 USD');
    expect(ex1Row).toContain('+0.40 EUR');
    expect(ex1Row).toContain('部分实现');

    // 筛选“已结算” → 3 行（§5.4：PO-EX-2 / PO-EX-5 / PO-EX-9）
    await setSelect('#profit-status', 'SETTLED');
    const settled = rowTexts();
    expect(settled.length).toBe(3);
    expect(settled.every((text) => text.includes('已结算'))).toBe(true);
    // 三张结算单用业务键（关联订单号）交叉验证，而非按下标
    const ex2Id = orderIdOf('USD/EUR', 'BUY_USD', '740.08');
    const ex5Id = orderIdOf('USD/JPY', 'BUY_USD', '300000');
    const ex9Id = orderIdOf('USD/HKD', 'SELL_USD', '400.00');
    for (const id of [ex2Id, ex5Id, ex9Id]) {
      expect(settled.some((text) => text.includes(id))).toBe(true);
    }

    // 再叠加币对筛选：USD/EUR + 已结算 → 仅 PO-EX-2
    await setSelect('#profit-pair', 'USD/EUR');
    const narrowed = rowTexts();
    expect(narrowed.length).toBe(1);
    expect(narrowed[0]).toContain(ex2Id);
  });

  it('行展开出现分配明细：自然对冲/渠道平仓来源、FIFO 序号、基准价、分摊与尾差标记', async () => {
    await loginAsOps();
    const ex1Id = orderIdOf('USD/EUR', 'SELL_USD', '2000.00');
    const ex2Id = orderIdOf('USD/EUR', 'BUY_USD', '740.08');
    const closeBatch = useAppStore
      .getState()
      .data.closeBatches.find((batch) => batch.pairId === 'USD/EUR' && batch.status === 'SUCCESS');
    const attemptId = closeBatch?.attempts[0]?.id;
    expect(attemptId).toBeDefined();

    await mount('/ops/trading/profit-orders');
    // 业务键定位：USD/EUR + 多头 + 名义 2,000.00 USD（= PO-EX-1）
    await click(findRow(['USD/EUR', '多头', '2,000.00 USD']));

    expect(html()).toContain('收益单详情');
    expect(html()).toContain(`PO-${ex1Id}`);
    expect(html()).toContain('分配明细');
    expect(html()).toContain('FIFO 序号');
    expect(html()).toContain('尾差标记');
    expect(html()).toContain('自然对冲');
    expect(html()).toContain('渠道平仓');
    // 两段明细的金额：自然对冲分摊 +0.20 EUR、渠道平仓分摊 +0.20 EUR，累计 +0.40 EUR
    expect(html()).toContain('+0.20 EUR');
    expect(html()).toContain('+0.40 EUR');
    // 来源引用：自然对冲 → 对手订单 EX-2；渠道平仓 → 批次尝试 CB-…-A1
    expect(html()).toContain(ex2Id);
    expect(html()).toContain(attemptId ?? '');
    // 建仓/平仓基准价（§5.4：EX-1 建仓 0.9200；渠道平仓锁定 0.9202）
    expect(html()).toContain('0.9200');
    expect(html()).toContain('0.9202');

    // 待实现单（PO-EX-3：USD/EUR 多头 1,500.00 USD）展开为空明细引导
    await click(findRow(['USD/EUR', '多头', '1,500.00 USD']));
    expect(html()).toContain('暂无分配明细');
  });
});
