import { useMemo, useState, type ReactNode } from 'react';
import { ChartColumn, Table2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PairExposure } from '@/domain/ledger';
import { D, fmtMoney } from '@/domain/money';
import { formatDateTime } from '@/lib/format';
import type {
  OverviewPoint,
  OverviewRange,
  OverviewRangeType,
  QuoteHealthRow,
  QuoteHealthStatus,
} from '@/store/selectors';
import {
  DEFAULT_OVERVIEW_RANGE_TYPE,
  EXPOSURE_SIDE_META,
  OVERVIEW_RANGE_PRESETS,
  QUOTE_STATUS_META,
  buildCustomRange,
  dayKeyToDisplay,
  describeRange,
  formatFreshness,
  rangeDateInputs,
  useOverviewSummary,
  usePairExposures,
  useQuoteHealth,
} from '@/features/overview/hooks';

// 业务总览（设计文档 §10.3 / PRD §5.1）：一行筛选 → KPI → 趋势图（图表/数据表）→ 五币对敞口 → 报价健康。
// store 读取全部收敛在 features/overview/hooks（§7.2），本页不直接 import useAppStore；
// 筛选是页面本地临时态（§7.1 ui 语义），不写入 store，也不影响敞口/报价健康快照。

const CHART_CONFIG = {
  volume: { label: '成交额（USD）', color: 'var(--chart-1)' },
} satisfies ChartConfig;

type OverviewView = 'CHART' | 'TABLE';

/** 图表数据点：几何与刻度只能用 number；金额真值口径仍是 Decimal 字符串（KPI/数据表用 Money 渲染） */
interface ChartPoint {
  dayKey: string;
  label: string;
  volume: number;
  orderCount: number;
}

const SERIES_COLUMNS: DataTableColumn<OverviewPoint>[] = [
  {
    key: 'day',
    header: '日期',
    cell: (row) => <span className="tabular-nums">{dayKeyToDisplay(row.dayKey)}</span>,
  },
  {
    key: 'volume',
    header: '成交额（USD）',
    align: 'right',
    cell: (row) => <Money value={row.volumeUsd} currency="USD" />,
  },
  {
    key: 'orders',
    header: '成功订单数',
    align: 'right',
    cell: (row) => <span className="tabular-nums">{row.orderCount}</span>,
  },
];

const QUOTE_COLUMNS: DataTableColumn<QuoteHealthRow>[] = [
  {
    key: 'pair',
    header: '币对',
    cell: (row) => <span className="font-medium">{row.pairId}</span>,
  },
  {
    key: 'channel',
    header: '选中渠道',
    cell: (row) =>
      row.selectedChannelName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    key: 'collectedAt',
    header: '采集时间',
    cell: (row) =>
      row.collectedAt === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{formatDateTime(row.collectedAt)}</span>
      ),
  },
  {
    key: 'freshness',
    header: '剩余新鲜度',
    align: 'right',
    cell: (row) =>
      row.selectedChannelId === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{formatFreshness(row.remainingMs)}</span>
      ),
  },
  {
    key: 'status',
    header: '状态',
    cell: (row) => <QuoteStatusBadge status={row.status} fallback={row.fallback} />,
  },
];

/** 状态徽标：文字 + 图标 + 颜色三通道（§10.4 禁止只靠颜色）；「回退」补充命中非首位渠道的说明 */
function QuoteStatusBadge({ status, fallback }: { status: QuoteHealthStatus; fallback: boolean }) {
  const meta = QUOTE_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={meta.className}
      title={fallback ? '命中非首位渠道（回退）' : undefined}
    >
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </Badge>
  );
}

/** KPI 卡：区间成交额（Money 渲染）与成功订单数 */
function KpiCard({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

/** 单币对敞口快照卡：方向（多/空/持平）+ 净 USD + 可平金额（FLAT 显示 0 与「持平」） */
function ExposureCard({ exposure }: { exposure: PairExposure }) {
  const side = EXPOSURE_SIDE_META[exposure.side];
  const flat = exposure.side === 'FLAT';
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{exposure.pairId}</CardTitle>
        <CardAction>
          <Badge variant="outline" className={side.className}>
            {side.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">净敞口</span>
          <Money value={exposure.netUsd} currency="USD" signed={!flat} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">可平金额</span>
          {flat ? (
            <span className="tabular-nums text-muted-foreground">无可平敞口</span>
          ) : (
            <Money value={exposure.closeableUsd} currency="USD" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  // 生效区间（仅合法区间会写入）与自定义输入的草稿：非法时保留上次有效区间，即“非法不查询”
  const [range, setRange] = useState<OverviewRange>(() => ({ type: DEFAULT_OVERVIEW_RANGE_TYPE }));
  const [customFrom, setCustomFrom] = useState(
    () => rangeDateInputs({ type: DEFAULT_OVERVIEW_RANGE_TYPE }).from,
  );
  const [customTo, setCustomTo] = useState(
    () => rangeDateInputs({ type: DEFAULT_OVERVIEW_RANGE_TYPE }).to,
  );
  const [customError, setCustomError] = useState<string | null>(null);
  const [view, setView] = useState<OverviewView>('CHART');

  const summary = useOverviewSummary(range);
  const exposures = usePairExposures();
  const quoteHealth = useQuoteHealth();

  const chartPoints: ChartPoint[] = useMemo(
    () =>
      summary.series.map((point) => ({
        dayKey: point.dayKey,
        label: point.label,
        volume: D(point.volumeUsd).toNumber(),
        orderCount: point.orderCount,
      })),
    [summary.series],
  );

  // WHY 预设切换同步日期输入：让「预设 → 自定义微调」从当前区间平滑续接，无需重填日期
  const applyPreset = (type: OverviewRangeType): void => {
    const next: OverviewRange = { type };
    setRange(next);
    const inputs = rangeDateInputs(next);
    setCustomFrom(inputs.from);
    setCustomTo(inputs.to);
    setCustomError(null);
  };

  const applyCustomDates = (from: string, to: string): void => {
    setCustomFrom(from);
    setCustomTo(to);
    const result = buildCustomRange(from, to);
    if (!result.ok) {
      setCustomError(result.message);
      return;
    }
    setCustomError(null);
    setRange(result.range);
  };

  const customActive = range.type === 'CUSTOM';

  return (
    <div className="space-y-4">
      <PageHeader
        title="业务总览"
        description="成交额与订单趋势按所选区间统计（USD 折算）；下方五币对敞口与报价健康为当前快照，不受筛选影响。"
      />

      {/* 一行筛选：今日 / 近 7 天 / 近 30 天 / 自定义区间（起止含当天，end ≥ start 校验） */}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="space-y-1.5">
            <span id="overview-range-label" className="text-xs font-medium text-muted-foreground">
              统计区间
            </span>
            <div
              role="group"
              aria-labelledby="overview-range-label"
              className="flex flex-wrap items-center gap-1.5"
            >
              {OVERVIEW_RANGE_PRESETS.map((preset) => {
                const active = range.type === preset.type;
                return (
                  <Button
                    key={preset.type}
                    type="button"
                    size="sm"
                    variant={active ? 'secondary' : 'outline'}
                    aria-pressed={active}
                    onClick={() => applyPreset(preset.type)}
                  >
                    {preset.label}
                  </Button>
                );
              })}
              <Button
                type="button"
                size="sm"
                variant={customActive ? 'secondary' : 'outline'}
                aria-pressed={customActive}
                onClick={() => applyCustomDates(customFrom, customTo)}
              >
                自定义
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="overview-date-from" className="text-xs text-muted-foreground">
              自定义区间（起止含当天）
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="overview-date-from"
                type="date"
                className="w-36"
                value={customFrom}
                aria-invalid={customError !== null}
                aria-describedby={customError === null ? undefined : 'overview-custom-error'}
                onChange={(event) => applyCustomDates(event.target.value, customTo)}
              />
              <span className="text-xs text-muted-foreground">至</span>
              <Input
                id="overview-date-to"
                type="date"
                className="w-36"
                value={customTo}
                aria-invalid={customError !== null}
                aria-describedby={customError === null ? undefined : 'overview-custom-error'}
                onChange={(event) => applyCustomDates(customFrom, event.target.value)}
              />
            </div>
            {customError !== null ? (
              <p id="overview-custom-error" role="alert" className="text-xs text-rose-600">
                {customError}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* KPI：区间成交额 + 成功订单数（筛选仅作用于此处与趋势） */}
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          label="区间成交额（USD 折算）"
          value={<Money value={summary.volumeUsd} currency="USD" />}
          hint="口径：区间内成功订单的 USD 腿合计，买卖双向均计入"
        />
        <KpiCard
          label="成功订单数"
          value={`${summary.orderCount} 笔`}
          hint="区间内成功兑换订单笔数（含双方自然对冲）"
        />
      </div>

      {/* 趋势图：shadcn Chart + Recharts 单系列；「图表/数据表」为等价信息源 */}
      <Card>
        <CardHeader>
          <CardTitle>成交额趋势（按日）</CardTitle>
          <CardDescription>
            {`${describeRange(range)} · 筛选仅作用于成交额/订单数，不影响敞口与报价健康`}
          </CardDescription>
          <CardAction>
            <div role="group" aria-label="趋势视图切换" className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={view === 'CHART' ? 'secondary' : 'outline'}
                aria-pressed={view === 'CHART'}
                onClick={() => setView('CHART')}
              >
                <ChartColumn className="size-3.5" aria-hidden />
                图表
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === 'TABLE' ? 'secondary' : 'outline'}
                aria-pressed={view === 'TABLE'}
                onClick={() => setView('TABLE')}
              >
                <Table2 className="size-3.5" aria-hidden />
                数据表
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.orderCount === 0 ? (
            <p className="text-xs text-muted-foreground">所选区间暂无成交订单，按日趋势为零。</p>
          ) : null}
          {view === 'CHART' ? (
            <ChartContainer config={CHART_CONFIG} className="h-72 w-full">
              <LineChart
                accessibilityLayer
                data={chartPoints}
                margin={{ top: 8, right: 16, bottom: 20, left: 8 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  label={{ value: '日期（月-日）', position: 'insideBottom', offset: -12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value: number) => value.toLocaleString('en-US')}
                  label={{ value: '成交额（USD）', angle: -90, position: 'insideLeft' }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent formatter={(value) => fmtMoney(String(value), 'USD')} />
                  }
                />
                <ChartLegend content={<ChartLegendContent nameKey="volume" />} />
                <Line
                  type="monotone"
                  dataKey="volume"
                  name="成交额（USD）"
                  stroke="var(--color-volume)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <div role="region" aria-label="成交额与订单数数据表" className="space-y-2">
              <DataTable
                columns={SERIES_COLUMNS}
                rows={summary.series}
                rowKey={(row) => row.dayKey}
              />
              <p className="text-xs text-muted-foreground">
                区间合计：<Money value={summary.volumeUsd} currency="USD" />
                {` · ${summary.orderCount} 笔`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 五币对敞口快照（当前值，不受筛选影响） */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">五币对敞口快照</h2>
          <p className="text-xs text-muted-foreground">当前快照，不受上方筛选影响</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {exposures.map((exposure) => (
            <ExposureCard key={exposure.pairId} exposure={exposure} />
          ))}
        </div>
      </section>

      {/* 报价健康（当前快照，不受筛选影响） */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">报价健康</h2>
          <p className="text-xs text-muted-foreground">
            当前快照，不受上方筛选影响（渠道启用 && 报价启用 && 采集在 10 分钟内为有效）
          </p>
        </div>
        <DataTable columns={QUOTE_COLUMNS} rows={quoteHealth} rowKey={(row) => row.pairId} />
      </section>
    </div>
  );
}
