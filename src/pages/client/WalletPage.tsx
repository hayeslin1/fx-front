import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { DemoNotice } from '@/components/common/DemoNotice';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { ALL_CURRENCIES } from '@/domain/constants';
import type { Currency, Wallet, WalletBill } from '@/domain/types';
import {
  BILL_TYPE_LABELS,
  CURRENCY_ACCOUNT_LABELS,
  CURRENCY_LABELS,
} from '@/features/wallet/labels';
import { useWalletBills, useWalletOverview } from '@/features/wallet/hooks';
import { formatDateTime } from '@/lib/format';

// 六币种余额列（Money 统一渲染；每行明示演示资金）
const WALLET_COLUMNS: DataTableColumn<Wallet>[] = [
  {
    key: 'currency',
    header: '币种',
    cell: (wallet) => (
      <span className="font-medium">{CURRENCY_ACCOUNT_LABELS[wallet.currency]}</span>
    ),
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

// 流水列：类型/带符号金额（正绿负红）/变动前后余额/时间/关联订单跳转
const BILL_COLUMNS: DataTableColumn<WalletBill>[] = [
  {
    key: 'time',
    header: '时间',
    cell: (bill) => (
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {formatDateTime(bill.createdAt)}
      </span>
    ),
  },
  {
    key: 'type',
    header: '类型',
    cell: (bill) => BILL_TYPE_LABELS[bill.type],
  },
  {
    key: 'currency',
    header: '币种',
    cell: (bill) => bill.currency,
  },
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
    cell: (bill) => (
      <Money
        value={bill.balanceBefore}
        currency={bill.currency}
        className="text-muted-foreground"
      />
    ),
  },
  {
    key: 'after',
    header: '变动后',
    align: 'right',
    cell: (bill) => <Money value={bill.balanceAfter} currency={bill.currency} />,
  },
  {
    key: 'order',
    header: '关联订单',
    align: 'right',
    cell: (bill) =>
      bill.relatedOrderId ? (
        <Link to={`/app/orders/${bill.relatedOrderId}`} className="text-primary hover:underline">
          {bill.relatedOrderId}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

// 钱包（设计文档 §10.2）：六币种余额表 + 流水（币种筛选、关联订单跳转）
export function WalletPage() {
  const { wallets } = useWalletOverview();
  const [currencyFilter, setCurrencyFilter] = useState<Currency | 'ALL'>('ALL');
  const bills = useWalletBills(currencyFilter === 'ALL' ? undefined : currencyFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="钱包"
        description="六币种余额与资金流水，所有余额均为演示资金，不提供提现"
        actions={
          <Button asChild>
            <Link to="/app/top-up">去充值</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">币种余额</CardTitle>
          <CardDescription>按 USD / GBP / EUR / JPY / CNH / HKD 固定顺序展示</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            ariaLabel="六币种余额"
            columns={WALLET_COLUMNS}
            rows={wallets}
            rowKey={(wallet) => wallet.currency}
            empty={<EmptyState title="暂无钱包数据" description="请重新登录或重置演示数据。" />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">资金流水</CardTitle>
              <CardDescription>流水按时间倒序，展示每笔变动的余额衔接与关联订单</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="bill-currency">币种筛选</Label>
              <select
                id="bill-currency"
                value={currencyFilter}
                onChange={(event) => setCurrencyFilter(event.target.value as Currency | 'ALL')}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="ALL">全部币种</option>
                {ALL_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            ariaLabel="资金流水"
            columns={BILL_COLUMNS}
            rows={bills}
            rowKey={(bill) => bill.id}
            empty={
              <EmptyState
                title={currencyFilter === 'ALL' ? '暂无流水' : `${currencyFilter} 暂无流水`}
                description="完成一笔充值或兑换后，这里会显示资金变动记录。"
                action={
                  <Button asChild>
                    <Link to="/app/top-up">去充值</Link>
                  </Button>
                }
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
