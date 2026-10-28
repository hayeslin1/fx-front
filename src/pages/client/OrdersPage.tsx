import { Link, useNavigate } from 'react-router';
import { Repeat2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { Order } from '@/domain/types';
import { DIRECTION_LABELS } from '@/features/exchange/labels';
import { useCustomerOrders } from '@/features/orders/hooks';
import { formatDateTime } from '@/lib/format';

// 订单列表（设计文档 §10.2）：当前客户订单倒序；行点击进详情；空态引导去兑换。
export function OrdersPage() {
  const navigate = useNavigate();
  const { orders, channelName } = useCustomerOrders();

  const columns: DataTableColumn<Order>[] = [
    {
      key: 'id',
      header: '订单号',
      // 订单号列同时是可键盘聚焦的链接（验收 12：表格键盘可用），行点击仅作鼠标快捷方式
      cell: (order) => (
        <Link
          to={`/app/orders/${order.id}`}
          className="font-mono text-xs text-foreground hover:text-primary hover:underline"
        >
          {order.id}
        </Link>
      ),
    },
    {
      key: 'createdAt',
      header: '时间',
      cell: (order) => (
        <span className="text-muted-foreground">{formatDateTime(order.createdAt)}</span>
      ),
    },
    {
      key: 'pair',
      header: '币对 / 方向',
      cell: (order) => (
        <span className="whitespace-nowrap">
          {order.pairId} · {DIRECTION_LABELS[order.direction]}
        </span>
      ),
    },
    {
      key: 'sourceAmount',
      header: '来源金额',
      align: 'right',
      cell: (order) => <Money value={order.sourceAmount} currency={order.sourceCurrency} />,
    },
    {
      key: 'clientRate',
      header: '成交价',
      align: 'right',
      cell: (order) => <Rate value={order.snapshot.clientRate} />,
    },
    {
      key: 'targetAmount',
      header: '到账金额',
      align: 'right',
      cell: (order) => <Money value={order.targetAmount} currency={order.targetCurrency} />,
    },
    {
      key: 'channel',
      header: '渠道',
      cell: (order) => channelName(order.snapshot.channelId),
    },
    {
      key: 'status',
      header: '状态',
      cell: (order) => <StatusBadge status={order.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="订单" description="当前客户的兑换订单（成交时间倒序）" />

      <DataTable
        ariaLabel="订单列表"
        columns={columns}
        rows={orders}
        rowKey={(order) => order.id}
        onRowClick={(order) => navigate(`/app/orders/${order.id}`)}
        empty={
          <EmptyState
            icon={<Repeat2 className="size-8" />}
            title="暂无订单"
            description="完成一笔兑换后，订单与价格快照会显示在这里。"
            action={
              <Button asChild>
                <Link to="/app/exchange">去兑换</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}
