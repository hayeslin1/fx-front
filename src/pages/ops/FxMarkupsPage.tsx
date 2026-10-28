import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { PageHeader } from '@/components/common/PageHeader';
import type { PairId } from '@/domain/types';
import {
  useFxRoutingCommands,
  useMarkupRows,
  validateMarkupBps,
  type MarkupRowView,
} from '@/features/fx-routing/hooks';

// 汇率运营-加点配置（设计文档 §10.3 / PRD §5.5）：
// 五对表格＝币对 / 每侧点差 bps（数字输入，0–1000 整数，对称：bid/ask 各距原始中间价 N bps）/
// 服务费（固定 0）/ 操作（保存，仅该行）。保存走 saveMarkup；
// 非法输入就地中文错误且零变更（领域服务同样校验，双保险）。
// 保存仅影响新报价；历史订单与锁价用快照。
// 数据读写全部经 features/fx-routing/hooks（§7.2），页面不直接触达 store。

export function FxMarkupsPage() {
  const rows = useMarkupRows();
  const commands = useFxRoutingCommands();
  // 行内草稿（按币对分别保存；无草稿即用持久化值）
  const [drafts, setDrafts] = useState<Partial<Record<PairId, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<PairId, string>>>({});

  const valueOf = (row: MarkupRowView): string => drafts[row.pairId] ?? String(row.halfSpreadBps);
  const isDirty = (row: MarkupRowView): boolean => valueOf(row) !== String(row.halfSpreadBps);

  const setRowError = (pairId: PairId, error: string | null) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (error === null) delete next[pairId];
      else next[pairId] = error;
      return next;
    });
  };

  /** 输入即做前端校验：非空非法值就地中文错误；空串留到保存时提示（允许清空重输） */
  const handleChange = (pairId: PairId, raw: string) => {
    setDrafts((prev) => ({ ...prev, [pairId]: raw }));
    if (raw.trim() === '') {
      setRowError(pairId, null);
      return;
    }
    const validation = validateMarkupBps(raw);
    setRowError(pairId, validation.ok ? null : validation.error);
  };

  /** 保存该行：非法输入就地报错且零变更；成功仅更新该币对 */
  const handleSave = async (row: MarkupRowView) => {
    const validation = validateMarkupBps(valueOf(row));
    if (!validation.ok) {
      setRowError(row.pairId, validation.error);
      return;
    }
    const result = await commands.saveMarkup(row.pairId, validation.value);
    if (!result.ok) {
      setRowError(row.pairId, result.message);
      toast.error(result.message);
      return;
    }
    setRowError(row.pairId, null);
    // 保存成功后归一化草稿（如 "0100" → "100"），与持久化值一致即不再是“未保存”
    setDrafts((prev) => ({ ...prev, [row.pairId]: String(result.data.markup.halfSpreadBps) }));
    toast.success(
      `${result.data.markup.pairId} 每侧点差已保存为 ${result.data.markup.halfSpreadBps} bps（仅影响新报价）`,
    );
  };

  const columns: DataTableColumn<MarkupRowView>[] = [
    {
      key: 'pair',
      header: '币对',
      cell: (row) => <span className="tabular-nums">{row.pairId}</span>,
    },
    {
      key: 'bps',
      header: '每侧点差 bps',
      cell: (row) => (
        <span className="block space-y-1">
          <Input
            type="text"
            inputMode="numeric"
            className="w-28 text-right tabular-nums"
            value={valueOf(row)}
            aria-label={`${row.pairId} 每侧点差 bps`}
            aria-invalid={errors[row.pairId] !== undefined}
            disabled={commands.pending}
            onChange={(event) => handleChange(row.pairId, event.target.value)}
          />
          {errors[row.pairId] !== undefined ? (
            <span role="alert" className="block text-xs text-destructive">
              {errors[row.pairId]}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'fee',
      header: '服务费',
      align: 'right',
      cell: (row) => <span className="tabular-nums">{row.fee}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (row) => (
        <Button
          type="button"
          size="xs"
          variant={isDirty(row) ? 'default' : 'outline'}
          disabled={!isDirty(row) || commands.pending}
          onClick={() => void handleSave(row)}
        >
          保存
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="加点配置"
        description="对称点差：bid/ask 各距原始中间价 N bps；服务费固定 0；保存仅影响新报价。"
      />

      <Card>
        <CardHeader>
          <CardTitle>五币对点差</CardTitle>
          <CardDescription>
            每侧点差取 0–1000 的整数 bps（默认
            50）；修改后点击该行「保存」，非法输入就地提示且不改动配置。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable columns={columns} rows={rows} rowKey={(row) => row.pairId} />
          <p className="text-xs text-muted-foreground">
            客户成交价 = 原始中间价 ×（1 ∓
            bps/10000）；保存即生效，仅影响之后的新报价，历史订单与锁价用快照。
          </p>
        </CardContent>
      </Card>

      {rows.some((row) => errors[row.pairId] !== undefined) ? (
        <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700">
          有未通过校验的输入，请修正后再保存
        </Badge>
      ) : null}
    </div>
  );
}
