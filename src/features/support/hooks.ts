import { useCallback, useMemo } from 'react';
import {
  supportCommands,
  type CreateTicketInput,
  type CreateTicketResult,
  type ReplyResult,
} from '@/domain/services/support.service';
import type { DataState, DomainResult, Order, Ticket, TicketMessage } from '@/domain/types';
import { useAppStore } from '@/store';
import {
  getCustomerOrders,
  getCustomerTickets,
  getOrderById,
  getTicketById,
  getTicketMessages,
} from '@/store/selectors';

// 客服工单薄 hooks（设计文档 §7.2）：页面唯一触达 store 的入口。
// WHY 页面经此读写而非直接 import useAppStore：对接期只需把 hooks 内部从
// store.apply(本地服务) 换成 api.*()，页面组件零改动。

/** 工单视图：在事实字段上补处理人展示名，避免页面自行拼装人员数据 */
export interface SupportTicketView extends Ticket {
  /** 处理人姓名；未指派时为“未分配” */
  assigneeName: string;
}

/** 处理人 id → 姓名；分派名单与运营账号都可能是来源（seed §5.6） */
function assigneeNameOf(data: DataState, assigneeId: string | undefined): string {
  if (!assigneeId) return '未分配';
  const assignee =
    data.assignees.find((user) => user.id === assigneeId) ??
    data.opsAccounts.find((account) => account.id === assigneeId);
  return assignee?.name ?? assigneeId;
}

/** 当前登录客户 id（未登录返回 undefined；路由守卫下正常不会出现） */
export function useSupportCustomerId(): string | undefined {
  return useAppStore((state) => state.session.client?.customerId);
}

/** 客户工单列表（选择器已按 updatedAt 倒序） */
export function useSupportList(): {
  customerId: string | undefined;
  tickets: SupportTicketView[];
} {
  const customerId = useSupportCustomerId();
  const data = useAppStore((state) => state.data);

  const tickets = useMemo(() => {
    if (!customerId) return [];
    return getCustomerTickets(data, customerId).map((ticket) => ({
      ...ticket,
      assigneeName: assigneeNameOf(data, ticket.assigneeId),
    }));
  }, [data, customerId]);

  return { customerId, tickets };
}

/** 新建工单：可选关联的本人订单 + 提交动作 */
export function useSupportNewTicket(): {
  customerId: string | undefined;
  orders: Order[];
  createTicket: (input: CreateTicketInput) => Promise<DomainResult<CreateTicketResult>>;
} {
  const customerId = useSupportCustomerId();
  const data = useAppStore((state) => state.data);
  const apply = useAppStore((state) => state.apply);

  // 最近订单：选择器已按成交时间倒序，下拉取前 20 条足够覆盖“最近订单”诉求
  const orders = useMemo(
    () => (customerId ? getCustomerOrders(data, customerId).slice(0, 20) : []),
    [data, customerId],
  );

  const createTicket = useCallback(
    async (input: CreateTicketInput): Promise<DomainResult<CreateTicketResult>> => {
      if (!customerId) {
        return { ok: false, code: 'NOT_AUTHENTICATED', message: '登录状态已失效，请重新登录' };
      }
      return apply(supportCommands.createTicket(customerId, input));
    },
    [apply, customerId],
  );

  return { customerId, orders, createTicket };
}

/** 工单详情：归属校验后的工单、时间线、关联订单与客户回复动作 */
export function useSupportTicketDetail(ticketId: string | undefined): {
  ticket: Ticket | undefined;
  messages: TicketMessage[];
  relatedOrder: Order | undefined;
  assigneeName: string;
  reply: (content: string) => Promise<DomainResult<ReplyResult>>;
} {
  const customerId = useSupportCustomerId();
  const data = useAppStore((state) => state.data);
  const apply = useAppStore((state) => state.apply);

  // WHY 归属校验放在 hooks：越权 id 与不存在统一按“未找到”处理，
  // 页面不接触客户 id，避免出现“能按 id 看到他人工单”的旁路。
  const { ticket, messages, relatedOrder } = useMemo(() => {
    const found = ticketId ? getTicketById(data, ticketId) : undefined;
    const owned = found && customerId && found.customerId === customerId ? found : undefined;
    return {
      ticket: owned,
      messages: owned ? getTicketMessages(data, owned.id) : [],
      relatedOrder:
        owned?.relatedOrderId !== undefined
          ? getOrderById(data, owned.relatedOrderId)
          : undefined,
    };
  }, [data, ticketId, customerId]);

  const reply = useCallback(
    async (content: string): Promise<DomainResult<ReplyResult>> => {
      if (!customerId || !ticketId) {
        return { ok: false, code: 'NOT_AUTHENTICATED', message: '登录状态已失效，请重新登录' };
      }
      return apply(supportCommands.customerReply(customerId, ticketId, content));
    },
    [apply, customerId, ticketId],
  );

  return {
    ticket,
    messages,
    relatedOrder,
    assigneeName: assigneeNameOf(data, ticket?.assigneeId),
    reply,
  };
}
