import { describe, expect, it } from 'vitest';
import { deriveProfitOrderId, nextCustomerId, nextId } from './ids';

// 固定本地时区时间构造，避免 CI 时区差异影响日键
const DAY1 = new Date(2026, 9, 28, 10, 0, 0).getTime();
const DAY1_LATER = new Date(2026, 9, 28, 23, 59, 59).getTime();
const DAY2 = new Date(2026, 9, 29, 0, 0, 1).getTime();

describe('nextId（<prefix>-YYYYMMDD-NNNN，跨日归零）', () => {
  it('首号为 -0001，同日递增', () => {
    const first = nextId({}, 'EX', DAY1);
    expect(first.id).toBe('EX-20261028-0001');
    expect(first.counters.EX).toEqual({ day: '20261028', seq: 1 });

    const second = nextId(first.counters, 'EX', DAY1_LATER);
    expect(second.id).toBe('EX-20261028-0002');
    expect(second.counters.EX).toEqual({ day: '20261028', seq: 2 });
  });

  it('跨日重新从 -0001 开始', () => {
    const first = nextId({}, 'EX', DAY1);
    const nextDay = nextId(first.counters, 'EX', DAY2);
    expect(nextDay.id).toBe('EX-20261029-0001');
    expect(nextDay.counters.EX).toEqual({ day: '20261029', seq: 1 });
  });

  it('不同前缀互不影响', () => {
    const a = nextId({}, 'EX', DAY1);
    const b = nextId(a.counters, 'BL', DAY1);
    expect(b.id).toBe('BL-20261028-0001');
    expect(b.counters.EX).toEqual({ day: '20261028', seq: 1 });
    expect(b.counters.BL).toEqual({ day: '20261028', seq: 1 });
  });
});

describe('nextCustomerId（C-0001 全局递增）', () => {
  it('连续生成递增编号', () => {
    const first = nextCustomerId({});
    expect(first.id).toBe('C-0001');
    const second = nextCustomerId(first.counters);
    expect(second.id).toBe('C-0002');
    expect(second.counters.C).toEqual({ day: 'GLOBAL', seq: 2 });
  });
});

describe('deriveProfitOrderId（EX → PO-EX 1:1）', () => {
  it('在完整订单号前加 PO- 前缀（§6.6 / §5.4 金样口径）', () => {
    expect(deriveProfitOrderId('EX-20261028-0002')).toBe('PO-EX-20261028-0002');
  });
});
