import type { TicketMessage, TicketStatus } from '@/domain/types';

// 工单枚举 → 中文展示名（设计文档 §4.2：枚举文案集中在 features/*/labels.ts）。
// WHY 状态文案此处仍保留：列表徽标走 common/StatusBadge，但筛选/空态/无障碍朗读等
// 场景需要同一份文案来源，避免两处各写一份导致不一致。
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  CLOSED: '已关闭',
};

/** 消息作者类型 → 中文展示名（详情时间线区分客户/运营，PRD §3.5） */
export const TICKET_AUTHOR_LABELS: Record<TicketMessage['authorKind'], string> = {
  CUSTOMER: '客户',
  OPS: '运营',
};
