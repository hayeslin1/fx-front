import { fmtRate } from '@/domain/money';
import type { DecimalStr } from '@/domain/types';
import { cn } from '@/lib/utils';

interface RateProps {
  value: DecimalStr;
  className?: string;
}

/** 汇率统一展示（固定 4 位小数，§6.1）；全站唯一渲染口径 */
export function Rate({ value, className }: RateProps) {
  return <span className={cn('tabular-nums whitespace-nowrap', className)}>{fmtRate(value)}</span>;
}
