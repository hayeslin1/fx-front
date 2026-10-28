import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { PageHeader } from '@/components/common/PageHeader';
import { PAIR_IDS } from '@/domain/constants';
import type { PairId } from '@/domain/types';
import {
  isSameOrder,
  moveItem,
  useFxRoutingCommands,
  useRoutingViews,
  type RoutingPairView,
} from '@/features/fx-routing/hooks';

// 汇率运营-路由配置（设计文档 §10.3 / PRD §5.5）：
// 按币对编辑渠道优先级——列表顺序即优先级（选源口径 §6.2 步骤 2），每行上/下移调整，
// 「保存」走 saveRouting（必须覆盖全部渠道，含停用渠道），「重置」回持久化值；
// 有未保存改动时显示“未保存”徽标并高亮保存按钮。
// 保存即生效，仅影响之后的新报价；历史订单与锁价用快照。
// 数据读写全部经 features/fx-routing/hooks（§7.2），页面不直接触达 store。

/** 路由列表行（页面投影：草稿序 + 渠道展示信息） */
interface RoutingRow {
  channelId: string;
  name: string;
  enabled: boolean;
  /** 1-based 顺序号 */
  order: number;
  /** 0-based 行下标（上/下移入参） */
  index: number;
}

export function FxRoutingPage() {
  const pairs = useRoutingViews();
  const commands = useFxRoutingCommands();
  const [selectedPair, setSelectedPair] = useState<PairId>(PAIR_IDS[0] ?? 'USD/EUR');
  // 本地草稿序（按币对分别保存：切换币对不丢失未保存改动；无草稿即用持久化值）
  const [drafts, setDrafts] = useState<Partial<Record<PairId, string[]>>>({});

  const current = pairs.find((item) => item.pairId === selectedPair) ?? pairs[0];
  if (current === undefined) return null; // 仅防御：PAIR_IDS 恒为五对

  const draftIdsOf = (item: RoutingPairView): string[] => drafts[item.pairId] ?? item.channelIds;
  const isDirty = (item: RoutingPairView): boolean =>
    !isSameOrder(draftIdsOf(item), item.channelIds);
  const dirty = isDirty(current);

  const rows: RoutingRow[] = draftIdsOf(current).map((channelId, index) => {
    const entry = current.entries.find((item) => item.channelId === channelId);
    return {
      channelId,
      name: entry?.name ?? channelId,
      enabled: entry?.enabled ?? false,
      order: index + 1,
      index,
    };
  });

  /** 上/下移：只重排本地草稿（保存前不影响持久化与报价） */
  const move = (pairId: PairId, index: number, delta: -1 | 1) => {
    setDrafts((prev) => {
      const persisted = pairs.find((item) => item.pairId === pairId)?.channelIds ?? [];
      const base = prev[pairId] ?? persisted;
      return { ...prev, [pairId]: moveItem(base, index, delta) };
    });
  };

  /** 重置：丢弃本地草稿，回到已保存的持久化顺序 */
  const handleReset = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[current.pairId];
      return next;
    });
    toast.success(`${current.pairId} 已重置为已保存的路由`);
  };

  /** 保存：整对提交（顺序即优先级，必须覆盖全部渠道） */
  const handleSave = async () => {
    const result = await commands.saveRouting(current.pairId, draftIdsOf(current));
    if (!result.ok) {
      // 领域服务失败零变更：仅提示，草稿保留供继续调整
      toast.error(result.message);
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[current.pairId];
      return next;
    });
    toast.success(
      `${result.data.routing.pairId} 路由已保存；保存即生效，仅影响之后的新报价，历史订单与锁价用快照`,
    );
  };

  const columns: DataTableColumn<RoutingRow>[] = [
    { key: 'order', header: '优先级', align: 'center', cell: (row) => row.order },
    {
      key: 'channel',
      header: '渠道',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span>{row.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{row.channelId}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <span className={row.enabled ? 'text-emerald-600' : 'text-muted-foreground'}>
          {row.enabled ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (row) => (
        <span className="flex justify-end gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={row.index === 0 || commands.pending}
            onClick={() => move(current.pairId, row.index, -1)}
          >
            上移
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={row.index === rows.length - 1 || commands.pending}
            onClick={() => move(current.pairId, row.index, 1)}
          >
            下移
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="路由配置"
        description="按币对维护渠道优先级；列表顺序即优先级，满足「渠道启用 && ≤10 分钟新鲜」的渠道按序被选中。"
      />

      <div role="group" aria-label="币对切换" className="flex flex-wrap items-center gap-2">
        {pairs.map((item) => (
          <Button
            key={item.pairId}
            type="button"
            size="sm"
            variant={item.pairId === current.pairId ? 'default' : 'outline'}
            aria-pressed={item.pairId === current.pairId}
            onClick={() => setSelectedPair(item.pairId)}
          >
            <span className="tabular-nums">{item.pairId}</span>
            {isDirty(item) ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                未保存
              </Badge>
            ) : null}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="tabular-nums">{current.pairId} 渠道优先级</CardTitle>
          <CardDescription>
            上/下移调整顺序后点击「保存」生效；重置可放弃未保存的改动。全部渠道均须在列表中（含停用渠道）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable columns={columns} rows={rows} rowKey={(row) => row.channelId} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={dirty ? 'default' : 'outline'}
              disabled={!dirty || commands.pending}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || commands.pending}
              onClick={handleReset}
            >
              重置
            </Button>
            {dirty ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                未保存
              </Badge>
            ) : null}
            {commands.pending ? (
              <span className="text-xs text-muted-foreground">正在提交…</span>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            保存即生效，仅影响之后的新报价；历史订单与锁价用快照。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
