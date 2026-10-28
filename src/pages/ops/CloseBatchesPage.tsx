import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PAIR_IDS } from '@/domain/constants';
import { fmtMoney, fmtRate } from '@/domain/money';
import type { CloseBatch, PairId, SimulatedResult } from '@/domain/types';
import { formatDateTime } from '@/lib/format';
import {
  PNL_SOURCE_LABELS,
  PLATFORM_SIDE_LABELS,
  SIMULATED_RESULT_LABELS,
  useAvailableChannels,
  useCloseBatchCommands,
  useCloseBatchViews,
  usePairExposure,
  type CloseBatchView,
} from '@/features/close-batches/hooks';

// 交易管理-平仓（设计文档 §10.3 / PRD §5.3）：
// 新建批次（金额/渠道/模拟结果 → 二次确认 → 领域服务校验并锁价）、
// 失败批次整批重试（弹层预填原参数，渠道与价格重新校验并重新锁定）、
// 批次展开详情（尝试列表 + 渠道平仓分配明细 + 收益影响汇总）。
// 数据读写全部经 features/close-batches/hooks（§7.2），页面不直接触达 store。

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

const DEFAULT_PAIR: PairId = PAIR_IDS[0] ?? 'USD/EUR';

export function CloseBatchesPage() {
  const batches = useCloseBatchViews();
  const commands = useCloseBatchCommands();

  // ---------- 新建平仓表单 ----------
  const [pairId, setPairId] = useState<PairId>(DEFAULT_PAIR);
  const [amount, setAmount] = useState('');
  const [channelId, setChannelId] = useState('');
  const [simulatedResult, setSimulatedResult] = useState<SimulatedResult>('SUCCESS');
  const [failReason, setFailReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const exposure = usePairExposure(pairId);
  const channels = useAvailableChannels(pairId);
  // 切换币对后原渠道若不可用则回退首位可用渠道（服务仍会在提交时复校验）
  const effectiveChannelId = channels.some((channel) => channel.id === channelId)
    ? channelId
    : (channels[0]?.id ?? '');
  const effectiveChannelName =
    channels.find((channel) => channel.id === effectiveChannelId)?.name ?? '—';

  const handleCreateConfirm = async () => {
    setFormError(null);
    const result = await commands.create({
      pairId,
      usdAmount: amount.trim(),
      channelId: effectiveChannelId,
      simulatedResult,
      failReason,
    });
    if (!result.ok) {
      // 领域服务失败零变更：就地把中文错误码文案展示在表单内
      setFormError(result.message);
      toast.error(result.message);
      return;
    }
    toast.success(
      `平仓批次 ${result.data.id} 已创建（${SIMULATED_RESULT_LABELS[result.data.status]}）`,
    );
    setAmount('');
    setFailReason('');
  };

  // ---------- 失败批次整批重试 ----------
  const [retryBatch, setRetryBatch] = useState<CloseBatch | null>(null);
  const [retryChannelId, setRetryChannelId] = useState('');
  const [retryResult, setRetryResult] = useState<SimulatedResult>('SUCCESS');
  const [retryFailReason, setRetryFailReason] = useState('');
  const [retryError, setRetryError] = useState<string | null>(null);

  const retryPairId = retryBatch?.pairId ?? DEFAULT_PAIR;
  const retryChannels = useAvailableChannels(retryPairId);
  // 预填原渠道；若已失效则回退首位当前可用渠道，提交时服务再次校验并重新锁价
  const retryEffectiveChannelId = retryChannels.some((channel) => channel.id === retryChannelId)
    ? retryChannelId
    : retryBatch !== null && retryChannels.some((channel) => channel.id === retryBatch.channelId)
      ? retryBatch.channelId
      : (retryChannels[0]?.id ?? '');

  const openRetry = (batch: CloseBatch) => {
    setRetryBatch(batch);
    setRetryChannelId(batch.channelId);
    setRetryResult('SUCCESS');
    setRetryFailReason('');
    setRetryError(null);
  };

  const handleRetryConfirm = async () => {
    if (retryBatch === null) return;
    setRetryError(null);
    const result = await commands.retry(retryBatch.id, {
      channelId: retryEffectiveChannelId,
      simulatedResult: retryResult,
      failReason: retryFailReason,
    });
    if (!result.ok) {
      setRetryError(result.message);
      toast.error(result.message);
      return;
    }
    toast.success(
      `批次 ${result.data.id} 重试已提交（${SIMULATED_RESULT_LABELS[result.data.status]}）`,
    );
    setRetryBatch(null);
  };

  // ---------- 批次详情展开 ----------
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="渠道平仓"
        description="按币对提交 USD 净敞口平仓；成功尝试按 FIFO 冲减敞口并向收益单分配损益，失败尝试零变更且可整批重试"
      />

      {/* ---------- 批次列表 ---------- */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>批次号</TableHead>
              <TableHead>币对</TableHead>
              <TableHead>方向</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">尝试次数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>失败原因</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((view) => (
              <Fragment key={view.batch.id}>
                <TableRow>
                  <TableCell className="font-mono text-xs">{view.batch.id}</TableCell>
                  <TableCell>{view.batch.pairId}</TableCell>
                  <TableCell>{PLATFORM_SIDE_LABELS[view.batch.side]}</TableCell>
                  <TableCell className="text-right">
                    <Money value={view.batch.usdAmount} currency="USD" />
                  </TableCell>
                  <TableCell>{view.channelName}</TableCell>
                  <TableCell>
                    <StatusBadge status={view.batch.status} />
                  </TableCell>
                  <TableCell className="text-right">{view.attemptCount} 次</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(view.batch.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-44 text-xs text-rose-600">
                    {view.batch.status === 'FAILED' ? (view.failReason ?? '—') : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {view.batch.status === 'FAILED' ? (
                        <Button variant="outline" size="xs" onClick={() => openRetry(view.batch)}>
                          整批重试
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={expandedBatchId === view.batch.id}
                        onClick={() =>
                          setExpandedBatchId(
                            expandedBatchId === view.batch.id ? null : view.batch.id,
                          )
                        }
                      >
                        {expandedBatchId === view.batch.id ? '收起详情' : '查看详情'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedBatchId === view.batch.id ? (
                  <TableRow>
                    <TableCell colSpan={10} className="bg-muted/40">
                      <BatchDetails view={view} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ---------- 新建平仓 ---------- */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">新建平仓</CardTitle>
          <CardDescription>
            平仓方向自动与净敞口相反；提交时按所选渠道最新原始价锁定执行价，成功尝试按 FIFO
            冲减敞口并分配损益
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              当前可平金额（{pairId} · 方向 {PLATFORM_SIDE_LABELS[exposure.side]}）
            </span>
            <Money value={exposure.closeableUsd} currency="USD" className="font-medium" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="close-pair">币对</Label>
              <select
                id="close-pair"
                disabled={commands.pending}
                value={pairId}
                onChange={(event) => setPairId(event.target.value as PairId)}
                className={SELECT_CLASS}
              >
                {PAIR_IDS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="close-amount">平仓金额（USD，最多 2 位小数）</Label>
              <Input
                id="close-amount"
                inputMode="decimal"
                autoComplete="off"
                disabled={commands.pending}
                placeholder="不超过可平金额，如 300.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="close-channel">渠道（仅启用且 10 分钟内有原始价）</Label>
              {channels.length === 0 ? (
                <>
                  <select id="close-channel" disabled value="" className={SELECT_CLASS}>
                    <option value="">暂无可用渠道</option>
                  </select>
                  <p className="text-xs text-rose-600">
                    该币对当前无可用渠道：需渠道启用且存在 10 分钟内的原始价。
                  </p>
                </>
              ) : (
                <select
                  id="close-channel"
                  disabled={commands.pending}
                  value={effectiveChannelId}
                  onChange={(event) => setChannelId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}（{channel.id} · 锁价基准 {fmtRate(channel.mid)}）
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">模拟结果（提交前显式选择）</span>
              <div className="flex h-8 items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    id="close-result-success"
                    type="radio"
                    name="close-result"
                    value="SUCCESS"
                    checked={simulatedResult === 'SUCCESS'}
                    disabled={commands.pending}
                    onChange={() => setSimulatedResult('SUCCESS')}
                  />
                  模拟成功
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    id="close-result-failed"
                    type="radio"
                    name="close-result"
                    value="FAILED"
                    checked={simulatedResult === 'FAILED'}
                    disabled={commands.pending}
                    onChange={() => setSimulatedResult('FAILED')}
                  />
                  模拟失败
                </label>
              </div>
            </div>
          </div>

          {simulatedResult === 'FAILED' ? (
            <div className="space-y-2">
              <Label htmlFor="close-fail-reason">失败原因（模拟失败必填，PRD §5.3 审计要求）</Label>
              <Input
                id="close-fail-reason"
                disabled={commands.pending}
                placeholder="如：下游渠道模拟超时"
                value={failReason}
                onChange={(event) => setFailReason(event.target.value)}
              />
            </div>
          ) : null}

          {formError ? (
            <p role="alert" className="text-xs text-rose-600">
              {formError}
            </p>
          ) : null}

          <Button type="button" disabled={commands.pending} onClick={() => setConfirmOpen(true)}>
            {commands.pending ? '提交中…' : '提交平仓'}
          </Button>
        </CardContent>
      </Card>

      {/* ---------- 新建平仓二次确认（PRD §5.3） ---------- */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认提交平仓批次？"
        description={
          <>
            {pairId} · 方向 {PLATFORM_SIDE_LABELS[exposure.side]} · 金额{' '}
            {amount.trim() === '' ? '—' : fmtMoney(amount.trim(), 'USD')} · 渠道{' '}
            {effectiveChannelName} · 结果 {SIMULATED_RESULT_LABELS[simulatedResult]}
            <br />
            提交后将按该渠道最新原始价锁定执行价并按 FIFO 冲减敞口；失败尝试不改变敞口与收益。
          </>
        }
        confirmText="确认提交"
        onConfirm={() => {
          void handleCreateConfirm();
        }}
      />

      {/* ---------- 整批重试弹层（预填原参数，渠道与价格重新校验并重新锁定） ---------- */}
      <AlertDialog
        open={retryBatch !== null}
        onOpenChange={(open) => {
          if (!open) setRetryBatch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>整批重试 {retryBatch?.id ?? ''}</AlertDialogTitle>
            <AlertDialogDescription>
              金额与币对沿用原批次（
              {retryBatch === null ? '—' : fmtMoney(retryBatch.usdAmount, 'USD')} · {retryPairId}
              ）；渠道与价格将在提交时重新校验并重新锁定，原渠道失效时请改选可用渠道。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-left">
            <div className="space-y-2">
              <Label htmlFor="retry-channel">渠道（当前可用）</Label>
              {retryChannels.length === 0 ? (
                <select id="retry-channel" disabled value="" className={SELECT_CLASS}>
                  <option value="">暂无可用渠道</option>
                </select>
              ) : (
                <select
                  id="retry-channel"
                  disabled={commands.pending}
                  value={retryEffectiveChannelId}
                  onChange={(event) => setRetryChannelId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  {retryChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}（{channel.id} · 锁价基准 {fmtRate(channel.mid)}）
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">模拟结果（每次尝试显式选择）</span>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="retry-result"
                    value="SUCCESS"
                    checked={retryResult === 'SUCCESS'}
                    disabled={commands.pending}
                    onChange={() => setRetryResult('SUCCESS')}
                  />
                  模拟成功
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="retry-result"
                    value="FAILED"
                    checked={retryResult === 'FAILED'}
                    disabled={commands.pending}
                    onChange={() => setRetryResult('FAILED')}
                  />
                  模拟失败
                </label>
              </div>
            </div>

            {retryResult === 'FAILED' ? (
              <div className="space-y-2">
                <Label htmlFor="retry-fail-reason">失败原因（模拟失败必填）</Label>
                <Input
                  id="retry-fail-reason"
                  disabled={commands.pending}
                  placeholder="如：下游渠道模拟超时"
                  value={retryFailReason}
                  onChange={(event) => setRetryFailReason(event.target.value)}
                />
              </div>
            ) : null}

            {retryError ? (
              <p role="alert" className="text-xs text-rose-600">
                {retryError}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={commands.pending || retryEffectiveChannelId === ''}
              onClick={(event) => {
                // 阻止 Action 默认关闭：失败时留在弹层内就地展示错误
                event.preventDefault();
                void handleRetryConfirm();
              }}
            >
              {commands.pending ? '重试中…' : '确认重试'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 批次展开详情（PRD §5.3）：尝试列表 + 分配明细（refId=attemptId）+ 收益影响汇总 */
function BatchDetails({ view }: { view: CloseBatchView }) {
  const allocationRows = view.attempts.flatMap((item) =>
    item.allocations.map((allocation) => ({ attempt: item.attempt, allocation })),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          尝试列表（每次尝试独立锁定价格快照，失败不记账）
        </p>
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>序号</TableHead>
                <TableHead>渠道</TableHead>
                <TableHead className="text-right">锁定 mid</TableHead>
                <TableHead>采集时间</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>失败原因</TableHead>
                <TableHead>执行时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.attempts.map(({ attempt, channelName }) => (
                <TableRow key={attempt.id}>
                  <TableCell>第 {attempt.index} 次</TableCell>
                  <TableCell>{channelName}</TableCell>
                  <TableCell className="text-right">
                    <Rate value={attempt.lockedMid} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(attempt.priceCollectedAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={attempt.status} />
                  </TableCell>
                  <TableCell className="max-w-44 text-xs text-rose-600">
                    {attempt.failReason ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(attempt.executedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {allocationRows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            分配明细（渠道平仓按 FIFO 逐段冲减，损益 100% 归属对应收益单）
          </p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>尝试</TableHead>
                  <TableHead>归属收益单</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="text-right">归属 USD</TableHead>
                  <TableHead className="text-right">建仓价</TableHead>
                  <TableHead className="text-right">平仓价</TableHead>
                  <TableHead className="text-right">损益</TableHead>
                  <TableHead className="text-right">分摊</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocationRows.map(({ attempt, allocation }) => (
                  <TableRow key={allocation.id}>
                    <TableCell>第 {attempt.index} 次</TableCell>
                    <TableCell className="font-mono text-xs">{allocation.profitOrderId}</TableCell>
                    <TableCell>{PNL_SOURCE_LABELS[allocation.source]}</TableCell>
                    <TableCell className="text-right">
                      <Money value={allocation.usdMatched} currency="USD" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Rate value={allocation.openMid} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Rate value={allocation.closeMid} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={allocation.pnl} currency={allocation.currency} signed />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={allocation.share} currency={allocation.currency} signed />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">收益影响汇总</p>
        {view.pnlImpact.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无收益影响（失败尝试不产生损益；成功尝试按报价币分币种累计，不同报价币不可相加）。
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-3 text-xs">
            {view.pnlImpact.map((item) => (
              <Money
                key={item.currency}
                value={item.share}
                currency={item.currency}
                signed
                className="font-medium"
              />
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
