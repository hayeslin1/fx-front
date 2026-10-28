import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkipLink } from '@/components/common/SkipLink';
import { MAIN_CONTENT_ID } from '@/components/common/main-content-id';
import { cn } from '@/lib/utils';
import { logoutClient, useAppStore } from '@/store';
import { getCustomerById } from '@/store/selectors';

const NAV_ITEMS = [
  { to: '/app/home', label: '首页' },
  { to: '/app/wallet', label: '钱包' },
  { to: '/app/exchange', label: '兑换' },
  { to: '/app/orders', label: '订单' },
  { to: '/app/support', label: '客服' },
];

// 客户端壳（设计文档 §4.3）：顶栏导航 + 用户菜单 + 「演示资金」氛围标识
export function ClientLayout() {
  const session = useAppStore((s) => s.session);
  const data = useAppStore((s) => s.data);
  const customer = session.client ? getCustomerById(data, session.client.customerId) : undefined;

  return (
    <div className="theme-client flex min-h-svh flex-col bg-background text-foreground">
      {/* 键盘首焦点：跳过顶栏导航直达 main（tabIndex=-1 保证跨浏览器片段导航后焦点落到地标） */}
      <SkipLink />
      <header className="sticky top-0 z-10 border-b bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4">
          <NavLink to="/app/home" className="text-base font-semibold tracking-tight">
            跨境汇兑
          </NavLink>
          <nav className="flex items-center gap-1 text-sm overflow-x-auto whitespace-nowrap scrollbar-hide">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'shrink-0 rounded-full px-3 py-1.5 transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="outline" className="hidden border-success bg-success-bg text-success lg:inline-flex">
              演示资金
            </Badge>
            <span className="hidden text-sm text-muted-foreground lg:inline">{customer?.name}</span>
            <Button variant="ghost" size="sm" onClick={logoutClient}>
              退出
            </Button>
          </div>
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
