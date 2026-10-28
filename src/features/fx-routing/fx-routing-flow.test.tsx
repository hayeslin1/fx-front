// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { PAIR_IDS } from '@/domain/constants';
import type { PairId } from '@/domain/types';
import { setClock } from '@/lib/clock';
import { SEED_OPS_ACCOUNTS, SEED_ROUTING } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';

// 汇率运营纵切（M5 F3：路由配置 + 加点配置）渲染用例。
// 装配范式同 app/routes.test.tsx（真实 createRoot + MemoryRouter + 真实守卫），
// 断言 DOM 与 store 事实双口径；行/控件一律按业务键（币对、渠道名）定位，禁止下标。
// 金样来源：设计文档 §5.4（USD/EUR…[CH-01, CH-02, CH-03]；USD/JPY…[CH-02, CH-01, CH-03]；
// 加点五对均 50 bps/侧）。

// jsdom 不实现 SubtleCrypto；登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();

/** 预置渠道名（业务键；CH-03 停用仍须留在路由中） */
const CHANNEL_NAMES = ['华星清算', '北岭报价', '青屿流动池'] as const;

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

/** 表格数据行文案（仅 tbody 的 tr，不含 thead） */
function rowTexts(): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
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

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function flush(): Promise<void> {
  await act(async () => {});
}

/** 以原生 setter + input 事件写入输入框（React 19 监听原生 input） */
async function fillInput(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---------- 业务键定位（币对 / 渠道名），禁止下标 ----------

/** 币对切换按钮（按钮文案含币对；未保存徽标也在按钮内，用 includes 匹配） */
function findPairTab(pairId: PairId): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(pairId),
  );
  if (!button) throw new Error(`未找到币对切换按钮：${pairId}`);
  return button;
}

/** 页面级按钮（按精确文案：保存 / 重置） */
function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

/** 数据行按渠道名定位（路由页） */
function rowByChannel(name: string): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((item) =>
    item.textContent?.includes(name),
  );
  if (!row) throw new Error(`未找到渠道行：${name}`);
  return row;
}

/** 数据行按币对定位（加点页） */
function rowByPair(pairId: PairId): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((item) =>
    item.textContent?.includes(pairId),
  );
  if (!row) throw new Error(`未找到币对行：${pairId}`);
  return row;
}

/** 行内按钮（上移 / 下移 / 该行保存） */
function rowButton(row: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(row.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`行内未找到按钮：${label}`);
  return button;
}

/** 加点输入框（aria-label 含币对） */
function markupInput(pairId: PairId): HTMLInputElement {
  const input = container.querySelector(`input[aria-label="${pairId} 每侧点差 bps"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`未找到点差输入框：${pairId}`);
  return input;
}

/** 某列（按表头文案）的全部单元格文案 */
function columnTexts(header: string): string[] {
  const headers = Array.from(container.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => th.textContent?.trim() === header);
  if (index < 0) throw new Error(`未找到列头：${header}`);
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (row) => row.children[index]?.textContent?.trim() ?? '',
  );
}

// ---------- 双口径断言辅助：DOM 顺序 vs store 持久化 ----------

/** store 中某币对路由渠道 id 顺序 */
function storeRoutingIds(pairId: PairId): string[] {
  return (
    useAppStore.getState().data.fxConfig.routing.find((rule) => rule.pairId === pairId)
      ?.channelIds ?? []
  );
}

/** store 某币对路由的渠道名顺序（对照 DOM 文本） */
function storeRoutingNames(pairId: PairId): string[] {
  const channels = useAppStore.getState().data.fxConfig.channels;
  return storeRoutingIds(pairId).map(
    (channelId) => channels.find((channel) => channel.id === channelId)?.name ?? channelId,
  );
}

/** 页面当前展示的渠道顺序（每行恰好一个渠道名） */
function domRoutingOrder(): string[] {
  return rowTexts().map((text) => {
    const name = CHANNEL_NAMES.find((item) => text.includes(item));
    if (name === undefined) throw new Error(`路由行缺少渠道名：${text}`);
    return name;
  });
}

/** “未保存”徽标数量（Badge 元素精确匹配，避免命中说明文案里的同词） */
function unsavedBadgeCount(): number {
  return Array.from(container.querySelectorAll('[data-slot="badge"]')).filter(
    (item) => item.textContent?.trim() === '未保存',
  ).length;
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

describe('运营-汇率运营-路由配置', () => {
  it('USD/JPY 初始顺序 [北岭报价, 华星清算, 青屿流动池]，与 store.routing 一致且无未保存标记', async () => {
    await loginAsOps();
    await mount('/ops/fx/routing');

    // 五对切换器齐备；切到 USD/JPY（金样：主渠道非路由首位）
    for (const pairId of PAIR_IDS) {
      expect(html()).toContain(pairId);
    }
    await click(findPairTab('USD/JPY'));

    expect(storeRoutingIds('USD/JPY')).toEqual(['CH-02', 'CH-01', 'CH-03']);
    expect(domRoutingOrder()).toEqual(['北岭报价', '华星清算', '青屿流动池']);
    // DOM 文本顺序即 store 路由顺序（双口径一致）
    expect(domRoutingOrder()).toEqual(storeRoutingNames('USD/JPY'));
    // 顺序号：首行为 1 且是北岭报价
    expect(rowTexts()[0]).toContain('1');
    expect(rowTexts()[0]).toContain('北岭报价');

    // 未做任何编辑：无“未保存”徽标，保存/重置禁用
    expect(unsavedBadgeCount()).toBe(0);
    expect(findButton('保存').disabled).toBe(true);
    expect(findButton('重置').disabled).toBe(true);
    // 保存即生效口径的页面提示常驻
    expect(html()).toContain('保存即生效，仅影响之后的新报价；历史订单与锁价用快照');
  });

  it('USD/JPY 下移首行 → 保存更新 store 且其它币对不动；再改动后「重置」回持久化值', async () => {
    await loginAsOps();
    await mount('/ops/fx/routing');
    await click(findPairTab('USD/JPY'));

    // 下移首行（北岭报价）：本地草稿序变化，持久化不动
    await click(rowButton(rowByChannel('北岭报价'), '下移'));
    expect(domRoutingOrder()).toEqual(['华星清算', '北岭报价', '青屿流动池']);
    expect(storeRoutingIds('USD/JPY')).toEqual(['CH-02', 'CH-01', 'CH-03']);
    expect(unsavedBadgeCount()).toBeGreaterThan(0);
    expect(findButton('保存').disabled).toBe(false);

    // 保存 → store.routing(USD/JPY) 更新为 [CH-01, CH-02, CH-03]，其它币对逐对不动
    await click(findButton('保存'));
    await flush();
    expect(storeRoutingIds('USD/JPY')).toEqual(['CH-01', 'CH-02', 'CH-03']);
    expect(domRoutingOrder()).toEqual(storeRoutingNames('USD/JPY'));
    for (const pairId of ['USD/EUR', 'USD/GBP', 'USD/CNH', 'USD/HKD'] as const) {
      expect(storeRoutingIds(pairId)).toEqual(SEED_ROUTING[pairId]);
    }
    expect(unsavedBadgeCount()).toBe(0);
    expect(findButton('保存').disabled).toBe(true);

    // 再制造未保存改动（末位上移），「重置」回持久化值（= 刚保存的 [CH-01, CH-02, CH-03]）
    await click(rowButton(rowByChannel('青屿流动池'), '上移'));
    expect(domRoutingOrder()).toEqual(['华星清算', '青屿流动池', '北岭报价']);
    expect(unsavedBadgeCount()).toBeGreaterThan(0);

    await click(findButton('重置'));
    expect(domRoutingOrder()).toEqual(['华星清算', '北岭报价', '青屿流动池']);
    expect(domRoutingOrder()).toEqual(storeRoutingNames('USD/JPY'));
    expect(storeRoutingIds('USD/JPY')).toEqual(['CH-01', 'CH-02', 'CH-03']);
    expect(unsavedBadgeCount()).toBe(0);
  });

  it('USD/JPY 边界：首位「上移」禁用、末位「下移」禁用', async () => {
    await loginAsOps();
    await mount('/ops/fx/routing');
    await click(findPairTab('USD/JPY'));

    // 首位北岭报价：上移禁用、下移可用；末位青屿流动池：下移禁用、上移可用
    expect(rowButton(rowByChannel('北岭报价'), '上移').disabled).toBe(true);
    expect(rowButton(rowByChannel('北岭报价'), '下移').disabled).toBe(false);
    expect(rowButton(rowByChannel('青屿流动池'), '下移').disabled).toBe(true);
    expect(rowButton(rowByChannel('青屿流动池'), '上移').disabled).toBe(false);
  });

  it('USD/EUR 初始 [华星清算, 北岭报价, 青屿流动池]（对照 store.routing）', async () => {
    await loginAsOps();
    await mount('/ops/fx/routing');

    // 默认选中首对 USD/EUR
    expect(storeRoutingIds('USD/EUR')).toEqual(SEED_ROUTING['USD/EUR']);
    expect(storeRoutingIds('USD/EUR')).toEqual(['CH-01', 'CH-02', 'CH-03']);
    expect(domRoutingOrder()).toEqual(['华星清算', '北岭报价', '青屿流动池']);
    expect(domRoutingOrder()).toEqual(storeRoutingNames('USD/EUR'));
  });
});

describe('运营-汇率运营-加点配置', () => {
  it('五对初始 50、服务费列固定 0；USD/EUR 改 100 保存后仅该对变化', async () => {
    await loginAsOps();
    await mount('/ops/fx/markups');

    // 初始：store 五对均 50；DOM 五个输入均为 50
    const markups = useAppStore.getState().data.fxConfig.markups;
    expect(markups.length).toBe(5);
    expect(markups.every((item) => item.halfSpreadBps === 50)).toBe(true);
    expect(rowTexts().length).toBe(5);
    for (const pairId of PAIR_IDS) {
      expect(markupInput(pairId).value).toBe('50');
    }
    // 服务费列固定 0
    expect(columnTexts('服务费')).toEqual(['0', '0', '0', '0', '0']);

    // 修改 USD/EUR = 100 → 保存（仅该行）
    const input = markupInput('USD/EUR');
    await fillInput(input, '100');
    // 有未保存改动：该行保存按钮高亮可点（无改动的行保持禁用）
    expect(rowButton(rowByPair('USD/EUR'), '保存').disabled).toBe(false);
    expect(rowButton(rowByPair('USD/GBP'), '保存').disabled).toBe(true);
    await click(rowButton(rowByPair('USD/EUR'), '保存'));
    await flush();

    const after = useAppStore.getState().data.fxConfig.markups;
    expect(after.find((item) => item.pairId === 'USD/EUR')?.halfSpreadBps).toBe(100);
    for (const pairId of ['USD/GBP', 'USD/JPY', 'USD/CNH', 'USD/HKD'] as const) {
      expect(after.find((item) => item.pairId === pairId)?.halfSpreadBps).toBe(50);
    }
    expect(markupInput('USD/EUR').value).toBe('100');
    // 保存后无错误提示、该行保存按钮回到禁用（无未保存改动）
    expect(rowByPair('USD/EUR').textContent).not.toContain('0–1000');
    expect(rowButton(rowByPair('USD/EUR'), '保存').disabled).toBe(true);
  });

  it('非法输入 1001 / -1 / 50.5 就地报错且 store 零变更', async () => {
    await loginAsOps();
    await mount('/ops/fx/markups');
    const before = useAppStore.getState().data.fxConfig.markups;

    // 超上限 1001：输入即就地中文错误，点击保存被拒
    await fillInput(markupInput('USD/EUR'), '1001');
    expect(rowByPair('USD/EUR').textContent).toContain('每侧点差须为 0–1000 的整数 bps');
    await click(rowButton(rowByPair('USD/EUR'), '保存'));
    await flush();
    expect(useAppStore.getState().data.fxConfig.markups).toEqual(before);

    // 负数 -1：同样就地报错、零变更
    await fillInput(markupInput('USD/EUR'), '-1');
    expect(rowByPair('USD/EUR').textContent).toContain('每侧点差须为 0–1000 的整数 bps');
    await click(rowButton(rowByPair('USD/EUR'), '保存'));
    await flush();
    expect(useAppStore.getState().data.fxConfig.markups).toEqual(before);

    // 非整数 50.5：同样就地报错、零变更
    await fillInput(markupInput('USD/EUR'), '50.5');
    expect(rowByPair('USD/EUR').textContent).toContain('每侧点差须为 0–1000 的整数 bps');
    await click(rowButton(rowByPair('USD/EUR'), '保存'));
    await flush();

    const after = useAppStore.getState().data.fxConfig.markups;
    expect(after).toEqual(before);
    expect(after.find((item) => item.pairId === 'USD/EUR')?.halfSpreadBps).toBe(50);
    expect(markupInput('USD/EUR').value).toBe('50.5');
  });
});
