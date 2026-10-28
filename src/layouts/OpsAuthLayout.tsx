import { Outlet } from 'react-router';

// 运营端登录壳（设计文档 §4.1）：独立入口，客户账号不可进入（PRD §2）
// 外层即 <main> 地标（本页无导航，无需 skip link；元素类型替换，不改变任何布局/样式）
export function OpsAuthLayout() {
  return (
    <main className="theme-ops flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-foreground">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">FX 运营工作台</h1>
        <p className="text-sm text-muted-foreground">汇率运营与交易管理 · 演示环境</p>
      </div>
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </main>
  );
}
