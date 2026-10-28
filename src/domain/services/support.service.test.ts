import { beforeEach, describe, expect, it } from 'vitest';
import { buildSeed } from '../seed';
import type { DataState, DomainResult, Ticket, TicketStatus } from '../types';
import { supportCommands } from './support.service';

// 客服工单：双端共享事实、状态机、关闭禁回复、指派名单与失败零变更
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

function stateJson(s: DataState): string {
  return JSON.stringify(s);
}

function expectFailedZero(result: DomainResult<unknown>, beforeJson: string): void {
  expect(result.ok).toBe(false);
  expect(stateJson(state)).toBe(beforeJson);
}

function ticketOf(customerId: string, status?: TicketStatus): Ticket {
  const ticket = state.tickets.find(
    (t) => t.customerId === customerId && (status === undefined || t.status === status),
  );
  if (!ticket) throw new Error(`ticket missing: ${customerId} ${status ?? ''}`);
  return ticket;
}

describe('createTicket', () => {
  it('成功：初始 PENDING，首条客户留言与工单同事务创建，编号计数器推进', async () => {
    const order = state.orders.find((o) => o.customerId === 'C-001');
    expect(order).toBeDefined();
    if (!order) return;

    const result = await supportCommands
      .createTicket('C-001', {
        subject: '  到账金额咨询  ',
        content: '  请帮忙核对到账金额  ',
        relatedOrderId: order.id,
      })
      .run(state, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { ticket, message } = result.data;
    expect(ticket.id).toMatch(/^TK-\d{8}-\d{4}$/);
    expect(ticket.subject).toBe('到账金额咨询');
    expect(ticket.status).toBe('PENDING');
    expect(ticket.assigneeId).toBeUndefined();
    expect(ticket.relatedOrderId).toBe(order.id);
    expect(ticket.createdAt).toBe(NOW);
    expect(ticket.updatedAt).toBe(NOW);

    expect(message.id).toMatch(/^TM-\d{8}-\d{4}$/);
    expect(message.ticketId).toBe(ticket.id);
    expect(message.authorKind).toBe('CUSTOMER');
    expect(message.authorId).toBe('C-001');
    expect(message.authorName).toBe('林小满');
    expect(message.content).toBe('请帮忙核对到账金额');
    expect(message.createdAt).toBe(NOW);

    expect(result.next.tickets).toHaveLength(state.tickets.length + 1);
    expect(result.next.ticketMessages).toHaveLength(state.ticketMessages.length + 1);
    // seed 已有当日工单 TK-…-0001，取号须续号为 0002（不与既有工单重号）
    expect(result.next.tickets.filter((t) => t.id === ticket.id)).toHaveLength(1);
    expect(result.next.counters.TK?.seq).toBe(2);
    expect(result.next.counters.TM?.seq).toBe(1);
  });

  it('主题/内容为空、客户不存在、关联他人订单均拒绝且零变更', async () => {
    const otherOrder = state.orders.find((o) => o.customerId === 'C-002');
    expect(otherOrder).toBeDefined();
    if (!otherOrder) return;

    const cases: Array<{
      customerId: string;
      input: { subject: string; content: string; relatedOrderId?: string };
      code: string;
    }> = [
      { customerId: 'C-001', input: { subject: '   ', content: '内容' }, code: 'SUBJECT_REQUIRED' },
      { customerId: 'C-001', input: { subject: '主题', content: '  ' }, code: 'CONTENT_REQUIRED' },
      {
        customerId: 'C-999',
        input: { subject: '主题', content: '内容' },
        code: 'CUSTOMER_NOT_FOUND',
      },
      {
        customerId: 'C-001',
        input: { subject: '主题', content: '内容', relatedOrderId: otherOrder.id },
        code: 'ORDER_NOT_FOUND',
      },
    ];
    for (const item of cases) {
      const beforeJson = stateJson(state);
      const result = await supportCommands
        .createTicket(item.customerId, item.input)
        .run(state, { now: NOW });
      expectFailedZero(result, beforeJson);
      if (!result.ok) expect(result.code).toBe(item.code);
    }
  });
});

describe('客户留言 / 运营回复', () => {
  it('客户回复本人工单：追加 CUSTOMER 消息并刷新 updatedAt', async () => {
    const ticket = ticketOf('C-001', 'PENDING');
    const result = await supportCommands
      .customerReply('C-001', ticket.id, ' 补充信息 ')
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.message.authorKind).toBe('CUSTOMER');
    expect(result.data.message.authorId).toBe('C-001');
    expect(result.data.message.authorName).toBe('林小满');
    expect(result.data.message.content).toBe('补充信息');
    expect(result.data.ticket.updatedAt).toBe(NOW);
    expect(result.data.ticket.status).toBe('PENDING');
    expect(result.next.ticketMessages).toHaveLength(state.ticketMessages.length + 1);
  });

  it('运营回复：记录运营账号姓名，双端共享同一消息', async () => {
    const ticket = ticketOf('C-001', 'PENDING');
    const result = await supportCommands
      .opsReply('OPS-001', ticket.id, '已为您核对')
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.message.authorKind).toBe('OPS');
    expect(result.data.message.authorId).toBe('OPS-001');
    expect(result.data.message.authorName).toBe('演示管理员');
    const shared = result.next.ticketMessages.find((m) => m.id === result.data.message.id);
    expect(shared?.ticketId).toBe(ticket.id);
    expect(shared?.content).toBe('已为您核对');
  });

  it('已关闭工单双方均不可回复；非本人工单不可回复；失败零变更', async () => {
    const closed = ticketOf('C-003', 'CLOSED');
    const otherTicket = ticketOf('C-002');

    const customerOnClosed = await supportCommands
      .customerReply('C-003', closed.id, '再问一句')
      .run(state, { now: NOW });
    expect(customerOnClosed.ok).toBe(false);
    if (!customerOnClosed.ok) expect(customerOnClosed.code).toBe('TICKET_CLOSED');

    const opsOnClosed = await supportCommands
      .opsReply('OPS-001', closed.id, '回复')
      .run(state, { now: NOW });
    expect(opsOnClosed.ok).toBe(false);
    if (!opsOnClosed.ok) expect(opsOnClosed.code).toBe('TICKET_CLOSED');

    const beforeJson = stateJson(state);
    const otherCustomer = await supportCommands
      .customerReply('C-001', otherTicket.id, '越权')
      .run(state, { now: NOW });
    expectFailedZero(otherCustomer, beforeJson);
    if (!otherCustomer.ok) expect(otherCustomer.code).toBe('TICKET_NOT_FOUND');

    const unknownOps = await supportCommands
      .opsReply('OPS-999', otherTicket.id, '越权')
      .run(state, { now: NOW });
    expectFailedZero(unknownOps, beforeJson);
    if (!unknownOps.ok) expect(unknownOps.code).toBe('OPS_NOT_FOUND');

    const empty = await supportCommands
      .customerReply('C-001', ticketOf('C-001').id, '  ')
      .run(state, { now: NOW });
    expectFailedZero(empty, beforeJson);
    if (!empty.ok) expect(empty.code).toBe('CONTENT_REQUIRED');
  });
});

describe('assign', () => {
  it('指派名单内处理人成功并刷新 updatedAt', async () => {
    const ticket = ticketOf('C-001', 'PENDING');
    const result = await supportCommands
      .assign('OPS-001', ticket.id, 'OPS-002')
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ticket.assigneeId).toBe('OPS-002');
    expect(result.data.ticket.updatedAt).toBe(NOW);
  });

  it('名单外处理人/未知运营/已关闭工单拒绝且零变更', async () => {
    const ticket = ticketOf('C-001', 'PENDING');
    const closed = ticketOf('C-003', 'CLOSED');

    const notInList = await supportCommands
      .assign('OPS-001', ticket.id, 'OPS-999')
      .run(state, { now: NOW });
    expect(notInList.ok).toBe(false);
    if (!notInList.ok) expect(notInList.code).toBe('ASSIGNEE_NOT_FOUND');

    const beforeJson = stateJson(state);
    const noOps = await supportCommands
      .assign('OPS-999', ticket.id, 'OPS-002')
      .run(state, { now: NOW });
    expectFailedZero(noOps, beforeJson);
    if (!noOps.ok) expect(noOps.code).toBe('OPS_NOT_FOUND');

    const onClosed = await supportCommands
      .assign('OPS-001', closed.id, 'OPS-002')
      .run(state, { now: NOW });
    expectFailedZero(onClosed, beforeJson);
    if (!onClosed.ok) expect(onClosed.code).toBe('TICKET_CLOSED');
  });
});

describe('setStatus / close', () => {
  it('合法流转：PENDING → IN_PROGRESS → PENDING；CLOSED 可重开', async () => {
    const pending = ticketOf('C-001', 'PENDING');
    const inProgress = await supportCommands
      .setStatus('OPS-001', pending.id, 'IN_PROGRESS')
      .run(state, { now: NOW });
    expect(inProgress.ok).toBe(true);
    if (!inProgress.ok) return;
    expect(inProgress.data.ticket.status).toBe('IN_PROGRESS');
    expect(inProgress.data.ticket.updatedAt).toBe(NOW);

    const back = await supportCommands
      .setStatus('OPS-001', inProgress.data.ticket.id, 'PENDING')
      .run(inProgress.next, { now: NOW + 1 });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.data.ticket.status).toBe('PENDING');

    const closed = ticketOf('C-003', 'CLOSED');
    const reopened = await supportCommands
      .setStatus('OPS-001', closed.id, 'IN_PROGRESS')
      .run(state, { now: NOW });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.data.ticket.status).toBe('IN_PROGRESS');
  });

  it('同态/非法状态/未知运营拒绝且零变更', async () => {
    const pending = ticketOf('C-001', 'PENDING');
    const beforeJson = stateJson(state);

    const same = await supportCommands
      .setStatus('OPS-001', pending.id, 'PENDING')
      .run(state, { now: NOW });
    expectFailedZero(same, beforeJson);
    if (!same.ok) expect(same.code).toBe('INVALID_STATUS_TRANSITION');

    const illegal = await supportCommands
      .setStatus('OPS-001', pending.id, 'DONE' as TicketStatus)
      .run(state, { now: NOW });
    expectFailedZero(illegal, beforeJson);
    if (!illegal.ok) expect(illegal.code).toBe('INVALID_STATUS');

    const noOps = await supportCommands
      .setStatus('OPS-999', pending.id, 'CLOSED')
      .run(state, { now: NOW });
    expectFailedZero(noOps, beforeJson);
    if (!noOps.ok) expect(noOps.code).toBe('OPS_NOT_FOUND');
  });

  it('关闭后禁回复；重复关闭幂等不改变状态', async () => {
    const pending = ticketOf('C-001', 'PENDING');
    const closed = await supportCommands.close('OPS-001', pending.id).run(state, { now: NOW });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.data.ticket.status).toBe('CLOSED');
    expect(closed.data.ticket.updatedAt).toBe(NOW);

    const reply = await supportCommands
      .opsReply('OPS-001', pending.id, '关闭后回复')
      .run(closed.next, { now: NOW + 1 });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.code).toBe('TICKET_CLOSED');

    const again = await supportCommands.close('OPS-001', pending.id).run(closed.next, {
      now: NOW + 2,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.ticket.updatedAt).toBe(NOW);
  });
});
