import { useState, type ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router';
import { toast } from 'sonner';
import {
  Activity,
  ArrowLeftRight,
  Calculator,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  GitBranch,
  Headphones,
  LayoutDashboard,
  Layers,
  LineChart,
  Network,
  PlusCircle,
  Percent,
  TrendingUp,
  Users,
  WalletMinimal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { SkipLink } from '@/components/common/SkipLink';
import { MAIN_CONTENT_ID } from '@/components/common/main-content-id';
import { cn } from '@/lib/utils';
import { logoutOps, resetDemoData, useAppStore } from '@/store';
import { getOpsAccountById } from '@/store/selectors';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '总览',
    items: [{ to: '/ops/overview', label: '业务总览', icon: LayoutDashboard }],
  },
  {
    title: '客户管理',
    items: [{ to: '/ops/customers', label: '客户列表', icon: Users }],
  },
  {
    title: '交易管理',
    items: [
      { to: '/ops/trading/orders', label: '客户订单', icon: LineChart },
      { to: '/ops/trading/exposure', label: '敞口监控', icon: Activity },
      { to: '/ops/trading/close-batches', label: '渠道平仓', icon: CandlestickChart },
      { to: '/ops/trading/profit-orders', label: '收益订单', icon: TrendingUp },
    ],
  },
  {
    title: '钱包管理',
    items: [
      { to: '/ops/wallets/balances', label: '余额查询', icon: WalletMinimal },
      { to: '/ops/wallets/bills', label: '账单流水', icon: FileText },
      { to: '/ops/wallets/assisted-top-up', label: '代客充值', icon: PlusCircle },
    ],
  },
  {
    title: '汇率运营',
    items: [
      { to: '/ops/fx/channels', label: '渠道管理', icon: Network },
      { to: '/ops/fx/pairs', label: '币对管理', icon: Layers },
      { to: '/ops/fx/pool', label: '采集池', icon: Coins },
      { to: '/ops/fx/routing', label: '路由配置', icon: GitBranch },
      { to: '/ops/fx/markups', label: '加点管理', icon: Percent },
      { to: '/ops/fx/calculator', label: '报价计算器', icon: Calculator },
    ],
  },
  {
    title: '客服处理',
    items: [{ to: '/ops/support/tickets', label: '工单列表', icon: Headphones }],
  },
];

// 运营壳（设计文档 §4.3）：侧边栏六组一级导航 + 顶栏（账号 / 重置演示数据 / 退出）
// 侧边栏支持折叠：收起时只显示图标，内容区自动延伸填满；状态存内存（刷新回到展开）
export function OpsLayout() {
  const opsAccountId = useAppStore((s) => s.session.ops?.opsAccountId);
  const data = useAppStore((s) => s.data);
  const collapsed = useAppStore((s) => s.ui.sidebarCollapsed);
  const account = opsAccountId ? getOpsAccountById(data, opsAccountId) : undefined;
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const toggleSidebar = () => {
    useAppStore.setState({ ui: { ...useAppStore.getState().ui, sidebarCollapsed: !collapsed } });
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetDemoData(); // 内部清空会话，守卫随即跳回 /ops/login
      toast.success('演示数据已重置为预置样例');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="theme-ops flex min-h-svh bg-background text-foreground">
      {/* 键盘首焦点：跳过六组侧栏导航直达 main（.skip-link 为 fixed 定位，不参与首层 flex 布局） */}
      <SkipLink />
      <aside
        className={cn(
          'group flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-out',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b text-sm font-semibold tracking-tight',
            collapsed ? 'justify-center px-0' : 'px-4',
          )}
        >
          <ArrowLeftRight className="size-5 shrink-0 text-accent-foreground" />
          {!collapsed && <span className="ml-2 whitespace-nowrap">FX 运营工作台</span>}
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              {!collapsed && (
                <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center rounded-md transition-colors',
                        collapsed ? 'justify-center py-2' : 'px-2 py-1.5 text-sm',
                        isActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span className="ml-2 whitespace-nowrap">{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            className="w-full"
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b bg-card px-4">
          <span className="text-sm text-muted-foreground">{account?.name ?? '运营账号'}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onClick={() => setResetOpen(true)}
          >
            重置演示数据
          </Button>
          <Button variant="ghost" size="sm" onClick={logoutOps}>
            退出
          </Button>
        </header>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex-1 space-y-6 p-4 outline-none lg:p-6"
        >
          <Outlet />
        </main>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="重置演示数据？"
        description="将清除演示期间产生的全部数据（含新注册客户）并恢复预置样例，所有登录会话将退出。"
        confirmText="确认重置"
        destructive
        onConfirm={handleReset}
      />
    </div>
  );
}
