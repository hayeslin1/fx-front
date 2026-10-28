import { Outlet } from 'react-router';

// 客户端登录/注册壳（设计文档 §4.1）：居中卡片 + 暖色主题
export function ClientAuthLayout() {
  return (
    <div className="theme-client flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-foreground">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">跨境汇兑演示平台</h1>
        <p className="text-sm text-muted-foreground">个人客户版 · 高保真交互原型</p>
      </div>
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  );
}
