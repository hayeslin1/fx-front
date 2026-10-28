// 客户订单模块 API（§8.4 orders.ts）：服务端按 token 过滤，仅返回本人订单。
import type {
  Order,
  OrderDetailReq,
  OrderDetailResp,
  OrdersQueryReq,
  Page,
} from './dto';
import { request } from './http';

/** 本人订单分页查询，支持币对/日期过滤 */
export function query(input: OrdersQueryReq): Promise<Page<Order>> {
  return request<OrdersQueryReq, Page<Order>>('/api/orders/query', input);
}

/** 订单详情：客户侧只含订单与关联流水，不含敞口/收益单（PRD §3.4） */
export function detail(input: OrderDetailReq): Promise<OrderDetailResp> {
  return request<OrderDetailReq, OrderDetailResp>('/api/orders/detail', input);
}
