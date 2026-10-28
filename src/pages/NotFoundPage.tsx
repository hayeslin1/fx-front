import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

// 404（设计文档 §4.3：极简 + 返回入口）
export function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-5xl font-semibold tracking-tight">404</p>
      <p className="text-sm text-muted-foreground">页面不存在或已被移除</p>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/">返回首页</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/app/login">客户登录</Link>
        </Button>
      </div>
    </div>
  );
}
