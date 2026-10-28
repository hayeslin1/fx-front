import { useCallback, useMemo, useRef, useState } from 'react';
import { DEFAULT_HALF_SPREAD_BPS, FEE, PAIR_IDS } from '@/domain/constants';
import { fxConfigCommands } from '@/domain/services/fx-config.service';
import type {
  DataState,
  DomainCommand,
  DomainResult,
  MarkupConfig,
  PairId,
  RoutingRule,
} from '@/domain/types';
import { useAppStore } from '@/store';

// 运营端「汇率运营-路由配置 / 加点配置」薄 hooks（设计文档 §7.2）：
// 页面不直接触达 store——读取投影与写操作（saveRouting / saveMarkup）全部收敛于此。
// operatorId 取当前 ops 会话；领域服务会再校验账号存在，非法操作者零变更（fx-config.service）。
// 对接后端时仅替换本文件内部实现（本地领域服务 → src/api），页面不动。

// ---------- 纯函数（node 环境可直接单测） ----------

/** 加点输入校验（PRD §5.5 / 设计文档 §10.3：每侧点差 0–1000 整数 bps，对称单值） */
export function validateMarkupBps(
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: '请输入每侧点差（0–1000 整数 bps）' };
  // 仅接受纯数字串：负数、小数、科学计数法等一律拒绝
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: '每侧点差须为 0–1000 的整数 bps' };
  const value = Number(trimmed);
  if (value > 1000) return { ok: false, error: '每侧点差须为 0–1000 的整数 bps' };
  return { ok: true, value };
}

/** 列表内移动一项（上/下移按钮）：越界时返回同序新数组（按钮侧同步禁用） */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** 顺序比较（草稿序是否与持久化序一致，用于“未保存”标记与保存/重置禁用） */
export function isSameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 某币对持久化的路由渠道顺序；配置缺失回退“全部渠道按定义序”（仅防御，seed 恒有全量五对） */
export function persistedRoutingIds(data: DataState, pairId: PairId): string[] {
  const rule = data.fxConfig.routing.find((item) => item.pairId === pairId);
  return rule?.channelIds ?? data.fxConfig.channels.map((channel) => channel.id);
}

// ---------- 读取 hooks ----------

export interface RoutingEntryView {
  channelId: string;
  /** 渠道展示名（配置缺失回退 id） */
  name: string;
  /** 渠道启用状态；停用渠道仍必须在路由中（saveRouting 要求覆盖全部渠道） */
  enabled: boolean;
  /** 1-based 顺序号：列表顺序即优先级（§6.2 步骤 2 选源口径） */
  order: number;
}

export interface RoutingPairView {
  pairId: PairId;
  /** 持久化渠道顺序（草稿比对的基准） */
  channelIds: string[];
  entries: RoutingEntryView[];
}

/** 五币对持久化路由视图（按 PAIR_IDS 固定顺序，行内含渠道名与顺序号） */
export function useRoutingViews(): RoutingPairView[] {
  const data = useAppStore((state) => state.data);
  return useMemo(
    () =>
      PAIR_IDS.map((pairId) => {
        const channelIds = persistedRoutingIds(data, pairId);
        const entries: RoutingEntryView[] = channelIds.map((channelId, index) => {
          const channel = data.fxConfig.channels.find((item) => item.id === channelId);
          return {
            channelId,
            name: channel?.name ?? channelId,
            enabled: channel?.enabled ?? false,
            order: index + 1,
          };
        });
        return { pairId, channelIds, entries };
      }),
    [data],
  );
}

export interface MarkupRowView {
  pairId: PairId;
  /** 每侧点差 bps（持久化值；缺配置回退默认 50） */
  halfSpreadBps: number;
  /** 服务费（恒为 "0"，PRD §4.2 / §5.5） */
  fee: string;
}

/** 五币对加点视图（表格行：币对 / 每侧点差 / 服务费固定 0） */
export function useMarkupRows(): MarkupRowView[] {
  const data = useAppStore((state) => state.data);
  return useMemo(
    () =>
      PAIR_IDS.map((pairId) => {
        const markup = data.fxConfig.markups.find((item) => item.pairId === pairId);
        return {
          pairId,
          halfSpreadBps: markup?.halfSpreadBps ?? DEFAULT_HALF_SPREAD_BPS,
          fee: FEE,
        };
      }),
    [data],
  );
}

// ---------- 写操作 ----------

export interface FxRoutingCommands {
  /** 提交中：禁用按钮/输入，防重复提交 */
  pending: boolean;
  saveRouting: (
    pairId: PairId,
    channelIds: string[],
  ) => Promise<DomainResult<{ routing: RoutingRule }>>;
  saveMarkup: (
    pairId: PairId,
    halfSpreadBps: number,
  ) => Promise<DomainResult<{ markup: MarkupConfig }>>;
}

/**
 * 路由/加点写操作（§7.2）：经 store.apply 提交领域服务命令。
 * WHY 用 ref 同步守卫：setPending 是异步渲染，仅靠 disabled 挡不住同一帧内的双击；
 * 失败时领域服务不返回 next，store 不写入，天然满足“就地提示、零变更”。
 */
export function useFxRoutingCommands(): FxRoutingCommands {
  const apply = useAppStore((state) => state.apply);
  const opsAccountId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);
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

  const saveRouting = useCallback(
    async (
      pairId: PairId,
      channelIds: string[],
    ): Promise<DomainResult<{ routing: RoutingRule }>> => {
      if (opsAccountId === null) {
        return { ok: false, code: 'NO_OPS_SESSION', message: '运营登录状态已失效，请重新登录' };
      }
      return run(fxConfigCommands.saveRouting(opsAccountId, pairId, channelIds));
    },
    [opsAccountId, run],
  );

  const saveMarkup = useCallback(
    async (
      pairId: PairId,
      halfSpreadBps: number,
    ): Promise<DomainResult<{ markup: MarkupConfig }>> => {
      if (opsAccountId === null) {
        return { ok: false, code: 'NO_OPS_SESSION', message: '运营登录状态已失效，请重新登录' };
      }
      return run(fxConfigCommands.saveMarkup(opsAccountId, pairId, halfSpreadBps));
    },
    [opsAccountId, run],
  );

  return { pending, saveRouting, saveMarkup };
}
