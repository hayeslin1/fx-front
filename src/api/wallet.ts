// 客户钱包模块 API（§8.4 wallet.ts）。
import type {
  EmptyReq,
  Page,
  TopUpReq,
  TopUpResp,
  Wallet,
  WalletBill,
  WalletBillsReq,
} from './dto';
import { request } from './http';

/** 当前客户六币种余额；无入参 */
export function balances(): Promise<Wallet[]> {
  return request<EmptyReq, Wallet[]>('/api/wallet/balances/query', {});
}

/** 当前客户流水分页，支持币种/类型/时间过滤 */
export function bills(input: WalletBillsReq): Promise<Page<WalletBill>> {
  return request<WalletBillsReq, Page<WalletBill>>('/api/wallet/bills/query', input);
}

/** 自助充值（幂等）：金额为十进制字符串，精度由前后端双侧校验 */
export function topUp(input: Omit<TopUpReq, 'requestId'>): Promise<TopUpResp> {
  return request<TopUpReq, TopUpResp>('/api/wallet/top-up', input, { idempotent: true });
}
