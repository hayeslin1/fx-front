import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  COLLECT_ALL_PENDING_KEY,
  POOL_VALIDITY_META,
  poolRowKey,
  resolvePoolValidity,
  useFxPoolActions,
  useFxPoolRows,
  useNowTick,
  type FxPoolRow,
} from '@/features/fx-pool/hooks';

// 汇率运营-采集池（设计文档 §10.3 汇率运营段、§5.4 渠道与采集池、决策 D5）：
// 币对×渠道全量行：原始中间价（Rate）/采集时间/报价启用开关/有效状态（渠道启用 && ≤10min，实时计算）；
// 行级“模拟采集”按步长序列生成新价并刷新时间，页头另提供“全部采集”。
// 成功后价格与时间即时刷新并 toast；失败（如 PRICE_NOT_FOUND）就地展示领域中文 message 且零变更。

/** 报价启用开关：role="switch" 的可访问开关（文字 + 颜色，不只靠颜色，§11） */
function QuoteSwitch({
  row,
  checked,
  disabled,
  pending,
  onToggle,
}: {
  row: FxPoolRow;
  checked: boolean;
  disabled: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`报价启用 ${row.pairId} ${row.channelName}`}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-emerald-500' : 'bg-zinc-300',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className={cn('text-xs', checked ? 'text-emerald-700' : 'text-muted-foreground')}>
        {pending ? '保存中…' : checked ? '开启' : '关闭'}
      </span>
    </span>
  );
}

export function FxPoolPage() {
  const rows = useFxPoolRows();
  const { pendingKey, collect, collectAll, setQuoteEnabled } = useFxPoolActions();
  const at = useNowTick();
  /** 行级失败信息（领域中文 message，就地展示；下次成功即清除） */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const busy = pendingKey !== null;
  const pricedRowCount = rows.filter((row) => row.rawPrice !== null).length;

  const clearRowError = (key: string) => {
    setRowErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleCollect = async (row: FxPoolRow) => {
    const key = poolRowKey(row.pairId, row.channelId);
    const result = await collect(row.pairId, row.channelId);
    if (!result.ok) {
      setRowErrors((prev) => ({ ...prev, [key]: result.message }));
      toast.error(result.message);
      return;
    }
    clearRowError(key);
    toast.success(`已采集 ${row.pairId} · ${row.channelName}`);
  };

  const handleCollectAll = async () => {
    const result = await collectAll();
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setRowErrors({});
    toast.success(`全部采集完成：${pricedRowCount} 条渠道价格已按同一步长推进`);
  };

  const handleToggleQuote = async (row: FxPoolRow, next: boolean) => {
    const key = poolRowKey(row.pairId, row.channelId);
    const result = await setQuoteEnabled(row.pairId, row.channelId, next);
    if (!result.ok) {
      setRowErrors((prev) => ({ ...prev, [key]: result.message }));
      toast.error(result.message);
      return;
    }
    clearRowError(key);
  };

  const columns: DataTableColumn<FxPoolRow>[] = [
    {
      key: 'pair',
      header: '币对',
      cell: (row) => <span className="font-medium">{row.pairId}</span>,
    },
    {
      key: 'channel',
      header: '渠道',
      cell: (row) => (
        <span>
          {row.channelName}
          <span className="ml-2 font-mono text-xs text-muted-foreground">{row.channelId}</span>
        </span>
      ),
    },
    {
      key: 'mid',
      header: '原始中间价',
      align: 'right',
      cell: (row) =>
        row.rawPrice === null ? (
          <span className="text-muted-foreground">暂无采集价</span>
        ) : (
          // Rate 为统一展示口径（4 位小数）；title 附 12 位有效位的落库全精度值
          <span title={`全精度：${row.rawPrice.mid}`}>
            <Rate value={row.rawPrice.mid} />
          </span>
        ),
    },
    {
      key: 'collectedAt',
      header: '采集时间',
      cell: (row) =>
        row.rawPrice === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{formatDateTime(row.rawPrice.collectedAt)}</span>
        ),
    },
    {
      key: 'quoteEnabled',
      header: '报价启用',
      cell: (row) => (
        <QuoteSwitch
          row={row}
          checked={row.rawPrice?.quoteEnabled ?? false}
          disabled={busy || row.rawPrice === null}
          pending={pendingKey === poolRowKey(row.pairId, row.channelId)}
          onToggle={(next) => {
            void handleToggleQuote(row, next);
          }}
        />
      ),
    },
    {
      key: 'validity',
      header: '有效状态',
      cell: (row) => {
        const validity = resolvePoolValidity(row.channelEnabled, row.rawPrice, at);
        const meta = POOL_VALIDITY_META[validity];
        return (
          <Badge variant="outline" className={meta.className}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: '操作',
      cell: (row) => {
        const key = poolRowKey(row.pairId, row.channelId);
        const error = rowErrors[key];
        return (
          <div className="space-y-1">
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => {
                void handleCollect(row);
              }}
            >
              {pendingKey === key ? '采集中…' : '模拟采集'}
            </Button>
            {error === undefined ? null : (
              <p className="text-xs text-rose-600" role="alert">
                {error}
              </p>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="采集池"
        description="同一币对各渠道按同一步长推进，保持渠道间价差关系；新增渠道无初始采集价，须先采集后才参与报价"
        actions={
          <Button
            disabled={busy}
            onClick={() => {
              void handleCollectAll();
            }}
          >
            {pendingKey === COLLECT_ALL_PENDING_KEY ? '采集中…' : '全部采集'}
          </Button>
        }
      />

      <p className="text-xs text-muted-foreground">
        有效状态 = 渠道启用且采集时间在 10 分钟内（实时计算）；报价启用开关仅约束客户报价选源，
        不影响平仓渠道校验（平仓要求渠道启用 + 原始价新鲜）。全部按钮均为模拟采集，仅影响之后的
        新报价，历史订单与已锁价快照不变。
      </p>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => poolRowKey(row.pairId, row.channelId)}
        empty={<p className="text-sm text-muted-foreground">暂无渠道或币对配置，请先前往渠道/币对页维护。</p>}
      />

      <p className="text-xs text-muted-foreground">
        当前共 {rows.length} 行（{pricedRowCount} 行有采集价）；采集时间与有效状态按统一时间源实时刷新。
      </p>
    </div>
  );
}
