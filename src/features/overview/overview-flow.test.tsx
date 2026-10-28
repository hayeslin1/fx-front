// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { setClock } from '@/lib/clock';
import { SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps } from '@/store';

// M4 运营总览纵切（jsdom，真实 store + 真实路由渲染）：
// 覆盖默认区间金样出数、筛选语义（仅影响成交额/订单数）、自定义区间校验（非法不查询）、
// 图表/数据表等价视图切换。时钟固定注入，保证区间边界与新鲜度可确定复现（设计文档 §4.4）。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const OPS_ACCOUNT = SEED_OPS_ACCOUNTS[0];

let container: HTMLDivElement;
let root: Root;

async function mount(path: string): Promise<void> {
  await act(async () => {
    // key 随路径变化强制重建 Router：避免同一实例保留上次导航位置
    root.render(
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

function text(): string {
  return container.textContent ?? '';
}

function byId<T extends Element>(id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (element === null) throw new Error(`未找到元素 #${id}`);
  return element;
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  );
  if (button === undefined) throw new Error(`未找到按钮「${label}」`);
  return button;
}

/** 原生 setter + input 事件：绕过 React 受控值追踪，触发 onChange（与本仓库既有 jsdom 用例同法） */
function setInputValue(id: string, value: string): void {
  const input = byId<HTMLInputElement>(id);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    // 等一拍宏任务，确保状态更新/重渲染全部完成后再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 数据表视图区域（含全部逐日数值，与图表等价；按 aria-label 定位避免与其他表格混淆） */
function seriesRegion(): HTMLElement {
  const region = container.querySelector<HTMLElement>(
    '[role="region"][aria-label="成交额与订单数数据表"]',
  );
  if (region === null) throw new Error('未找到成交额数据表区域（当前可能仍在图表视图）');
  return region;
}

function seriesRows(): HTMLTableRowElement[] {
  return Array.from(seriesRegion().querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

function rowByDate(date: string): HTMLTableRowElement {
  const row = seriesRows().find((item) => item.querySelector('td')?.textContent === date);
  if (row === undefined) throw new Error(`数据表未找到日期行 ${date}`);
  return row;
}

function cellTexts(row: HTMLTableRowElement): string[] {
  return Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent ?? '');
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();

  if (OPS_ACCOUNT === undefined) throw new Error('缺少种子运营账号 OPS-001');
  const login = await loginOps(OPS_ACCOUNT.email, OPS_ACCOUNT.password);
  if (!login.ok) throw new Error(`运营登录失败：${login.message}`);
  await mount('/ops/overview');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('总览渲染（默认近 7 天）', () => {
  it('KPI / 五币对敞口 / 报价健康出金样数值与状态文本', async () => {
    const page = text();

    // 默认区间为「近 7 天」（seed 成交集中在近 5 天）
    expect(buttonByText('近 7 天').getAttribute('aria-pressed')).toBe('true');
    expect(page).toContain('近 7 天（2026-10-22 ~ 2026-10-28，含起止当天）');

    // KPI：9 笔成功订单 USD 腿合计 19,876.87（EX-1..EX-9 金样）
    expect(page).toContain('区间成交额（USD 折算）');
    expect(page).toContain('19,876.87 USD');
    expect(page).toContain('9 笔');

    // 五币对敞口快照（当前值，不受筛选影响）：多/空方向与净 USD
    expect(page).toContain('五币对敞口快照');
    expect(page).toContain('多头');
    expect(page).toContain('空头');
    expect(page).toContain('+1,700.00 USD'); // USD/EUR
    expect(page).toContain('+3,023.13 USD'); // USD/JPY（EX-4 剩余）
    expect(page).toContain('-1,200.00 USD'); // USD/CNH
    expect(page).toContain('-600.00 USD'); // USD/HKD
    expect(page).toContain('可平金额');

    // 报价健康：五币对全部命中首位渠道（USD/JPY 首位为 CH-02 北岭报价）
    expect(page).toContain('报价健康');
    expect(page).toContain('北岭报价');
    expect(page).toContain('华星清算');
    expect(page).toContain('2026-10-28 09:58:00'); // 采集时间 = 锚点 - 2min
    expect(page).toContain('08:00'); // 10min 新鲜度剩余 8 分钟
    expect(page).toContain('正常');

    // 图表默认视图：Recharts accessibilityLayer 生效（role=application + 键盘可达）
    const chartSurface = container.querySelector('svg[role="application"]');
    expect(chartSurface).not.toBeNull();
    expect(chartSurface?.getAttribute('tabindex')).toBe('0');
    // 图例与轴标签齐备（§11.2）
    expect(page).toContain('日期（月-日）');
    expect(page).toContain('成交额（USD）');
  });
});

describe('区间筛选', () => {
  it('切换到近 30 天：范围说明更新、无校验提示，数据表按 30 个自然日出零成交日', async () => {
    await click(buttonByText('近 30 天'));

    expect(buttonByText('近 30 天').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('近 30 天（2026-09-29 ~ 2026-10-28，含起止当天）');
    expect(text()).not.toContain('结束日期不能早于开始日期');
    expect(text()).toContain('19,876.87 USD'); // 区间拉长后成交额不变（seed 全部落在近 5 天）

    await click(buttonByText('数据表'));
    expect(seriesRows()).toHaveLength(30);
  });

  it('切换到今日（空窗）：KPI 归零，敞口与报价健康快照不受筛选影响', async () => {
    await click(buttonByText('今日'));

    expect(text()).toContain('今日（2026-10-28 ~ 2026-10-28，含起止当天）');
    expect(text()).toContain('0.00 USD'); // 区间成交额归零（最近一笔成交在昨日 22:00）
    expect(text()).toContain('0 笔');
    expect(text()).toContain('所选区间暂无成交订单');

    // 当前快照与筛选解耦：敞口/报价健康仍展示 seed 金样
    expect(text()).toContain('+1,700.00 USD');
    expect(text()).toContain('08:00');
    expect(text()).toContain('正常');
    expect(container.querySelector('svg[role="application"]')).not.toBeNull();
  });

  it('自定义区间：合法区间立即查询；end < start 就地提示且保留上次结果（不查询）', async () => {
    // 合法自定义：10-25 ~ 10-26 共 4 笔（1,500 + 6,000 + 1,976.87 + 1,200）
    setInputValue('overview-date-from', '2026-10-25');
    setInputValue('overview-date-to', '2026-10-26');

    expect(buttonByText('自定义').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('自定义区间（2026-10-25 ~ 2026-10-26，含起止当天）');
    expect(text()).toContain('10,676.87 USD');
    expect(text()).toContain('4 笔');

    // 非法区间：结束早于开始 → 就地提示；KPI/范围说明保持上次有效区间结果
    setInputValue('overview-date-to', '2026-10-20');

    const invalid = byId<HTMLInputElement>('overview-date-to');
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    expect(text()).toContain('结束日期不能早于开始日期');
    expect(text()).toContain('自定义区间（2026-10-25 ~ 2026-10-26，含起止当天）');
    expect(text()).toContain('10,676.87 USD');
    expect(text()).toContain('4 笔');
  });
});

describe('图表 / 数据表等价视图', () => {
  it('切到数据表后含与图表等价的逐日数值（含零成交日与订单数）', async () => {
    await click(buttonByText('数据表'));

    // 图表卸载、数据表出现
    expect(container.querySelector('svg[role="application"]')).toBeNull();
    expect(buttonByText('数据表').getAttribute('aria-pressed')).toBe('true');

    const rows = seriesRows();
    expect(rows).toHaveLength(7); // 近 7 天含零成交日
    expect(cellTexts(rowByDate('2026-10-22'))).toEqual(['2026-10-22', '0.00 USD', '0']);
    expect(cellTexts(rowByDate('2026-10-23'))).toEqual(['2026-10-23', '2,000.00 USD', '1']);
    expect(cellTexts(rowByDate('2026-10-24'))).toEqual(['2026-10-24', '5,800.00 USD', '2']);
    expect(cellTexts(rowByDate('2026-10-25'))).toEqual(['2026-10-25', '7,500.00 USD', '2']);
    expect(cellTexts(rowByDate('2026-10-26'))).toEqual(['2026-10-26', '3,176.87 USD', '2']);
    expect(cellTexts(rowByDate('2026-10-27'))).toEqual(['2026-10-27', '1,400.00 USD', '2']);
    expect(cellTexts(rowByDate('2026-10-28'))).toEqual(['2026-10-28', '0.00 USD', '0']);
    expect(text()).toContain('区间合计：19,876.87 USD · 9 笔');

    // 切回图表：等价视图可往返
    await click(buttonByText('图表'));
    expect(container.querySelector('svg[role="application"]')).not.toBeNull();
  });
});
