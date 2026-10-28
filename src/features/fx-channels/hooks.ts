import { useCallback, useMemo, useRef, useState } from 'react';
import { QUOTE_CCY } from '@/domain/constants';
import { fxConfigCommands, type UpsertChannelInput } from '@/domain/services/fx-config.service';
import type {
  Channel,
  Currency,
  CurrencyPair,
  DomainCommand,
  DomainResult,
  PairId,
} from '@/domain/types';
import { useAppStore } from '@/store';

// 运营端「汇率运营-渠道管理 / 币对管理」薄 hooks（设计文档 §7.2 / §10.3 汇率运营段、PRD §5.5）：
// 页面组件不直接触达 store，渠道/币对列表读取与写操作（新增/编辑/启停）全部收敛于此；
// operatorId 取当前 ops 会话，领域服务再校验账号存在（非法操作者零变更）。
// 对接后端时仅替换本文件内部实现（本地选择器/领域服务 → src/api，§8.6），页面与测试不动。

/** 运营未登录（会话失效）统一错误：写操作直接拒绝，不做任何变更 */
const NO_OPS_SESSION_MESSAGE = '运营登录状态已失效，请重新登录';

/** 渠道/币对启停状态文案（列表徽标与开关文案共用，业务键断言口径） */
export function enabledStatusLabel(enabled: boolean): string {
  return enabled ? '启用' : '停用';
}

// ---------- 读取 hooks ----------

export interface FxChannelsView {
  /** 渠道列表（seed 顺序即展示顺序，保持稳定可比对） */
  channels: Channel[];
  opsAccountId: string | null;
}

/** 渠道列表（渠道管理页） */
export function useFxChannelsView(): FxChannelsView {
  const channels = useAppStore((state) => state.data.fxConfig.channels);
  const opsAccountId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);
  return { channels, opsAccountId };
}

export interface FxPairRow {
  pair: CurrencyPair;
  /** 基础币恒为 USD（PRD §5.5：五组 USD 枢纽币对） */
  baseCurrency: Currency;
  /** 报价币（1 USD = R 报价币，收益/损益记账币种） */
  quoteCurrency: Currency;
}

export interface FxPairsView {
  rows: FxPairRow[];
  opsAccountId: string | null;
}

/** 币对列表（币对管理页；币对固定五对，仅启停状态可变） */
export function useFxPairsView(): FxPairsView {
  const pairs = useAppStore((state) => state.data.fxConfig.pairs);
  const opsAccountId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);
  const rows = useMemo(
    () =>
      pairs.map((pair) => ({
        pair,
        baseCurrency: 'USD' as Currency,
        quoteCurrency: QUOTE_CCY[pair.id],
      })),
    [pairs],
  );
  return { rows, opsAccountId };
}

// ---------- 写入 hooks ----------

/**
 * 提交守卫：pending 期间拒绝重复提交并禁用按钮。
 * WHY 用 ref 同步守卫：setPending 是异步渲染，仅靠 disabled 挡不住同一帧内的双击。
 */
function usePendingRunner(): {
  pending: boolean;
  run: <T>(command: DomainCommand<T>) => Promise<DomainResult<T>>;
} {
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

  return { pending, run };
}

export interface FxChannelCommands {
  /** 提交中：用于禁用按钮/输入，防重复提交 */
  pending: boolean;
  /** 新增（无 id）/编辑名称与状态（带 id）走同一命令；失败零变更 */
  saveChannel: (input: UpsertChannelInput) => Promise<DomainResult<{ channel: Channel }>>;
  /** 渠道启停：不物理删除，停用即影响报价选源与平仓可选渠道 */
  toggleChannel: (
    channelId: string,
    enabled: boolean,
  ) => Promise<DomainResult<{ channel: Channel }>>;
}

/** 渠道写操作（新增/编辑/启停），全部经 store.apply 提交领域服务 */
export function useFxChannelCommands(): FxChannelCommands {
  const { pending, run } = usePendingRunner();
  const opsAccountId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);

  const saveChannel = useCallback(
    (input: UpsertChannelInput): Promise<DomainResult<{ channel: Channel }>> => {
      if (opsAccountId === null) {
        return Promise.resolve({
          ok: false,
          code: 'NO_OPS_SESSION',
          message: NO_OPS_SESSION_MESSAGE,
        });
      }
      return run(fxConfigCommands.upsertChannel(opsAccountId, input));
    },
    [opsAccountId, run],
  );

  const toggleChannel = useCallback(
    (channelId: string, enabled: boolean): Promise<DomainResult<{ channel: Channel }>> => {
      if (opsAccountId === null) {
        return Promise.resolve({
          ok: false,
          code: 'NO_OPS_SESSION',
          message: NO_OPS_SESSION_MESSAGE,
        });
      }
      return run(fxConfigCommands.toggleChannel(opsAccountId, channelId, enabled));
    },
    [opsAccountId, run],
  );

  return { pending, saveChannel, toggleChannel };
}

export interface FxPairCommands {
  pending: boolean;
  /** 币对启停：停用后双向不可报价（历史订单与锁价快照不变） */
  togglePair: (pairId: PairId, enabled: boolean) => Promise<DomainResult<{ pair: CurrencyPair }>>;
}

/** 币对写操作（启停） */
export function useFxPairCommands(): FxPairCommands {
  const { pending, run } = usePendingRunner();
  const opsAccountId = useAppStore((state) => state.session.ops?.opsAccountId ?? null);

  const togglePair = useCallback(
    (pairId: PairId, enabled: boolean): Promise<DomainResult<{ pair: CurrencyPair }>> => {
      if (opsAccountId === null) {
        return Promise.resolve({
          ok: false,
          code: 'NO_OPS_SESSION',
          message: NO_OPS_SESSION_MESSAGE,
        });
      }
      return run(fxConfigCommands.togglePair(opsAccountId, pairId, enabled));
    },
    [opsAccountId, run],
  );

  return { pending, togglePair };
}
