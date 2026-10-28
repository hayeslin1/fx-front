import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { StorageRecoveryBanner } from '@/components/common/StorageRecoveryBanner';
import { useAppStore } from '@/store';

/**
 * 按当前会话类型把主题 class 挂到 <html> 根上（P0-4）。
 *
 * 背景：theme-client / theme-ops 的 CSS 变量覆写原本挂在各布局内层 <div> 上。
 * 但 Toaster、StorageRecoveryBanner 等全局组件是路由的兄弟节点，不在布局内，
 * 只能解析 :root 缺省（客户端暖色）——运营端页面弹 toast / 显示恢复横幅时会变成客户端暖白底。
 *
 * 这里把主题 class 提到 :root，布局内层 class 保留（双重保证：布局自身背景也走覆写），
 * 根层切换让所有全局组件一致取到当前主题 token。
 */
function useThemeOnRoot() {
  const session = useAppStore((s) => s.session);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-client', 'theme-ops');
    if (session.ops) {
      root.classList.add('theme-ops');
    } else {
      // 客户端（含未登录的登录页）与无会话默认走客户端暖色
      root.classList.add('theme-client');
    }
  }, [session]);
}

// 全局 Provider 装配（设计文档 §4.1）：根主题切换 + 存储恢复/降级提示条 + 全局 toast
export function AppProviders({ children }: { children: ReactNode }) {
  useThemeOnRoot();
  return (
    <>
      <StorageRecoveryBanner />
      {children}
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
