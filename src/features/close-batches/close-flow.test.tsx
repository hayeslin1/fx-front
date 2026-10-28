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

// M4 运营端纵切 E 渲染用例（jsdom，装配范式同 app/routes.test.tsx）：
// 覆盖敞口页五币对金样出数与来源明细展开、平仓批次列表、新建平仓成功/失败、
// 失败批次整批重试重新锁价。WHY 走真实 createRoot + MemoryRouter + 真实领域服务：
// 同时断言 store 事实与页面 DOM，避免只测组件内部状态。

// jsdom 不实现 SubtleCrypto；登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 固定时钟 = seed 锚点（routes.test.tsx 同款），保证预置原始价 2 分钟前采集、仍在 10 分钟内
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const OPS_EMAIL = SEED_OPS_ACCOUNTS[0]?.email ?? 'ops@demo.fx';
const OPS_PASSWORD = SEED_OPS_ACCOUNTS[0]?.password ?? 'OpsDemo123';

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
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
  const result = await loginOps(OPS_EMAIL, OPS_PASSWORD);
  expect(result.ok).toBe(true);
}

/** 以原生 setter + input 事件写入受控/非受控表单（React 19 监听原生 input） */
async function fill(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`表单控件不存在：${selector}`);
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
}

/** 页面内按钮（弹层内容经 Radix Portal 挂到 document.body，不在 container 内） */
function findPageButton(text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
    ) ?? null
  );
}

/** 弹层按钮按精确文案匹配（'确认提交'/'确认重试' 在页面内不存在同文案按钮） */
function findDialogButton(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  );
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

describe('M4 运营端：敞口与平仓', () => {
  it('敞口页展示五币对与金样净值/对应外币估值', async () => {
    await loginOpsSeed();
    await mount('/ops/trading/exposure');

    expect(html()).toContain('对应外币估值');
    for (const pairId of ['USD/EUR', 'USD/GBP', 'USD/JPY', 'USD/CNH', 'USD/HKD']) {
      expect(html()).toContain(pairId);
    }

    // §5.4 金样净敞口（正为多头、负为空头）
    expect(html()).toContain('+1,700.00 USD');
    expect(html()).toContain('+6,000.00 USD');
    expect(html()).toContain('+3,023.13 USD');
    expect(html()).toContain('-1,200.00 USD');
    expect(html()).toContain('-600.00 USD');

    // 对应外币估值 = 净值 × 最新原始中间价（采集时间并列取先出现者：CH-01）
    expect(html()).toContain('1,564.00 EUR'); // 1,700.00 × 0.9200
    expect(html()).toContain('4,710.00 GBP'); // 6,000.00 × 0.7850
    expect(html()).toContain('457,097 JPY'); // 3,023.13 × 151.20，JPY 0 位
    expect(html()).toContain('-8,694.00 CNH'); // -1,200.00 × 7.2450
    expect(html()).toContain('-4,686.00 HKD'); // -600.00 × 7.8100
  });

  it('敞口页展开来源订单明细（USD/EUR：EX-1 剩余 200 + EX-3 全部 1,500）', async () => {
    await loginOpsSeed();
    await mount('/ops/trading/exposure');

    const usdEurRow = Array.from(container.querySelectorAll('tbody tr')).find((row) =>
      row.textContent?.includes('USD/EUR'),
    );
    expect(usdEurRow).toBeDefined();
    await click(usdEurRow?.querySelector('button') ?? null);

    expect(html()).toContain('来源订单明细');
    expect(html()).toContain('剩余 USD');
    expect(html()).toContain('建仓 mid');
    expect(html()).toContain('200.00 USD');
    expect(html()).toContain('1,500.00 USD');
    expect(html()).toContain('0.9200');
    expect(html()).toContain('0.9195');
  });

  it('平仓页展示 2 个预置批次（CB-1 成功 / CB-2 失败）', async () => {
    await loginOpsSeed();
    const seeded = useAppStore.getState().data.closeBatches;
    expect(seeded.length).toBe(2);
    const successBatch = seeded.find((batch) => batch.status === 'SUCCESS');
    const failedBatch = seeded.find((batch) => batch.status === 'FAILED');
    expect(successBatch).toBeDefined();
    expect(failedBatch).toBeDefined();
    if (successBatch === undefined || failedBatch === undefined) return;

    await mount('/ops/trading/close-batches');
    expect(html()).toContain('新建平仓');
    expect(html()).toContain(successBatch.id);
    expect(html()).toContain(failedBatch.id);
    expect(html()).toContain('华星清算');
    expect(html()).toContain('北岭报价');
    expect(html()).toContain('模拟失败（演示）');
    expect(html()).toContain('整批重试');
  });

  it('新建平仓成功：closeBatches +1、页面出现新批次号、锁定 mid=0.9200', async () => {
    await loginOpsSeed();
    await mount('/ops/trading/close-batches');
    const before = useAppStore.getState().data.closeBatches.length;

    await fill('#close-amount', '300.00');
    await click(findPageButton('提交平仓'));
    expect(document.body.textContent).toContain('确认提交平仓批次');
    await click(findDialogButton('确认提交'));
    await act(async () => {});

    const after = useAppStore.getState().data.closeBatches;
    expect(after.length).toBe(before + 1);
    const created = after.at(-1);
    expect(created?.pairId).toBe('USD/EUR');
    expect(created?.status).toBe('SUCCESS');
    expect(created?.usdAmount).toBe('300.00');
    expect(created?.channelId).toBe('CH-01');
    const attempt = created?.attempts[0];
    expect(attempt === undefined ? null : D(attempt.lockedMid).equals(D('0.9200'))).toBe(true);
    expect(attempt?.status).toBe('SUCCESS');

    expect(html()).toContain(created?.id ?? '');
  });

  it('新建平仓失败路径：金额超可平（1,700.00）提交零变更并就地提示', async () => {
    await loginOpsSeed();
    await mount('/ops/trading/close-batches');
    const before = useAppStore.getState().data.closeBatches.length;

    await fill('#close-amount', '9999.00');
    await click(findPageButton('提交平仓'));
    await click(findDialogButton('确认提交'));
    await act(async () => {});

    expect(useAppStore.getState().data.closeBatches.length).toBe(before);
    expect(html()).toContain('超出可平金额');
  });

  it('失败批次整批重试：预填原渠道并重新校验、重新锁定价格', async () => {
    await loginOpsSeed();
    await mount('/ops/trading/close-batches');
    const failed = useAppStore.getState().data.closeBatches.find((b) => b.status === 'FAILED');
    expect(failed).toBeDefined();
    if (failed === undefined) return;

    await click(findPageButton('整批重试'));
    const channelSelect = document.querySelector('#retry-channel') as HTMLSelectElement | null;
    expect(channelSelect?.value).toBe('CH-02'); // 弹层预填原批次渠道

    await click(findDialogButton('确认重试'));
    await act(async () => {});

    const retried = useAppStore
      .getState()
      .data.closeBatches.find((batch) => batch.id === failed.id);
    expect(retried?.status).toBe('SUCCESS');
    expect(retried?.attempts.length).toBe(2);
    const second = retried?.attempts[1];
    expect(second?.index).toBe(2);
    expect(second?.channelId).toBe('CH-02');
    // 重试重新锁定当前渠道原始价（CH-02 USD/JPY = 151.00）
    expect(second === undefined ? null : D(second.lockedMid).equals(D('151.00'))).toBe(true);
  });
});
