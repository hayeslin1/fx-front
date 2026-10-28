// 运营客户管理 API（§8.4 ops-customer.ts）：查询 + 建户/编辑/重置密码（演示级）。
// 冻结/KYC 等真实风控能力不在原型范围。
import type {
  Customer,
  CustomerCreateReq,
  CustomerDetailReq,
  CustomerDetailResp,
  CustomerOverview,
  CustomerResetPasswordReq,
  CustomerResetPasswordResp,
  CustomerUpdateReq,
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

/** 运营建户：邮箱忽略大小写判重；密码规则与注册一致（≥8 位含字母数字） */
export function createCustomer(input: CustomerCreateReq): Promise<Customer> {
  return request<CustomerCreateReq, Customer>(
    '/api/ops/customers/create',
    input,
    { idempotent: true },
  );
}

/** 编辑客户资料（姓名/邮箱，未传字段不变） */
export function updateCustomer(input: CustomerUpdateReq): Promise<Customer> {
  return request<CustomerUpdateReq, Customer>(
    '/api/ops/customers/update',
    input,
  );
}

/** 重置客户密码（演示级 SHA-256(salt:password)，非生产方案） */
export function resetPassword(
  input: CustomerResetPasswordReq,
): Promise<CustomerResetPasswordResp> {
  return request<CustomerResetPasswordReq, CustomerResetPasswordResp>(
    '/api/ops/customers/reset-password',
    input,
    { idempotent: true },
  );
}
