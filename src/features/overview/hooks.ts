import { useEffect, useMemo, useState, type ComponentType } from 'react';
import dayjs from 'dayjs';
import { CircleAlert, CircleCheck, Shuffle } from 'lucide-react';
import type { PairExposure } from '@/domain/ledger';
import { now } from '@/lib/clock';
import { formatDate } from '@/lib/format';
import { useAppStore } from '@/store';
import {
  selectLedger,
  selectOverviewSummary,
  selectQuoteHealth,
  type OverviewRange,
  type OverviewRangeType,
  type OverviewSummary,
  type QuoteHealthRow,
  type QuoteHealthStatus,
} from '@/store/selectors';

// 运营总览薄 hooks（设计文档 §7.2）：页面不直接触达 store，读取统一经本文件；
// 对接后端时只替换本文件内部实现（本地选择器 → src/api 调用），OverviewPage 不动。
// 筛选仅作用于汇总/趋势；五币对敞口与报价健康是**不受筛选影响**的当前快照（§10.3、PRD §5.1）。

// ---------- 枚举展示映射（§10.4：文案 + 图标 + 颜色集中定义，状态禁止只靠颜色表达） ----------

export const QUOTE_STATUS_META: Record<
  QuoteHealthStatus,
  { label: string; className: string; icon: ComponentType<{ className?: string }> }
> = {
  NORMAL: {
    label: '正常',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CircleCheck,
  },
  FALLBACK: {
    label: '回退',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: Shuffle,
  },
  NO_QUOTE: {
    label: '无有效报价',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
    icon: CircleAlert,
  },
};

export const EXPOSURE_SIDE_META: Record<
  PairExposure['side'],
  { label: string; className: string }
> = {
  LONG: { label: '多头', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  SHORT: { label: '空头', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  FLAT: { label: '持平', className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
};

const RANGE_LABEL: Record<OverviewRangeType, string> = {
  TODAY: '今日',
  LAST_7D: '近 7 天',
  LAST_30D: '近 30 天',
  CUSTOM: '自定义区间',
};

/** 一行筛选的预设区间（§10.3 顺序：今日/近 7 天/近 30 天；“自定义”由日期输入承担） */
export const OVERVIEW_RANGE_PRESETS: ReadonlyArray<{ type: OverviewRangeType; label: string }> = [
  { type: 'TODAY', label: '今日' },
  { type: 'LAST_7D', label: '近 7 天' },
  { type: 'LAST_30D', label: '近 30 天' },
];

/**
 * 默认区间取「近 7 天」而非「今日」：
 * WHY 预置演示成交集中在近 5 天，今日为空窗；默认给出非空看板更符合总览页用途。
 */
export const DEFAULT_OVERVIEW_RANGE_TYPE: OverviewRangeType = 'LAST_7D';

// ---------- 区间换算与校验（纯函数，node 环境可直接单测） ----------

const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** date input 值（YYYY-MM-DD）→ 当日起点毫秒；格式或日期非法返回 null */
export function parseDateInput(value: string): number | null {
  if (!DATE_INPUT_RE.test(value)) return null;
  const parsed = dayjs(value);
  // dayjs 对日期越界（如 2026-02-30）解析为 Invalid Date，isValid 兜底
  return parsed.isValid() ? parsed.startOf('day').valueOf() : null;
}

export type CustomRangeResult = { ok: true; range: OverviewRange } | { ok: false; message: string };

/**
 * 自定义区间校验 + 换算（PRD §5.1）：起止**含当天**。
 * WHY 在此收口：选择器只接受毫秒端点（store/selectors.resolveRange），
 * 「含当天 / end ≥ start」的语义只在页面侧定义一次；非法时只返回 message、不产出 range，
 * 调用方保持上一次有效区间，即“非法就地提示且不查询”。
 */
export function buildCustomRange(fromInput: string, toInput: string): CustomRangeResult {
  if (fromInput === '' || toInput === '') {
    return { ok: false, message: '请选择开始与结束日期' };
  }
  const start = parseDateInput(fromInput);
  if (start === null) return { ok: false, message: '开始日期格式不正确' };
  const endDayStart = parseDateInput(toInput);
  if (endDayStart === null) return { ok: false, message: '结束日期格式不正确' };
  if (endDayStart < start) return { ok: false, message: '结束日期不能早于开始日期' };
  return {
    ok: true,
    // 起止含当天：结束日扩到当日 23:59:59.999，订单 createdAt 落在当天即计入
    range: { type: 'CUSTOM', dateFrom: start, dateTo: dayjs(endDayStart).endOf('day').valueOf() },
  };
}

/**
 * 已解析的起止毫秒（仅用于展示换算）。
 * WHY 与 store/selectors.resolveRange 同口径重复实现：该函数未导出，本纵切不允许改选择器，
 * 若后续口径调整须两处同步。
 */
function resolvedBounds(range: OverviewRange, nowMs: number): { start: number; end: number } {
  const today = dayjs(nowMs).startOf('day');
  switch (range.type) {
    case 'TODAY':
      return { start: today.valueOf(), end: nowMs };
    case 'LAST_7D':
      return { start: today.subtract(6, 'day').valueOf(), end: nowMs };
    case 'LAST_30D':
      return { start: today.subtract(29, 'day').valueOf(), end: nowMs };
    case 'CUSTOM':
      return { start: range.dateFrom ?? nowMs, end: range.dateTo ?? nowMs };
  }
}

/** 筛选范围说明（§11.2：图表需含筛选范围说明）：标签 + 实际起止日 + 含起止当天 */
export function describeRange(range: OverviewRange, nowMs: number = now()): string {
  const { start, end } = resolvedBounds(range, nowMs);
  return `${RANGE_LABEL[range.type]}（${formatDate(start)} ~ ${formatDate(end)}，含起止当天）`;
}

/** 区间的起止日展示值（YYYY-MM-DD）：切换预设时同步自定义输入，保证从预设平滑过渡 */
export function rangeDateInputs(
  range: OverviewRange,
  nowMs: number = now(),
): { from: string; to: string } {
  const { start, end } = resolvedBounds(range, nowMs);
  return { from: formatDate(start), to: formatDate(end) };
}

/** 剩余新鲜度展示 mm:ss（10 分钟上限内足够；无有效报价传 0） */
export function formatFreshness(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 日键 YYYYMMDD → 展示日期 YYYY-MM-DD（纯字符串重排，不引入新的时间源） */
export function dayKeyToDisplay(dayKey: string): string {
  return dayKey.length === 8
    ? `${dayKey.slice(0, 4)}-${dayKey.slice(4, 6)}-${dayKey.slice(6, 8)}`
    : dayKey;
}

// ---------- 读取 hooks ----------

/**
 * 1 秒心跳的当前时间：让“剩余新鲜度”随真实时间滚动、相对区间（今日/近 N 天）的
 * 右端点保持新鲜。测试注入固定时钟时 now() 恒定，setState 同值不触发额外渲染。
 */
function useNowMs(intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return nowMs;
}

/** 区间汇总与按日趋势（筛选仅作用于此处，§7.3） */
export function useOverviewSummary(range: OverviewRange): OverviewSummary {
  const data = useAppStore((s) => s.data);
  const nowMs = useNowMs();
  return useMemo(() => selectOverviewSummary(data, range, nowMs), [data, range, nowMs]);
}

/** 五币对敞口当前快照（不受筛选影响；FLAT 表示净敞口为零，仍展示 0 与可平 0） */
export function usePairExposures(): PairExposure[] {
  const data = useAppStore((s) => s.data);
  return useMemo(() => selectLedger(data).pairExposure, [data]);
}

/** 报价健康当前快照（不受筛选影响，§10.3） */
export function useQuoteHealth(): QuoteHealthRow[] {
  const data = useAppStore((s) => s.data);
  const nowMs = useNowMs();
  return useMemo(() => selectQuoteHealth(data, nowMs), [data, nowMs]);
}
