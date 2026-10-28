import { nextId } from '../ids';
import type {
  DataState,
  DomainCommand,
  DomainResult,
  Ticket,
  TicketMessage,
  TicketStatus,
} from '../types';

// 客服工单领域服务（设计文档 §8.4 support.ts、PRD §3.5 / §5.6）
// 双端共享同一事实：工单状态、分派、消息全部写回 DataState。
// 状态机（PRD §5.6）：待处理(PENDING)、处理中(IN_PROGRESS)、已关闭(CLOSED)；
// 已关闭不可回复，可主动重开。

export interface CreateTicketInput {
  subject: string;
  content: string;
  relatedOrderId?: string;
}

export interface CreateTicketResult {
  ticket: Ticket;
  message: TicketMessage;
}

export interface ReplyResult {
  ticket: Ticket;
  message: TicketMessage;
}

function fail(code: string, message: string): DomainResult<never> {
  return { ok: false, code, message };
}

function opsExists(state: DataState, operatorId: string): boolean {
  return state.opsAccounts.some((a) => a.id === operatorId);
}

function findTicket(state: DataState, ticketId: string): Ticket | undefined {
  return state.tickets.find((t) => t.id === ticketId);
}

/**
 * 对齐当日工单计数器后再取号。
 * WHY：seed 预置工单未按时间序写入，持久化的 TK 计数器可能停留在更早日期，
 * 直接 nextId 会与当日既有工单号重号（如已有 TK-20261028-0001 又生成同号）。
 * 这里按既有当日最大序号回填计数器，仍统一经 nextId 生成编号。
 */
function alignTicketCounter(state: DataState, now: number): DataState['counters'] {
  const dayKey = nextId(state.counters, 'TK', now).id.split('-')[1] ?? '';
  let maxSeq = 0;
  for (const ticket of state.tickets) {
    const match = new RegExp(`^TK-${dayKey}-(\\d+)$`).exec(ticket.id);
    if (match) {
      const seq = Number.parseInt(match[1] ?? '0', 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  const current = state.counters.TK;
  if (current && current.day === dayKey && current.seq >= maxSeq) {
    return state.counters;
  }
  return { ...state.counters, TK: { day: dayKey, seq: maxSeq } };
}

/** 合法状态流转：同态不视为流转；关闭后允许重开 */
const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['PENDING', 'CLOSED'],
  CLOSED: ['PENDING', 'IN_PROGRESS'],
};

function isTicketStatus(value: string): value is TicketStatus {
  return value === 'PENDING' || value === 'IN_PROGRESS' || value === 'CLOSED';
}

/**
 * 追加消息并同步工单 updatedAt。
 * WHY 消息 id 走 nextId：与订单/流水一致，计数器持久化保证重放与刷新后编号稳定。
 */
function appendMessage(input: {
  state: DataState;
  ticket: Ticket;
  authorKind: 'CUSTOMER' | 'OPS';
  authorId: string;
  authorName: string;
  content: string;
  now: number;
}): { ticket: Ticket; message: TicketMessage; state: DataState } {
  const { state, ticket, authorKind, authorId, authorName, content, now } = input;
  const { id, counters } = nextId(state.counters, 'TM', now);
  const message: TicketMessage = {
    id,
    ticketId: ticket.id,
    authorKind,
    authorId,
    authorName,
    content,
    createdAt: now,
  };
  const updatedTicket: Ticket = { ...ticket, updatedAt: now };
  return {
    ticket: updatedTicket,
    message,
    state: {
      ...state,
      tickets: state.tickets.map((t) => (t.id === ticket.id ? updatedTicket : t)),
      ticketMessages: [...state.ticketMessages, message],
      counters,
    },
  };
}

export const supportCommands = {
  /**
   * 客户创建工单（PRD §3.5）：主题、内容必填；可选关联订单必须属于当前客户。
   * 首条客户留言与工单在同一事务内创建，初始状态 PENDING。
   */
  createTicket(customerId: string, input: CreateTicketInput): DomainCommand<CreateTicketResult> {
    return {
      run: (state, ctx): DomainResult<CreateTicketResult> => {
        const customer = state.customers.find((c) => c.id === customerId);
        if (!customer) {
          return fail('CUSTOMER_NOT_FOUND', '客户不存在');
        }
        const subject = input.subject.trim();
        if (!subject) {
          return fail('SUBJECT_REQUIRED', '请输入工单主题');
        }
        const content = input.content.trim();
        if (!content) {
          return fail('CONTENT_REQUIRED', '请输入工单内容');
        }
        if (input.relatedOrderId !== undefined) {
          const order = state.orders.find((o) => o.id === input.relatedOrderId);
          if (!order || order.customerId !== customerId) {
            return fail('ORDER_NOT_FOUND', '关联订单不存在或不属于当前客户');
          }
        }

        const ticketIdResult = nextId(alignTicketCounter(state, ctx.now), 'TK', ctx.now);
        const ticket: Ticket = {
          id: ticketIdResult.id,
          customerId,
          subject,
          ...(input.relatedOrderId === undefined ? {} : { relatedOrderId: input.relatedOrderId }),
          status: 'PENDING',
          createdAt: ctx.now,
          updatedAt: ctx.now,
        };
        const messageIdResult = nextId(ticketIdResult.counters, 'TM', ctx.now);
        const message: TicketMessage = {
          id: messageIdResult.id,
          ticketId: ticket.id,
          authorKind: 'CUSTOMER',
          authorId: customerId,
          authorName: customer.name,
          content,
          createdAt: ctx.now,
        };

        return {
          ok: true,
          next: {
            ...state,
            tickets: [...state.tickets, ticket],
            ticketMessages: [...state.ticketMessages, message],
            counters: messageIdResult.counters,
          },
          data: { ticket, message },
        };
      },
    };
  },

  /** 客户追加留言：仅限本人工单；已关闭工单拒绝（PRD §3.5） */
  customerReply(customerId: string, ticketId: string, content: string): DomainCommand<ReplyResult> {
    return {
      run: (state, ctx): DomainResult<ReplyResult> => {
        const customer = state.customers.find((c) => c.id === customerId);
        if (!customer) {
          return fail('CUSTOMER_NOT_FOUND', '客户不存在');
        }
        const ticket = findTicket(state, ticketId);
        if (!ticket || ticket.customerId !== customerId) {
          return fail('TICKET_NOT_FOUND', '工单不存在');
        }
        if (ticket.status === 'CLOSED') {
          return fail('TICKET_CLOSED', '工单已关闭，无法继续回复');
        }
        const normalized = content.trim();
        if (!normalized) {
          return fail('CONTENT_REQUIRED', '请输入回复内容');
        }
        const appended = appendMessage({
          state,
          ticket,
          authorKind: 'CUSTOMER',
          authorId: customerId,
          authorName: customer.name,
          content: normalized,
          now: ctx.now,
        });
        return {
          ok: true,
          next: appended.state,
          data: { ticket: appended.ticket, message: appended.message },
        };
      },
    };
  },

  /** 运营回复：操作者必须为运营账号；已关闭工单拒绝 */
  opsReply(operatorId: string, ticketId: string, content: string): DomainCommand<ReplyResult> {
    return {
      run: (state, ctx): DomainResult<ReplyResult> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const operator = state.opsAccounts.find((a) => a.id === operatorId);
        const ticket = findTicket(state, ticketId);
        if (!ticket) {
          return fail('TICKET_NOT_FOUND', '工单不存在');
        }
        if (ticket.status === 'CLOSED') {
          return fail('TICKET_CLOSED', '工单已关闭，无法继续回复');
        }
        const normalized = content.trim();
        if (!normalized) {
          return fail('CONTENT_REQUIRED', '请输入回复内容');
        }
        if (!operator) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const appended = appendMessage({
          state,
          ticket,
          authorKind: 'OPS',
          authorId: operatorId,
          authorName: operator.name,
          content: normalized,
          now: ctx.now,
        });
        return {
          ok: true,
          next: appended.state,
          data: { ticket: appended.ticket, message: appended.message },
        };
      },
    };
  },

  /** 指派处理人（PRD §5.6）：必须在预置处理人名单内；已关闭工单不可指派 */
  assign(
    operatorId: string,
    ticketId: string,
    assigneeId: string,
  ): DomainCommand<{ ticket: Ticket }> {
    return {
      run: (state, ctx): DomainResult<{ ticket: Ticket }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const ticket = findTicket(state, ticketId);
        if (!ticket) {
          return fail('TICKET_NOT_FOUND', '工单不存在');
        }
        if (ticket.status === 'CLOSED') {
          return fail('TICKET_CLOSED', '工单已关闭，无法指派处理人');
        }
        if (!state.assignees.some((u) => u.id === assigneeId)) {
          return fail('ASSIGNEE_NOT_FOUND', '处理人不在预置名单内');
        }
        const updated: Ticket = { ...ticket, assigneeId, updatedAt: ctx.now };
        return {
          ok: true,
          next: {
            ...state,
            tickets: state.tickets.map((t) => (t.id === ticketId ? updated : t)),
          },
          data: { ticket: updated },
        };
      },
    };
  },

  /**
   * 变更工单状态：仅允许三种状态间的合法流转（同态不算流转）。
   * CLOSED → PENDING/IN_PROGRESS 即“重开”，重开后恢复可回复。
   */
  setStatus(
    operatorId: string,
    ticketId: string,
    status: TicketStatus,
  ): DomainCommand<{ ticket: Ticket }> {
    return {
      run: (state, ctx): DomainResult<{ ticket: Ticket }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const ticket = findTicket(state, ticketId);
        if (!ticket) {
          return fail('TICKET_NOT_FOUND', '工单不存在');
        }
        if (!isTicketStatus(status)) {
          return fail('INVALID_STATUS', '不支持的工单状态');
        }
        if (!ALLOWED_TRANSITIONS[ticket.status].includes(status)) {
          return fail('INVALID_STATUS_TRANSITION', '不允许的工单状态流转');
        }
        const updated: Ticket = { ...ticket, status, updatedAt: ctx.now };
        return {
          ok: true,
          next: {
            ...state,
            tickets: state.tickets.map((t) => (t.id === ticketId ? updated : t)),
          },
          data: { ticket: updated },
        };
      },
    };
  },

  /** 关闭工单（幂等）：已关闭时直接返回当前工单，不产生重复时间戳变更 */
  close(operatorId: string, ticketId: string): DomainCommand<{ ticket: Ticket }> {
    return {
      run: (state, ctx): DomainResult<{ ticket: Ticket }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const ticket = findTicket(state, ticketId);
        if (!ticket) {
          return fail('TICKET_NOT_FOUND', '工单不存在');
        }
        if (ticket.status === 'CLOSED') {
          return { ok: true, next: state, data: { ticket } };
        }
        const updated: Ticket = { ...ticket, status: 'CLOSED', updatedAt: ctx.now };
        return {
          ok: true,
          next: {
            ...state,
            tickets: state.tickets.map((t) => (t.id === ticketId ? updated : t)),
          },
          data: { ticket: updated },
        };
      },
    };
  },
};
