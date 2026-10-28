import { useCallback, useMemo, useRef, useState } from 'react';
import { PAIR_IDS, PRICE_FRESH_MS, QUOTE_CCY } from '@/domain/constants';
import type { PairExposure } from '@/domain/ledger';
import { ccyDp, D, roundCcy, type Decimal } from '@/domain/money';
import {
  closeBatchCommands,
  type CloseExposureSnapshot,
} from '@/domain/services/close-batch.service';
import type {
  Channel,
  CloseAttempt,
  CloseBatch,
  Currency,
  DecimalStr,
  DomainCommand,
  DomainResult,
  PairId,
  PlatformSide,
  PnlAllocation,
  PnlSource,
  RawPrice,
  SimulatedResult,
} from '@/domain/types';
import { now } from '@/lib/clock';
import { useAppStore } from '@/store';
import {
  getLatestRawMid,
  selectLedger,
  selectPairExposure,
  selectPairLots,
} from '@/store/selectors';

// 运营端「交易管理-敞口 / 平仓」薄 hooks（设计文档 §7.2）：
// 页面组件不直接触达 store，敞口行、平仓批次视图、可平渠道与写操作全部收敛于此；
// 对接后端时仅替换本文件内部实现（本地领域服务 → src/api，§8.6），页面不动。

// ---------- 中文标签（枚举文案集中在本 feature 内，避免跨层散落） ----------

/** 平台敞口/平仓方向：多（平台 USD 多头）| 空 | 持平 */
export const PLATFORM_SIDE_LABELS: Record<PlatformSide | 'FLAT', string> = {
  LONG: '多',
  SHORT: '空',
  FLAT: '持平',
};

/** 模拟结果：提交前显式选择（PRD §5.3） */
export const SIMULATED_RESULT_LABELS: Record<SimulatedResult, string> = {
  SUCCESS: '模拟成功',
  FAILED: '模拟失败',
};

/** 分配明细来源（PRD §6.2 审计字段） */
export const PNL_SOURCE_LABELS: Record<PnlSource, string> = {
  NATURAL_HEDGE: '自然对冲',
  CHANNEL_CLOSE: '渠道平仓',
};

// ---------- 纯函数 ----------

/** 某渠道某币对最新一条原始价；同采集时间保留先出现者（与 close-batch.service 口径一致） */
function latestPriceOf(
  prices: readonly RawPrice[],
  pairId: PairId,
  channelId: string,
): RawPrice | undefined {
  let latest: RawPrice | undefined;
  for (const price of prices) {
    if (price.pairId !== pairId || price.channelId !== channelId) continue;
    if (latest === undefined || price.collectedAt > latest.collectedAt) latest = price;
  }
  return latest;
}

/** 解析正数原始价；非法/非正价格按“无有效原始价”处理，展示层不抛异常 */
function parsePositiveMid(raw: RawPrice): Decimal | null {
  try {
    const mid = D(raw.mid);
    return mid.isFinite() && mid.gt(0) ? mid : null;
  } catch {
    return null;
  }
}

/** 渠道 id → 展示名；配置缺失回退 id（本 feature 内联，避免依赖其他 feature 未提交文件） */
function channelNameOf(channels: readonly Channel[], channelId: string): string {
  return channels.find((channel) => channel.id === channelId)?.name ?? channelId;
}

/** 净敞口按最新原始中间价折算为报价币估值（按报价币精度舍入；脏价格返回 undefined） */
export function foreignValueOf(
  netUsd: DecimalStr,
  mid: DecimalStr,
  currency: Currency,
): DecimalStr | undefined {
  try {
    const value = D(netUsd).times(D(mid));
    if (!value.isFinite()) return undefined;
    return roundCcy(value, currency).toFixed(ccyDp(currency));
  } catch {
    return undefined;
  }
}

/** 服务入参需要的敞口快照投影（§6.5：服务不依赖重放引擎，快照由调用方传入） */
function exposureSnapshotOf(exposure: PairExposure): CloseExposureSnapshot {
  return { netUsd: exposure.netUsd, side: exposure.side };
}

// ---------- 敞口读取 ----------

/** 来源订单明细行（selectPairLots 的展示投影） */
export interface ExposureLotRow {
  orderId: string;
  side: PlatformSide;
  /** 多/空 中文 */
  sideLabel: string;
  usdRemaining: DecimalStr;
  /** 建仓基准价（订单成交时原始中间价） */
  openMid: DecimalStr;
}

export interface ExposureRow {
  pairId: PairId;
  side: PlatformSide | 'FLAT';
  sideLabel: string;
  netUsd: DecimalStr;
  /** |netUsd|，平仓可平上限（§6.5） */
  closeableUsd: DecimalStr;
  quoteCcy: Currency;
  /** 最新原始中间价（跨渠道按采集时间取最新；无价格 undefined） */
  mid?: DecimalStr;
  /** 对应外币估值 = 净敞口 × 最新中间价（报价币精度；无价格 undefined） */
  foreignValue?: DecimalStr;
  isFlat: boolean;
  /** 剩余敞口来源订单（FIFO 顺序） */
  lots: ExposureLotRow[];
}

/** 五币对敞口行（PRD §5.3 敞口页）：方向/净值/可平金额来自账本重放，外币估值按最新原始中间价折算 */
export function useExposureRows(): ExposureRow[] {
  const data = useAppStore((state) => state.data);
  return useMemo(
    () =>
      PAIR_IDS.map((pairId) => {
        const exposure = selectPairExposure(data, pairId);
        const quoteCcy = QUOTE_CCY[pairId];
        const mid = getLatestRawMid(data, pairId);
        const lots: ExposureLotRow[] = selectPairLots(data, pairId).map((lot) => ({
          orderId: lot.orderId,
          side: lot.side,
          sideLabel: PLATFORM_SIDE_LABELS[lot.side],
          usdRemaining: lot.usdRemaining,
          openMid: lot.openMid,
        }));
        return {
          pairId,
          side: exposure.side,
          sideLabel: PLATFORM_SIDE_LABELS[exposure.side],
          netUsd: exposure.netUsd,
          closeableUsd: exposure.closeableUsd,
          quoteCcy,
          mid,
          foreignValue:
            mid === undefined ? undefined : foreignValueOf(exposure.netUsd, mid, quoteCcy),
          isFlat: exposure.side === 'FLAT',
          lots,
        };
      }),
    [data],
  );
}

/** 单个币对当前敞口（新建平仓表单展示可平金额与自动方向） */
export function usePairExposure(pairId: PairId): PairExposure {
  const data = useAppStore((state) => state.data);
  return useMemo(() => selectPairExposure(data, pairId), [data, pairId]);
}

// ---------- 平仓批次读取 ----------

export interface CloseAttemptView {
  attempt: CloseAttempt;
  channelName: string;
  /** 与该尝试关联的渠道平仓分配明细（refId = attemptId） */
  allocations: PnlAllocation[];
}

export interface ClosePnlImpactRow {
  currency: Currency;
  /** 分摊合计（高精度字符串；展示按报价币精度舍入，不同报价币不相加） */
  share: DecimalStr;
}

export interface CloseBatchView {
  batch: CloseBatch;
  channelName: string;
  attemptCount: number;
  lastAttempt?: CloseAttempt;
  /** 最近一次尝试的失败原因（仅失败批次展示） */
  failReason?: string;
  attempts: CloseAttemptView[];
  /** 收益影响汇总（按报价币分币种累计） */
  pnlImpact: ClosePnlImpactRow[];
}

/** 平仓批次视图（PRD §5.3 列表与详情）：批次事实 + 派生账本的渠道平仓分配明细 */
export function useCloseBatchViews(): CloseBatchView[] {
  const data = useAppStore((state) => state.data);
  return useMemo(() => {
    const ledger = selectLedger(data);
    // 分配明细按 refId（成功尝试 id）归集：渠道平仓明细才属于批次审计
    const allocationsByAttempt = new Map<string, PnlAllocation[]>();
    for (const profitOrder of ledger.profitOrders) {
      for (const allocation of profitOrder.allocations) {
        if (allocation.source !== 'CHANNEL_CLOSE') continue;
        const list = allocationsByAttempt.get(allocation.refId);
        if (list === undefined) allocationsByAttempt.set(allocation.refId, [allocation]);
        else list.push(allocation);
      }
    }

    return [...data.closeBatches]
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .map((batch) => {
        const attempts: CloseAttemptView[] = batch.attempts.map((attempt) => ({
          attempt,
          channelName: channelNameOf(data.fxConfig.channels, attempt.channelId),
          allocations: allocationsByAttempt.get(attempt.id) ?? [],
        }));
        const impact = new Map<Currency, Decimal>();
        for (const item of attempts) {
          for (const allocation of item.allocations) {
            const current = impact.get(allocation.currency) ?? D(0);
            impact.set(allocation.currency, current.plus(allocation.share));
          }
        }
        const lastAttempt = batch.attempts.at(-1);
        return {
          batch,
          channelName: channelNameOf(data.fxConfig.channels, batch.channelId),
          attemptCount: batch.attempts.length,
          lastAttempt,
          failReason: batch.status === 'FAILED' ? lastAttempt?.failReason : undefined,
          attempts,
          pnlImpact: [...impact.entries()].map(([currency, share]) => ({
            currency,
            share: share.toString(),
          })),
        };
      });
  }, [data]);
}

// ---------- 可平渠道 ----------

export interface AvailableChannel {
  id: string;
  name: string;
  /** 该渠道该币对最新原始中间价 */
  mid: DecimalStr;
  collectedAt: number;
}

/**
 * 当前可用于平仓的渠道（PRD §5.3：渠道启用 && 存在该币对原始价 && 10 分钟内）。
 * 与 close-batch.service 提交校验同口径；展示快照按渲染时刻计算，
 * 提交/重试时领域服务会再次校验并锁定当时的价格快照（原渠道失效即拒绝并要求改选）。
 */
export function useAvailableChannels(pairId: PairId): AvailableChannel[] {
  const data = useAppStore((state) => state.data);
  return useMemo(() => {
    const at = now();
    const options: AvailableChannel[] = [];
    for (const channel of data.fxConfig.channels) {
      if (!channel.enabled) continue;
      const latest = latestPriceOf(data.fxConfig.rawPrices, pairId, channel.id);
      if (latest === undefined) continue;
      if (parsePositiveMid(latest) === null) continue;
      if (at - latest.collectedAt > PRICE_FRESH_MS) continue;
      options.push({
        id: channel.id,
        name: channel.name,
        mid: latest.mid,
        collectedAt: latest.collectedAt,
      });
    }
    return options;
  }, [data, pairId]);
}

// ---------- 写操作 ----------

export interface CreateCloseBatchInput {
  pairId: PairId;
  usdAmount: string;
  channelId: string;
  simulatedResult: SimulatedResult;
  failReason?: string;
}

export interface RetryCloseBatchInput {
  channelId: string;
  simulatedResult: SimulatedResult;
  failReason?: string;
}

export interface CloseBatchCommands {
  /** 提交中：禁用按钮/输入，防重复提交 */
  pending: boolean;
  create: (input: CreateCloseBatchInput) => Promise<DomainResult<CloseBatch>>;
  retry: (batchId: string, input: RetryCloseBatchInput) => Promise<DomainResult<CloseBatch>>;
}

/**
 * 平仓写操作（§7.2）：提交时从 store 读取“当前时刻”状态——
 * exposure 取 selectPairExposure 最新快照传入领域服务（§6.5 快照入参约定）；
 * 渠道启用/价格新鲜度的复校验与锁价由 close-batch.service 在提交瞬间完成。
 */
export function useCloseBatchCommands(): CloseBatchCommands {
  const apply = useAppStore((state) => state.apply);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T>(command: DomainCommand<T>): Promise<DomainResult<T>> => {
      if (pendingRef.current) {
        return { ok: false, code: 'SUBMIT_PENDING', message: '正在提交，请勿重复操作' };
      }
      pendingRef.current = true;
      setPending(true);
      try {
        return await apply(command);
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [apply],
  );

  const create = useCallback(
    async (input: CreateCloseBatchInput): Promise<DomainResult<CloseBatch>> => {
      const exposure = selectPairExposure(useAppStore.getState().data, input.pairId);
      return run(
        closeBatchCommands.createBatch({
          pairId: input.pairId,
          usdAmount: input.usdAmount,
          channelId: input.channelId,
          simulatedResult: input.simulatedResult,
          failReason: input.failReason,
          exposure: exposureSnapshotOf(exposure),
        }),
      );
    },
    [run],
  );

  const retry = useCallback(
    async (batchId: string, input: RetryCloseBatchInput): Promise<DomainResult<CloseBatch>> => {
      const data = useAppStore.getState().data;
      const batch = data.closeBatches.find((item) => item.id === batchId);
      if (batch === undefined) {
        return { ok: false, code: 'BATCH_NOT_FOUND', message: '平仓批次不存在' };
      }
      const exposure = selectPairExposure(data, batch.pairId);
      return run(
        closeBatchCommands.retry(batchId, {
          channelId: input.channelId,
          simulatedResult: input.simulatedResult,
          failReason: input.failReason,
          exposure: exposureSnapshotOf(exposure),
        }),
      );
    },
    [run],
  );

  return { pending, create, retry };
}
