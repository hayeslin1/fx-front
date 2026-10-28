// 客户兑换模块 API（§8.4 exchange.ts）。
import type {
  ExchangeExecuteReq,
  ExchangeExecuteResp,
  ExchangeQuoteReq,
  Quote,
} from './dto';
import { request } from './http';

/**
 * 取价：以来源/目标币种表达方向，服务端推导 pairId 与 direction。
 * 业务失败（无有效报价）由服务端返回 code != 0，并可在扩展字段携带渠道诊断。
 */
export function quote(input: ExchangeQuoteReq): Promise<Quote> {
  return request<ExchangeQuoteReq, Quote>('/api/exchange/quote', input);
}

/** 确认成交（幂等）：服务端二次校验报价未过期与余额充足，失败零写入 */
export function execute(input: Omit<ExchangeExecuteReq, 'requestId'>): Promise<ExchangeExecuteResp> {
  return request<ExchangeExecuteReq, ExchangeExecuteResp>('/api/exchange/execute', input, {
    idempotent: true,
  });
}
