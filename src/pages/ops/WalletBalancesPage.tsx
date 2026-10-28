import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { DemoNotice } from '@/components/common/DemoNotice';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { ALL_CURRENCIES } from '@/domain/constants';
import { useOpsBalances, type OpsBalanceRow } from '@/features/ops-wallet/hooks';

// 运营余额查询（设计文档 §10.3 钱包管理段、PRD §5.4）：
// 按客户（姓名/邮箱关键词）搜索 → 六币种余额宽表（容器横向滚动）+ USD 参考估值列。
// 只读页面：运营无手工调账入口，余额均标注演示资金。

/** 客户身份列：姓名 + 邮箱（邮箱小字，便于同名客户区分） */
const IDENTITY_COLUMNS: DataTableColumn<OpsBalanceRow>[] = [
  {
    key: 'customer',
    header: '客户',
    cell: (row) => <span className="font-medium whitespace-nowrap">{row.customer.name}</span>,
  },
  {
    key: 'email',
    header: '邮箱',
    cell: (row) => (
      <span className="text-xs whitespace-nowrap text-muted-foreground">{row.customer.email}</span>
    ),
  },
];

/** 六币种余额列（固定顺序；缺项不补，显示 “—” 而非 0，避免误读为真实零余额） */
const CURRENCY_COLUMNS: DataTableColumn<OpsBalanceRow>[] = ALL_CURRENCIES.map((currency) => ({
  key: currency,
  header: currency,
  align: 'right',
  cell: (row) => {
    const balance = row.wallets.find((wallet) => wallet.currency === currency)?.balance;
    return balance === undefined ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Money value={balance} currency={currency} />
    );
  },
}));

/** USD 参考估值列（D6 口径：缺参考价的币种不计入并就地提示） */
const VALUATION_COLUMN: DataTableColumn<OpsBalanceRow> = {
  key: 'valuation',
  header: '参考估值（USD）',
  align: 'right',
  cell: (row) => (
    <span className="whitespace-nowrap">
      <Money value={row.valuation.totalUsd} currency="USD" className="font-medium" />
      {row.valuation.missing.length > 0 ? (
        <span className="ml-1 text-xs text-muted-foreground">
          （{row.valuation.missing.join('、')} 缺参考价）
        </span>
      ) : null}
    </span>
  ),
};

const BALANCE_COLUMNS: DataTableColumn<OpsBalanceRow>[] = [
  ...IDENTITY_COLUMNS,
  ...CURRENCY_COLUMNS,
  VALUATION_COLUMN,
];

export function WalletBalancesPage() {
  const [keyword, setKeyword] = useState('');
  const rows = useOpsBalances(keyword);

  return (
    <div className="space-y-6">
      <PageHeader
        title="余额查询"
        description="按客户检索六币种余额与 USD 参考估值，余额均为演示资金"
        actions={<DemoNotice />}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">客户余额</CardTitle>
              <CardDescription>
                参考估值 = Σ(余额 × 该币对最新原始中间价)，USD 按 1:1 计入；无参考价的币种不计入。
              </CardDescription>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-keyword">客户搜索</Label>
              <Input
                id="customer-keyword"
                value={keyword}
                autoComplete="off"
                placeholder="输入姓名或邮箱关键词"
                className="w-60"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">共 {rows.length} 位客户（宽表可横向滚动）</p>
          <DataTable
            columns={BALANCE_COLUMNS}
            rows={rows}
            rowKey={(row) => row.customer.id}
            empty={
              <EmptyState
                title="未找到匹配客户"
                description="换一个姓名或邮箱关键词再试，或清空搜索框查看全部客户。"
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
