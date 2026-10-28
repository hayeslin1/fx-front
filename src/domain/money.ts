import Decimal from 'decimal.js';
import { CCY_DP, DECIMAL_PRECISION, RATE_SIG_DIGITS } from './constants';
import type { Currency, DecimalStr, TradeDirection } from './types';

// 金额与汇率精度的唯一出口（设计文档 §6.1 / ADR-002）：
// 全应用禁止绕过本模块直接对 number 做金额/汇率运算。
Decimal.set({
  precision: DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  // 保证序列化/展示不出现科学计数法（持久化为普通十进制字符串）
  toExpNeg: -40,
  toExpPos: 40,
});

export { Decimal };

/** Decimal 构造快捷方式 */
export function D(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function ccyDp(ccy: Currency): 0 | 2 {
  return CCY_DP[ccy];
}

/** 按币种精度四舍五入（入账/展示的唯一舍入口径，PRD §4.3） */
export function roundCcy(value: Decimal.Value, ccy: Currency): Decimal {
  return new Decimal(value).toDecimalPlaces(ccyDp(ccy), Decimal.ROUND_HALF_UP);
}

/** 汇率内部存储精度：12 位有效位（设计文档 §6.1） */
export function toRateSig12(value: Decimal.Value): Decimal {
  return new Decimal(value).toSignificantDigits(RATE_SIG_DIGITS, Decimal.ROUND_HALF_UP);
}

/**
 * 客户成交价（PRD §4.2）：
 * - 卖 USD（SELL_USD）用 bid：mid × (1 − bps/10000)
 * - 买 USD（BUY_USD）用 ask：mid × (1 + bps/10000)
 */
export function deriveClientRate(
  mid: Decimal.Value,
  halfSpreadBps: number,
  direction: TradeDirection,
): Decimal {
  const rate = new Decimal(mid);
  const half = new Decimal(halfSpreadBps).div(10000);
  return direction === 'SELL_USD'
    ? rate.mul(new Decimal(1).minus(half))
    : rate.mul(new Decimal(1).plus(half));
}

/**
 * 金额展示：千分位 + 币种精度 + 币种代码（如 "1,830.80 EUR"、"150,000 JPY"）。
 * WHY 用字符串拼接而非 Intl：避免经 number 丢失大数/高精度（设计文档 §6.1）
 */
export function fmtMoney(value: Decimal.Value, ccy: Currency): string {
  const dp = ccyDp(ccy);
  const fixed = new Decimal(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const [intPart = '0', frac] = body.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = frac === undefined ? grouped : `${grouped}.${frac}`;
  return `${negative ? '-' : ''}${out} ${ccy}`;
}

/** 汇率展示：固定 4 位小数（如 "0.9154"、"151.2000"） */
export function fmtRate(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** 校验金额输入字符串：正数 + 币种精度约束（表单即时校验共用，设计文档 §7.4） */
export function isValidAmountInput(input: string, ccy: Currency): boolean {
  if (!/^\d+(\.\d+)?$/.test(input)) return false;
  const value = new Decimal(input);
  if (value.lte(0)) return false;
  const dp = ccyDp(ccy);
  const decimals = input.includes('.') ? (input.split('.')[1] ?? '').length : 0;
  return decimals <= dp;
}

export type { DecimalStr };
