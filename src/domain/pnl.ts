import { D, type Decimal } from './money';
import type { DecimalStr, PlatformSide, ProfitOrderStatus } from './types';

// 损益与分摊（设计文档 §6.4/§6.6、附录 B）。
// 全部为高精度纯函数：不做逐段舍入（D7），只在展示层按报价币精度舍入。

/**
 * 单段匹配损益（以币对报价币计，设计文档 §6.4 公式）：
 * - 多头（LONG）：平仓价高于建仓价盈利 → usd × (closeMid − openMid)
 * - 空头（SHORT）：平仓价低于建仓价盈利 → usd × (openMid − closeMid)
 *
 * WHY 用调用方传入的“原始中间价”而非客户成交价：客户成交价含点差，
 * 会把平台点差收益混入自然对冲损益（PRD §6.2）。
 */
export function segmentPnl(
  side: PlatformSide,
  usdMatched: Decimal,
  openMid: Decimal,
  closeMid: Decimal,
): Decimal {
  return side === 'LONG'
    ? usdMatched.mul(closeMid.minus(openMid))
    : usdMatched.mul(openMid.minus(closeMid));
}

/**
 * 自然对冲损益 50/50 分摊（设计文档 §6.4 步骤 3）。
 *
 * 返回的 `first` 永远归属 FIFO 较早（被抵销）的收益单，`second` 归属新订单。
 * 除以 2 在十进制下通常可整除；当内部精度导致 a、b 不对称时，把较大的一份
 * 留给较早单（即“尾差归 FIFO 较早订单”），并用 remainderToFirst 标记。
 * 两份额之和恒等于原损益，绝不引入或丢失金额。
 */
export function splitHalf(pnl: Decimal): {
  first: Decimal;
  second: Decimal;
  remainderToFirst: boolean;
} {
  const a = pnl.div(2);
  const b = pnl.minus(a);
  if (a.eq(b)) {
    return { first: a, second: b, remainderToFirst: false };
  }
  // 有尾差时取较大一份给较早单（负损益下“较大”即绝对值更小、对客户更有利）
  return a.gt(b)
    ? { first: a, second: b, remainderToFirst: true }
    : { first: b, second: a, remainderToFirst: true };
}

/**
 * 收益单状态判定（设计文档 §6.6）：只看本单自身未平 USD 本金。
 * - 未平为 0 → SETTLED（含订单成立即被全额自然对冲的情况）
 * - 未平等于名义本金 → PENDING
 * - 其余（0 < 未平 < 名义）→ PARTIAL
 *
 * WHY 先判 0：名义本金为 0 的异常输入同时满足“等于名义”，业务语义应优先按已结算处理。
 */
export function profitOrderStatus(
  usdNotional: DecimalStr,
  usdOpen: DecimalStr,
): ProfitOrderStatus {
  const open = D(usdOpen);
  if (open.eq(0)) return 'SETTLED';
  if (open.eq(D(usdNotional))) return 'PENDING';
  return 'PARTIAL';
}
