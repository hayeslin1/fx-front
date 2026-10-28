import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { DemoNotice } from '@/components/common/DemoNotice';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import type { Order, Wallet, WalletBill } from '@/domain/types';
import { DIRECTION_LABELS } from '@/features/exchange/labels';
import { useOpsCustomerDetail, RECENT_LIMIT } from '@/features/ops-customer/hooks';
import { BILL_TYPE_LABELS, CURRENCY_LABELS } from '@/features/wallet/labels';
import { formatDateTime } from '@/lib/format';

// 客户详情（设计文档 §10.3、PRD §5.2）：资料卡 + 六币种余额 + USD 参考估值 + 最近订单/流水概览。
// 仅查询；运营端无客户订单详情路由，订单概览只展示编号/币对/方向/金额/时间。

const TIME_CELL_CLASS = 'text-xs whitespace-nowrap text-muted-foreground tabular-nums';

// 资料字段：dt/dd 语义化，便于读屏按“标签—值”朗读
function InfoField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const WALLET_COLUMNS: DataTableColumn<Wallet>[] = [
  {
    key: 'currency',
    header: '币种',
    cell: (wallet) => <span className="font-medium">{CURRENCY_LABELS[wallet.currency]}</span>,
  },
  {
    key: 'balance',
    header: '可用余额',
    align: 'right',
    cell: (wallet) => <Money value={wallet.balance} currency={wallet.currency} />,
  },
  {
    key: 'nature',
    header: '性质',
    align: 'right',
    cell: () => <DemoNotice />,
  },
];

const RECENT_ORDER_COLUMNS: DataTableColumn<Order>[] = [
  {
    key: 'id',
    header: '订单号',
    cell: (order) => <span className="font-medium">{order.id}</span>,
  },
  {
    key: 'createdAt',
    header: '时间',
    cell: (order) => <span className={TIME_CELL_CLASS}>{formatDateTime(order.createdAt)}</span>,
  },
  { key: 'pairId', header: '币对', cell: (order) => order.pairId },
  { key: 'direction', header: '方向', cell: (order) => DIRECTION_LABELS[order.direction] },
  {
    key: 'sourceAmount',
    header: '来源金额',
    align: 'right',
    cell: (order) => <Money value={order.sourceAmount} currency={order.sourceCurrency} />,
  },
  {
    key: 'targetAmount',
    header: '到账金额',
    align: 'right',
    cell: (order) => <Money value={order.targetAmount} currency={order.targetCurrency} />,
  },
];

const RECENT_BILL_COLUMNS: DataTableColumn<WalletBill>[] = [
  {
    key: 'createdAt',
    header: '时间',
    cell: (bill) => <span className={TIME_CELL_CLASS}>{formatDateTime(bill.createdAt)}</span>,
  },
  { key: 'type', header: '类型', cell: (bill) => BILL_TYPE_LABELS[bill.type] },
  {
    key: 'amount',
    header: '金额',
    align: 'right',
    cell: (bill) => <Money value={bill.amount} currency={bill.currency} signed />,
  },
];

export function CustomerDetailPage() {
  const { id } = useParams();
  const { customer, wallets, valuation, recentOrders, recentBills } = useOpsCustomerDetail(id);

  if (customer === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title="客户详情" description="查看客户资料、六币种余额与近期订单/流水" />
        <EmptyState
          title="客户不存在"
          description="客户编号不存在（可能已重置演示数据），请返回客户列表重新选择。"
          action={
            <Button asChild variant="outline">
              <Link to="/ops/customers">返回客户列表</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        description={`客户编号 ${customer.id} · 邮箱 ${customer.email} · 仅查询，不支持资料修改/KYC/冻结（PRD §5.2）`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/ops/customers">
              <ArrowLeft className="size-4" />
              返回列表
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">客户资料</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <InfoField label="客户编号">{customer.id}</InfoField>
            <InfoField label="姓名">{customer.name}</InfoField>
            <InfoField label="邮箱">{customer.email}</InfoField>
            <InfoField label="注册时间">{formatDateTime(customer.createdAt)}</InfoField>
            <InfoField label="最近登录">
              {customer.lastLoginAt === null ? '—' : formatDateTime(customer.lastLoginAt)}
            </InfoField>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">六币种余额</CardTitle>
              <CardDescription>按 USD / GBP / EUR / JPY / CNH / HKD 固定顺序展示</CardDescription>
            </div>
            <DemoNotice />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable
            columns={WALLET_COLUMNS}
            rows={wallets}
            rowKey={(wallet) => wallet.currency}
            empty={<EmptyState title="暂无钱包数据" description="该客户暂无任何币种余额记录。" />}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              USD 参考估值（按各币对最新原始中间价折算，非可成交价）
            </p>
            <p className="text-base font-semibold">
              <Money value={valuation?.totalUsd ?? '0.00'} currency="USD" />
            </p>
          </div>
          {valuation !== undefined && valuation.missing.length > 0 ? (
            <p className="text-xs text-amber-700">
              有 {valuation.missing.length} 种币种（{valuation.missing.join('、')}
              ）暂缺参考价，未计入估值。
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle className="text-base">最近订单</CardTitle>
            <CardDescription>
              按成交时间倒序，最多展示最近 {RECENT_LIMIT} 笔（运营端不提供订单详情页）
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={RECENT_ORDER_COLUMNS}
            rows={recentOrders}
            rowKey={(order) => order.id}
            empty={<EmptyState title="暂无订单" description="该客户暂无成功兑换订单。" />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle className="text-base">最近流水</CardTitle>
            <CardDescription>按时间倒序，最多展示最近 {RECENT_LIMIT} 笔</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={RECENT_BILL_COLUMNS}
            rows={recentBills}
            rowKey={(bill) => bill.id}
            empty={<EmptyState title="暂无流水" description="该客户暂无钱包资金变动记录。" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
