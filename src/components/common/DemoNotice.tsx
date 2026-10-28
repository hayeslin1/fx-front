import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface DemoNoticeProps {
  className?: string;
  /** 自定义文案；默认“演示资金” */
  label?: string;
}

/** 演示资金/演示数据标识（PRD 全局要求：任何余额都需明示为演示资金） */
export function DemoNotice({ className, label = '演示资金' }: DemoNoticeProps) {
  return (
    <Badge variant="secondary" className={cn('font-normal', className)}>
      {label}
    </Badge>
  );
}
