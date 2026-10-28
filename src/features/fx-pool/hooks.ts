import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRICE_FRESH_MS } from '@/domain/constants';
import {
  fxConfigCommands,
  type CollectAllResult,
  type CollectResult,
} from '@/domain/services/fx-config.service';
import type { DomainResult, PairId, RawPrice } from '@/domain/types';
import { now as readNow } from '@/lib/clock';
import { useAppStore } from '@/store';

// 汇率运营-采集池薄 hooks（设计文档 §7.2 / §10.3 汇率运营段、§5.4 渠道与采集池、§6.5 口径说明）：
// 页面不直接触达 store，读取一律为 store 派生（币对×渠道全量交叉、业务键连接原始价），
// 写入经 store.apply 提交领域命令（operatorId 取当前运营会话）。对接后端时只替换本文件。

/** 行/动作的业务键：币对 + 渠道（禁止用表格下标定位行） */
export function poolRowKey(pairId: PairId, channelId: string): string {
  return `${pairId}::${channelId}`;
}

export type PoolValidity = 'FRESH' | 'STALE' | 'CHANNEL_DISABLED' | 'NO_PRICE';

/**
 * 有效状态实时判定（§10.3：有效 = 渠道启用 && 采集时间 ≤ 10 分钟）。
 * WHY 渠道停用优先于新鲜度：停用渠道即使刚采集也“不参与报价选源”，文案必须是「渠道停用」而非「有效」。
 */
export function resolvePoolValidity(
  channelEnabled: boolean,
  rawPrice: RawPrice | null,
  at: number,
  freshMs: number = PRICE_FRESH_MS,
): PoolValidity {
  if (!channelEnabled) return 'CHANNEL_DISABLED';
  if (rawPrice === null) return 'NO_PRICE';
  return at - rawPrice.collectedAt <= freshMs ? 'FRESH' : 'STALE';
}

export const POOL_VALIDITY_META: Record<PoolValidity, { label: string; className: string }> = {
  FRESH: { label: '有效', className: 'border-success bg-success-bg text-success' },
  STALE: { label: '已过期', className: 'border-warning bg-warning-bg text-warning' },
  CHANNEL_DISABLED: { label: '渠道停用', className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
  NO_PRICE: { label: '暂无采集价', className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
};

export interface FxPoolRow {
  pairId: PairId;
  channelId: string;
  channelName: string;
  channelEnabled: boolean;
  /** null = 该（币对,渠道）暂无采集价（新增渠道场景；未采集前不参与报价与平仓） */
  rawPrice: RawPrice | null;
}

/**
 * 采集池全量行（币对 × 渠道，保持配置顺序）。
 * WHY 按配置全量交叉而非仅遍历 rawPrices：新增渠道必须立即出现在表中（显示「暂无采集价」），
 * 否则运营无法感知“新渠道尚未采集”的状态。
 */
export function useFxPoolRows(): FxPoolRow[] {
  const pairs = useAppStore((s) => s.data.fxConfig.pairs);
  const channels = useAppStore((s) => s.data.fxConfig.channels);
  const rawPrices = useAppStore((s) => s.data.fxConfig.rawPrices);

  return useMemo(() => {
    const priceByKey = new Map(rawPrices.map((price) => [poolRowKey(price.pairId, price.channelId), price]));
    const rows: FxPoolRow[] = [];
    for (const pair of pairs) {
      for (const channel of channels) {
        rows.push({
          pairId: pair.id,
          channelId: channel.id,
          channelName: channel.name,
          channelEnabled: channel.enabled,
          rawPrice: priceByKey.get(poolRowKey(pair.id, channel.id)) ?? null,
        });
      }
    }
    return rows;
  }, [pairs, channels, rawPrices]);
}

/**
 * 1 秒心跳的当前时间（等价机制允许）。
 * WHY：有效状态是滑动的 10 分钟窗口，页面静置时也必须跨过“新鲜 → 已过期”边界，
 * 不能只在交互后重算；统一时间源经 lib/clock，测试注入固定时钟即确定可复现（§4.4）。
 */
export function useNowTick(intervalMs = 1000): number {
  const [at, setAt] = useState(() => readNow());
  useEffect(() => {
    const timer = setInterval(() => setAt(readNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return at;
}

/** 全部采集动作的 pending 键（与行键区分） */
export const COLLECT_ALL_PENDING_KEY = 'ALL';

export interface FxPoolActions {
  /** 正在执行的动作键（行键或 COLLECT_ALL_PENDING_KEY）；非 null 时页面禁用全部操作按钮防双击 */
  pendingKey: string | null;
  collect: (pairId: PairId, channelId: string) => Promise<DomainResult<CollectResult>>;
  collectAll: () => Promise<DomainResult<CollectAllResult>>;
  setQuoteEnabled: (
    pairId: PairId,
    channelId: string,
    quoteEnabled: boolean,
  ) => Promise<DomainResult<{ rawPrice: RawPrice }>>;
}

function noOpsSession(): DomainResult<never> {
  return { ok: false, code: 'NO_OPS_SESSION', message: '运营登录状态已失效，请重新登录' };
}

function actionPending(): DomainResult<never> {
  return { ok: false, code: 'ACTION_PENDING', message: '正在执行，请勿重复操作' };
}

/**
 * 采集池写操作（§5.4 决策 D5）：
 * - collect：单行模拟采集，按该币对 nextIndex 的步长推进该渠道价格并刷新时间；
 * - collectAll：全部采集，每个币对同一步长推进其全部渠道，nextIndex 每币对仅前移一次；
 * - setQuoteEnabled：报价启用开关（仅约束客户报价，不影响平仓渠道校验，§6.5）。
 * 失败一律零变更（领域服务保证），message 为领域中文文案，由页面就地展示。
 * WHY ref 同步守卫：setPendingKey 是异步渲染，仅靠 disabled 挡不住同一帧内的双击。
 */
export function useFxPoolActions(): FxPoolActions {
  const apply = useAppStore((s) => s.apply);
  const opsAccountId = useAppStore((s) => s.session.ops?.opsAccountId ?? null);
  const busyRef = useRef(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(
      key: string,
      command: () => Promise<DomainResult<T>>,
    ): Promise<DomainResult<T>> => {
      if (busyRef.current) return actionPending();
      busyRef.current = true;
      setPendingKey(key);
      try {
        return await command();
      } finally {
        busyRef.current = false;
        setPendingKey(null);
      }
    },
    [],
  );

  const collect = useCallback(
    async (pairId: PairId, channelId: string): Promise<DomainResult<CollectResult>> => {
      if (opsAccountId === null) return noOpsSession();
      return run(poolRowKey(pairId, channelId), () =>
        apply(fxConfigCommands.collect(opsAccountId, pairId, channelId)),
      );
    },
    [apply, opsAccountId, run],
  );

  const collectAll = useCallback(async (): Promise<DomainResult<CollectAllResult>> => {
    if (opsAccountId === null) return noOpsSession();
    return run(COLLECT_ALL_PENDING_KEY, () => apply(fxConfigCommands.collectAll(opsAccountId)));
  }, [apply, opsAccountId, run]);

  const setQuoteEnabled = useCallback(
    async (
      pairId: PairId,
      channelId: string,
      quoteEnabled: boolean,
    ): Promise<DomainResult<{ rawPrice: RawPrice }>> => {
      if (opsAccountId === null) return noOpsSession();
      return run(poolRowKey(pairId, channelId), () =>
        apply(fxConfigCommands.toggleQuoteEnabled(opsAccountId, pairId, channelId, quoteEnabled)),
      );
    },
    [apply, opsAccountId, run],
  );

  return { pendingKey, collect, collectAll, setQuoteEnabled };
}
