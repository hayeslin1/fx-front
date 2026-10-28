// 运营交易模块 API（§8.4 trading.ts）：订单/敞口/平仓批次/收益订单。
import type {
  CloseBatch,
  CloseBatchCreateReq,
  CloseBatchDetailReq,
  CloseBatchDetailResp,
  CloseBatchRetryReq,
  CloseBatchesQueryReq,
  EmptyReq,
  ExposureQueryResp,
  OpsOrderDetailReq,
  OpsOrderDetailResp,
  OpsOrdersQueryReq,
  OrderWithCustomer,
  Page,
  ProfitOrder,
  ProfitOrderDetailReq,
  ProfitOrderWithCustomer,
  ProfitOrdersQueryReq,
} from './dto';
import { request } from './http';

// ---------- 客户订单 ----------
export function ordersQuery(input: OpsOrdersQueryReq): Promise<Page<OrderWithCustomer>> {
  return request<OpsOrdersQueryReq, Page<OrderWithCustomer>>(
    '/api/ops/trading/orders/query',
    input,
  );
}

/** 订单详情：含订单级敞口 lot、关联流水与唯一收益单 */
export function orderDetail(input: OpsOrderDetailReq): Promise<OpsOrderDetailResp> {
  return request<OpsOrderDetailReq, OpsOrderDetailResp>(
    '/api/ops/trading/orders/detail',
    input,
  );
}

// ---------- 敞口 ----------
/** 五币对净敞口/可平金额 + 全部未平 lot */
export function exposureQuery(): Promise<ExposureQueryResp> {
  return request<EmptyReq, ExposureQueryResp>('/api/ops/trading/exposure/query', {});
}

// ---------- 平仓批次 ----------
export function closeBatchesQuery(input: CloseBatchesQueryReq): Promise<Page<CloseBatch>> {
  return request<CloseBatchesQueryReq, Page<CloseBatch>>(
    '/api/ops/trading/close-batches/query',
    input,
  );
}

/** 新建平仓（幂等）；simulatedResult 为演示字段，对接期由真实渠道结果替换 */
export function closeBatchCreate(
  input: Omit<CloseBatchCreateReq, 'requestId'>,
): Promise<CloseBatch> {
  return request<CloseBatchCreateReq, CloseBatch>(
    '/api/ops/trading/close-batches/create',
    input,
    { idempotent: true },
  );
}

/** 整批重试（幂等）：每次重试生成新尝试并重新锁定有效原始价 */
export function closeBatchRetry(
  input: Omit<CloseBatchRetryReq, 'requestId'>,
): Promise<CloseBatch> {
  return request<CloseBatchRetryReq, CloseBatch>(
    '/api/ops/trading/close-batches/retry',
    input,
    { idempotent: true },
  );
}

export function closeBatchDetail(input: CloseBatchDetailReq): Promise<CloseBatchDetailResp> {
  return request<CloseBatchDetailReq, CloseBatchDetailResp>(
    '/api/ops/trading/close-batches/detail',
    input,
  );
}

// ---------- 收益订单 ----------
export function profitOrdersQuery(
  input: ProfitOrdersQueryReq,
): Promise<Page<ProfitOrderWithCustomer>> {
  return request<ProfitOrdersQueryReq, Page<ProfitOrderWithCustomer>>(
    '/api/ops/trading/profit-orders/query',
    input,
  );
}

export function profitOrderDetail(input: ProfitOrderDetailReq): Promise<ProfitOrder> {
  return request<ProfitOrderDetailReq, ProfitOrder>(
    '/api/ops/trading/profit-orders/detail',
    input,
  );
}
