import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSupportNewTicket } from '@/features/support/hooks';
import { formatDateTime } from '@/lib/format';

// 表单校验与领域校验同口径（设计文档 §7.4）：主题/内容必填，提交前就地提示；
// 关联订单可空，空串在提交时归一为 undefined，避免把“未选择”传给领域服务。
const ticketSchema = z.object({
  subject: z.string().trim().min(1, '请输入工单主题'),
  content: z.string().trim().min(1, '请输入工单内容'),
  relatedOrderId: z.string(),
});
type TicketFormValues = z.infer<typeof ticketSchema>;

// 原生控件外观对齐 shadcn Input（项目未安装 Textarea/Select 组件，按既有令牌手写样式）
const FIELD_CLASS =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

// 新建工单（里程碑 M3，设计文档 §10.2）：主题 + 内容必填，可选关联本人最近订单。
export function SupportNewPage() {
  const navigate = useNavigate();
  const { orders, createTicket } = useSupportNewTicket();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { subject: '', content: '', relatedOrderId: '' },
  });
  const { register, handleSubmit, formState } = form;

  const onSubmit = async (values: TicketFormValues) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const result = await createTicket({
        subject: values.subject,
        content: values.content,
        ...(values.relatedOrderId ? { relatedOrderId: values.relatedOrderId } : {}),
      });
      if (!result.ok) {
        // 领域错误就地展示（如关联订单不属于本人），不跳转、不产生任何写入
        setServerError(result.message);
        return;
      }
      toast.success('工单已创建');
      navigate(`/app/support/${result.data.ticket.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建工单"
        description="描述你遇到的问题，运营会尽快回复"
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/support">返回列表</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>工单信息</CardTitle>
          <CardDescription>主题与内容为必填项</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="subject">主题</Label>
              <Input
                id="subject"
                placeholder="请简要描述问题（如：EUR 到账金额不一致）"
                aria-invalid={formState.errors.subject ? true : undefined}
                {...register('subject')}
              />
              {formState.errors.subject ? (
                <p className="text-xs text-danger">{formState.errors.subject.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">内容</Label>
              <textarea
                id="content"
                rows={6}
                placeholder="请补充问题细节，便于运营快速定位"
                className={FIELD_CLASS}
                aria-invalid={formState.errors.content ? true : undefined}
                {...register('content')}
              />
              {formState.errors.content ? (
                <p className="text-xs text-danger">{formState.errors.content.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="relatedOrderId">关联订单（可选）</Label>
              <select
                id="relatedOrderId"
                className={FIELD_CLASS}
                disabled={orders.length === 0}
                {...register('relatedOrderId')}
              >
                <option value="">不关联订单</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.id} · {order.pairId} · {formatDateTime(order.createdAt)}
                  </option>
                ))}
              </select>
              {orders.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无可关联订单</p>
              ) : null}
            </div>

            {serverError ? (
              <p className="text-xs text-danger" role="alert">
                {serverError}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? '提交中…' : '提交工单'}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/app/support">取消</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
