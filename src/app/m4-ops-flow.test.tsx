// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { D } from '@/domain/money';
import { setClock } from '@/lib/clock';
import { SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';
import { selectLedger } from '@/store/selectors';

// M4 J3 运营交易闭环冒烟（设计文档 §12.3）：总览筛选切换（趋势变化、快照不动）→
// 订单核对 → 敞口页 → 新建平仓（成功）→ 失败批次整批重试（重新校验并锁价）→
// 收益单未平/状态与分配明细随迭代变化核对。
// 真实 store + 真实领域服务 + 真实路由，断言 store 事实与页面 DOM 双口径。
// EX-n / PO-EX-n / CB-n 为 §5.4 业务编号：一律按业务键（币对|方向|金额）定位，禁止下标。

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

function text(): string {
  return container.textContent ?? '';
}

async function mount(path: string): Promise<void> {
  await act(async () => {
    root.render(
      // key 随路径变化强制重建 Router：否则同一 Router 实例会保留上次导航位置
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

async function loginOpsSeed(): Promise<void> {
  const spec = SEED_OPS_ACCOUNTS[0];
  if (!spec) throw new Error('预置运营账号缺失');
  const result = await loginOps(spec.email, spec.password);
  expect(result.ok).toBe(true);
}

/** 页面内按钮按包含文案定位（图标不产生 textContent，故不用精确相等） */
function pageButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) throw new Error(`未找到页面按钮「${label}」`);
  return button;
}

/** 弹层按钮按精确文案定位（Portal 挂到 document.body，不在 container 内） */
function dialogButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
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

/** 弹层内的下拉（同样经 Portal 挂到 document.body） */
async function setDialogSelect(selector: string, value: string): Promise<void> {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`弹层下拉不存在：${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** 按业务键（多个文案片段同时命中）定位数据行 */
function findRow(needles: string[]): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((item) =>
    needles.every((needle) => item.textContent?.includes(needle)),
  );
  if (!row) throw new Error(`按业务键未找到行：${needles.join(' + ')}`);
  return row;
}

/** 按业务键（币对|方向|来源金额）定位订单 id */
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

/** 总览「成交额与订单数数据表」区域内的数据行（按 aria-label 定位避免与报价健康表混淆） */
function seriesRows(): HTMLTableRowElement[] {
  const region = container.querySelector<HTMLElement>(
    '[role="region"][aria-label="成交额与订单数数据表"]',
  );
  if (region === null) throw new Error('未找到成交额数据表区域（当前可能仍在图表视图）');
  return Array.from(region.querySelectorAll<HTMLTableRowElement>('tbody tr'));
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

describe('J3 运营交易闭环', () => {
  it('总览筛选切换：趋势随区间变化，敞口与报价健康快照不动', async () => {
    await loginOpsSeed();
    await mount('/ops/overview');

    // 默认近 7 天：9 笔金样 19,876.87
    expect(text()).toContain('19,876.87 USD');
    expect(text()).toContain('9 笔');

    // 数据表视图：近 7 天含零成交日共 7 行
    await click(pageButton('数据表'));
    expect(seriesRows()).toHaveLength(7);

    // 切今日：KPI 归零、趋势变单日，快照（敞口/报价健康）原样
    await click(pageButton('今日'));
    expect(text()).toContain('0.00 USD');
    expect(text()).toContain('0 笔');
    expect(seriesRows()).toHaveLength(1);
    expect(text()).toContain('+1,700.00 USD');
    expect(text()).toContain('正常');
  });

  it('订单核对 → 敞口页：EX-1 剩余 200 与 PO-EX-1 +0.40 EUR，敞口明细可对账', async () => {
    await loginOpsSeed();
    const ex1Id = orderIdOf('USD/EUR', 'SELL_USD', '2000.00');

    // 交易订单页：9 笔全量，展开 EX-1 核对关联流水/敞口/收益单
    await mount('/ops/trading/orders');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(9);
    await click(findRow(['USD/EUR', '卖出 USD', '2,000.00 USD']));
    expect(html()).toContain('该订单未平敞口');
    expect(html()).toContain('200.00 USD');
    expect(html()).toContain(`PO-${ex1Id}`);
    expect(html()).toContain('+0.40 EUR');

    // 敞口页：净值金样 + USD/EUR 来源明细（EX-1 剩余 200 / EX-3 全部 1,500）
    await mount('/ops/trading/exposure');
    expect(html()).toContain('+1,700.00 USD');
    const usdEurRow = Array.from(container.querySelectorAll('tbody tr')).find((row) =>
      row.textContent?.includes('USD/EUR'),
    );
    await click(usdEurRow?.querySelector('button') ?? null);
    expect(html()).toContain('200.00 USD');
    expect(html()).toContain('1,500.00 USD');
    expect(html()).toContain('0.9200');
    expect(html()).toContain('0.9195');
  });

  it('新建平仓 300 成功：敞口 1,700→1,400（FIFO 先耗 EX-1），PO-EX-1 未平 200→0、部分实现→已结算', async () => {
    await loginOpsSeed();
    const ex1Id = orderIdOf('USD/EUR', 'SELL_USD', '2000.00');
    const poOf = () =>
      selectLedger(useAppStore.getState().data).profitOrders.find(
        (po) => po.customerOrderId === ex1Id,
      );
    const before = poOf();
    expect(before?.status).toBe('PARTIAL');
    expect(before === undefined ? null : D(before.usdOpen).eq('200')).toBe(true);

    // 新建平仓：USD/EUR 300.00、模拟成功（默认渠道 CH-01，锁定 0.9200）
    await mount('/ops/trading/close-batches');
    const batchCount = useAppStore.getState().data.closeBatches.length;
    await fill('#close-amount', '300.00');
    await click(pageButton('提交平仓'));
    expect(document.body.textContent).toContain('确认提交平仓批次');
    await click(dialogButton('确认提交'));
    await act(async () => {});

    const batches = useAppStore.getState().data.closeBatches;
    expect(batches.length).toBe(batchCount + 1);
    expect(batches.at(-1)?.status).toBe('SUCCESS');
    expect(html()).toContain(batches.at(-1)?.id ?? '');

    // 敞口联动：净值 1,700 → 1,400；FIFO 先耗 EX-1 的 200，再耗 EX-3（1,500 → 1,400）
    await mount('/ops/trading/exposure');
    expect(html()).toContain('+1,400.00 USD');
    const usdEurRow = Array.from(container.querySelectorAll('tbody tr')).find((row) =>
      row.textContent?.includes('USD/EUR'),
    );
    await click(usdEurRow?.querySelector('button') ?? null);
    expect(html()).toContain('1,400.00 USD');
    expect(html()).not.toContain('1,500.00 USD');

    // 收益单联动：未平 200→0、部分实现→已结算
    const after = poOf();
    expect(after?.status).toBe('SETTLED');
    expect(after === undefined ? null : D(after.usdOpen).eq('0')).toBe(true);

    await mount('/ops/trading/profit-orders');
    const row = findRow(['USD/EUR', '多头', '2,000.00 USD']);
    expect(row.textContent).toContain('已结算');
    expect(row.textContent).toContain('0.00 USD');
  });

  it('CB-2 失败批次整批重试：按当前价池重新锁定并转 SUCCESS，收益单未平冲减且明细出现新尝试', async () => {
    await loginOpsSeed();
    const state = useAppStore.getState().data;
    const failed = state.closeBatches.find((batch) => batch.status === 'FAILED');
    expect(failed).toBeDefined();
    if (failed === undefined) return;

    const jpyProfitOrders = () =>
      selectLedger(useAppStore.getState().data).profitOrders.filter(
        (po) => po.pairId === 'USD/JPY',
      );
    const openOf = new Map(jpyProfitOrders().map((po) => [po.id, D(po.usdOpen)]));
    const sumBefore = jpyProfitOrders().reduce((acc, po) => acc.plus(D(po.usdOpen)), D('0'));

    // 整批重试：弹层预填原渠道，显式重选后提交（服务侧重校验并重新锁价）
    await mount('/ops/trading/close-batches');
    await click(pageButton('整批重试'));
    const channelSelect = document.querySelector('#retry-channel');
    expect((channelSelect as HTMLSelectElement | null)?.value).toBe(failed.channelId);
    await setDialogSelect('#retry-channel', 'CH-02');
    await click(dialogButton('确认重试'));
    await act(async () => {});

    const retried = useAppStore
      .getState()
      .data.closeBatches.find((batch) => batch.id === failed.id);
    expect(retried?.status).toBe('SUCCESS');
    expect(retried?.attempts.length).toBe(2);
    const second = retried?.attempts[1];
    expect(second?.index).toBe(2);
    // 重新锁价：锁定值 = 价池中 CH-02 该币对最新原始价（151.00）
    const latestCh02 = useAppStore
      .getState()
      .data.fxConfig.rawPrices.filter(
        (price) => price.pairId === 'USD/JPY' && price.channelId === 'CH-02',
      )
      .sort((a, b) => b.collectedAt - a.collectedAt)[0];
    expect(latestCh02).toBeDefined();
    expect(second === undefined ? null : D(second.lockedMid).eq(latestCh02?.mid ?? '')).toBe(true);

    // 收益单未平合计按批次金额冲减；至少一张 USD/JPY 收益单被冲减
    const sumAfter = jpyProfitOrders().reduce((acc, po) => acc.plus(D(po.usdOpen)), D('0'));
    expect(sumAfter.eq(sumBefore.minus(D(failed.usdAmount)))).toBe(true);
    const changed = jpyProfitOrders().find((po) => {
      const before = openOf.get(po.id);
      return before !== undefined && D(po.usdOpen).lt(before);
    });
    expect(changed).toBeDefined();
    if (changed === undefined) return;

    // 页面核对：被冲减收益单展开后出现第二次尝试（渠道平仓来源）
    await mount('/ops/trading/profit-orders');
    await click(findRow([changed.id]));
    expect(html()).toContain(second?.id ?? '');
    expect(html()).toContain('渠道平仓');
  });
});
