// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { MAIN_CONTENT_ID } from '@/components/common/main-content-id';
import { StorageRecoveryBanner } from '@/components/common/StorageRecoveryBanner';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, loginOps, useAppStore } from '@/store';
import { AppRoutes } from './routes';

// 可访问性走查（设计文档 §11.2 与 §12.2 验收 12：表格/表单/弹窗键盘可用、非仅颜色表达状态）：
// 跳转链接与 main 地标唯一、表头 scope、弹窗可访问名称与描述、全页按钮可访问名称、状态徽标含文字。
// 装配范式同 routes.test.tsx：jsdom + WebCrypto 回填 + 固定时钟 + Router key 强制重建。
// WHY 不覆盖：对比度（CSS 变量取值）与读屏器实测无法在 jsdom 复现，留 §12.3 手工验收。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let container: HTMLDivElement;
let root: Root;

async function mount(path: string): Promise<void> {
  await act(async () => {
    // key 随路径变化强制重建 Router：同一用例内多次切换路由
    root.render(
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

async function loginAsClient(): Promise<void> {
  const spec = SEED_CUSTOMERS[0];
  if (spec === undefined) throw new Error('缺少预置客户账号');
  const result = await loginClient(spec.email, spec.password);
  expect(result.ok).toBe(true);
}

async function loginAsOps(): Promise<void> {
  const spec = SEED_OPS_ACCOUNTS[0];
  if (spec === undefined) throw new Error('缺少预置运营账号');
  const result = await loginOps(spec.email, spec.password);
  expect(result.ok).toBe(true);
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    // 等一拍宏任务，确保提交/导航等异步链路完成后再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
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

/** 可访问名称（简化算法）：aria-label → aria-labelledby 指向文本 → 可见文本内容 */
function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') return ariaLabel.trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null && labelledBy.trim() !== '') {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text !== '') return text;
  }
  return (element.textContent ?? '').trim();
}

/** 断言跳转链接存在于导航之前，且指向本端唯一的 main 地标 */
function expectSkipLinkAndSingleMain(): void {
  const skip = container.querySelector('a.skip-link');
  expect(skip).not.toBeNull();
  expect(skip?.getAttribute('href')).toBe(`#${MAIN_CONTENT_ID}`);
  expect(accessibleName(skip as Element)).toBe('跳到主要内容');

  const mains = container.querySelectorAll('main');
  expect(mains).toHaveLength(1);
  const main = mains[0];
  expect(main?.id).toBe(MAIN_CONTENT_ID);

  // 跳转链接是该端首个可聚焦元素（先于 header/侧栏导航出现）
  const header = container.querySelector('header');
  expect(header).not.toBeNull();
  if (skip !== null && header !== null) {
    expect(skip.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

/** 全页按钮批量断言：每个按钮都有可访问名称（可见文本或 aria-label） */
function expectAllButtonsNamed(scope: ParentNode): number {
  const buttons = Array.from(scope.querySelectorAll('button'));
  const unnamed = buttons.filter((button) => accessibleName(button) === '');
  expect(unnamed.map((button) => button.outerHTML.slice(0, 120))).toEqual([]);
  return buttons.length;
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

describe('全局壳：跳转链接与 main 地标', () => {
  it('客户端登录后：skip link 先于顶栏导航，指向唯一 main 地标', async () => {
    await loginAsClient();
    await mount('/app/home');
    expectSkipLinkAndSingleMain();
    // main 内确有页面内容（标题由 PageHeader 提供）
    expect(container.querySelector('main h1')?.textContent).toContain('你好');
  });

  it('运营端登录后：skip link 先于侧栏六组导航，指向唯一 main 地标', async () => {
    await loginAsOps();
    await mount('/ops/overview');
    expectSkipLinkAndSingleMain();
    expect(container.querySelector('main h1')?.textContent).toContain('业务总览');
  });
});

describe('表格语义与弹窗键盘可用', () => {
  it('数据表表头：客户端订单列与运营端原生表格 th 全部 scope="col"', async () => {
    await loginAsClient();
    await mount('/app/orders');
    const clientHeads = Array.from(container.querySelectorAll('main thead th'));
    expect(clientHeads.length).toBeGreaterThan(0);
    for (const th of clientHeads) expect(th.getAttribute('scope')).toBe('col');

    await loginAsOps();
    await mount('/ops/trading/close-batches');
    const opsHeads = Array.from(container.querySelectorAll('main thead th'));
    expect(opsHeads.length).toBeGreaterThan(0);
    for (const th of opsHeads) expect(th.getAttribute('scope')).toBe('col');

    // 一页两表（客户钱包）：各自 aria-label 区分用途，表头同样带 scope
    await mount('/app/wallet');
    const walletTables = Array.from(container.querySelectorAll('main table'));
    expect(walletTables).toHaveLength(2);
    for (const table of walletTables) {
      expect(table.getAttribute('aria-label')).toBeTruthy();
      for (const th of table.querySelectorAll('thead th')) {
        expect(th.getAttribute('scope')).toBe('col');
      }
    }
  });

  it('确认弹窗：打开后 role=alertdialog 且有可读标题与描述（键盘 ESC 可关闭由 Radix 内建）', async () => {
    await loginAsOps();
    await mount('/ops/overview');
    await click(findButton(container, '重置演示数据'));

    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]');
    expect(dialog).not.toBeNull();
    // Radix 以 aria-labelledby/aria-describedby 关联标题与描述
    expect(accessibleName(dialog as Element)).toContain('重置演示数据？');
    const describedBy = dialog?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = describedBy ? document.getElementById(describedBy) : null;
    expect(description?.textContent).toContain('恢复预置样例');

    // 弹窗内按钮同样有可访问名称（取消 / 确认重置）
    expect(expectAllButtonsNamed(dialog as ParentNode)).toBeGreaterThanOrEqual(2);
  });

  it('行展开/详情按钮带 aria-expanded 状态（运营端平仓批次页）', async () => {
    await loginAsOps();
    await mount('/ops/trading/close-batches');
    const toggle = findButton(container, '查看详情');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await click(toggle);
    const collapse = findButton(container, '收起详情');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('按钮可访问名称与状态表达双通道', () => {
  it('两端样例页全部按钮都有可访问名称（可见文本或 aria-label）', async () => {
    await loginAsClient();
    for (const path of [
      '/app/home',
      '/app/wallet',
      '/app/orders',
      '/app/top-up',
      '/app/exchange',
      '/app/support',
      '/app/support/new',
    ]) {
      await mount(path);
      expect(expectAllButtonsNamed(container)).toBeGreaterThan(0);
    }

    await loginAsOps();
    for (const path of [
      '/ops/overview',
      '/ops/customers',
      '/ops/fx/channels',
      '/ops/fx/pairs',
      '/ops/fx/pool',
      '/ops/fx/routing',
      '/ops/fx/markups',
      '/ops/fx/calculator',
      '/ops/support/tickets',
      '/ops/trading/orders',
      '/ops/trading/exposure',
      '/ops/trading/close-batches',
      '/ops/trading/profit-orders',
      '/ops/wallets/balances',
      '/ops/wallets/bills',
      '/ops/wallets/assisted-top-up',
    ]) {
      await mount(path);
      expect(expectAllButtonsNamed(container)).toBeGreaterThan(0);
    }
  });

  it('状态不止靠颜色：订单状态徽标含文字，币对启停开关带 aria-label 与文字状态', async () => {
    await loginAsClient();
    await mount('/app/orders');
    const clientBadges = Array.from(container.querySelectorAll('[data-slot="badge"]'));
    expect(clientBadges.length).toBeGreaterThan(0);
    for (const badge of clientBadges) expect(accessibleName(badge)).not.toBe('');
    expect(container.textContent).toContain('已完成');

    await loginAsOps();
    await mount('/ops/fx/pairs');
    // 启停开关：native checkbox + role=switch + aria-label（不依赖底色表达状态）
    const switches = Array.from(
      container.querySelectorAll<HTMLInputElement>('main input[role="switch"]'),
    );
    expect(switches.length).toBeGreaterThan(0);
    for (const item of switches) {
      expect(item.getAttribute('aria-label')).toContain('启停开关');
      // 状态经原生 checked 暴露；同行另有「启用/停用」文字通道（颜色之外的第二通道）
      expect(typeof item.checked).toBe('boolean');
      const row = item.closest('tr');
      expect(row?.textContent).toMatch(/启用|停用/);
    }
  });
});

describe('表格键盘可达与地标/状态通道补齐', () => {
  it('订单列表可键盘进入详情、404 自带 main 地标、开关有 aria-checked、存储提示为 live region', async () => {
    // ① 客户端订单列表：订单号是可聚焦链接（键盘 Enter 进详情），行点击仅鼠标快捷方式
    await loginAsClient();
    await mount('/app/orders');
    const orderLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('main tbody a[href^="/app/orders/"]'),
    );
    expect(orderLinks.length).toBeGreaterThan(0);
    for (const link of orderLinks) {
      expect(accessibleName(link)).not.toBe('');
      expect(link.getAttribute('href')).toMatch(/^\/app\/orders\/.+/);
    }

    // ② 404 不套壳：自身即主内容地标（§11.2 每页应有 main）
    await mount('/no-such-route-404');
    expect(container.textContent).toContain('404');
    expect(container.querySelectorAll('main')).toHaveLength(1);

    // ③ 币对启停开关：role=switch 显式暴露 aria-checked（与原生 checked 同源）
    await loginAsOps();
    await mount('/ops/fx/pairs');
    const switches = Array.from(
      container.querySelectorAll<HTMLInputElement>('main input[role="switch"]'),
    );
    expect(switches.length).toBeGreaterThan(0);
    for (const item of switches) {
      expect(item.getAttribute('aria-checked')).toBe(String(item.checked));
    }

    // ④ 存储提示条为 live region（引导后动态出现，读屏可播报）：
    // 该组件挂在 providers 层（不在 AppRoutes 内），此处单独挂载断言两条分支
    await act(async () => {
      useAppStore.setState({ ui: { ...useAppStore.getState().ui, storageRecovered: true } });
      root.render(<StorageRecoveryBanner />);
    });
    const recovered = container.querySelector('[role="status"]');
    expect(recovered).not.toBeNull();
    expect(recovered?.textContent).toContain('已重置为预置演示数据');

    await act(async () => {
      useAppStore.setState({
        ui: { ...useAppStore.getState().ui, storageRecovered: false, storagePersistent: false },
      });
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已降级为内存模式');
  });
});
