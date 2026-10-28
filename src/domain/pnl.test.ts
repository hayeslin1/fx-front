import { describe, expect, it } from 'vitest';
import { D } from './money';
import { profitOrderStatus, segmentPnl, splitHalf } from './pnl';

// 损益公式与 50/50 分摊（设计文档 §6.4/§6.6、§12.1）

describe('segmentPnl：多头/空头公式双向断言', () => {
  it('多头：平仓价高于建仓价盈利', () => {
    const pnl = segmentPnl('LONG', D('800'), D('0.9200'), D('0.9205'));
    expect(pnl.eq('0.4')).toBe(true);
  });

  it('多头：平仓价低于建仓价亏损', () => {
    const pnl = segmentPnl('LONG', D('1976.87'), D('151.20'), D('151.00'));
    expect(pnl.eq('-395.374')).toBe(true);
  });

  it('空头：平仓价低于建仓价盈利', () => {
    const pnl = segmentPnl('SHORT', D('400'), D('7.8110'), D('7.8100'));
    expect(pnl.eq('0.4')).toBe(true);
  });

  it('空头：平仓价高于建仓价亏损', () => {
    const pnl = segmentPnl('SHORT', D('1000'), D('7.8100'), D('7.8110'));
    expect(pnl.eq('-1')).toBe(true);
  });

  it('建仓/平仓价相同则损益为 0', () => {
    expect(segmentPnl('LONG', D('123.45'), D('0.92'), D('0.92')).eq(0)).toBe(true);
    expect(segmentPnl('SHORT', D('123.45'), D('151.2'), D('151.2')).eq(0)).toBe(true);
  });
});

describe('splitHalf：50/50 分摊与尾差归 FIFO 较早单', () => {
  it('可整除时两份相等且无尾差标记', () => {
    const { first, second, remainderToFirst } = splitHalf(D('0.4'));
    expect(first.eq('0.2')).toBe(true);
    expect(second.eq('0.2')).toBe(true);
    expect(remainderToFirst).toBe(false);
  });

  it('负损益同样均分', () => {
    const { first, second, remainderToFirst } = splitHalf(D('-395.374'));
    expect(first.eq('-197.687')).toBe(true);
    expect(second.eq('-197.687')).toBe(true);
    expect(remainderToFirst).toBe(false);
  });

  it('内部精度导致除不尽时，较大一份归 FIFO 较早单（first）并标记', () => {
    // 20 位有效位且末位为奇数：÷2 需要 21 位，decimal.js 按精度舍入后产生尾差
    const pnl = D('0.99999999999999999999');
    const { first, second, remainderToFirst } = splitHalf(pnl);

    expect(remainderToFirst).toBe(true);
    expect(first.gt(second)).toBe(true);
    // 两份之和必须精确等于原损益，不能因分摊引入误差
    expect(first.plus(second).eq(pnl)).toBe(true);
  });

  it('尾差为负损益时仍把“较大”（亏损更小）的一份留给较早单', () => {
    const pnl = D('-0.99999999999999999999');
    const { first, second, remainderToFirst } = splitHalf(pnl);

    expect(remainderToFirst).toBe(true);
    expect(first.gt(second)).toBe(true);
    expect(first.plus(second).eq(pnl)).toBe(true);
  });
});

describe('profitOrderStatus：仅按自身未平本金判定', () => {
  it('未平 == 名义 → PENDING', () => {
    expect(profitOrderStatus('1500.00', '1500.00')).toBe('PENDING');
  });

  it('0 < 未平 < 名义 → PARTIAL', () => {
    expect(profitOrderStatus('2000.00', '200.00')).toBe('PARTIAL');
    expect(profitOrderStatus('5000.00', '3023.13')).toBe('PARTIAL');
  });

  it('未平 == 0 → SETTLED（含全额自然对冲立即结算）', () => {
    expect(profitOrderStatus('800.00', '0')).toBe('SETTLED');
    expect(profitOrderStatus('800.00', '0.00')).toBe('SETTLED');
  });

  it('其他订单剩余敞口不影响本单判定（入参只有本单未平）', () => {
    // 同一币对还有 1700 USD 未平，但本单自身为 0 即已结算
    expect(profitOrderStatus('800', '0')).toBe('SETTLED');
  });
});
