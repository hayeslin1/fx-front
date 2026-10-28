import { AlertTriangle, HardDrive, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dismissStorageRecovered, useAppStore } from '@/store';

/**
 * 存储状态提示（PRD §9-11 + 设计文档 §5.3）：
 * - 数据损坏/版本不兼容已恢复为预置样例 → 可关闭的警示条
 * - localStorage 不可用降级为内存存储 → 常驻提示刷新将丢失
 * WHY role="status"：两条提示均为引导后才动态出现（§11.2 动态状态须可被读屏播报），
 * 隐含 aria-live="polite"，不打断用户当前操作。
 */
export function StorageRecoveryBanner() {
  const ui = useAppStore((s) => s.ui);
  return (
    <>
      {ui.storageRecovered ? (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-warning bg-warning-bg px-4 py-2 text-sm text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">检测到本地数据损坏或版本不兼容，已重置为预置演示数据。</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-warning"
            onClick={dismissStorageRecovered}
            aria-label="关闭提示"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
      {!ui.storagePersistent ? (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-danger bg-danger-bg px-4 py-2 text-sm text-danger"
        >
          <HardDrive className="size-4 shrink-0" />
          <span className="flex-1">
            当前浏览器不支持本地存储（已降级为内存模式），刷新页面后数据将全部丢失。
          </span>
        </div>
      ) : null}
    </>
  );
}
