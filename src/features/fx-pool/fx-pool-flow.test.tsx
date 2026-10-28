// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { D, fmtRate, toRateSig12 } from '@/domain/money';
import { fxConfigCommands } from '@/domain/services/fx-config.service';
import type { Channel, CollectStepSeq, PairId, RawPrice } from '@/domain/types';
import { setClock } from '@/lib/clock';
import { formatDateTime } from '@/lib/format';
import { SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';

// M5 F2 汇率运营-采集池纵切（jsdom，真实 store + 真实路由渲染，装配范式同 app/routes.test.tsx）：
// 覆盖全量行出数（币对×渠道）、单行模拟采集的确定性步长与游标前移、全部采集（每币对同一步长、游标仅前移一次）、
// 报价启用开关、有效状态三态（渠道停用/有效）与新增渠道首采（§5.4：无价渠道以该币对最新原始价为基准步进）。
// WHY 断言 store 事实 + DOM 双口径：价格推进与 nextIndex 持久化是领域事实，
// 页面只负责展示；行一律按业务键（币对 + 渠道名）定位，禁止表格下标。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
/** 金样锚点：设计文档 §5.4 交易脚本直接引用的币对（USD/JPY 主渠道非路由首位，此处取标准对） */
const PAIR_EUR: PairId = 'USD/EUR';
const PAIR_GBP: PairId = 'USD/GBP';

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
    // key 随路径变化强制重建 Router：避免同一实例保留上次导航位置
    root.render(
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

/** DOM 内表格数据行数 */
function tableRowCount(): number {
  return container.querySelectorAll('tbody tr').length;
}

/** 业务键定位行：币对 + 渠道名同时命中（禁止下标） */
function findRow(pairId: PairId, channelName: string): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find(
    (item) =>
      (item.textContent ?? '').includes(pairId) && (item.textContent ?? '').includes(channelName),
  );
  if (row === undefined) throw new Error(`未找到行：${pairId} · ${channelName}`);
  return row;
}

/** 按钮按文案定位（可指定作用域：行内「模拟采集」/页头「全部采集」） */
function findButton(scope: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label),
  );
  if (button === undefined) throw new Error(`未找到按钮「${label}」`);
  return button;
}

/** 行内报价启用开关（role="switch"） */
function switchOf(row: HTMLTableRowElement): HTMLButtonElement {
  const element = row.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (element === null) throw new Error('该行没有报价启用开关');
  return element;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    // 等一拍宏任务，确保 store.apply 异步链路与重渲染完成后再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------- store 事实读取（业务键连接，不依赖预置编号位次） ----------

function fxConfig() {
  return useAppStore.getState().data.fxConfig;
}

function channelEnabled(): Channel {
  const channel = fxConfig().channels.find((item) => item.enabled);
  if (channel === undefined) throw new Error('预置数据中缺少启用渠道');
  return channel;
}

function channelDisabled(): Channel | undefined {
  return fxConfig().channels.find((item) => !item.enabled);
}

function rawPriceOf(pairId: PairId, channelId: string): RawPrice {
  const price = fxConfig().rawPrices.find(
    (item) => item.pairId === pairId && item.channelId === channelId,
  );
  if (price === undefined) throw new Error(`采集价不存在：${pairId} · ${channelId}`);
  return price;
}

function stepOf(pairId: PairId): CollectStepSeq {
  const seq = fxConfig().collectSteps.find((item) => item.pairId === pairId);
  if (seq === undefined) throw new Error(`采集步长不存在：${pairId}`);
  return seq;
}

/** 与实现同口径：mid × (1 + step/100)，12 位有效位 */
function expectedMid(mid: string, step: string): string {
  return toRateSig12(D(mid).mul(D(1).plus(D(step).div(100)))).toString();
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();

  const opsSpec = SEED_OPS_ACCOUNTS[0];
  if (opsSpec === undefined) throw new Error('缺少预置运营账号');
  const login = await loginOps(opsSpec.email, opsSpec.password);
  if (!login.ok) throw new Error('运营登录失败');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('采集池全量视图', () => {
  it('表格行数 = 币对×渠道实况（与 store.fxConfig.rawPrices 一致，不硬编码）', async () => {
    await mount('/ops/fx/pool');

    const { pairs, channels, rawPrices } = fxConfig();
    expect(tableRowCount()).toBe(rawPrices.length);
    // 预置（§5.4）：三渠道五币对均有采集价，全量交叉行数 = rawPrices 长度
    expect(tableRowCount()).toBe(pairs.length * channels.length);

    // 每一条采集价都能按业务键（币对 + 渠道名）在表中找到行
    for (const price of rawPrices) {
      const channel = channels.find((item) => item.id === price.channelId);
      if (channel === undefined) throw new Error(`渠道不存在：${price.channelId}`);
      const row = findRow(price.pairId, channel.name);
      expect(row.textContent).toContain(fmtRate(price.mid));
    }

    // 页头操作入口存在，且列头口径完整
    expect(findButton(container, '全部采集')).toBeDefined();
    for (const header of ['币对', '渠道', '原始中间价', '采集时间', '报价启用', '有效状态']) {
      expect(html()).toContain(`>${header}</th>`);
    }
  });

  it('页头说明文案存在（同一步长推进 / 新增渠道无初始采集价）', async () => {
    await mount('/ops/fx/pool');
    expect(text()).toContain('同一币对各渠道按同一步长推进，保持渠道间价差关系');
    expect(text()).toContain('新增渠道无初始采集价，须先采集后才参与报价');
  });

  it('有效状态实时计算：停用渠道行「渠道停用」，启用且新鲜行「有效」', async () => {
    await mount('/ops/fx/pool');

    const enabled = channelEnabled();
    expect(findRow(PAIR_EUR, enabled.name).textContent).toContain('有效');

    // 时钟锚点 = seed 锚点：全部预置采集价为 2 分钟前，处于 10 分钟新鲜度内（§5.4）
    expect(NOW - rawPriceOf(PAIR_EUR, enabled.id).collectedAt).toBeLessThanOrEqual(10 * 60_000);

    const disabled = channelDisabled();
    if (disabled !== undefined) {
      // 预置 CH-03 停用（用于演示启停）：与新鲜度无关，优先展示「渠道停用」
      expect(findRow(PAIR_EUR, disabled.name).textContent).toContain('渠道停用');
    }
  });
});

describe('行级模拟采集', () => {
  it('按步长序列推进该行价格、刷新时间、该币对游标前移一次，其他币对不动', async () => {
    await mount('/ops/fx/pool');

    const channel = channelEnabled();
    const beforePrice = rawPriceOf(PAIR_EUR, channel.id);
    const beforeStep = stepOf(PAIR_EUR);
    const step = beforeStep.steps[beforeStep.nextIndex];
    if (step === undefined) throw new Error('采集步长序列为空');
    const otherSteps = fxConfig().collectSteps.filter((seq) => seq.pairId !== PAIR_EUR);
    const beforeRowText = findRow(PAIR_EUR, channel.name).textContent ?? '';

    await click(findButton(findRow(PAIR_EUR, channel.name), '模拟采集'));

    // store 事实：mid = 原值 × (1 + 当前步长/100)（12 位有效位），collectedAt = 时钟 NOW
    const afterPrice = rawPriceOf(PAIR_EUR, channel.id);
    expect(afterPrice.mid).toBe(expectedMid(beforePrice.mid, step));
    expect(afterPrice.collectedAt).toBe(NOW);
    expect(afterPrice.quoteEnabled).toBe(beforePrice.quoteEnabled);

    // 仅该币对游标循环前移一次；其他币对游标与价格零变更
    const afterStep = stepOf(PAIR_EUR);
    expect(afterStep.nextIndex).toBe((beforeStep.nextIndex + 1) % beforeStep.steps.length);
    for (const before of otherSteps) {
      expect(stepOf(before.pairId).nextIndex).toBe(before.nextIndex);
    }
    expect(rawPriceOf(PAIR_GBP, channel.id).mid).toBe('0.785');

    // 页面：该行价格与采集时间文本即时刷新
    const afterRowText = findRow(PAIR_EUR, channel.name).textContent ?? '';
    expect(afterRowText).not.toBe(beforeRowText);
    expect(afterRowText).toContain(fmtRate(afterPrice.mid));
    expect(afterRowText).toContain(formatDateTime(NOW));
  });
});

describe('全部采集', () => {
  it('全部行时间 = NOW，每个币对仅前移一次且各渠道按同一步长推进', async () => {
    await mount('/ops/fx/pool');

    const beforePrices = new Map(
      fxConfig().rawPrices.map((price) => [`${price.pairId}::${price.channelId}`, { ...price }]),
    );
    const beforeSteps = new Map(fxConfig().collectSteps.map((seq) => [seq.pairId, { ...seq }]));
    const rowCountBefore = tableRowCount();

    await click(findButton(container, '全部采集'));

    const { rawPrices, collectSteps } = fxConfig();
    expect(rawPrices).toHaveLength(beforePrices.size);
    for (const price of rawPrices) {
      const before = beforePrices.get(`${price.pairId}::${price.channelId}`);
      const beforeStep = beforeSteps.get(price.pairId);
      if (before === undefined || beforeStep === undefined) throw new Error('快照缺失');
      const step = beforeStep.steps[beforeStep.nextIndex];
      if (step === undefined) throw new Error('采集步长序列为空');
      expect(price.collectedAt).toBe(NOW);
      expect(price.mid).toBe(expectedMid(before.mid, step));
    }

    // 每个币对 nextIndex 仅前移一次
    for (const seq of collectSteps) {
      const before = beforeSteps.get(seq.pairId);
      if (before === undefined) throw new Error('步长快照缺失');
      expect(seq.nextIndex).toBe((before.nextIndex + 1) % before.steps.length);
    }

    // 页面行数与时间列同步刷新（任取一行按业务键核对）
    expect(tableRowCount()).toBe(rowCountBefore);
    const row = findRow('USD/JPY', channelEnabled().name);
    expect(row.textContent).toContain(formatDateTime(NOW));
  });
});

describe('报价启用开关', () => {
  it('关闭某行 → 仅该（币对,渠道）quoteEnabled=false，且不改变有效状态（§6.5 口径）', async () => {
    await mount('/ops/fx/pool');

    const channel = channelEnabled();
    const other = fxConfig().channels.find((item) => item.id !== channel.id);
    if (other === undefined) throw new Error('预置渠道不足');
    const row = findRow(PAIR_EUR, channel.name);
    expect(switchOf(row).getAttribute('aria-checked')).toBe('true');

    await click(switchOf(row));

    expect(rawPriceOf(PAIR_EUR, channel.id).quoteEnabled).toBe(false);
    expect(rawPriceOf(PAIR_EUR, other.id).quoteEnabled).toBe(true);
    expect(rawPriceOf(PAIR_GBP, channel.id).quoteEnabled).toBe(true);

    const afterRow = findRow(PAIR_EUR, channel.name);
    expect(switchOf(afterRow).getAttribute('aria-checked')).toBe('false');
    expect(afterRow.textContent).toContain('关闭');
    // 报价启用只约束客户报价选源：有效状态（渠道启用 && ≤10min）不受影响
    expect(afterRow.textContent).toContain('有效');
    // 价格与采集时间不变
    expect(rawPriceOf(PAIR_EUR, channel.id).mid).toBe('0.92');
  });
});

describe('采集失败', () => {
  it('无采集价的渠道行展示「暂无采集价」，首采（模拟采集）按基准步进生成首价（§5.4）', async () => {
    await mount('/ops/fx/pool');

    // 新增渠道（§5.4）：无初始采集价，须先采集 — 经真实领域命令写入 store
    const operatorId = useAppStore.getState().session.ops?.opsAccountId;
    if (operatorId === undefined) throw new Error('运营会话缺失');
    const newChannelName = '演示新增渠道';
    await act(async () => {
      const created = await useAppStore
        .getState()
        .apply(fxConfigCommands.upsertChannel(operatorId, { name: newChannelName, enabled: true }));
      expect(created.ok).toBe(true);
    });
    const channelId = fxConfig().channels.find((c) => c.name === newChannelName)?.id;
    if (channelId === undefined) throw new Error('新渠道未写入 store');

    const row = findRow(PAIR_EUR, newChannelName);
    expect(row.textContent).toContain('暂无采集价');
    // 无价渠道不可切换报价开关
    expect(switchOf(row).disabled).toBe(true);

    // 首采基准（§5.4）= 该币对采集前最新一条原始价（collectedAt 最新、并列取先出现者）；
    // 预期首价 = 基准 × (1 + 当前步长/100)，12 位有效位
    let base: RawPrice | undefined;
    for (const price of fxConfig().rawPrices) {
      if (price.pairId !== PAIR_EUR) continue;
      if (base === undefined || price.collectedAt > base.collectedAt) base = price;
    }
    if (base === undefined) throw new Error(`${PAIR_EUR} 基准价缺失`);
    const seq = fxConfig().collectSteps.find((s) => s.pairId === PAIR_EUR);
    if (seq === undefined) throw new Error(`${PAIR_EUR} 步长缺失`);
    const step = seq.steps[seq.nextIndex];
    if (step === undefined) throw new Error(`${PAIR_EUR} 步长越界`);
    const expected = toRateSig12(D(base.mid).mul(D(1).plus(D(step).div(100)))).toString();

    await click(findButton(row, '模拟采集'));

    // 首价已生成：落库 12 位有效位、时间刷新为时钟 NOW、报价开关默认为开
    const price = fxConfig().rawPrices.find(
      (item) => item.pairId === PAIR_EUR && item.channelId === channelId,
    );
    expect(price?.mid).toBe(expected);
    expect(price?.collectedAt).toBe(NOW);
    expect(price?.quoteEnabled).toBe(true);

    // 页面即时刷新：不再显示「暂无采集价」，开关可切换
    const refreshed = findRow(PAIR_EUR, newChannelName);
    expect(refreshed.textContent).not.toContain('暂无采集价');
    expect(switchOf(refreshed).disabled).toBe(false);
  });
});
