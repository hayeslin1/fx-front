// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';
import { bootstrapStore, loginClient, useAppStore } from '@/store';

// 客服工单纵切（M3 P3）渲染用例（jsdom，装配范式同 app/routes.test.tsx）：
// 覆盖列表出数、新建后 store 增长并跳转详情、已关闭禁回复、客户回复新增消息。
// WHY 走真实 createRoot + MemoryRouter：状态机/守卫/跳转均为真实实现，
// 断言 store 事实与 DOM 双口径，避免只测组件内部状态。

// jsdom 不实现 SubtleCrypto；登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

async function mount(path: string): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

/** 登录指定序号的预置客户（密码哈希经 Web Crypto，必须 await） */
async function loginAs(index: number): Promise<void> {
  const spec = SEED_CUSTOMERS[index];
  if (!spec) throw new Error(`预置客户不存在：${index}`);
  const result = await loginClient(spec.email, spec.password);
  expect(result.ok).toBe(true);
}

/** 以原生 setter + input 事件写入受控/非受控表单（React 19 监听原生 input） */
async function fill(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`表单控件不存在：${selector}`);
  await act(async () => {
    const proto =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** 按文案找按钮（Button asChild 渲染为 <a>，不会误命中） */
function findButton(text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
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

describe('客服工单纵切', () => {
  it('登录后列表展示本人预置工单，点击行进入详情', async () => {
    await loginAs(0); // C-001 林小满

    const own = useAppStore.getState().data.tickets.filter((t) => t.customerId === 'C-001');
    expect(own.length).toBeGreaterThan(0);
    const first = own[0];
    if (!first) throw new Error('预置工单缺失');

    await mount('/app/support');
    expect(html()).toContain('客服工单');
    expect(html()).toContain('主题');
    expect(html()).toContain('状态');
    expect(html()).toContain('处理人');
    expect(html()).toContain('更新时间');
    expect(html()).toContain(first.subject);
    expect(html()).toContain('待处理');
    // 身份隔离：他人（C-002）的预置工单不可见
    expect(html()).not.toContain('报价过期提示咨询');

    await click(container.querySelector('tbody tr'));
    expect(html()).toContain(`工单号 ${first.id}`);
    expect(html()).toContain(first.subject);
  });

  it('新建工单成功：store 工单 +1 且跳转详情页', async () => {
    await loginAs(0);
    const beforeTickets = useAppStore.getState().data.tickets.length;
    const beforeMessages = useAppStore.getState().data.ticketMessages.length;
    const subject = 'M3 联调：新建工单主题';
    const content = '这是通过新建工单表单提交的内容，用于验证提交后跳转详情。';

    await mount('/app/support/new');
    expect(html()).toContain('新建工单');
    await fill('#subject', subject);
    await fill('#content', content);
    await click(findButton('提交工单'));

    const state = useAppStore.getState().data;
    expect(state.tickets.length).toBe(beforeTickets + 1);
    expect(state.ticketMessages.length).toBe(beforeMessages + 1);
    const created = state.tickets.find((ticket) => ticket.subject === subject);
    expect(created).toBeDefined();
    expect(created?.customerId).toBe('C-001');
    expect(created?.status).toBe('PENDING');

    // 跳转详情：标题/工单号/首条客户留言均可见
    expect(html()).toContain(`工单号 ${created?.id ?? ''}`);
    expect(html()).toContain(subject);
    expect(html()).toContain(content);
  });

  it('已关闭工单不可回复，提示新建工单', async () => {
    await loginAs(2); // C-003 苏晚（其预置工单为 CLOSED）
    const closed = useAppStore
      .getState()
      .data.tickets.find((ticket) => ticket.customerId === 'C-003' && ticket.status === 'CLOSED');
    expect(closed).toBeDefined();
    if (!closed) return;

    await mount(`/app/support/${closed.id}`);
    expect(html()).toContain('工单已关闭，如有新问题请新建工单');
    expect(html()).not.toContain('提交回复');
    expect(container.querySelector('#reply-content')).toBeNull();
    expect(findButton('提交回复')).toBeNull();
  });

  it('customerReply 成功：时间线新增客户消息并在 store 落库', async () => {
    await loginAs(0);
    const ticket = useAppStore
      .getState()
      .data.tickets.find((t) => t.customerId === 'C-001' && t.status !== 'CLOSED');
    expect(ticket).toBeDefined();
    if (!ticket) return;

    await mount(`/app/support/${ticket.id}`);
    // 预置首条客户留言已在时间线
    expect(html()).toContain('EUR 到账金额与预期不一致');

    const beforeMessages = useAppStore.getState().data.ticketMessages.length;
    const replyContent = '补充说明：请核对 EUR 到账明细，谢谢。';
    await fill('#reply-content', replyContent);
    await click(findButton('提交回复'));

    const messages = useAppStore.getState().data.ticketMessages;
    expect(messages.length).toBe(beforeMessages + 1);
    const created = messages.find((message) => message.content === replyContent);
    expect(created).toBeDefined();
    expect(created?.ticketId).toBe(ticket.id);
    expect(created?.authorKind).toBe('CUSTOMER');
    expect(created?.authorName).toBe('林小满');

    expect(html()).toContain(replyContent);
    // 提交成功后清空输入框，避免重复发送
    expect((container.querySelector('#reply-content') as HTMLTextAreaElement).value).toBe('');
  });
});
