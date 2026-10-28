import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PAIR_IDS } from '@/domain/constants';
import type { PairId, PnlAllocation, ProfitOrderStatus } from '@/domain/types';
import { useProfitOrders, type ProfitOrderRow } from '@/features/trading/hooks';
import {
  PLATFORM_SIDE_LABELS,
  PNL_SOURCE_LABELS,
  PROFIT_ORDER_STATUS_BADGE_CLASS,
  PROFIT_ORDER_STATUS_LABELS,
  REMAINDER_LABELS,
  allocationRefLabel,
} from '@/features/trading/labels';
import { CURRENCY_LABELS } from '@/features/wallet/labels';
import { formatDateTime } from '@/lib/format';

// 交易管理-收益订单（设计文档 §10.3、PRD §5.3、§6.6）：
// 列表（收益单号/关联订单/客户/币对/方向/名义 USD/已平/未平/累计损益+币种/状态）+ 筛选（状态/币对）
// + 行展开详情（分配明细：来源区分、FIFO 序号、建仓/平仓基准价、损益与分摊、尾差标记）。
// WHY 状态徽标文案取自 labels 而非 StatusBadge 内置映射：公共徽标把 PARTIAL 译作“部分结算”，
// 收益单单据口径是“部分实现/待实现”（§6.6），故以 labels 为唯一文案来源并复用其同款配色。

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const STATUS_OPTIONS: ProfitOrderStatus[] = ['PENDING', 'PARTIAL', 'SETTLED'];

/** 分配明细列（与客户订单页行展开同构；两页各自持有，避免页面之间互相 import） */
const ALLOCATION_COLUMNS: DataTableColumn<PnlAllocation>[] = [
  { key: 'source', header: '来源', cell: (item) => PNL_SOURCE_LABELS[item.source] },
  {
    key: 'ref',
    header: '批次或对手单',
    cell: (item) => <span className="font-mono text-xs">{allocationRefLabel(item)}</span>,
  },
  { key: 'fifoSeq', header: 'FIFO 序号', align: 'right', cell: (item) => item.fifoSeq },
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
    header: '尾差标记',
    align: 'center',
    cell: (item) => (
      <span className={item.isRemainder ? 'text-amber-700' : 'text-muted-foreground'}>
        {item.isRemainder ? REMAINDER_LABELS.yes : REMAINDER_LABELS.no}
      </span>
    ),
  },
];

export function ProfitOrdersPage() {
  const [status, setStatus] = useState('');
  const [pairId, setPairId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = useProfitOrders({
    status: status === '' ? undefined : (status as ProfitOrderStatus),
    pairId: pairId === '' ? undefined : (pairId as PairId),
  });
  const expanded = rows.find((row) => row.profitOrder.id === expandedId);

  const toggle = (profitOrderId: string) => {
    setExpandedId((current) => (current === profitOrderId ? null : profitOrderId));
  };

  const columns: DataTableColumn<ProfitOrderRow>[] = [
    {
      key: 'id',
      header: '收益单号',
      cell: (row) => <span className="font-mono text-xs">{row.profitOrder.id}</span>,
    },
    {
      key: 'orderId',
      header: '关联订单',
      cell: (row) => <span className="font-mono text-xs">{row.profitOrder.customerOrderId}</span>,
    },
    { key: 'customer', header: '客户', cell: (row) => row.customerName },
    { key: 'pair', header: '币对', cell: (row) => row.profitOrder.pairId },
    {
      key: 'side',
      header: '方向',
      cell: (row) => PLATFORM_SIDE_LABELS[row.profitOrder.side],
    },
    {
      key: 'usdNotional',
      header: '名义 USD',
      align: 'right',
      cell: (row) => <Money value={row.profitOrder.usdNotional} currency="USD" />,
    },
    {
      key: 'usdClosed',
      header: '已平 USD',
      align: 'right',
      cell: (row) => <Money value={row.usdClosed} currency="USD" />,
    },
    {
      key: 'usdOpen',
      header: '未平 USD',
      align: 'right',
      cell: (row) => <Money value={row.profitOrder.usdOpen} currency="USD" />,
    },
    {
      key: 'realizedPnl',
      header: '累计损益（币种）',
      align: 'right',
      cell: (row) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <Money
            value={row.profitOrder.realizedPnl}
            currency={row.profitOrder.pnlCurrency}
            signed
          />
          <span className="text-xs text-muted-foreground">
            {CURRENCY_LABELS[row.profitOrder.pnlCurrency]}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <StatusBadge
          status={PROFIT_ORDER_STATUS_LABELS[row.profitOrder.status]}
          className={PROFIT_ORDER_STATUS_BADGE_CLASS[row.profitOrder.status]}
        />
      ),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (row) => {
        const isOpen = expandedId === row.profitOrder.id;
        return (
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-expanded={isOpen}
            onClick={(event) => {
              event.stopPropagation();
              toggle(row.profitOrder.id);
            }}
          >
            {isOpen ? '收起' : '明细'}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="收益订单"
        description="每笔成功兑换唯一收益单；展开行查看 FIFO 分配明细、损益与尾差（不同报价币的损益不得相加）"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选</CardTitle>
          <CardDescription>状态（待实现/部分实现/已结算）与币对</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="profit-status">状态</Label>
              <select
                id="profit-status"
                className={SELECT_CLASS}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">全部状态</option>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {PROFIT_ORDER_STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profit-pair">币对</Label>
              <select
                id="profit-pair"
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
          </div>
          <p className="mt-2 text-xs text-muted-foreground">当前共 {rows.length} 张收益单</p>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.profitOrder.id}
        onRowClick={(row) => toggle(row.profitOrder.id)}
        empty={
          <EmptyState title="没有匹配的收益单" description="请调整状态或币对筛选条件后重试。" />
        }
      />

      {expanded !== undefined ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base">收益单详情</CardTitle>
                <CardDescription>
                  {expanded.profitOrder.id} · 关联订单 {expanded.profitOrder.customerOrderId} ·{' '}
                  {expanded.customerName} · {expanded.profitOrder.pairId} ·{' '}
                  {PLATFORM_SIDE_LABELS[expanded.profitOrder.side]}
                  {expanded.order !== undefined
                    ? ` · 成交时间 ${formatDateTime(expanded.order.createdAt)}`
                    : ''}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setExpandedId(null)}>
                收起
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">名义 USD</dt>
                <dd>
                  <Money value={expanded.profitOrder.usdNotional} currency="USD" />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">已平 USD</dt>
                <dd>
                  <Money value={expanded.usdClosed} currency="USD" />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">未平 USD</dt>
                <dd>
                  <Money value={expanded.profitOrder.usdOpen} currency="USD" />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  累计损益（{CURRENCY_LABELS[expanded.profitOrder.pnlCurrency]}）
                </dt>
                <dd>
                  <Money
                    value={expanded.profitOrder.realizedPnl}
                    currency={expanded.profitOrder.pnlCurrency}
                    signed
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">状态</dt>
                <dd>
                  <StatusBadge
                    status={PROFIT_ORDER_STATUS_LABELS[expanded.profitOrder.status]}
                    className={PROFIT_ORDER_STATUS_BADGE_CLASS[expanded.profitOrder.status]}
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">分配明细条数</dt>
                <dd className="tabular-nums">{expanded.profitOrder.allocations.length}</dd>
              </div>
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">分配明细</h3>
              <DataTable
                columns={ALLOCATION_COLUMNS}
                rows={expanded.profitOrder.allocations}
                rowKey={(item) => item.id}
                empty={
                  <EmptyState
                    title="暂无分配明细"
                    description="该收益单尚未实现损益（等待自然对冲或渠道平仓）。"
                  />
                }
              />
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
