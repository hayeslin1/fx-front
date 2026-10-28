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
import type { OpsUser, Ticket } from '@/domain/types';

// 运营客服处理纵切（M5 F5）渲染用例（jsdom，装配范式同 app/routes.test.tsx）：
// 覆盖列表出数与三类筛选、详情客户/时间线/关联订单、指派落库、回复首条置处理中、
// 关闭二次确认与禁回复、重开恢复、已关闭直显提示与未知工单号空态。
// WHY 走真实 createRoot + MemoryRouter + 真实 store：状态机/守卫/跳转均为真实实现，
// 断言 store 事实与 DOM 双口径；工单一律用业务键（主题）定位，禁止 TK-00x 位次假设。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const OPS_SPEC = SEED_OPS_ACCOUNTS.find((account) => account.isDemoAccount) ?? SEED_OPS_ACCOUNTS[0];

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

function text(): string {
  return container.textContent ?? '';
}

/** 表格数据区文本（表头/筛选下拉选项不在其中，避免“选项文案”造成假阳性断言） */
function tbodyText(): string {
  return container.querySelector('tbody')?.textContent ?? '';
}

/** DOM 内表格数据行数（DataTable 空态不渲染 tbody，计数即为 0） */
function tableRowCount(): number {
  return container.querySelectorAll('tbody tr').length;
}

/** 渲染路由；key 随 path 变化强制重建 MemoryRouter（同用例内多次 mount 切换路由） */
async function mount(path: string): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

function byId<T extends Element>(id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (element === null) throw new Error(`未找到元素 #${id}`);
  return element;
}

async function setInputValue(id: string, value: string): Promise<void> {
  const input = byId<HTMLInputElement | HTMLTextAreaElement>(id);
  await act(async () => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function setSelectValue(id: string, value: string): Promise<void> {
  const select = byId<HTMLSelectElement>(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 等一拍宏任务，确保提交/导航的异步链路全部完成后再断言 */
async function click(element: Element | null): Promise<void> {
  if (element === null) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
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

/** 按文案找按钮（可指定根节点：ConfirmDialog 经 portal 渲染在 document.body） */
function findButton(scope: ParentNode, label: string): HTMLButtonElement {
  const button = findButtonOrNull(scope, label);
  if (button === null) throw new Error(`未找到按钮「${label}」`);
  return button;
}

/** 业务键定位：按主题片段取预置工单（禁止硬编码 TK-00x 位次假设） */
function ticketBySubject(part: string): Ticket {
  const ticket = useAppStore.getState().data.tickets.find((item) => item.subject.includes(part));
  if (ticket === undefined) throw new Error(`预置工单不存在：${part}`);
  return ticket;
}

function storeTicket(ticketId: string): Ticket {
  const ticket = useAppStore.getState().data.tickets.find((item) => item.id === ticketId);
  if (ticket === undefined) throw new Error(`工单不存在：${ticketId}`);
  return ticket;
}

/** 业务键定位：按姓名取预置处理人 */
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

  if (OPS_SPEC === undefined) throw new Error('缺少预置运营账号');
  const login = await loginOps(OPS_SPEC.email, OPS_SPEC.password);
  if (!login.ok) throw new Error('运营登录失败');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('运营工单列表', () => {
  it('展示 3 个预置工单：工单号/主题/状态/处理人出数，未指派显示占位符', async () => {
    const pending = ticketBySubject('与预期不一致');
    const inProgress = ticketBySubject('报价过期提示咨询');
    const closed = ticketBySubject('钱包账单明细');

    await mount('/ops/support/tickets');

    expect(text()).toContain('客服处理');
    for (const header of ['工单号', '主题', '客户', '状态', '处理人', '最近更新']) {
      expect(html()).toContain(header);
    }
    expect(tableRowCount()).toBe(3);
    for (const ticket of [pending, inProgress, closed]) {
      expect(tbodyText()).toContain(ticket.id);
      expect(tbodyText()).toContain(ticket.subject);
    }
    // 客户名（C-001 林小满）与三种状态文案
    expect(tbodyText()).toContain('林小满');
    expect(tbodyText()).toContain('待处理');
    expect(tbodyText()).toContain('处理中');
    expect(tbodyText()).toContain('已关闭');
    // TK-002 处理人王倩；TK-001 未指派显示 —
    expect(tbodyText()).toContain('王倩');
    expect(tbodyText()).toContain('—');
  });

  it('状态筛选「已关闭」→ 仅剩已关闭工单', async () => {
    const pending = ticketBySubject('与预期不一致');
    const inProgress = ticketBySubject('报价过期提示咨询');
    const closed = ticketBySubject('钱包账单明细');

    await mount('/ops/support/tickets');
    await setSelectValue('ticket-status', 'CLOSED');

    expect(tableRowCount()).toBe(1);
    expect(tbodyText()).toContain(closed.id);
    expect(tbodyText()).toContain(closed.subject);
    expect(tbodyText()).not.toContain(pending.subject);
    expect(tbodyText()).not.toContain(inProgress.subject);
    expect(text()).toContain('共 1 个工单');
  });

  it('关键词即时过滤：主题/客户名/工单号均可命中', async () => {
    const pending = ticketBySubject('与预期不一致');
    const inProgress = ticketBySubject('报价过期提示咨询');
    const closed = ticketBySubject('钱包账单明细');

    await mount('/ops/support/tickets');

    // 主题命中：仅 TK-002
    await setInputValue('ticket-keyword', '报价');
    expect(tableRowCount()).toBe(1);
    expect(tbodyText()).toContain(inProgress.id);
    expect(tbodyText()).toContain(inProgress.subject);
    expect(tbodyText()).not.toContain(pending.subject);
    expect(tbodyText()).not.toContain(closed.subject);

    // 客户名命中：林小满 → 仅 TK-001
    await setInputValue('ticket-keyword', '林小满');
    expect(tableRowCount()).toBe(1);
    expect(tbodyText()).toContain(pending.id);

    // 工单号命中：TK-003 的完整单号 → 仅其一行
    await setInputValue('ticket-keyword', closed.id);
    expect(tableRowCount()).toBe(1);
    expect(tbodyText()).toContain(closed.id);

    // 无匹配关键词 → 空态区分“无匹配”（非“暂无工单”）
    await setInputValue('ticket-keyword', '不存在的关键词XYZ');
    expect(tableRowCount()).toBe(0);
    expect(text()).toContain('无匹配工单');
    expect(text()).not.toContain('暂无工单');
  });
});

describe('运营工单详情：指派与回复', () => {
  it('待处理工单详情展示客户资料与时间线；指派王倩后 store.assigneeId=OPS-002', async () => {
    const pending = ticketBySubject('与预期不一致');
    const customer = useAppStore
      .getState()
      .data.customers.find((item) => item.id === pending.customerId);
    if (customer === undefined) throw new Error('预置客户不存在');
    expect(pending.status).toBe('PENDING');
    expect(pending.assigneeId).toBeUndefined();

    await mount(`/ops/support/tickets/${pending.id}`);

    expect(html()).toContain(`工单号 ${pending.id}`);
    expect(text()).toContain(pending.subject);
    // 客户信息卡：姓名/邮箱/编号
    expect(text()).toContain('客户信息');
    expect(text()).toContain(customer.name);
    expect(text()).toContain(customer.email);
    expect(text()).toContain(customer.id);
    // 时间线：预置 1 条客户消息，时间正序口径由选择器保证
    const messages = useAppStore
      .getState()
      .data.ticketMessages.filter((message) => message.ticketId === pending.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.authorKind).toBe('CUSTOMER');
    expect(text()).toContain('沟通记录（1）');
    expect(text()).toContain(messages[0]?.content ?? '');
    // 关联订单卡：按事实口径断言（有则展示订单号，无则占位）
    expect(text()).toContain('关联订单');
    if (pending.relatedOrderId === undefined) {
      expect(text()).toContain('本工单未关联订单');
    } else {
      expect(text()).toContain(pending.relatedOrderId);
    }

    // 指派：下拉选中王倩后提交，store 事实落库且页面回显
    const wangqian = assigneeByName('王倩');
    await setSelectValue('ticket-assignee-select', wangqian.id);
    await click(findButton(container, '指派'));

    expect(storeTicket(pending.id).assigneeId).toBe(wangqian.id);
    expect(text()).toContain(wangqian.name);
  });

  it('回复成功：消息 +1（authorKind=OPS）且待处理工单自动置为处理中', async () => {
    const pending = ticketBySubject('与预期不一致');
    expect(pending.status).toBe('PENDING');
    const beforeMessages = useAppStore.getState().data.ticketMessages.length;

    await mount(`/ops/support/tickets/${pending.id}`);
    const content = '正在核实';
    await setInputValue('ops-reply-content', content);
    await click(findButton(container, '回复'));

    const messages = useAppStore.getState().data.ticketMessages;
    expect(messages.length).toBe(beforeMessages + 1);
    const created = messages.find((message) => message.content === content);
    expect(created).toBeDefined();
    expect(created?.ticketId).toBe(pending.id);
    expect(created?.authorKind).toBe('OPS');
    expect(created?.authorId).toBe(OPS_SPEC?.id);
    expect(created?.authorName).toBe(OPS_SPEC?.name);

    // 首条回复语义：PENDING → IN_PROGRESS（同一次用户操作内顺序两条命令）
    expect(storeTicket(pending.id).status).toBe('IN_PROGRESS');

    // 时间线展示新回复与作者；状态徽标更新；输入框清空防重复发送
    expect(text()).toContain(content);
    expect(text()).toContain(OPS_SPEC?.name ?? '');
    expect(text()).toContain('处理中');
    expect(byId<HTMLTextAreaElement>('ops-reply-content').value).toBe('');
  });
});

describe('运营工单详情：关闭与重开', () => {
  it('关闭需二次确认：CLOSED 后回复框禁用并提示；重开恢复可回复', async () => {
    const target = ticketBySubject('报价过期提示咨询');

    await mount(`/ops/support/tickets/${target.id}`);

    // 独立关闭按钮 + 确认弹窗（portal 渲染在 document.body）
    await click(findButton(container, '关闭工单'));
    expect(document.body.textContent).toContain('确认关闭');
    await click(findButton(document.body, '确认关闭'));

    expect(storeTicket(target.id).status).toBe('CLOSED');
    expect(byId<HTMLTextAreaElement>('ops-reply-content').disabled).toBe(true);
    expect(text()).toContain('已关闭工单不可回复，可重开');
    expect(findButtonOrNull(container, '关闭工单')).toBeNull();

    // 重开：CLOSED → PENDING，恢复可回复
    await click(findButton(container, '重开'));
    expect(storeTicket(target.id).status).toBe('PENDING');
    expect(byId<HTMLTextAreaElement>('ops-reply-content').disabled).toBe(false);
    expect(text()).not.toContain('已关闭工单不可回复，可重开');
  });

  it('已关闭工单详情直显禁回复提示；未知工单号渲染空态', async () => {
    const closed = ticketBySubject('钱包账单明细');
    expect(closed.status).toBe('CLOSED');

    await mount(`/ops/support/tickets/${closed.id}`);
    expect(text()).toContain('已关闭工单不可回复，可重开');
    expect(byId<HTMLTextAreaElement>('ops-reply-content').disabled).toBe(true);
    expect(findButtonOrNull(container, '关闭工单')).toBeNull();
    expect(findButtonOrNull(container, '重开')).not.toBeNull();
    // 已关闭工单不可指派：下拉与指派按钮均禁用并提示
    expect(byId<HTMLSelectElement>('ticket-assignee-select').disabled).toBe(true);
    expect(findButton(container, '指派').disabled).toBe(true);
    expect(text()).toContain('工单已关闭，不可指派处理人');

    // 未知工单号 → 空态（含返回入口）
    await mount('/ops/support/tickets/TK-404-0000');
    expect(text()).toContain('工单不存在');
    expect(text()).toContain('返回工单列表');
  });
});
