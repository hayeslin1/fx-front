import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import {
  enabledStatusLabel,
  useFxPairCommands,
  useFxPairsView,
  type FxPairRow,
} from '@/features/fx-channels/hooks';

// 汇率运营-币对管理（设计文档 §10.3「汇率运营」段、PRD §5.5）：
// 五组 USD 枢纽币对（USD/EUR、USD/GBP、USD/JPY、USD/CNH、USD/HKD）的启停开关（togglePair）；
// 停用后双向不可报价，启用/停用即时影响之后的新报价；历史订单与既有锁价使用成交快照，不受影响。
// 数据读写全部经 features/fx-channels/hooks（§7.2），页面不直接触达 store。

/** 状态徽标配色（文字 + 颜色双通道，不靠颜色单独表意） */
const STATUS_BADGE_CLASS = {
  enabled: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  disabled: 'border-zinc-200 bg-zinc-50 text-zinc-600',
} as const;

function PairStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[enabled ? 'enabled' : 'disabled']}>
      {enabledStatusLabel(enabled)}
    </Badge>
  );
}

export function FxPairsPage() {
  const { rows } = useFxPairsView();
  const commands = useFxPairCommands();

  const handleToggle = async (row: FxPairRow) => {
    const nextEnabled = !row.pair.enabled;
    const result = await commands.togglePair(row.pair.id, nextEnabled);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    // 停用即提示「停用后双向不可报价」（PRD §5.5）
    toast.success(
      nextEnabled
        ? `${row.pair.id} 已启用，可双向报价`
        : `${row.pair.id} 已停用，停用后双向不可报价`,
    );
  };

  const columns: DataTableColumn<FxPairRow>[] = [
    {
      key: 'pairId',
      header: '币对',
      cell: (row) => <span className="font-medium">{row.pair.id}</span>,
    },
    {
      key: 'baseCurrency',
      header: '基础币',
      cell: (row) => <span>{row.baseCurrency}</span>,
    },
    {
      key: 'quoteCurrency',
      header: '报价币',
      cell: (row) => <span>{row.quoteCurrency}</span>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => <PairStatusBadge enabled={row.pair.enabled} />,
    },
    {
      key: 'toggle',
      header: '启停开关',
      cell: (row) => (
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            role="switch"
            aria-label={`${row.pair.id} 启停开关`}
            className="peer sr-only"
            disabled={commands.pending}
            checked={row.pair.enabled}
            onChange={() => void handleToggle(row)}
          />
          <span
            aria-hidden="true"
            className="h-5 w-9 rounded-full bg-zinc-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-disabled:opacity-50"
          />
        </label>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="币对管理"
        description="停用后双向不可报价；配置保存仅影响新报价（历史订单与既有锁价用成交快照）"
      />

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          共 {rows.length} 组 USD 枢纽币对（1 USD = R 报价币；启停开关即时生效于之后的新报价）
        </p>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.pair.id}
          empty={<EmptyState title="暂无币对" description="USD 枢纽币对由系统预置，不应为空。" />}
        />
      </div>
    </div>
  );
}
