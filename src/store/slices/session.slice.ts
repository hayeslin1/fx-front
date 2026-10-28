import type { SessionState } from '@/domain/types';

// 会话切片：持久化（刷新保持登录）；退出登录时置空（设计文档 §7.1）
export const initialSession: SessionState = {
  client: null,
  ops: null,
};
