// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { setClock } from '@/lib/clock';
import { SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';

// M5 F1 汇率运营「渠道管理 + 币对管理」闭环冒烟（设计文档 §10.3「汇率运营」段、PRD §5.5）：
// 渠道预置出数 → 新增（store +1、CH- 新号、五对路由末尾自动追加）→ 编辑名称（编号不变）→
// 停用（enabled=false 且状态徽标变“停用”）→ 空名称拒绝（零变更）→ 币对页五对出数、停用/恢复。
// 真实 store + 真实领域服务 + 真实路由，断言 store 事实与页面 DOM 双口径；
// 定位一律按业务键（渠道名/编号、币对 id），禁止按下标。

// jsdom 不实现 SubtleCrypto；登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const FIVE_PAIRS = ['USD/EUR', 'USD/GBP', 'USD/JPY', 'USD/CNH', 'USD/HKD'];

let container: HTMLDivElement;
let root: Root;

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

/** 行内按钮按精确文案定位（同一行存在“编辑/停用”等多个按钮） */
function rowButton(row: HTMLTableRowElement, label: string): HTMLButtonElement {
  const button = Array.from(row.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`行内未找到按钮「${label}」`);
  return button;
}

/** 弹层按钮按精确文案定位（Portal 挂到 document.body，不在 container 内） */
function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`弹层按钮不存在「${label}」`);
  return button;
}

/** 以原生 setter + input 事件写入输入框（React 19 监听原生 input） */
async function fillWithin(scope: ParentNode, selector: string, value: string): Promise<void> {
  const element = scope.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`输入控件不存在：${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
  });
  // 写操作走 async apply：再刷一轮微任务，确保命令结果已落到 store 与页面
  await act(async () => {});
}

/** 按业务键（多个文案片段同时命中）定位数据行 */
function findRow(needles: string[]): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((item) =>
    needles.every((needle) => item.textContent?.includes(needle)),
  );
  if (!row) throw new Error(`按业务键未找到行：${needles.join(' + ')}`);
  return row;
}

/** 行内状态徽标文案（状态 = 文字 + 颜色双通道中的文字口径） */
function rowStatus(row: HTMLTableRowElement): string {
  return row.querySelector('[data-slot="badge"]')?.textContent?.trim() ?? '';
}

/** 按业务键取 store 渠道事实（渠道号唯一） */
function channelOf(id: string) {
  const channel = useAppStore.getState().data.fxConfig.channels.find((item) => item.id === id);
  if (!channel) throw new Error(`store 中不存在渠道 ${id}`);
  return channel;
}

/** 按业务键取 store 币对事实（币对 id 唯一） */
function pairOf(pairId: string) {
  const pair = useAppStore.getState().data.fxConfig.pairs.find((item) => item.id === pairId);
  if (!pair) throw new Error(`store 中不存在币对 ${pairId}`);
  return pair;
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

describe('渠道管理', () => {
  it('渠道页预置出数：三个渠道的编号、名称与启停状态', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/channels');

    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(rowStatus(findRow(['CH-01', '华星清算']))).toBe('启用');
    expect(rowStatus(findRow(['CH-02', '北岭报价']))).toBe('启用');
    expect(rowStatus(findRow(['CH-03', '青屿流动池']))).toBe('停用');
    // 页头口径提示：停用影响选源/平仓渠道，不影响历史订单与快照
    expect(text()).toContain('渠道状态影响客户报价选源与平仓可选渠道');
    expect(text()).toContain('停用不影响历史订单与快照');
  });

  it('新增渠道「测试渠道X」：store +1、CH- 新号、五对路由末尾自动追加且页面出数', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/channels');
    const beforeCount = useAppStore.getState().data.fxConfig.channels.length;

    await fillWithin(container, '#channel-name', '测试渠道X');
    await click(pageButton('新增渠道'));

    const state = useAppStore.getState().data;
    expect(state.fxConfig.channels.length).toBe(beforeCount + 1);
    const created = state.fxConfig.channels.find((channel) => channel.name === '测试渠道X');
    expect(created).toBeDefined();
    if (!created) return;
    expect(created.id.startsWith('CH-')).toBe(true);
    expect(created.enabled).toBe(true);

    // 五对路由末尾均自动追加新渠道 id（保持“路由覆盖全部渠道”）
    expect(state.fxConfig.routing).toHaveLength(5);
    for (const rule of state.fxConfig.routing) {
      expect(rule.channelIds.at(-1)).toBe(created.id);
      expect(rule.channelIds).toHaveLength(beforeCount + 1);
    }

    // 页面：新渠道名称与编号出现在列表
    expect(rowStatus(findRow([created.id, '测试渠道X']))).toBe('启用');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(beforeCount + 1);
  });

  it('编辑 CH-01 名称保存：store 名称变更、编号不变，页面显示新名称', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/channels');
    expect(channelOf('CH-01').name).toBe('华星清算');

    await click(rowButton(findRow(['CH-01', '华星清算']), '编辑'));
    const input = document.querySelector('#channel-edit-name');
    expect((input as HTMLInputElement | null)?.value).toBe('华星清算');
    await fillWithin(document, '#channel-edit-name', '华星清算·修订');
    await click(dialogButton('保存'));

    const updated = channelOf('CH-01');
    expect(updated.name).toBe('华星清算·修订');
    expect(updated.id).toBe('CH-01');
    expect(useAppStore.getState().data.fxConfig.channels).toHaveLength(3);
    // 页面原行显示新名称，状态不变
    expect(rowStatus(findRow(['CH-01', '华星清算·修订']))).toBe('启用');
  });

  it('停用 CH-02：store.enabled=false 且该行状态徽标显示“停用”，可再启用恢复', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/channels');
    expect(channelOf('CH-02').enabled).toBe(true);

    await click(rowButton(findRow(['CH-02', '北岭报价']), '停用'));
    expect(channelOf('CH-02').enabled).toBe(false);
    expect(rowStatus(findRow(['CH-02', '北岭报价']))).toBe('停用');

    // 启停可逆（不做物理删除）：再启用恢复
    await click(rowButton(findRow(['CH-02', '北岭报价']), '启用'));
    expect(channelOf('CH-02').enabled).toBe(true);
    expect(rowStatus(findRow(['CH-02', '北岭报价']))).toBe('启用');
  });

  it('空名称提交被拒：就地展示领域中文提示且 store 零变更', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/channels');
    const before = useAppStore.getState().data;

    await fillWithin(container, '#channel-name', '   ');
    await click(pageButton('新增渠道'));

    expect(text()).toContain('请输入渠道名称');
    // 失败路径零变更：data 引用不变
    expect(useAppStore.getState().data).toBe(before);
    expect(useAppStore.getState().data.fxConfig.channels).toHaveLength(3);
  });

  it('编辑弹层空名称被拒：弹层内就地展示领域中文提示且 store 零变更', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/channels');
    const before = useAppStore.getState().data;

    await click(rowButton(findRow(['CH-01', '华星清算']), '编辑'));
    await fillWithin(document, '#channel-edit-name', '');
    await click(dialogButton('保存'));

    expect(document.body.textContent ?? '').toContain('请输入渠道名称');
    expect(useAppStore.getState().data).toBe(before);
    expect(channelOf('CH-01').name).toBe('华星清算');
    // 校验失败不关闭弹层，便于修改后重试
    expect(document.querySelector('#channel-edit-name')).not.toBeNull();
  });
});

describe('币对管理', () => {
  it('五对出数；停用 USD/EUR 双向不可报价，再启用恢复', async () => {
    await loginOpsSeed();
    await mount('/ops/fx/pairs');

    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
    for (const pairId of FIVE_PAIRS) {
      expect(rowStatus(findRow([pairId]))).toBe('启用');
    }
    expect(text()).toContain('停用后双向不可报价');
    expect(text()).toContain('配置保存仅影响新报价');
    expect(pairOf('USD/EUR').enabled).toBe(true);

    // 停用 USD/EUR：开关点击 → store 落库 + 行内徽标变“停用”
    const switchOf = (row: HTMLTableRowElement) => row.querySelector('input[type="checkbox"]');
    await click(switchOf(findRow(['USD/EUR'])));
    expect(pairOf('USD/EUR').enabled).toBe(false);
    expect(rowStatus(findRow(['USD/EUR']))).toBe('停用');

    // 再启用恢复：启停只影响之后的新报价，历史订单/锁价快照不变
    await click(switchOf(findRow(['USD/EUR'])));
    expect(pairOf('USD/EUR').enabled).toBe(true);
    expect(rowStatus(findRow(['USD/EUR']))).toBe('启用');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  });
});
