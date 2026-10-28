import { useCallback, useMemo, useRef, useState } from 'react';
import { supportCommands, type ReplyResult } from '@/domain/services/support.service';
import type {
  Customer,
  DataState,
  DomainCommand,
  DomainResult,
  OpsUser,
  Order,
  Ticket,
  TicketMessage,
  TicketStatus,
} from '@/domain/types';
import { useAppStore } from '@/store';
import { getCustomerById, getOrderById, getTicketById, getTicketMessages } from '@/store/selectors';

// 运营客服处理薄 hooks（设计文档 §7.2/§10.3 客服处理段、PRD §5.6）：
// 工单列表/详情/操作的 store 读写全部收敛在本文件，页面组件不直接触达 store；
// 对接后端时仅替换本文件内部实现（本地选择器 + 领域服务 → src/api 调用），页面与测试不动。

// ---------- 纯函数（不依赖 React/store，可在 node 环境直接断言） ----------

/**
 * 处理人展示名：未指派返回 '—'（列表列口径）。
 * WHY 回退原始 id：名单/账号被调整后历史工单仍要能追溯指派对象，不能空白或显示 undefined。
 */
export function assigneeNameOf(data: DataState, assigneeId: string | undefined): string {
  if (!assigneeId) return '—';
  const assignee =
    data.assignees.find((user) => user.id === assigneeId) ??
    data.opsAccounts.find((account) => account.id === assigneeId);
  return assignee?.name ?? assigneeId;
}

/** 列表行：工单事实 + 客户名/处理人展示名（页面不自行拼装人员与客户数据） */
export interface OpsTicketRow extends Ticket {
  customerName: string;
  assigneeName: string;
}

/** 处理人筛选：'ALL' 全部、'UNASSIGNED' 未指派、其余为处理人 id */
export type OpsAssigneeFilter = 'ALL' | 'UNASSIGNED' | string;

export interface OpsTicketQuery {
  status: TicketStatus | 'ALL';
  assigneeId: OpsAssigneeFilter;
  /** 匹配主题/客户名/工单号，大小写不敏感，空关键词恒匹配（即时过滤） */
  keyword: string;
}

/**
 * 工单筛选（状态 + 处理人 + 关键词，条件之间为 AND）。
 * WHY 关键词同时匹配工单号：运营常拿着客户发来的 TK 单号直接检索。
 */
export function filterOpsTickets(rows: OpsTicketRow[], query: OpsTicketQuery): OpsTicketRow[] {
  const needle = query.keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (query.status !== 'ALL' && row.status !== query.status) return false;
    if (query.assigneeId === 'UNASSIGNED') {
      if (row.assigneeId !== undefined) return false;
    } else if (query.assigneeId !== 'ALL' && row.assigneeId !== query.assigneeId) {
      return false;
    }
    if (!needle) return true;
    return (
      row.subject.toLowerCase().includes(needle) ||
      row.id.toLowerCase().includes(needle) ||
      row.customerName.toLowerCase().includes(needle)
    );
  });
}

// ---------- 读取 hooks ----------

/** 运营会话与指派上下文：operatorId 取当前 ops 会话，assignees 为预置处理人名单 */
export interface OpsSupportContext {
  operatorId: string | null;
  /** 预置处理人名单（PRD §5.6；seed §5.4） */
  assignees: OpsUser[];
}

export function useOpsSupportContext(): OpsSupportContext {
  const operatorId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);
  const data = useAppStore((state) => state.data);
  return { operatorId, assignees: data.assignees };
}

/** 全量工单列表（最近更新在前；客户名/处理人展示名已就位） */
export function useOpsTicketRows(): OpsTicketRow[] {
  const data = useAppStore((state) => state.data);
  return useMemo(() => {
    // 排序口径与客户列表选择器一致：updatedAt 倒序，同刻按 id 倒序保证稳定
    const sorted = [...data.tickets].sort(
      (a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id),
    );
    return sorted.map((ticket) => ({
      ...ticket,
      customerName: getCustomerById(data, ticket.customerId)?.name ?? ticket.customerId,
      assigneeName: assigneeNameOf(data, ticket.assigneeId),
    }));
  }, [data]);
}

export interface OpsTicketDetailView {
  ticket: Ticket | undefined;
  customer: Customer | undefined;
  /** 消息时间线（时间正序，选择器已排序） */
  messages: TicketMessage[];
  relatedOrder: Order | undefined;
  assigneeName: string;
}

const EMPTY_DETAIL: OpsTicketDetailView = {
  ticket: undefined,
  customer: undefined,
  messages: [],
  relatedOrder: undefined,
  assigneeName: '—',
};

/** 工单详情视图：工单 + 客户资料 + 时间线 + 关联订单（运营端无归属校验，按单号直达） */
export function useOpsTicketDetail(ticketId: string | undefined): OpsTicketDetailView {
  const data = useAppStore((state) => state.data);
  return useMemo(() => {
    if (ticketId === undefined) return EMPTY_DETAIL;
    const ticket = getTicketById(data, ticketId);
    if (ticket === undefined) return EMPTY_DETAIL;
    return {
      ticket,
      customer: getCustomerById(data, ticket.customerId),
      messages: getTicketMessages(data, ticket.id),
      relatedOrder:
        ticket.relatedOrderId !== undefined ? getOrderById(data, ticket.relatedOrderId) : undefined,
      assigneeName: assigneeNameOf(data, ticket.assigneeId),
    };
  }, [data, ticketId]);
}

// ---------- 写入 hooks ----------

/** 未登录运营会话时的统一拒绝（路由守卫下正常不会出现） */
const NO_OPS_SESSION: DomainResult<never> = {
  ok: false,
  code: 'NO_OPS_SESSION',
  message: '运营登录状态已失效，请重新登录',
};

export interface OpsTicketActions {
  /** 任一操作提交中：页面据此禁用控件，防双击重复提交 */
  pending: boolean;
  assign: (assigneeId: string) => Promise<DomainResult<{ ticket: Ticket }>>;
  reply: (content: string) => Promise<DomainResult<ReplyResult>>;
  transition: (status: TicketStatus) => Promise<DomainResult<{ ticket: Ticket }>>;
  close: () => Promise<DomainResult<{ ticket: Ticket }>>;
}

/**
 * 工单操作四件套（指派/回复/状态切换/关闭）：经 store.apply 提交 supportCommands，
 * operatorId 取当前运营会话（领域服务再校验账号存在与合法流转，非法一律零变更）。
 * WHY 用 ref 同步守卫：setPending 是异步渲染，仅靠 disabled 挡不住同一帧内的双击。
 */
export function useOpsTicketActions(ticketId: string | undefined): OpsTicketActions {
  const apply = useAppStore((state) => state.apply);
  const operatorId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T>(command: DomainCommand<T>): Promise<DomainResult<T>> => {
      if (pendingRef.current) {
        return { ok: false, code: 'SUBMIT_PENDING', message: '正在提交，请勿重复操作' };
      }
      pendingRef.current = true;
      setPending(true);
      try {
        return await apply(command);
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [apply],
  );

  const assign = useCallback(
    async (assigneeId: string): Promise<DomainResult<{ ticket: Ticket }>> => {
      if (operatorId === null || ticketId === undefined) return NO_OPS_SESSION;
      return run(supportCommands.assign(operatorId, ticketId, assigneeId));
    },
    [operatorId, run, ticketId],
  );

  const transition = useCallback(
    async (status: TicketStatus): Promise<DomainResult<{ ticket: Ticket }>> => {
      if (operatorId === null || ticketId === undefined) return NO_OPS_SESSION;
      return run(supportCommands.setStatus(operatorId, ticketId, status));
    },
    [operatorId, run, ticketId],
  );

  const close = useCallback(async (): Promise<DomainResult<{ ticket: Ticket }>> => {
    if (operatorId === null || ticketId === undefined) return NO_OPS_SESSION;
    return run(supportCommands.close(operatorId, ticketId));
  }, [operatorId, run, ticketId]);

  const reply = useCallback(
    async (content: string): Promise<DomainResult<ReplyResult>> => {
      if (operatorId === null || ticketId === undefined) return NO_OPS_SESSION;
      // WHY 提交前读 store 事实而非渲染快照：需按“此刻真实状态”决定是否置为处理中，
      // 避免组件快照过期（客户在另一端刚留言/重开）导致漏流转或误流转。
      const statusBefore = getTicketById(useAppStore.getState().data, ticketId)?.status;
      const result = await run(supportCommands.opsReply(operatorId, ticketId, content));
      if (result.ok && statusBefore === 'PENDING') {
        // WHY 同一次用户操作内顺序 apply 两条命令（PRD §5.6「首条回复可将状态置为处理中」）：
        // opsReply 成功且原状态为待处理时，再置为处理中；不合并为单条领域命令，
        // 保持 opsReply（只追加消息）与 setStatus（状态机校验/重开语义）职责单一。
        const transitioned = await run(
          supportCommands.setStatus(operatorId, ticketId, 'IN_PROGRESS'),
        );
        // 第二条失败（极端并发：工单被移除）不回滚已落库的回复，以状态流转失败提示为准
        if (!transitioned.ok) return transitioned;
      }
      return result;
    },
    [operatorId, run, ticketId],
  );

  return { pending, assign, reply, transition, close };
}
