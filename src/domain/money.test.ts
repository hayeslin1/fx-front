import { describe, expect, it } from 'vitest';
import {
  D,
  deriveClientRate,
  fmtMoney,
  fmtRate,
  isValidAmountInput,
  roundCcy,
  toRateSig12,
} from './money';

describe('deriveClientRate（PRD §4.2 客户成交价）', () => {
  it('卖 USD 用 bid：mid × (1 − 50bps/10000)', () => {
    expect(D(deriveClientRate('0.9200', 50, 'SELL_USD')).toString()).toBe('0.9154');
  });

  it('买 USD 用 ask：mid × (1 + 50bps/10000)', () => {
    expect(D(deriveClientRate('0.9205', 50, 'BUY_USD')).toString()).toBe('0.9251025');
  });

  it('JPY 报价同样适用', () => {
    expect(D(deriveClientRate('151.20', 50, 'SELL_USD')).toString()).toBe('150.444');
    expect(D(deriveClientRate('151.00', 50, 'BUY_USD')).toString()).toBe('151.755');
  });
});

describe('roundCcy（币种精度 + ROUND_HALF_UP）', () => {
  it('JPY 取整并 .5 进位', () => {
    expect(roundCcy('752220.5', 'JPY').toFixed(0)).toBe('752221');
  });

  it('两位币种 .005 进位', () => {
    expect(roundCcy('1830.805', 'EUR').toFixed(2)).toBe('1830.81');
    expect(roundCcy('1372.35375', 'EUR').toFixed(2)).toBe('1372.35');
  });
});

describe('toRateSig12（12 位有效位内部存储）', () => {
  it('截断到 12 位有效位并可往返', () => {
    expect(toRateSig12('0.9251025000099999').toString()).toBe('0.92510250001');
    expect(toRateSig12('151.20').toString()).toBe('151.2');
  });
});

describe('fmtMoney（千分位 + 币种精度 + 币种代码）', () => {
  it('两位币种补零并分组', () => {
    expect(fmtMoney('1830.8', 'EUR')).toBe('1,830.80 EUR');
    expect(fmtMoney('20500', 'USD')).toBe('20,500.00 USD');
  });

  it('JPY 无小数并分组', () => {
    expect(fmtMoney('752220', 'JPY')).toBe('752,220 JPY');
  });

  it('负数保留符号', () => {
    expect(fmtMoney('-1950', 'USD')).toBe('-1,950.00 USD');
  });

  it('极大金额不经 number，保持精确', () => {
    expect(fmtMoney('123456789012345678.9', 'USD')).toBe('123,456,789,012,345,678.90 USD');
  });
});

describe('fmtRate（4 位小数展示）', () => {
  it('固定 4 位', () => {
    expect(fmtRate('0.9154')).toBe('0.9154');
    expect(fmtRate('151.2')).toBe('151.2000');
  });
});

describe('isValidAmountInput（表单即时校验）', () => {
  it('正数合法', () => {
    expect(isValidAmountInput('100', 'USD')).toBe(true);
    expect(isValidAmountInput('1.23', 'EUR')).toBe(true);
  });

  it('拒绝零、负数与非数字', () => {
    expect(isValidAmountInput('0', 'USD')).toBe(false);
    expect(isValidAmountInput('-1', 'USD')).toBe(false);
    expect(isValidAmountInput('1e3', 'USD')).toBe(false);
    expect(isValidAmountInput('', 'USD')).toBe(false);
  });

  it('JPY 拒绝小数输入', () => {
    expect(isValidAmountInput('100.5', 'JPY')).toBe(false);
    expect(isValidAmountInput('100', 'JPY')).toBe(true);
  });

  it('两位币种拒绝超过两位小数', () => {
    expect(isValidAmountInput('1.234', 'EUR')).toBe(false);
  });
});
