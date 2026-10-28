// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { D } from '@/domain/money';
import { fxConfigCommands } from '@/domain/services/fx-config.service';
import type { DomainCommand, DomainResult } from '@/domain/types';
import { setClock } from '@/lib/clock';
import { formatDateTime } from '@/lib/format';
import { SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';

// 汇率运营-报价计算器纵切（M5 F4）渲染用例。
// 装配范式同 app/routes.test.tsx（真实 createRoot + MemoryRouter + 真实守卫），
// 断言 DOM 与 store 事实双口径；EX-1 金样（§5.4：2,000.00 USD @0.9200 → 0.9154 → 1,830.80 EUR）
// 与 store.orders 中该单快照交叉断言一致，不凭空造数。
// 只读证明：页面交互过程中 store.apply 零调用（spy 计数），且订单/流水/钱包数量不变、ui.quote 保持 null。

// jsdom 不实现 SubtleCrypto；登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const CALC_PATH = '/ops/fx/calculator';

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

function opsSpec(): { id: string; email: string; password: string } {
  const spec = SEED_OPS_ACCOUNTS[0];
  if (!spec) throw new Error('预置运营账号缺失');
  return spec;
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter key={CALC_PATH} initialEntries={[CALC_PATH]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

async function loginAsOps(): Promise<void> {
  const spec = opsSpec();
  const result = await loginOps(spec.email, spec.password);
  expect(result.ok).toBe(true);
}

/** 运营配置写操作经 store.apply 提交（与真实页面操作路径一致） */
async function applyCommand<T>(cmd: DomainCommand<T>): Promise<void> {
  await act(async () => {
    const result = await useAppStore.getState().apply(cmd);
    expect(result.ok).toBe(true);
  });
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

describe('汇率运营-报价计算器', () => {
  it('SELL_USD USD/EUR 2,000.00 → EX-1 金样（中间价/渠道/客户价/到账，与订单快照一致）', async () => {
    await loginAsOps();

    // 金样交叉来源：store.orders 中 EX-1（USD/EUR 卖出 USD 来源 2,000.00）的成交快照
    const order = useAppStore
      .getState()
      .data.orders.find(
        (o) => o.pairId === 'USD/EUR' && o.direction === 'SELL_USD' && o.sourceAmount === '2000.00',
      );
    expect(order).toBeDefined();
    if (!order) return;
    // 数值断言用 Decimal 相等（store 规范化后 mid 为 '0.92'，与 '0.9200' 等值）
    expect(D(order.snapshot.mid).eq('0.9200')).toBe(true);
    expect(order.snapshot.channelId).toBe('CH-01');
    expect(D(order.snapshot.clientRate).eq('0.9154')).toBe(true);
    expect(D(order.targetAmount).eq('1830.80')).toBe(true);

    await mount();
    // 默认条件即 USD/EUR + 卖出 USD，输入金额后即时试算
    await fill('#calc-amount', '2000.00');

    expect(html()).toContain('0.9200'); // 原始中间价 = EX-1 快照 mid
    expect(html()).toContain('华星清算'); // 选中渠道 = EX-1 快照渠道（CH-01）
    expect(html()).toContain('0.9154'); // 客户成交价 = EX-1 快照 clientRate（bid）
    expect(html()).toContain('bid');
    expect(html()).toContain('1,830.80 EUR'); // 舍入后到账 = EX-1 快照 targetAmount（§5.4 金样）
    expect(html()).toContain('服务费');
    expect(html()).toContain('0.00 USD');

    // 采集时间展示 = store.rawPrices 中该渠道该币对的快照时间（非硬编码）
    const raw = useAppStore
      .getState()
      .data.fxConfig.rawPrices.find((r) => r.pairId === 'USD/EUR' && r.channelId === 'CH-01');
    expect(raw).toBeDefined();
    if (!raw) return;
    expect(html()).toContain(formatDateTime(raw.collectedAt));
  });

  it('方向切换为买入 USD：客户价走 ask（mid ×(1+50bps)），到账以 USD 计价', async () => {
    await loginAsOps();

    const cfg = useAppStore.getState().data.fxConfig;
    const raw = cfg.rawPrices.find((r) => r.pairId === 'USD/EUR' && r.channelId === 'CH-01');
    const markup = cfg.markups.find((m) => m.pairId === 'USD/EUR');
    expect(raw).toBeDefined();
    expect(D(raw?.mid ?? '0').eq('0.9200')).toBe(true);
    expect(markup?.halfSpreadBps).toBe(50);

    await mount();
    await fill('#calc-amount', '2000.00');
    await setSelect('#calc-direction', 'BUY_USD');

    // ask = 0.9200 ×(1+50/10000) = 0.9246；到账 = 2000 ÷ 0.9246 = 2163.0975… → 2,163.10 USD
    expect(html()).toContain('ask');
    expect(html()).toContain('0.9246');
    expect(html()).toContain('2,163.10 USD');
    expect(html()).not.toContain('1,830.80 EUR'); // 卖出方向的旧结果已被替换
  });

  it('停用 CH-01 后回退命中「北岭报价」：展示实际选中渠道与对应客户价（J4 关键语义）', async () => {
    await loginAsOps();
    await mount();
    await fill('#calc-amount', '2000.00');
    expect(html()).toContain('华星清算');

    await applyCommand(fxConfigCommands.toggleChannel(opsSpec().id, 'CH-01', false));

    const cfg = useAppStore.getState().data.fxConfig;
    expect(cfg.channels.find((c) => c.id === 'CH-01')?.enabled).toBe(false);
    const ch02Mid = cfg.rawPrices.find((r) => r.pairId === 'USD/EUR' && r.channelId === 'CH-02')?.mid;
    expect(ch02Mid).toBeDefined();
    expect(D(ch02Mid ?? '0').eq('0.9205')).toBe(true);

    // 回退展示实际命中渠道（CH-02），而非路由首位；价格随渠道切换：
    // bid = 0.9205 ×0.995 = 0.9158975 → 展示 0.9159；到账 = 2000 ×0.9158975 = 1831.795 → 1,831.80 EUR
    expect(html()).not.toContain('华星清算');
    expect(html()).toContain('北岭报价');
    expect(html()).toContain('0.9159');
    expect(html()).toContain('1,831.80 EUR');
  });

  it('停用币对 → 「币对已停用」；渠道/报价开关全部不可用 → 「暂无有效报价」+ 逐渠道中文原因', async () => {
    await loginAsOps();
    await mount();
    await fill('#calc-amount', '2000.00');
    expect(html()).toContain('1,830.80 EUR');

    // 停用 USD/EUR：双向均不可报价（PRD §5.5）
    await applyCommand(fxConfigCommands.togglePair(opsSpec().id, 'USD/EUR', false));
    expect(html()).toContain('币对已停用');
    expect(html()).not.toContain('1,830.80');
    expect(html()).not.toContain('逐渠道诊断'); // PAIR_DISABLED 无逐渠道诊断

    // 恢复币对，制造“无有效报价”：CH-01 渠道停用、CH-02 报价开关停用、CH-03 预置即停用
    await applyCommand(fxConfigCommands.togglePair(opsSpec().id, 'USD/EUR', true));
    await applyCommand(fxConfigCommands.toggleChannel(opsSpec().id, 'CH-01', false));
    await applyCommand(fxConfigCommands.toggleQuoteEnabled(opsSpec().id, 'USD/EUR', 'CH-02', false));

    expect(html()).toContain('暂无有效报价');
    expect(html()).toContain('逐渠道诊断');
    // 逐渠道诊断：三个渠道全部给出中文原因（渠道已停用 ×2、报价开关已停用 ×1）
    expect(html()).toContain('华星清算');
    expect(html()).toContain('北岭报价');
    expect(html()).toContain('青屿流动池');
    expect(html()).toContain('渠道已停用');
    expect(html()).toContain('报价开关已停用');
  });

  it('金额校验：格式非法/低于下限/超过上限给中文提示；边界 1 与 10,000 可试算', async () => {
    await loginAsOps();
    await mount();

    await fill('#calc-amount', '1.999'); // USD 仅 2 位小数 → INVALID_AMOUNT
    expect(html()).toContain('金额格式不正确');

    await fill('#calc-amount', '0.5'); // 等值 0.5 USD < 1 → BELOW_MIN
    expect(html()).toContain('金额低于单笔最低限额');

    await fill('#calc-amount', '100000'); // 等值 100,000 USD > 10,000 → ABOVE_MAX
    expect(html()).toContain('金额超过单笔最高限额');

    // 边界含：1.00 → 0.9154 → 0.92 EUR；10,000.00 → 9,154.00 EUR（mid 0.9200 ×0.995 = 0.9154）
    await fill('#calc-amount', '1.00');
    expect(html()).toContain('0.92 EUR');
    await fill('#calc-amount', '10000.00');
    expect(html()).toContain('9,154.00 EUR');
    expect(html()).not.toContain('金额低于单笔最低限额');
    expect(html()).not.toContain('金额超过单笔最高限额');
  });

  it('只读证明：存在「不成交」提示；全部交互后 apply 零调用、账户数据数量不变、无锁价', async () => {
    await loginAsOps();
    const before = useAppStore.getState().data;
    expect(before.orders.length).toBeGreaterThan(0);
    expect(before.bills.length).toBeGreaterThan(0);
    expect(before.wallets.length).toBeGreaterThan(0);

    // 包裹 apply 计数：页面任何写操作都必须经此，计算器应当零调用
    const originalApply = useAppStore.getState().apply;
    let applyCalls = 0;
    useAppStore.setState({
      apply: <T,>(cmd: DomainCommand<T>): Promise<DomainResult<T>> => {
        applyCalls += 1;
        return originalApply(cmd);
      },
    });

    await mount();
    expect(html()).toContain('不成交');
    expect(html()).toContain('不写任何账户数据');
    expect(html()).toContain('不产生锁价');

    await fill('#calc-amount', '2000.00');
    expect(html()).toContain('1,830.80 EUR'); // 页面确实完成试算（有结果事实，而非未渲染）
    await setSelect('#calc-pair', 'USD/JPY'); // 路由首位 CH-02：mid 151.00 → 到账 2000 ×150.245
    expect(html()).toContain('北岭报价');
    expect(html()).toContain('300,490 JPY');
    await setSelect('#calc-direction', 'BUY_USD');
    await setSelect('#calc-pair', 'USD/EUR');
    await fill('#calc-amount', '');

    const after = useAppStore.getState();
    expect(applyCalls).toBe(0);
    expect(after.data.orders.length).toBe(before.orders.length);
    expect(after.data.bills.length).toBe(before.bills.length);
    expect(after.data.wallets.length).toBe(before.wallets.length);
    expect(after.ui.quote).toBeNull(); // 未产生锁价（30 秒内存态报价保持空）

    useAppStore.setState({ apply: originalApply });
  });
});
