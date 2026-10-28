import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { DomainResult, TicketStatus } from '@/domain/types';
import {
  useOpsSupportContext,
  useOpsTicketActions,
  useOpsTicketDetail,
} from '@/features/ops-support/hooks';
import { TICKET_AUTHOR_LABELS } from '@/features/support/labels';
import { TRADE_DIRECTION_LABELS } from '@/features/trading/labels';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

// 运营工单详情（设计文档 §10.3 客服处理段、PRD §5.6）：
// 客户信息卡 + 关联订单卡（若有）+ 消息时间线（客户/运营区分，时间正序）+ 操作区
// （指派 / 回复 / 状态切换 / 关闭；已关闭禁回复可重开）。两端共享同一工单事实（§9.4）。

/** 与客户端详情页同一套表单控件外观（项目未安装 Textarea/Select，按既有令牌手写样式） */
const FIELD_CLASS =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** 状态切换动作文案：待处理 ↔ 处理中按钮，已关闭改「重开」（PRD §5.6） */
const TRANSITION_LABELS: Record<TicketStatus, { label: string; next: TicketStatus }> = {
  PENDING: { label: '开始处理', next: 'IN_PROGRESS' },
  IN_PROGRESS: { label: '退回待处理', next: 'PENDING' },
  CLOSED: { label: '重开', next: 'PENDING' },
};

export function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { assignees } = useOpsSupportContext();
  const { ticket, customer, messages, relatedOrder, assigneeName } = useOpsTicketDetail(id);
  const { pending, assign, reply, transition, close } = useOpsTicketActions(id);

  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [replyText, setReplyText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);

  // 工单号不存在（含被重置后失效的历史链接）统一空态，不泄露任何其他工单信息
  if (!ticket) {
    return (
      <div className="space-y-6">
        <PageHeader title="工单详情" />
        <EmptyState
          title="工单不存在"
          description="工单可能已被移除，或工单号有误；请从列表重新进入。"
          action={
            <Button asChild>
              <Link to="/ops/support/tickets">返回工单列表</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const closed = ticket.status === 'CLOSED';
  // 指派下拉默认选中当前处理人；未指派（或历史处理人已不在名单内）时回退名单首位
  const assigneeValue =
    assigneeDraft !== '' ? assigneeDraft : (ticket.assigneeId ?? assignees[0]?.id ?? '');
  const transitionMeta = TRANSITION_LABELS[ticket.status];

  /**
   * 统一动作包装：领域拒绝（非法流转/已关闭/内容为空等）就地展示中文 message 且零变更；
   * 成功清空错误并轻提示。pending 由 hooks 的同步 ref 守卫 + 控件 disabled 双保险。
   */
  const runAction = async (
    action: () => Promise<DomainResult<unknown>>,
    successText: string,
  ): Promise<boolean> => {
    setActionError(null);
    const result = await action();
    if (!result.ok) {
      setActionError(result.message);
      return false;
    }
    toast.success(successText);
    return true;
  };

  const onAssign = async () => {
    if (assigneeValue === '') {
      setActionError('请选择处理人');
      return;
    }
    await runAction(() => assign(assigneeValue), '已指派处理人');
  };

  const onReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = replyText.trim();
    if (!content) {
      setActionError('请输入回复内容');
      return;
    }
    const ok = await runAction(() => reply(content), '回复已提交');
    if (ok) setReplyText('');
  };

  const onTransition = async () => {
    const successText =
      ticket.status === 'CLOSED'
        ? '工单已重开'
        : `工单已更新为${transitionMeta.next === 'PENDING' ? '待处理' : '处理中'}`;
    await runAction(() => transition(transitionMeta.next), successText);
  };

  const onClose = async () => {
    await runAction(() => close(), '工单已关闭');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={ticket.subject}
        description={`工单号 ${ticket.id}`}
        actions={
          <Button variant="outline" asChild>
            <Link to="/ops/support/tickets">返回列表</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>客户信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <InfoItem label="姓名">{customer?.name ?? ticket.customerId}</InfoItem>
            <InfoItem label="邮箱">
              {customer?.email ?? <span className="text-muted-foreground">—</span>}
            </InfoItem>
            <InfoItem label="客户编号">
              <span className="tabular-nums">{ticket.customerId}</span>
            </InfoItem>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>关联订单</CardTitle>
          </CardHeader>
          <CardContent>
            {relatedOrder ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <InfoItem label="订单号">
                  <span className="font-medium tabular-nums">{relatedOrder.id}</span>
                </InfoItem>
                <InfoItem label="币对">{relatedOrder.pairId}</InfoItem>
                <InfoItem label="方向">{TRADE_DIRECTION_LABELS[relatedOrder.direction]}</InfoItem>
                <InfoItem label="来源金额">
                  <Money value={relatedOrder.sourceAmount} currency={relatedOrder.sourceCurrency} />
                </InfoItem>
                <InfoItem label="到账金额">
                  <Money value={relatedOrder.targetAmount} currency={relatedOrder.targetCurrency} />
                </InfoItem>
                <InfoItem label="成交时间">
                  <span className="tabular-nums">{formatDateTime(relatedOrder.createdAt)}</span>
                </InfoItem>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">本工单未关联订单</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>沟通记录（{messages.length}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无消息</p>
          ) : (
            messages.map((message) => {
              const fromCustomer = message.authorKind === 'CUSTOMER';
              return (
                <div
                  key={message.id}
                  className={cn('flex', fromCustomer ? 'justify-start' : 'justify-end')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] space-y-1 rounded-xl border px-3 py-2',
                      fromCustomer
                        ? 'border-emerald-100 bg-emerald-50'
                        : 'border-border bg-muted/60',
                    )}
                  >
                    <div
                      className={cn(
                        'flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground',
                        fromCustomer ? 'justify-start' : 'justify-end',
                      )}
                    >
                      <span className="font-medium text-foreground">{message.authorName}</span>
                      <span>{TICKET_AUTHOR_LABELS[message.authorKind]}</span>
                      <time
                        dateTime={new Date(message.createdAt).toISOString()}
                        className="tabular-nums"
                      >
                        {formatDateTime(message.createdAt)}
                      </time>
                    </div>
                    <p className="text-sm break-words whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>运营操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">当前状态</span>
            <StatusBadge status={ticket.status} />
            <span className="text-muted-foreground">处理人</span>
            <span className={cn(assigneeName === '—' && 'text-muted-foreground')}>
              {assigneeName}
            </span>
          </div>

          {actionError ? (
            <p
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="ticket-assignee-select">指派处理人</Label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="ticket-assignee-select"
                value={assigneeValue}
                disabled={closed || pending}
                aria-label="指派处理人"
                className={cn(SELECT_CLASS, 'sm:w-56')}
                onChange={(event) => setAssigneeDraft(event.target.value)}
              >
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={closed || pending}
                onClick={onAssign}
              >
                指派
              </Button>
            </div>
            {closed ? (
              <p className="text-xs text-muted-foreground">工单已关闭，不可指派处理人</p>
            ) : null}
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="ops-reply-content">回复客户</Label>
            <form className="space-y-3" onSubmit={onReply} noValidate>
              <textarea
                id="ops-reply-content"
                rows={4}
                value={replyText}
                disabled={closed || pending}
                placeholder="输入给客户的回复内容…"
                className={FIELD_CLASS}
                onChange={(event) => setReplyText(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={closed || pending || replyText.trim() === ''}>
                  回复
                </Button>
                {closed ? (
                  <p className="text-xs text-amber-700">已关闭工单不可回复，可重开</p>
                ) : null}
              </div>
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button type="button" variant="outline" disabled={pending} onClick={onTransition}>
              {transitionMeta.label}
            </Button>
            {!closed ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => setCloseOpen(true)}
              >
                关闭工单
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="关闭工单"
        description="关闭后客户与运营均不可再回复；如需继续沟通可随时重开。确认关闭该工单？"
        confirmText="确认关闭"
        destructive
        onConfirm={onClose}
      />
    </div>
  );
}
