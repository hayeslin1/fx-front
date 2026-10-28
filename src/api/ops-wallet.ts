// 运营钱包模块 API（§8.4 ops-wallet.ts）：余额/账单查询与代客充值。
import type {
  AssistedTopUpReq,
  AssistedTopUpResp,
  CustomerBalances,
  OpsBillsQueryReq,
  OpsWalletBalancesReq,
  Page,
  WalletBillWithCustomer,
} from './dto';
import { request } from './http';

/** 客户余额分页，支持按客户 id 或关键词（姓名/邮箱）搜索 */
export function balancesQuery(input: OpsWalletBalancesReq): Promise<Page<CustomerBalances>> {
  return request<OpsWalletBalancesReq, Page<CustomerBalances>>(
    '/api/ops/wallet/balances/query',
    input,
  );
}

/** 全量账单分页，附客户摘要 */
export function billsQuery(input: OpsBillsQueryReq): Promise<Page<WalletBillWithCustomer>> {
  return request<OpsBillsQueryReq, Page<WalletBillWithCustomer>>(
    '/api/ops/wallet/bills/query',
    input,
  );
}

/** 代客充值（幂等）：备注必填并记录操作人，用于审计 */
export function assistedTopUp(
  input: Omit<AssistedTopUpReq, 'requestId'>,
): Promise<AssistedTopUpResp> {
  return request<AssistedTopUpReq, AssistedTopUpResp>(
    '/api/ops/wallet/assisted-top-up',
    input,
    { idempotent: true },
  );
}
