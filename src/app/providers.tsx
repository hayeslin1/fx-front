import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { StorageRecoveryBanner } from '@/components/common/StorageRecoveryBanner';

// 全局 Provider 装配（设计文档 §4.1）：存储恢复/降级提示条 + 全局 toast
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <StorageRecoveryBanner />
      {children}
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
