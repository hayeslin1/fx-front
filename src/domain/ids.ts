import { formatDayKey } from '@/lib/format';
import type { Counters } from './types';

// 编号规则（设计文档附录 D）。计数器随事实一并持久化，重放确定性依赖 id 单调递增。

export interface NextIdResult {
  id: string;
  counters: Counters;
}

/** 日期前缀编号：<prefix>-YYYYMMDD-NNNN，跨日自动归零 */
export function nextId(counters: Counters, prefix: string, at: number, pad = 4): NextIdResult {
  const day = formatDayKey(at);
  const current = counters[prefix];
  const seq = current && current.day === day ? current.seq + 1 : 1;
  return {
    id: `${prefix}-${day}-${String(seq).padStart(pad, '0')}`,
    counters: { ...counters, [prefix]: { day, seq } },
  };
}

/** 客户编号：C-0001（不分日，全局递增） */
export function nextCustomerId(counters: Counters): NextIdResult {
  const seq = (counters['C']?.seq ?? 0) + 1;
  return {
    id: `C-${String(seq).padStart(4, '0')}`,
    counters: { ...counters, C: { day: 'GLOBAL', seq } },
  };
}

/** 收益单号：由客户订单号派生 EX-… → PO-…（1:1 且重放幂等） */
export function deriveProfitOrderId(orderId: string): string {
  return orderId.replace(/^EX/, 'PO');
}
