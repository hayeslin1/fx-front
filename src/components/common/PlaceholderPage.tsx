import { Construction } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface PlaceholderPageProps {
  title: string;
  /** 计划落地的里程碑（设计文档 §13），如 "M3" */
  milestone: string;
  description?: string;
}

/**
 * M1 工程骨架占位页：路由与导航已就位，页面本体按里程碑逐步替换。
 * WHY 先占位：保证 30 条路由可点击可达，演示动线完整（设计文档 §13 M1 出口）。
 */
export function PlaceholderPage({ title, milestone, description }: PlaceholderPageProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Construction className="size-10 text-muted-foreground" />
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
          待实现 · {milestone}
        </Badge>
      </div>
      <p className="max-w-md text-sm text-muted-foreground">
        {description ?? '本页为工程骨架占位，路由与导航已接通，页面功能将在对应里程碑实现。'}
      </p>
    </div>
  );
}
