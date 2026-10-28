// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, resetDemoData } from '@/store';
import { AppRoutes } from './routes';

// 客户端渲染冒烟（jsdom，真实 createRoot + 守卫 useEffect 重定向）：
// 验证“两端登录可达、未知路径 404 不白屏、首页金样出数、双端身份隔离”。
// WHY jsdom 例外（设计文档 §12.1 实现注记 2026-10-28）：zustand v5 的 SSR 服务端快照
// 取 getInitialState，登录态与事实数据无法在 renderToString 中体现，故渲染用例走 DOM。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let container: HTMLDivElement;
let root: Root;

async function mount(path: string): Promise<string> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
  return container.innerHTML;
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

describe('未登录渲染与守卫', () => {
  it('/app/login 渲染客户登录页（含演示账号提示与注册入口）', async () => {
    const html = await mount('/app/login');
    expect(html).toContain('跨境汇兑演示平台');
    expect(html).toContain('演示账号');
    expect(html).toContain('立即注册');
  });

  it('/ops/login 渲染运营登录页（客户账号不可进入的提示）', async () => {
    const html = await mount('/ops/login');
    expect(html).toContain('运营登录');
    expect(html).toContain('仅限运营账号');
  });

  it('未登录访问 /app/home → 守卫重定向到客户登录页', async () => {
    const html = await mount('/app/home');
    expect(html).toContain('演示账号');
  });

  it('未知路径渲染 404（含返回入口）', async () => {
    const html = await mount('/no-such-page');
    expect(html).toContain('404');
    expect(html).toContain('返回首页');
  });
});

describe('登录后渲染（金样出数）', () => {
  it('客户登录 → /app/home 渲染姓名、六币种余额与参考估值（C-001 USD 20,500.00）', async () => {
    const spec = SEED_CUSTOMERS[0];
    expect(spec).toBeDefined();
    if (!spec) return;
    const login = await loginClient(spec.email, spec.password);
    expect(login.ok).toBe(true);

    const html = await mount('/app/home');
    expect(html).toContain('你好，林小满');
    expect(html).toContain('20,500.00 USD');
    expect(html).toContain('8,203.15 EUR');
    expect(html).toContain('参考估值');
  });

  it('客户会话访问 /ops/overview → 重定向到运营登录（双端身份隔离）', async () => {
    const spec = SEED_CUSTOMERS[0];
    if (!spec) return;
    await loginClient(spec.email, spec.password);
    const html = await mount('/ops/overview');
    expect(html).toContain('运营登录');
  });

  it('重置演示数据后会话清空，再访问 /app/home 回到登录页', async () => {
    const spec = SEED_CUSTOMERS[0];
    if (!spec) return;
    await loginClient(spec.email, spec.password);
    await act(async () => {
      await resetDemoData();
    });
    const html = await mount('/app/home');
    expect(html).toContain('演示账号');
  });
});
