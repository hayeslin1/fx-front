import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// 状态徽标：统一订单/平仓/工单等业务状态的文案与配色（PRD 各列表页）。
// 用显式色板而非主题 variant，保证两套主题（客户/运营）下语义色一致。

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  COMPLETED: { label: '已完成', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  SUCCESS: { label: '成功', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  PENDING: { label: '待处理', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  IN_PROGRESS: { label: '处理中', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  PARTIAL: { label: '部分结算', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  SETTLED: { label: '已结算', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  CLOSED: { label: '已关闭', className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
  FAILED: { label: '失败', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  EXPIRED: { label: '已过期', className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = STATUS_MAP[status];
  return (
    <Badge variant="outline" className={cn(meta?.className, className)}>
      {meta?.label ?? status}
    </Badge>
  );
}
