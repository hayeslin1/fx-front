import { useMemo } from 'react';
import { getQuote, type NoQuoteReason } from '@/domain/pricing';
import type { PairId, Quote, TradeDirection } from '@/domain/types';
import {
  CHANNEL_DIAG_REASON_LABELS,
  NO_QUOTE_REASON_LABELS,
  channelNameOf,
} from '@/features/exchange/labels';
import { now } from '@/lib/clock';
import { useAppStore } from '@/store';

// 报价计算器 feature 薄 hooks（设计文档 §7.2）：store 读取全部收敛在本文件，页面不直接触达 store。
// 与兑换 feature 的关键差异：计算器只做“试算”——直接调用纯函数 getQuote，
// 既不写 ui.quote（不产生锁价），也不经 store.apply（不产生任何事实变更）。

/** 逐渠道诊断行（渠道名 + 中文原因，供「无有效报价」时展示，PRD §4.1） */
export interface CalculatorDiagnostic {
  channelId: string;
  channelName: string;
  /** 中文原因：渠道已停用 / 报价开关已停用 / 暂无采集价 / 采集价已过期（超过 10 分钟）/ 不在路由 */
  reasonLabel: string;
}

/** 试算结果：成功携带报价快照与选中渠道展示名；失败携带中文原因与逐渠道诊断 */
export type CalculatorResult =
  | { ok: true; quote: Quote; channelName: string }
  | { ok: false; reason: NoQuoteReason; reasonLabel: string; diagnostics: CalculatorDiagnostic[] };

/**
 * 按当前运营配置试算客户报价（输入即算）。
 * 金额为空串时不发起计算（返回 null，页面展示引导文案）；
 * 结果随 facts（币对/渠道/采集价/路由/加点）变更自动重算——本页没有“取价后 30 秒锁价”语义，
 * 因为计算器只读：不缓存快照、不落库、不影响任何账户数据。
 */
export function useCalculatorQuote(
  pairId: PairId,
  direction: TradeDirection,
  sourceAmount: string,
): CalculatorResult | null {
  const data = useAppStore((state) => state.data);

  return useMemo(() => {
    if (sourceAmount === '') return null;
    const channels = data.fxConfig.channels;
    const result = getQuote(data.fxConfig, { pairId, direction, sourceAmount }, now());
    if (result.ok) {
      return {
        ok: true,
        quote: result.quote,
        channelName: channelNameOf(channels, result.quote.channelId),
      };
    }
    return {
      ok: false,
      reason: result.reason,
      reasonLabel: NO_QUOTE_REASON_LABELS[result.reason],
      diagnostics: result.diagnostics.map((diag) => ({
        channelId: diag.channelId,
        channelName: channelNameOf(channels, diag.channelId),
        reasonLabel: CHANNEL_DIAG_REASON_LABELS[diag.reason],
      })),
    };
  }, [data, pairId, direction, sourceAmount]);
}
