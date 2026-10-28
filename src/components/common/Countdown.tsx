import { useEffect, useRef, useState } from 'react';
import { now } from '@/lib/clock';
import { cn } from '@/lib/utils';

interface CountdownProps {
  /** 截止时间（epoch ms），通常为 Quote.expiresAt */
  expiresAt: number;
  /** 到期回调（只触发一次；用于禁用成交/清空报价） */
  onExpire?: () => void;
  /** 最后几秒进入强调色，默认 5 秒 */
  warnSeconds?: number;
  className?: string;
}

const TICK_MS = 250;

/**
 * 报价倒计时（30 秒锁价，PRD §4.1）。
 * WHY 250ms 轮询而非 1s：避免定时器漂移导致“显示 1 秒实际已过期”，
 * 且过期判定始终以注入时钟为准（测试可 setClock）。
 */
export function Countdown({ expiresAt, onExpire, warnSeconds = 5, className }: CountdownProps) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, expiresAt - now()));
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    const tick = () => {
      const remaining = Math.max(0, expiresAt - now());
      setRemainingMs(remaining);
      if (remaining === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [expiresAt, onExpire]);

  const seconds = Math.ceil(remainingMs / 1000);
  const expired = remainingMs === 0;
  const urgent = !expired && seconds <= warnSeconds;

  return (
    <span
      role="timer"
      aria-live="polite"
      className={cn(
        'tabular-nums text-sm',
        expired ? 'text-muted-foreground' : urgent ? 'font-semibold text-danger' : 'text-warning',
        className,
      )}
    >
      {expired ? '报价已过期，请重新取价' : `报价剩余 ${seconds} 秒`}
    </span>
  );
}
