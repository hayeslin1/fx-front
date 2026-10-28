// 运营客户管理 API（§8.4 ops-customer.ts）：只读查询，不做 KYC/冻结/改资料。
import type {
  CustomerDetailReq,
  CustomerDetailResp,
  CustomerOverview,
  CustomersQueryReq,
  Page,
} from './dto';
import { request } from './http';

/** 客户列表分页，附六币种余额与按最新中间价折算的 USD 估值 */
export function customersQuery(input: CustomersQueryReq): Promise<Page<CustomerOverview>> {
  return request<CustomersQueryReq, Page<CustomerOverview>>(
    '/api/ops/customers/query',
    input,
  );
}

/** 客户详情：资料 + 余额 + 最近订单概览 */
export function customerDetail(input: CustomerDetailReq): Promise<CustomerDetailResp> {
  return request<CustomerDetailReq, CustomerDetailResp>(
    '/api/ops/customers/detail',
    input,
  );
}
