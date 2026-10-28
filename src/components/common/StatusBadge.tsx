import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// 状态徽标：统一订单/平仓/工单等业务状态的文案与配色（PRD 各列表页）。
// 使用语义色 token（--success/--warning/--danger/--info），双端（client/ops）各自覆写，
// 保证配色在两套主题下语义一致；中性的 zinc 表示关闭/过期类，不属于语义色。

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  COMPLETED: { label: '已完成', className: 'border-success bg-success-bg text-success' },
  SUCCESS: { label: '成功', className: 'border-success bg-success-bg text-success' },
  PENDING: { label: '待处理', className: 'border-warning bg-warning-bg text-warning' },
  IN_PROGRESS: { label: '处理中', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  PARTIAL: { label: '部分结算', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  SETTLED: { label: '已结算', className: 'border-success bg-success-bg text-success' },
  CLOSED: { label: '已关闭', className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
  FAILED: { label: '失败', className: 'border-danger bg-danger-bg text-danger' },
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
