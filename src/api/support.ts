// 工单模块 API（§8.4 support.ts）：客户与运营共用，路径前缀区分端。
import type {
  EmptyReq,
  OpsTicketAssignReq,
  OpsTicketCloseReq,
  OpsTicketStatusReq,
  OpsTicketsQueryReq,
  OpsUser,
  Page,
  Ticket,
  TicketCreateReq,
  TicketDetailReq,
  TicketDetailResp,
  TicketMessage,
  TicketReplyReq,
  TicketsQueryReq,
  TicketWithCustomer,
} from './dto';
import { request } from './http';

// ---------- 客户侧 ----------

/** 创建工单（幂等）：状态初始为 PENDING */
export function createTicket(input: Omit<TicketCreateReq, 'requestId'>): Promise<Ticket> {
  return request<TicketCreateReq, Ticket>('/api/support/tickets/create', input, {
    idempotent: true,
  });
}

/** 本人工单分页查询 */
export function queryTickets(input: TicketsQueryReq): Promise<Page<Ticket>> {
  return request<TicketsQueryReq, Page<Ticket>>('/api/support/tickets/query', input);
}

/** 工单详情与往来消息 */
export function ticketDetail(input: TicketDetailReq): Promise<TicketDetailResp> {
  return request<TicketDetailReq, TicketDetailResp>('/api/support/tickets/detail', input);
}

/** 追加回复（幂等）；工单已关闭时服务端返回 409xx */
export function replyTicket(input: Omit<TicketReplyReq, 'requestId'>): Promise<TicketMessage> {
  return request<TicketReplyReq, TicketMessage>('/api/support/tickets/reply', input, {
    idempotent: true,
  });
}

// ---------- 运营侧 ----------

/** 运营工单分页查询，支持状态/处理人/关键词过滤 */
export function opsQuery(input: OpsTicketsQueryReq): Promise<Page<TicketWithCustomer>> {
  return request<OpsTicketsQueryReq, Page<TicketWithCustomer>>(
    '/api/ops/support/tickets/query',
    input,
  );
}

/** 指派处理人 */
export function opsAssign(input: OpsTicketAssignReq): Promise<Ticket> {
  return request<OpsTicketAssignReq, Ticket>('/api/ops/support/tickets/assign', input);
}

/** 状态切换；合法流转由服务端按 §6 规则校验 */
export function opsSetStatus(input: OpsTicketStatusReq): Promise<Ticket> {
  return request<OpsTicketStatusReq, Ticket>('/api/ops/support/tickets/status', input);
}

/** 关闭工单（幂等）；关闭后双方均不可回复 */
export function opsClose(input: Omit<OpsTicketCloseReq, 'requestId'>): Promise<Ticket> {
  return request<OpsTicketCloseReq, Ticket>('/api/ops/support/tickets/close', input, {
    idempotent: true,
  });
}

/** 预置处理人名单 */
export function assignees(): Promise<OpsUser[]> {
  return request<EmptyReq, OpsUser[]>('/api/ops/support/assignees/query', {});
}
