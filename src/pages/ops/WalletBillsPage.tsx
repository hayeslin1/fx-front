import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import type { BillType } from '@/domain/types';
import { BILL_TYPE_LABELS, CURRENCY_LABELS } from '@/features/wallet/labels';
import {
  filterCustomersByKeyword,
  useOpsBillsView,
  useOpsWalletContext,
  type OpsBillRow,
} from '@/features/ops-wallet/hooks';
import { formatDateTime } from '@/lib/format';

// 运营账单流水（设计文档 §10.3 钱包管理段、PRD §5.4）：
// 筛选＝客户（关键词或下拉）+ 类型（全部流水类型）+ 日期范围（起止含当天，非法拒绝）；
// 列为时间/客户/币种/金额±/变动前/变动后/类型/关联订单/操作人，时间倒序。

/** 全部流水类型（枚举文案唯一来源 features/wallet/labels.ts） */
const BILL_TYPE_OPTIONS: BillType[] = [
  'INITIAL_GIFT',
  'TOPUP_SELF',
  'TOPUP_OPS',
  'EXCHANGE_DEBIT',
  'EXCHANGE_CREDIT',
];

const controlClassName =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

const BILL_COLUMNS: DataTableColumn<OpsBillRow>[] = [
  {
    key: 'time',
    header: '时间',
    cell: (row) => (
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {formatDateTime(row.bill.createdAt)}
      </span>
    ),
  },
  {
    key: 'customer',
    header: '客户',
    cell: (row) => <span className="whitespace-nowrap">{row.customerName}</span>,
  },
  {
    key: 'currency',
    header: '币种',
    cell: (row) => <span className="whitespace-nowrap">{CURRENCY_LABELS[row.bill.currency]}</span>,
  },
  {
    key: 'amount',
    header: '金额±',
    align: 'right',
    cell: (row) => <Money value={row.bill.amount} currency={row.bill.currency} signed />,
  },
  {
    key: 'before',
    header: '变动前',
    align: 'right',
    cell: (row) => (
      <Money
        value={row.bill.balanceBefore}
        currency={row.bill.currency}
        className="text-muted-foreground"
      />
    ),
  },
  {
    key: 'after',
    header: '变动后',
    align: 'right',
    cell: (row) => <Money value={row.bill.balanceAfter} currency={row.bill.currency} />,
  },
  {
    key: 'type',
    header: '类型',
    cell: (row) => <span className="whitespace-nowrap">{BILL_TYPE_LABELS[row.bill.type]}</span>,
  },
  {
    key: 'order',
    header: '关联订单',
    align: 'right',
    cell: (row) =>
      row.bill.relatedOrderId ? (
        <span className="text-xs whitespace-nowrap tabular-nums">{row.bill.relatedOrderId}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: 'operator',
    header: '操作人',
    align: 'right',
    cell: (row) => (
      <span className="whitespace-nowrap">
        {row.operatorName === '—' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          row.operatorName
        )}
      </span>
    ),
  },
];

export function WalletBillsPage() {
  const { customers } = useOpsWalletContext();
  const [keyword, setKeyword] = useState('');
  const [customerId, setCustomerId] = useState('ALL');
  const [type, setType] = useState<BillType | 'ALL'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 关键词只过滤下拉候选项；已选中客户始终保留，避免关键词变化导致选择值悬空
  const visibleCustomers = useMemo(() => {
    const matched = filterCustomersByKeyword(customers, keyword);
    const selected = customers.find((customer) => customer.id === customerId);
    if (selected !== undefined && !matched.some((customer) => customer.id === selected.id)) {
      return [selected, ...matched];
    }
    return matched;
  }, [customers, keyword, customerId]);

  const { rows, dateError } = useOpsBillsView({
    ...(customerId === 'ALL' ? {} : { customerId }),
    ...(type === 'ALL' ? {} : { type }),
    ...(dateFrom === '' ? {} : { dateFrom }),
    ...(dateTo === '' ? {} : { dateTo }),
  });

  const resetFilters = () => {
    setKeyword('');
    setCustomerId('ALL');
    setType('ALL');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="账单流水"
        description="全量钱包账单核对：客户自助充值、运营代客充值及兑换扣款/入账"
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">筛选</CardTitle>
              <CardDescription>客户（关键词或下拉）、流水类型与日期范围，起止均含当天。</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={resetFilters}>
              重置筛选
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="bill-customer-keyword">客户关键词</Label>
              <Input
                id="bill-customer-keyword"
                value={keyword}
                autoComplete="off"
                placeholder="姓名或邮箱片段"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill-customer">客户</Label>
              <select
                id="bill-customer"
                value={customerId}
                className={controlClassName}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="ALL">全部客户</option>
                {visibleCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}（{customer.email}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill-type">类型</Label>
              <select
                id="bill-type"
                value={type}
                className={controlClassName}
                onChange={(event) => setType(event.target.value as BillType | 'ALL')}
              >
                <option value="ALL">全部类型</option>
                {BILL_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {BILL_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill-date-from">开始日期</Label>
              <Input
                id="bill-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill-date-to">结束日期</Label>
              <Input
                id="bill-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </div>
          {dateError ? (
            <p className="text-xs text-rose-600">{dateError}（日期筛选已拒绝，其余筛选照常生效）</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">共 {rows.length} 条流水（时间倒序）</p>
        <DataTable
          columns={BILL_COLUMNS}
          rows={rows}
          rowKey={(row) => row.bill.id}
          empty={
            <EmptyState
              title="暂无匹配流水"
              description="调整客户、类型或日期筛选后重试；预置数据覆盖全部五类流水。"
            />
          }
        />
      </div>
    </div>
  );
}
