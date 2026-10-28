import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { ALL_CURRENCIES } from '@/domain/constants';
import {
  filterCustomerRows,
  useOpsCustomerRows,
  walletOf,
  type OpsCustomerRow,
} from '@/features/ops-customer/hooks';
import { formatDateTime } from '@/lib/format';

// 客户列表（设计文档 §10.3、PRD §5.2）：姓名/邮箱/注册时间/最近登录/USD 估值/六币种余额/操作。
// 仅查询，不提供 KYC/冻结/改资料入口；宽表由 DataTable 容器横向滚动承载。

const TIME_CELL_CLASS = 'text-xs whitespace-nowrap text-muted-foreground tabular-nums';

const CUSTOMER_COLUMNS: DataTableColumn<OpsCustomerRow>[] = [
  {
    key: 'name',
    header: '姓名',
    cell: (row) => <span className="font-medium">{row.customer.name}</span>,
  },
  {
    key: 'email',
    header: '邮箱',
    cell: (row) => <span className="text-muted-foreground">{row.customer.email}</span>,
  },
  {
    key: 'createdAt',
    header: '注册时间',
    cell: (row) => (
      <span className={TIME_CELL_CLASS}>{formatDateTime(row.customer.createdAt)}</span>
    ),
  },
  {
    key: 'lastLoginAt',
    header: '最近登录',
    cell: (row) =>
      row.customer.lastLoginAt === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className={TIME_CELL_CLASS}>{formatDateTime(row.customer.lastLoginAt)}</span>
      ),
  },
  {
    key: 'valuation',
    header: 'USD 参考估值',
    align: 'right',
    cell: (row) => (
      <div className="space-y-0.5">
        <Money value={row.valuation.totalUsd} currency="USD" />
        {row.valuation.missing.length > 0 ? (
          <p className="text-[11px] text-amber-700">
            有 {row.valuation.missing.length} 种币种暂缺参考价，未计入
          </p>
        ) : null}
      </div>
    ),
  },
  // 六币种余额列（顺序与 ALL_CURRENCIES 一致；缺钱包渲染占位符）
  ...ALL_CURRENCIES.map((currency) => ({
    key: `balance-${currency}`,
    header: `${currency} 余额`,
    align: 'right' as const,
    cell: (row: OpsCustomerRow) => {
      const wallet = walletOf(row, currency);
      return wallet === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Money value={wallet.balance} currency={currency} />
      );
    },
  })),
  {
    key: 'actions',
    header: '操作',
    align: 'right',
    cell: (row) => (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/ops/customers/${row.customer.id}`}>查看详情</Link>
      </Button>
    ),
  },
];

export function CustomersPage() {
  const rows = useOpsCustomerRows();
  const [keyword, setKeyword] = useState('');
  const filtered = useMemo(() => filterCustomerRows(rows, keyword), [rows, keyword]);
  const hasKeyword = keyword.trim() !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="客户管理"
        description="客户检索与余额总览；仅查询，不支持 KYC、账户冻结或资料修改（PRD §5.2）"
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">客户列表</CardTitle>
              <CardDescription>
                共 {filtered.length} 位客户；USD 估值为参考估值（按各币对最新中间价折算）
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索姓名或邮箱"
                aria-label="搜索姓名或邮箱"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={CUSTOMER_COLUMNS}
            rows={filtered}
            rowKey={(row) => row.customer.id}
            empty={
              hasKeyword ? (
                <EmptyState
                  title="无匹配客户"
                  description={`未找到与「${keyword.trim()}」匹配的客户，请调整关键词。`}
                />
              ) : (
                <EmptyState
                  title="暂无客户"
                  description="重置演示数据后可恢复预置样例客户，新注册客户也会出现在此。"
                />
              )
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
