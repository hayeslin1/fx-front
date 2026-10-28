import { fmtMoney } from '@/domain/money';
import type { Currency, DecimalStr } from '@/domain/types';
import { cn } from '@/lib/utils';

interface MoneyProps {
  value: DecimalStr;
  currency: Currency;
  /** 带符号着色：正 +绿 / 负 +红（收益、损益场景），正数自动补 "+" */
  signed?: boolean;
  className?: string;
}

/** 金额统一展示组件：全站唯一渲染口径（千分位 + 币种精度，见 domain/money.fmtMoney） */
export function Money({ value, currency, signed = false, className }: MoneyProps) {
  const text = fmtMoney(value, currency);
  const negative = text.startsWith('-');
  return (
    <span
      className={cn(
        'tabular-nums whitespace-nowrap',
        signed && (negative ? 'text-danger' : 'text-success'),
        className,
      )}
    >
      {signed && !negative ? `+${text}` : text}
    </span>
  );
}
