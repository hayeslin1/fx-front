import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PAIR_IDS } from '@/domain/constants';
import type { OpenLot, PairId, PnlAllocation, WalletBill } from '@/domain/types';
import {
  closedUsdOf,
  resolveDateRange,
  useTradingOrderDetail,
  useTradingOrders,
  type TradingOrderRow,
} from '@/features/trading/hooks';
import {
  ORDER_STATUS_LABELS,
  PNL_SOURCE_LABELS,
  PROFIT_ORDER_STATUS_BADGE_CLASS,
  PROFIT_ORDER_STATUS_LABELS,
  REMAINDER_LABELS,
  TRADE_DIRECTION_LABELS,
  allocationRefLabel,
} from '@/features/trading/labels';
import { BILL_TYPE_LABELS, CURRENCY_LABELS } from '@/features/wallet/labels';
import { formatDateTime } from '@/lib/format';

// 交易管理-客户订单（设计文档 §10.3、PRD §5.3）：
// 列表（订单号/时间/客户/币对/方向/来源金额/成交价/到账/渠道/状态）+ 筛选（客户/币对/日期，起止含当天，非法区间拒绝）
// + 行展开详情（关联钱包流水、该订单未平敞口、关联收益单及分配明细）。
// WHY 详情走"行展开卡片"而非独立路由：/ops/trading/orders 无详情路由（§10.1），
// 运营核对快照时列表与明细需要同屏对照，展开卡片比跳页更贴近核对动线。

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const BILL_COLUMNS: DataTableColumn<WalletBill>[] = [
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
    cell: (bill) => <span className="text-muted-foreground">{formatDateTime(bill.createdAt)}</span>,
  },
];

const ALLOCATION_COLUMNS: DataTableColumn<PnlAllocation>[] = [
  { key: 'source', header: '来源', cell: (item) => PNL_SOURCE_LABELS[item.source] },
  {
    key: 'ref',
    header: '对手单或批次尝试',
    cell: (item) => <span className="font-mono text-xs">{allocationRefLabel(item)}</span>,
  },
  { key: 'fifoSeq', header: '序号', align: 'right', cell: (item) => item.fifoSeq },
  {
    key: 'usdMatched',
    header: '归属 USD',
    align: 'right',
    cell: (item) => <Money value={item.usdMatched} currency="USD" />,
  },
  {
    key: 'openMid',
    header: '建仓基准价',
    align: 'right',
    cell: (item) => <Rate value={item.openMid} />,
  },
  {
    key: 'closeMid',
    header: '平仓基准价',
    align: 'right',
    cell: (item) => <Rate value={item.closeMid} />,
  },
  {
    key: 'pnl',
    header: '损益',
    align: 'right',
    cell: (item) => <Money value={item.pnl} currency={item.currency} signed />,
  },
  {
    key: 'share',
    header: '分摊',
    align: 'right',
    cell: (item) => <Money value={item.share} currency={item.currency} signed />,
  },
  {
    key: 'remainder',
    header: '尾差',
    align: 'center',
    cell: (item) => (
      <span className={item.isRemainder ? 'text-amber-700' : 'text-muted-foreground'}>
        {item.isRemainder ? REMAINDER_LABELS.yes : REMAINDER_LABELS.no}
      </span>
    ),
  },
];

export function TradingOrdersPage() {
  const [customerId, setCustomerId] = useState('');
  const [pairId, setPairId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 起止含当天（startOf/endOf day）；非法区间只提示、不参与筛选
  const range = resolveDateRange(dateFrom, dateTo);
  const { rows, customers, channelName } = useTradingOrders({
    customerId: customerId === '' ? undefined : customerId,
    pairId: pairId === '' ? undefined : (pairId as PairId),
    from: range.from,
    to: range.to,
  });
  const detail = useTradingOrderDetail(expandedId);

  const toggle = (orderId: string) => {
    setExpandedId((current) => (current === orderId ? null : orderId));
  };

  const columns: DataTableColumn<TradingOrderRow>[] = [
    {
      key: 'id',
      header: '订单号',
      cell: (row) => <span className="font-mono text-xs">{row.order.id}</span>,
    },
    {
      key: 'createdAt',
      header: '时间',
      cell: (row) => (
        <span className="text-muted-foreground">{formatDateTime(row.order.createdAt)}</span>
      ),
    },
    { key: 'customer', header: '客户', cell: (row) => row.customerName },
    { key: 'pair', header: '币对', cell: (row) => row.order.pairId },
    {
      key: 'direction',
      header: '方向',
      cell: (row) => TRADE_DIRECTION_LABELS[row.order.direction],
    },
    {
      key: 'sourceAmount',
      header: '来源金额',
      align: 'right',
      cell: (row) => <Money value={row.order.sourceAmount} currency={row.order.sourceCurrency} />,
    },
    {
      key: 'clientRate',
      header: '成交价',
      align: 'right',
      cell: (row) => <Rate value={row.order.snapshot.clientRate} />,
    },
    {
      key: 'targetAmount',
      header: '到账',
      align: 'right',
      cell: (row) => <Money value={row.order.targetAmount} currency={row.order.targetCurrency} />,
    },
    { key: 'channel', header: '渠道', cell: (row) => row.channelName },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.order.status} /> },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (row) => {
        const expanded = expandedId === row.order.id;
        return (
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-expanded={expanded}
            onClick={(event) => {
              // 行点击与按钮点击同义，阻止冒泡避免二次切换
              event.stopPropagation();
              toggle(row.order.id);
            }}
          >
            {expanded ? '收起' : '详情'}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="客户订单"
        description="全量成功兑换订单与价格快照核对；展开行可查看关联钱包流水、订单级敞口与收益单"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选</CardTitle>
          <CardDescription>
            客户 / 币对 / 日期范围（起止含当天，开始日期不得晚于结束日期）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="order-customer">客户</Label>
              <select
                id="order-customer"
                className={SELECT_CLASS}
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">全部客户</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}（{customer.id}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-pair">币对</Label>
              <select
                id="order-pair"
                className={SELECT_CLASS}
                value={pairId}
                onChange={(event) => setPairId(event.target.value)}
              >
                <option value="">全部币对</option>
                {PAIR_IDS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-date-from">开始日期</Label>
              <Input
                id="order-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-date-to">结束日期</Label>
              <Input
                id="order-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </div>
          {range.error !== null ? (
            <p className="mt-2 text-xs text-destructive">{range.error}（当前筛选已忽略日期条件）</p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">当前共 {rows.length} 笔订单</p>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.order.id}
        onRowClick={(row) => toggle(row.order.id)}
        empty={
          <EmptyState title="没有匹配的订单" description="请调整客户、币对或日期筛选条件后重试。" />
        }
      />

      {detail.order !== undefined ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base">订单详情</CardTitle>
                <CardDescription>
                  {detail.order.id} · {detail.customerName} · {detail.order.pairId} ·{' '}
                  {TRADE_DIRECTION_LABELS[detail.order.direction]} ·{' '}
                  {ORDER_STATUS_LABELS[detail.order.status]} · 渠道{' '}
                  {channelName(detail.order.snapshot.channelId)}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setExpandedId(null)}>
                收起
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">关联钱包流水</h3>
              <DataTable
                columns={BILL_COLUMNS}
                rows={detail.bills}
                rowKey={(bill) => bill.id}
                empty={
                  <EmptyState
                    title="暂无关联流水"
                    description="该订单没有找到关联的钱包扣款/到账流水。"
                  />
                }
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">该订单未平敞口</h3>
              {detail.lots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  已平尽（本单 USD 本金已全部被自然对冲或渠道平仓，无剩余敞口）
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  <p>
                    剩余未平 USD 合计：
                    <Money value={detail.openUsd} currency="USD" className="font-semibold" />
                  </p>
                  <ul className="space-y-1">
                    {detail.lots.map((lot: OpenLot) => (
                      <li key={lot.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-muted-foreground">建仓基准价</span>
                        <Rate value={lot.openMid} />
                        <span className="text-muted-foreground">建仓时间</span>
                        <span>{formatDateTime(lot.openedAt)}</span>
                        <span className="text-muted-foreground">剩余</span>
                        <Money value={lot.usdRemaining} currency="USD" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">关联收益单</h3>
              {detail.profitOrder === undefined ? (
                <p className="text-sm text-muted-foreground">暂无关联收益单</p>
              ) : (
                <>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">收益单号</dt>
                      <dd className="font-mono text-xs">{detail.profitOrder.id}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">状态</dt>
                      <dd>
                        <StatusBadge
                          status={PROFIT_ORDER_STATUS_LABELS[detail.profitOrder.status]}
                          className={PROFIT_ORDER_STATUS_BADGE_CLASS[detail.profitOrder.status]}
                        />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">名义 USD</dt>
                      <dd>
                        <Money value={detail.profitOrder.usdNotional} currency="USD" />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">已平 USD</dt>
                      <dd>
                        <Money value={closedUsdOf(detail.profitOrder)} currency="USD" />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">未平 USD</dt>
                      <dd>
                        <Money value={detail.profitOrder.usdOpen} currency="USD" />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">
                        累计损益（{CURRENCY_LABELS[detail.profitOrder.pnlCurrency]}）
                      </dt>
                      <dd>
                        <Money
                          value={detail.profitOrder.realizedPnl}
                          currency={detail.profitOrder.pnlCurrency}
                          signed
                        />
                      </dd>
                    </div>
                  </dl>
                  <DataTable
                    columns={ALLOCATION_COLUMNS}
                    rows={detail.profitOrder.allocations}
                    rowKey={(item) => item.id}
                    empty={
                      <EmptyState
                        title="暂无分配明细"
                        description="该收益单尚未实现损益（等待自然对冲或渠道平仓）。"
                      />
                    }
                  />
                </>
              )}
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
