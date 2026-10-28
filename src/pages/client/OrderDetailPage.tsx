import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { WalletBill } from '@/domain/types';
import { DIRECTION_LABELS } from '@/features/exchange/labels';
import { useOrderDetail } from '@/features/orders/hooks';
import { ORDER_FLOW_LABELS, ORDER_STATUS_LABELS } from '@/features/orders/labels';
import { BILL_TYPE_LABELS } from '@/features/wallet/labels';
import { formatDateTime } from '@/lib/format';

// 订单详情（设计文档 §10.2）：完整价格快照 + 关联钱包流水。
// 客户侧不展示平台损益/收益订单（PRD §3.4）。
export function OrderDetailPage() {
  const { id } = useParams();
  const { order, bills, channelName } = useOrderDetail(id ?? '');

  const billColumns: DataTableColumn<WalletBill>[] = [
    { key: 'currency', header: '币种', cell: (bill) => bill.currency },
    { key: 'type', header: '类型', cell: (bill) => BILL_TYPE_LABELS[bill.type] },
    {
      key: 'amount',
      header: '金额',
      align: 'right',
      cell: (bill) => <Money value={bill.amount} currency={bill.currency} signed />,
    },
    {
      key: 'before',
      header: '变动前',
      align: 'right',
      cell: (bill) => <Money value={bill.balanceBefore} currency={bill.currency} />,
    },
    {
      key: 'after',
      header: '变动后',
      align: 'right',
      cell: (bill) => <Money value={bill.balanceAfter} currency={bill.currency} />,
    },
    {
      key: 'createdAt',
      header: '时间',
      cell: (bill) => (
        <span className="text-muted-foreground">{formatDateTime(bill.createdAt)}</span>
      ),
    },
  ];

  if (order === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title="订单详情" description="查看订单价格快照与关联钱包流水" />
        <EmptyState
          title="订单不存在"
          description="订单号不存在或不属于当前客户，请返回订单列表重新选择。"
          action={
            <Button asChild variant="outline">
              <Link to="/app/orders">返回订单列表</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`订单 ${order.id}`}
        description={`${ORDER_STATUS_LABELS[order.status]} · 成交时间 ${formatDateTime(
          order.snapshot.executedAt,
        )}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/orders">
              <ArrowLeft className="size-4" />
              返回列表
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>成交信息</CardTitle>
            <CardDescription>客户视角的兑换结果</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">订单号</dt>
              <dd className="text-right font-mono text-xs">{order.id}</dd>
              <dt className="text-muted-foreground">状态</dt>
              <dd className="flex justify-end">
                <StatusBadge status={order.status} />
              </dd>
              <dt className="text-muted-foreground">币对</dt>
              <dd className="text-right">{order.pairId}</dd>
              <dt className="text-muted-foreground">方向</dt>
              <dd className="text-right">
                {DIRECTION_LABELS[order.direction]}（{ORDER_FLOW_LABELS[order.direction]}）
              </dd>
              <dt className="text-muted-foreground">来源金额</dt>
              <dd className="text-right">
                <Money value={order.sourceAmount} currency={order.sourceCurrency} />
              </dd>
              <dt className="text-muted-foreground">到账金额</dt>
              <dd className="text-right">
                <Money value={order.targetAmount} currency={order.targetCurrency} />
              </dd>
              <dt className="text-muted-foreground">服务费</dt>
              <dd className="text-right">
                <Money value={order.fee} currency={order.sourceCurrency} />
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>价格快照</CardTitle>
            <CardDescription>成交后不随运营汇率配置变化（PRD §3.4）</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">客户成交价</dt>
              <dd className="text-right font-semibold">
                <Rate value={order.snapshot.clientRate} />
              </dd>
              <dt className="text-muted-foreground">成交时原始中间价</dt>
              <dd className="text-right">
                <Rate value={order.snapshot.mid} />
              </dd>
              <dt className="text-muted-foreground">报价渠道</dt>
              <dd className="text-right">{channelName(order.snapshot.channelId)}</dd>
              <dt className="text-muted-foreground">原始价采集时间</dt>
              <dd className="text-right">{formatDateTime(order.snapshot.priceCollectedAt)}</dd>
              <dt className="text-muted-foreground">成交时间</dt>
              <dd className="text-right">{formatDateTime(order.snapshot.executedAt)}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>关联钱包流水</CardTitle>
          <CardDescription>兑换扣款与到账两条流水，含变动前后余额</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            ariaLabel="关联钱包流水"
            columns={billColumns}
            rows={bills}
            rowKey={(bill) => bill.id}
            empty={<EmptyState title="暂无关联流水" description="该订单没有找到关联的钱包流水。" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
