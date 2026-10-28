import { QUOTE_CCY } from './constants';
import type { Currency, PairId, TradeDirection } from './types';

// 币种对 ↔ 币对/方向的推导（客户端接口以币种对表达方向，服务端推导，设计文档 §8.4）

/** 由 来源币/目标币 推导 USD 枢纽币对；非法组合（非 USD 参与/同币种）返回 null */
export function pairIdFor(source: Currency, target: Currency): PairId | null {
  if (source === target) return null;
  if (source === 'USD') return `USD/${target}` as PairId;
  if (target === 'USD') return `USD/${source}` as PairId;
  return null; // 本期不开放交叉币对（PRD §3.3）
}

/** 由来源币推导客户方向：来源为 USD → 卖 USD 买外币 */
export function directionFor(source: Currency): TradeDirection {
  return source === 'USD' ? 'SELL_USD' : 'BUY_USD';
}

export function quoteCurrencyOf(pairId: PairId): Currency {
  return QUOTE_CCY[pairId];
}
