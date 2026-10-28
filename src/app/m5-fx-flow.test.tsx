// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { D, fmtMoney, fmtRate, roundCcy, toRateSig12 } from '@/domain/money';
import { fxConfigCommands } from '@/domain/services/fx-config.service';
import type { Channel, PairId, Quote, RawPrice } from '@/domain/types';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, loginOps, useAppStore } from '@/store';

// M5 J4 报价链路冒烟（设计文档 §12.3 J4，jsdom 真实 store + 真实路由渲染）：
// 采集池模拟采集（价与时间刷新）→ 客户端取价命中主渠道新价 → 停用主渠道回退次渠道并展示实际渠道
// → 停用全部启用渠道「无报价 + 逐渠道中文原因」→ 恢复配置重新可取价 → 加点调整只对新报价生效（历史订单快照零变更）。
// WHY 渠道启停经 fxConfigCommands + apply：配置页按钮路径已由 F1 纵切用例覆盖，
// 本旅程聚焦「配置变更 → 报价选源」的端到端语义；报价一律 store 事实 + DOM 双口径断言。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
/** 金样锚点：J4 走 USD/EUR（路由首位 CH-01 华星清算） */
const PAIR: PairId = 'USD/EUR';
const CHANNEL_MAIN = '华星清算';
const CHANNEL_BACKUP = '北岭报价';
const CHANNEL_DISABLED = '青屿流动池'; // 预置停用但有价

let container: HTMLDivElement;
let root: Root;

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

function findButtonOrNull(scope: ParentNode, label: string): HTMLButtonElement | null {
  return (
    Array.from(scope.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    ) ?? null
  );
}

function findButton(scope: ParentNode, label: string): HTMLButtonElement {
  const button = findButtonOrNull(scope, label);
  if (button === null) throw new Error(`未找到按钮「${label}」`);
  return button;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    // 等一拍宏任务，确保 store.apply 异步链路与重渲染完成后再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function fill(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`表单控件不存在：${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---------- store 事实读取与领域命令（业务键连接，不依赖编号位次） ----------

function fxConfig() {
  return useAppStore.getState().data.fxConfig;
}

function channelByName(name: string): Channel {
  const channel = fxConfig().channels.find((item) => item.name === name);
  if (channel === undefined) throw new Error(`预置渠道不存在：${name}`);
  return channel;
}

function rawPriceOf(pairId: PairId, channelId: string): RawPrice {
  const price = fxConfig().rawPrices.find(
    (item) => item.pairId === pairId && item.channelId === channelId,
  );
  if (price === undefined) throw new Error(`采集价不存在：${pairId} · ${channelId}`);
  return price;
}

function opsId(): string {
  const id = useAppStore.getState().session.ops?.opsAccountId;
  if (id === undefined) throw new Error('运营会话缺失');
  return id;
}

async function setChannelEnabled(channelId: string, enabled: boolean): Promise<void> {
  await act(async () => {
    const result = await useAppStore
      .getState()
      .apply(fxConfigCommands.toggleChannel(opsId(), channelId, enabled));
    if (!result.ok) throw new Error(`渠道启停失败：${result.message}`);
  });
}

async function saveMarkup(halfSpreadBps: number): Promise<void> {
  await act(async () => {
    const result = await useAppStore
      .getState()
      .apply(fxConfigCommands.saveMarkup(opsId(), PAIR, halfSpreadBps));
    if (!result.ok) throw new Error(`加点保存失败：${result.message}`);
  });
}

/** 采集池行定位：币对 + 渠道名同时命中（禁止表格下标） */
function findRow(pairId: PairId, channelName: string): HTMLTableRowElement {
  const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find(
    (item) =>
      (item.textContent ?? '').includes(pairId) && (item.textContent ?? '').includes(channelName),
  );
  if (row === undefined) throw new Error(`未找到行：${pairId} · ${channelName}`);
  return row;
}

/** 客户端兑换页取价（按钮随已有报价在「获取报价 / 重新取价」间切换） */
async function quoteUI(): Promise<Quote | null> {
  await fill('#source-amount', '1000');
  const button = findButtonOrNull(container, '获取报价') ?? findButton(container, '重新取价');
  await click(button);
  return useAppStore.getState().ui.quote;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();

  const customer = SEED_CUSTOMERS[0];
  const opsSpec = SEED_OPS_ACCOUNTS[0];
  if (customer === undefined || opsSpec === undefined) throw new Error('缺少预置账号');
  const clientLogin = await loginClient(customer.email, customer.password);
  if (!clientLogin.ok) throw new Error('客户登录失败');
  const opsLogin = await loginOps(opsSpec.email, opsSpec.password);
  if (!opsLogin.ok) throw new Error('运营登录失败');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('J4 报价链路：采集 → 渠道降级 → 无报价 → 恢复', () => {
  it('模拟采集刷新主渠道价 → 取价命中新价 → 停用回退次渠道 → 全停用无报价+逐渠道原因 → 恢复回主渠道', async () => {
    const main = channelByName(CHANNEL_MAIN);
    const backup = channelByName(CHANNEL_BACKUP);
    const disabled = channelByName(CHANNEL_DISABLED);
    expect(main.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);

    // ① 采集池：模拟采集主渠道行 → 按该币对步长推进、时间刷新为时钟 NOW、页面同步
    await mount('/ops/fx/pool');
    const seq = fxConfig().collectSteps.find((item) => item.pairId === PAIR);
    const step = seq?.steps[seq.nextIndex];
    if (seq === undefined || step === undefined) throw new Error(`${PAIR} 采集步长缺失`);
    const beforeMid = rawPriceOf(PAIR, main.id).mid;
    const expectedMid = toRateSig12(D(beforeMid).mul(D(1).plus(D(step).div(100)))).toString();

    await click(findButton(findRow(PAIR, main.name), '模拟采集'));

    const collected = rawPriceOf(PAIR, main.id);
    expect(collected.mid).toBe(expectedMid);
    expect(collected.mid).not.toBe(beforeMid);
    expect(collected.collectedAt).toBe(NOW);
    expect(findRow(PAIR, main.name).textContent).toContain(fmtRate(collected.mid));

    // ② 客户端取价：命中路由首位（主渠道），mid = 刚采集的新价，展示实际渠道名
    await mount('/app/exchange');
    const first = await quoteUI();
    expect(first?.channelId).toBe(main.id);
    expect(first?.mid).toBe(collected.mid);
    expect(text()).toContain(main.name);
    expect(text()).toContain(fmtRate(collected.mid));
    if (first !== null) expect(text()).toContain(fmtRate(first.clientRate));

    // ③ 停用主渠道 → 回退次渠道（北岭报价），报价卡展示实际成交渠道
    await setChannelEnabled(main.id, false);
    const fallback = await quoteUI();
    expect(fallback?.channelId).toBe(backup.id);
    expect(fallback?.mid).toBe(rawPriceOf(PAIR, backup.id).mid);
    expect(text()).toContain(backup.name);

    // ④ 停用全部启用渠道 → 无报价 + 逐渠道中文原因（含预置停用的第三渠道）
    await setChannelEnabled(backup.id, false);
    const none = await quoteUI();
    expect(none).toBeNull();
    expect(text()).toContain('暂无有效报价');
    expect(text()).toContain('逐渠道诊断');
    for (const channel of [main, backup, disabled]) {
      expect(text()).toContain(channel.name);
    }
    expect(occurrences(text(), '渠道已停用')).toBe(3);

    // ⑤ 恢复配置 → 重新可取价且回到主渠道（采集后的新价仍在）
    await setChannelEnabled(main.id, true);
    await setChannelEnabled(backup.id, true);
    const restored = await quoteUI();
    expect(restored?.channelId).toBe(main.id);
    expect(restored?.mid).toBe(collected.mid);
  });
});

describe('J4 报价链路：加点只对新报价生效', () => {
  it('保存 100 bps 后新报价按新点差计价，历史订单快照零变更', async () => {
    await mount('/app/exchange');

    // 预置对称点差（bps）直接取自 store，不硬编码
    const markup = fxConfig().markups.find((item) => item.pairId === PAIR);
    if (markup === undefined) throw new Error(`${PAIR} 加点配置缺失`);

    const before = await quoteUI();
    expect(before?.halfSpreadBps).toBe(markup.halfSpreadBps);
    if (before !== null) {
      const expectedBefore = toRateSig12(
        D(before.mid).mul(D(1).minus(D(markup.halfSpreadBps).div(10000))),
      ).toString();
      expect(before.clientRate).toBe(expectedBefore);
    }

    const ordersBefore = JSON.stringify(useAppStore.getState().data.orders);

    // 运营调整加点 → 仅影响之后的新报价
    await saveMarkup(100);

    const after = await quoteUI();
    expect(after?.halfSpreadBps).toBe(100);
    if (after === null) throw new Error('加点后取价失败');
    const expectedRate = toRateSig12(D(after.mid).mul(D(1).minus(D(100).div(10000)))).toString();
    expect(after.clientRate).toBe(expectedRate);
    // DOM：新客户价与按新价折算的目标金额同步刷新
    expect(text()).toContain(fmtRate(expectedRate));
    expect(text()).toContain(fmtMoney(after.targetAmount, after.targetCurrency));
    expect(
      D(after.targetAmount).eq(roundCcy(D('1000').mul(expectedRate), after.targetCurrency)),
    ).toBe(true);

    // 历史订单价格快照零变更（加点不影响已成交订单）
    expect(JSON.stringify(useAppStore.getState().data.orders)).toBe(ordersBefore);
  });
});
