import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useSupportTicketDetail } from '@/features/support/hooks';
import { TICKET_AUTHOR_LABELS } from '@/features/support/labels';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

// 与新建页保持同一套表单控件外观（项目未安装 Textarea/Select，按既有令牌手写样式）
const FIELD_CLASS =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

interface InfoItemProps {
  label: string;
  children: ReactNode;
}

/** 工单信息栅格项：标签在上、值在下，便于窄屏折行 */
function InfoItem({ label, children }: InfoItemProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// 工单详情（里程碑 M3，设计文档 §10.2）：工单信息 + 关联订单 + 时间线 + 客户回复。
// 状态 CLOSED 时禁用回复入口并引导新建（PRD §3.5）。
export function SupportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ticket, messages, relatedOrder, assigneeName, reply } = useSupportTicketDetail(id);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // 不属于当前客户或 id 不存在时统一展示空态，不泄露他人工单是否存在
  if (!ticket) {
    return (
      <div className="space-y-6">
        <PageHeader title="工单详情" />
        <EmptyState
          title="工单不存在"
          description="工单可能已被移除，或不属于当前账号。"
          action={
            <Button asChild>
              <Link to="/app/support">返回工单列表</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const closed = ticket.status === 'CLOSED';

  const onReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = replyText.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const result = await reply(content);
      if (!result.ok) {
        // 领域拒绝（如并发下工单被运营关闭）就地提示，不产生写入
        setServerError(result.message);
        return;
      }
      setReplyText('');
      toast.success('回复已提交');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={ticket.subject}
        description={`工单号 ${ticket.id}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/support">返回列表</Link>
            </Button>
            <Button asChild>
              <Link to="/app/support/new">新建工单</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>工单信息</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoItem label="主题">{ticket.subject}</InfoItem>
          <InfoItem label="状态">
            <StatusBadge status={ticket.status} />
          </InfoItem>
          <InfoItem label="处理人">{assigneeName}</InfoItem>
          <InfoItem label="创建时间">
            <span className="tabular-nums">{formatDateTime(ticket.createdAt)}</span>
          </InfoItem>
          <InfoItem label="更新时间">
            <span className="tabular-nums">{formatDateTime(ticket.updatedAt)}</span>
          </InfoItem>
          <InfoItem label="关联订单">
            {relatedOrder ? (
              <Link
                to={`/app/orders/${relatedOrder.id}`}
                className="font-medium text-primary hover:underline"
              >
                {relatedOrder.id} · {relatedOrder.pairId}
              </Link>
            ) : (
              <span className="text-muted-foreground">未关联</span>
            )}
          </InfoItem>
        </CardContent>
      </Card>

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
                  className={cn('flex', fromCustomer ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] space-y-1 rounded-xl border px-3 py-2',
                      fromCustomer ? 'border-success bg-success-bg' : 'border-border bg-muted/60',
                    )}
                  >
                    <div
                      className={cn(
                        'flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground',
                        fromCustomer ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <span className="font-medium text-foreground">{message.authorName}</span>
                      <span>{TICKET_AUTHOR_LABELS[message.authorKind]}</span>
                      <time dateTime={new Date(message.createdAt).toISOString()} className="tabular-nums">
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
          <CardTitle>回复</CardTitle>
        </CardHeader>
        <CardContent>
          {closed ? (
            <p className="rounded-lg border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              工单已关闭，如有新问题请新建工单
            </p>
          ) : (
            <form className="space-y-3" onSubmit={onReply} noValidate>
              <Label htmlFor="reply-content">回复内容</Label>
              <textarea
                id="reply-content"
                rows={4}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                disabled={submitting}
                placeholder="补充说明或回复运营…"
                className={FIELD_CLASS}
              />
              {serverError ? (
                <p className="text-xs text-danger" role="alert">
                  {serverError}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting || replyText.trim().length === 0}>
                {submitting ? '提交中…' : '提交回复'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
