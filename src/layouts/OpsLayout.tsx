import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { SkipLink } from '@/components/common/SkipLink';
import { MAIN_CONTENT_ID } from '@/components/common/main-content-id';
import { cn } from '@/lib/utils';
import { logoutOps, resetDemoData, useAppStore } from '@/store';
import { getOpsAccountById } from '@/store/selectors';

const NAV_GROUPS: Array<{ title: string; items: Array<{ to: string; label: string }> }> = [
  { title: '总览', items: [{ to: '/ops/overview', label: '业务总览' }] },
  { title: '客户管理', items: [{ to: '/ops/customers', label: '客户列表' }] },
  {
    title: '交易管理',
    items: [
      { to: '/ops/trading/orders', label: '客户订单' },
      { to: '/ops/trading/exposure', label: '敞口监控' },
      { to: '/ops/trading/close-batches', label: '渠道平仓' },
      { to: '/ops/trading/profit-orders', label: '收益订单' },
    ],
  },
  {
    title: '钱包管理',
    items: [
      { to: '/ops/wallets/balances', label: '余额查询' },
      { to: '/ops/wallets/bills', label: '账单流水' },
      { to: '/ops/wallets/assisted-top-up', label: '代客充值' },
    ],
  },
  {
    title: '汇率运营',
    items: [
      { to: '/ops/fx/channels', label: '渠道管理' },
      { to: '/ops/fx/pairs', label: '币对管理' },
      { to: '/ops/fx/pool', label: '采集池' },
      { to: '/ops/fx/routing', label: '路由配置' },
      { to: '/ops/fx/markups', label: '加点管理' },
      { to: '/ops/fx/calculator', label: '报价计算器' },
    ],
  },
  { title: '客服处理', items: [{ to: '/ops/support/tickets', label: '工单列表' }] },
];

// 运营壳（设计文档 §4.3）：侧边栏六组一级导航 + 顶栏（账号 / 重置演示数据 / 退出）
export function OpsLayout() {
  const opsAccountId = useAppStore((s) => s.session.ops?.opsAccountId);
  const data = useAppStore((s) => s.data);
  const account = opsAccountId ? getOpsAccountById(data, opsAccountId) : undefined;
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

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
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex h-14 items-center border-b px-4 text-sm font-semibold tracking-tight">
          FX 运营工作台
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-2 text-xs font-medium text-muted-foreground">{group.title}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-2 py-1.5 text-[13px] transition-colors',
                      isActive
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
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
