// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import type { OpsUser, Ticket } from '@/domain/types';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, loginOps, useAppStore } from '@/store';

// M5 J5 工单与持久化冒烟（设计文档 §12.3 J5，jsdom 真实 store + 真实路由渲染）：
// 客户建单 → 运营端可见并指派/回复/关闭 → 客户端状态一致且不可回复
// → 重新引导（等价刷新，localStorage 保留）后双端数据一致 → 重置演示数据（二次确认）全量恢复预置样例。
// WHY 重新引导模拟刷新：持久化=手写落盘 + 引导恢复（§5.3），bootstrapStore 二次执行即真实刷新语义；
// 手工篡改 localStorage 后刷新恢复为浏览器 devtools 手工项（无法在 jsdom 等价复现），不入自动化。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const CUSTOMER = SEED_CUSTOMERS[0];
const OPS_SPEC = SEED_OPS_ACCOUNTS.find((account) => account.isDemoAccount) ?? SEED_OPS_ACCOUNTS[0];
if (CUSTOMER === undefined || OPS_SPEC === undefined) throw new Error('缺少预置账号');

let container: HTMLDivElement;
let root: Root;

function text(): string {
  return container.textContent ?? '';
}

/** 表格数据区文本（表头/下拉选项不在其中，避免选项文案假阳性） */
function tbodyText(): string {
  return container.querySelector('tbody')?.textContent ?? '';
}

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

/** 等一拍宏任务，确保提交/导航的异步链路全部完成后再断言 */
async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function fill(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`表单控件不存在：${selector}`);
  await act(async () => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function setSelectValue(id: string, value: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>(`#${id}`);
  if (select === null) throw new Error(`下拉控件不存在：#${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * 轮询等待 store 事实达成。
 * WHY：resetDemoData 内部 buildSeed 含 WebCrypto 派生（libuv 线程池回调），
 * 完成时机跨事件循环轮次，单次 setTimeout(0) 可能早于其落地（避免用固定延时碰运气）。
 */
async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`等待超时：${label}`);
}

// ---------- store 事实读取（业务键连接，不依赖编号位次） ----------

function storeTicket(ticketId: string): Ticket {
  const ticket = useAppStore.getState().data.tickets.find((item) => item.id === ticketId);
  if (ticket === undefined) throw new Error(`工单不存在：${ticketId}`);
  return ticket;
}

function ticketBySubject(part: string): Ticket {
  const ticket = useAppStore.getState().data.tickets.find((item) => item.subject.includes(part));
  if (ticket === undefined) throw new Error(`工单不存在：${part}`);
  return ticket;
}

function assigneeByName(name: string): OpsUser {
  const assignee = useAppStore.getState().data.assignees.find((item) => item.name === name);
  if (assignee === undefined) throw new Error(`预置处理人不存在：${name}`);
  return assignee;
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();

  const clientLogin = await loginClient(CUSTOMER.email, CUSTOMER.password);
  if (!clientLogin.ok) throw new Error('客户登录失败');
  const opsLogin = await loginOps(OPS_SPEC.email, OPS_SPEC.password);
  if (!opsLogin.ok) throw new Error('运营登录失败');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('J5 工单旅程：建单 → 指派/回复/关闭 → 双端一致 → 刷新一致', () => {
  it('客户建单后运营端可指派/回复/关闭，客户端一致且禁回复，重新引导后双端仍一致', async () => {
    const subject = 'J5 旅程：到账金额与预期不符复核';
    const content = '客户侧提交：请运营核对本笔换汇的到账金额。';
    const reply = '运营侧回复：已受理，正在核对渠道对账单。';

    // ① 客户端建单：store 落库（PENDING，归属本人）并跳转详情
    await mount('/app/support/new');
    await fill('#subject', subject);
    await fill('#content', content);
    await click(findButton(container, '提交工单'));

    const created = ticketBySubject(subject);
    expect(created.status).toBe('PENDING');
    expect(created.customerId).toBe(CUSTOMER.id);
    expect(text()).toContain(`工单号 ${created.id}`);

    // ② 运营端列表可见新单（待处理）
    await mount('/ops/support/tickets');
    expect(tbodyText()).toContain(subject);
    expect(tbodyText()).toContain('待处理');

    // ③ 运营详情：指派王倩 → 回复（首条自动置处理中）→ 关闭（二次确认）
    await mount(`/ops/support/tickets/${created.id}`);
    const wangqian = assigneeByName('王倩');
    await setSelectValue('ticket-assignee-select', wangqian.id);
    await click(findButton(container, '指派'));
    expect(storeTicket(created.id).assigneeId).toBe(wangqian.id);

    await fill('#ops-reply-content', reply);
    await click(findButton(container, '回复'));
    expect(storeTicket(created.id).status).toBe('IN_PROGRESS');
    const replyMessage = useAppStore
      .getState()
      .data.ticketMessages.find((message) => message.content === reply);
    expect(replyMessage?.authorKind).toBe('OPS');
    expect(replyMessage?.ticketId).toBe(created.id);

    await click(findButton(container, '关闭工单'));
    expect(document.body.textContent).toContain('确认关闭');
    await click(findButton(document.body, '确认关闭'));
    expect(storeTicket(created.id).status).toBe('CLOSED');

    // ④ 客户端一致：列表徽标已关闭、详情含运营回复且禁回复（无回复表单）
    await mount('/app/support');
    expect(tbodyText()).toContain(subject);
    expect(tbodyText()).toContain('已关闭');

    await mount(`/app/support/${created.id}`);
    expect(text()).toContain(reply);
    expect(text()).toContain('工单已关闭，如有新问题请新建工单');
    expect(container.querySelector('#reply-content')).toBeNull();
    expect(findButtonOrNull(container, '提交回复')).toBeNull();

    // ⑤ 重新引导 = 刷新（localStorage 保留）：数据与会话双端一致
    await bootstrapStore();
    const state = useAppStore.getState();
    expect(state.session.client?.customerId).toBe(CUSTOMER.id);
    expect(state.session.ops?.opsAccountId).toBe(OPS_SPEC.id);
    expect(storeTicket(created.id).status).toBe('CLOSED');
    expect(storeTicket(created.id).assigneeId).toBe(wangqian.id);
    expect(
      state.data.ticketMessages
        .filter((message) => message.ticketId === created.id)
        .map((message) => message.content),
    ).toContain(reply);

    // 刷新后运营端：仍可见新单、已关闭、处理人王倩
    await mount('/ops/support/tickets');
    expect(tbodyText()).toContain(subject);
    expect(tbodyText()).toContain('已关闭');
    expect(tbodyText()).toContain('王倩');

    // 刷新后客户端：仍为已关闭且不可回复
    await mount(`/app/support/${created.id}`);
    expect(text()).toContain('工单已关闭，如有新问题请新建工单');
    expect(text()).toContain(reply);
  });
});

describe('J5 重置演示数据：二次确认 → 全量恢复预置样例', () => {
  it('运营壳顶栏重置（确认弹窗）后恢复金样数据、会话全部退出、守卫回登录页', async () => {
    // 制造演示期脏数据：客户新建一张工单
    const dirtySubject = 'J5 重置：临时工单';
    await mount('/app/support/new');
    await fill('#subject', dirtySubject);
    await fill('#content', '用于验证重置后不复存在的临时工单。');
    await click(findButton(container, '提交工单'));
    expect(useAppStore.getState().data.tickets.some((t) => t.subject === dirtySubject)).toBe(true);

    const resetCountBefore = useAppStore.getState().data.meta.resetCount;

    // 运营壳顶栏「重置演示数据」→ 确认弹窗（危险操作红色确认）
    await mount('/ops/support/tickets');
    await click(findButton(container, '重置演示数据'));
    expect(document.body.textContent).toContain('重置演示数据？');
    expect(document.body.textContent).toContain('恢复预置样例');
    await click(findButton(document.body, '确认重置'));
    // resetDemoData 异步重建 seed（WebCrypto 派生跨事件循环轮次），轮询到重置落地再断言
    await waitUntil(
      () => useAppStore.getState().data.meta.resetCount === resetCountBefore + 1,
      '重置完成（resetCount +1）',
    );

    // 全量恢复预置样例（§5.4 金样：9 订单 / 18 钱包 / 3 工单 / 2 平仓批次），脏数据清除
    const state = useAppStore.getState();
    expect(state.data.tickets).toHaveLength(3);
    expect(state.data.orders).toHaveLength(9);
    expect(state.data.wallets).toHaveLength(18);
    expect(state.data.closeBatches).toHaveLength(2);
    expect(state.data.tickets.some((t) => t.subject === dirtySubject)).toBe(false);
    expect(state.data.meta.resetCount).toBe(resetCountBefore + 1);

    // 所有登录会话退出（重置确认文案承诺），双端守卫各自回登录页
    expect(state.session.client).toBeNull();
    expect(state.session.ops).toBeNull();
    // 当前挂载在 /ops/support/tickets：会话清空后同一渲染树内被守卫重定向
    expect(text()).toContain('运营登录');
    await mount('/app/home');
    expect(text()).toContain('登录');
    expect(text()).not.toContain('你好，');
  });
});
