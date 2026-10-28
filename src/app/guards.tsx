import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAppStore } from '@/store';

// 路由守卫（设计文档 §4.3）：双端身份隔离——客户会话与运营会话互不通行（PRD §2）
export function RequireClient({ children }: { children: ReactNode }) {
  const client = useAppStore((s) => s.session.client);
  if (!client) return <Navigate to="/app/login" replace />;
  return <>{children}</>;
}

export function RequireOps({ children }: { children: ReactNode }) {
  const ops = useAppStore((s) => s.session.ops);
  if (!ops) return <Navigate to="/ops/login" replace />;
  return <>{children}</>;
}

export function RedirectIfAuthed({
  kind,
  children,
}: {
  kind: 'client' | 'ops';
  children: ReactNode;
}) {
  const session = useAppStore((s) => s.session);
  if (kind === 'client' && session.client) return <Navigate to="/app/home" replace />;
  if (kind === 'ops' && session.ops) return <Navigate to="/ops/overview" replace />;
  return <>{children}</>;
}
