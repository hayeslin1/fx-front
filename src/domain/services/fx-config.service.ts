import { nextId } from '../ids';
import { D, toRateSig12 } from '../money';
import type {
  Channel,
  CollectStepSeq,
  CurrencyPair,
  DataState,
  DomainCommand,
  DomainResult,
  MarkupConfig,
  PairId,
  RawPrice,
  RoutingRule,
} from '../types';

// 汇率运营配置领域服务（设计文档 §8.4 fx-config.ts、PRD §5.5）
// 所有写操作均为运营权限：operatorId 必须存在于 opsAccounts，否则零变更。
// 配置只影响之后的新报价；历史订单/已锁价快照不变（由快照机制保证）。

export interface UpsertChannelInput {
  /** 无 id 为新增，有 id 为编辑（不物理删除，仅启停） */
  id?: string;
  name: string;
  enabled: boolean;
}

export interface CollectResult {
  rawPrice: RawPrice;
}

export interface CollectAllResult {
  rawPrices: RawPrice[];
}

function fail(code: string, message: string): DomainResult<never> {
  return { ok: false, code, message };
}

function opsExists(state: DataState, operatorId: string): boolean {
  return state.opsAccounts.some((a) => a.id === operatorId);
}

function pairExists(state: DataState, pairId: PairId): boolean {
  return state.fxConfig.pairs.some((p) => p.id === pairId);
}

/**
 * 该币对最新一条原始价（collectedAt 最新，并列取先出现者）。
 * WHY：新增渠道首采无自价可步进，以该币对既有最新价为基准应用步长（§5.4），
 * 与 D6 估值取“最近一次采集价”的口径一致。
 */
function latestPairPrice(state: DataState, pairId: PairId): RawPrice | undefined {
  let latest: RawPrice | undefined;
  for (const price of state.fxConfig.rawPrices) {
    if (price.pairId !== pairId) continue;
    if (latest === undefined || price.collectedAt > latest.collectedAt) latest = price;
  }
  return latest;
}

/** 取步长序列当前值；步长是百分比字符串（如 "-0.12" 表示 -0.12%） */
function stepAt(seq: CollectStepSeq): ReturnType<typeof D> | null {
  const raw = seq.steps[seq.nextIndex];
  if (raw === undefined || !/^[+-]?\d+(\.\d+)?$/.test(raw)) return null;
  return D(raw);
}

/** 按百分比步长确定性推进价格；内部按 12 位有效位存储（设计文档 §6.1） */
function applyStep(mid: string, pct: ReturnType<typeof D>): string {
  const factor = D(1).plus(pct.div(100));
  return toRateSig12(D(mid).mul(factor)).toString();
}

function nextIndexAfter(seq: CollectStepSeq): number {
  return (seq.nextIndex + 1) % seq.steps.length;
}

export const fxConfigCommands = {
  /** 新增/编辑渠道（PRD §5.5）。新增渠道自动追加到各币对路由末尾，保持“路由覆盖全部渠道” */
  upsertChannel(
    operatorId: string,
    input: UpsertChannelInput,
  ): DomainCommand<{ channel: Channel }> {
    return {
      run: (state, ctx): DomainResult<{ channel: Channel }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const name = input.name.trim();
        if (!name) {
          return fail('INVALID_CHANNEL_NAME', '请输入渠道名称');
        }

        if (input.id !== undefined) {
          const existing = state.fxConfig.channels.find((c) => c.id === input.id);
          if (!existing) {
            return fail('CHANNEL_NOT_FOUND', '渠道不存在');
          }
          const channel: Channel = { ...existing, name, enabled: input.enabled };
          return {
            ok: true,
            next: {
              ...state,
              fxConfig: {
                ...state.fxConfig,
                channels: state.fxConfig.channels.map((c) => (c.id === channel.id ? channel : c)),
              },
            },
            data: { channel },
          };
        }

        const { id, counters } = nextId(state.counters, 'CH', ctx.now);
        const channel: Channel = { id, name, enabled: input.enabled, createdAt: ctx.now };
        return {
          ok: true,
          next: {
            ...state,
            fxConfig: {
              ...state.fxConfig,
              channels: [...state.fxConfig.channels, channel],
              routing: state.fxConfig.routing.map((rule) => ({
                ...rule,
                channelIds: [...rule.channelIds, id],
              })),
            },
            counters,
          },
          data: { channel },
        };
      },
    };
  },

  /** 渠道启停：影响客户报价选源与平仓可选渠道（PRD §5.5） */
  toggleChannel(
    operatorId: string,
    channelId: string,
    enabled: boolean,
  ): DomainCommand<{ channel: Channel }> {
    return {
      run: (state): DomainResult<{ channel: Channel }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const existing = state.fxConfig.channels.find((c) => c.id === channelId);
        if (!existing) {
          return fail('CHANNEL_NOT_FOUND', '渠道不存在');
        }
        const channel: Channel = { ...existing, enabled };
        return {
          ok: true,
          next: {
            ...state,
            fxConfig: {
              ...state.fxConfig,
              channels: state.fxConfig.channels.map((c) => (c.id === channelId ? channel : c)),
            },
          },
          data: { channel },
        };
      },
    };
  },

  /** 币对启停：停用后双向均不可报价（PRD §5.5） */
  togglePair(
    operatorId: string,
    pairId: PairId,
    enabled: boolean,
  ): DomainCommand<{ pair: CurrencyPair }> {
    return {
      run: (state): DomainResult<{ pair: CurrencyPair }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const existing = state.fxConfig.pairs.find((p) => p.id === pairId);
        if (!existing) {
          return fail('PAIR_NOT_FOUND', '币对不存在');
        }
        const pair: CurrencyPair = { ...existing, enabled };
        return {
          ok: true,
          next: {
            ...state,
            fxConfig: {
              ...state.fxConfig,
              pairs: state.fxConfig.pairs.map((p) => (p.id === pairId ? pair : p)),
            },
          },
          data: { pair },
        };
      },
    };
  },

  /** 采集池“报价启用”开关：仅约束客户报价，不影响平仓渠道校验（§6.5 口径说明） */
  toggleQuoteEnabled(
    operatorId: string,
    pairId: PairId,
    channelId: string,
    quoteEnabled: boolean,
  ): DomainCommand<{ rawPrice: RawPrice }> {
    return {
      run: (state): DomainResult<{ rawPrice: RawPrice }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        if (!pairExists(state, pairId)) {
          return fail('PAIR_NOT_FOUND', '币对不存在');
        }
        if (!state.fxConfig.channels.some((c) => c.id === channelId)) {
          return fail('CHANNEL_NOT_FOUND', '渠道不存在');
        }
        const existing = state.fxConfig.rawPrices.find(
          (r) => r.pairId === pairId && r.channelId === channelId,
        );
        if (!existing) {
          return fail('PRICE_NOT_FOUND', '该渠道暂无采集价');
        }
        const rawPrice: RawPrice = { ...existing, quoteEnabled };
        return {
          ok: true,
          next: {
            ...state,
            fxConfig: {
              ...state.fxConfig,
              rawPrices: state.fxConfig.rawPrices.map((r) =>
                r.pairId === pairId && r.channelId === channelId ? rawPrice : r,
              ),
            },
          },
          data: { rawPrice },
        };
      },
    };
  },

  /**
   * 保存报价路由（PRD §5.5）：数组顺序即优先级。
   * 合法性 = 渠道均存在、无重复、且恰好覆盖当前全部渠道（上/下移只重排，不增删）。
   */
  saveRouting(
    operatorId: string,
    pairId: PairId,
    channelIds: string[],
  ): DomainCommand<{ routing: RoutingRule }> {
    return {
      run: (state): DomainResult<{ routing: RoutingRule }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        if (!pairExists(state, pairId)) {
          return fail('PAIR_NOT_FOUND', '币对不存在');
        }

        const unique = new Set(channelIds);
        const known = new Set(state.fxConfig.channels.map((c) => c.id));
        if (
          unique.size !== channelIds.length ||
          channelIds.some((id) => !known.has(id)) ||
          channelIds.length !== known.size ||
          state.fxConfig.channels.some((c) => !unique.has(c.id))
        ) {
          return fail('INVALID_ROUTING', '路由必须覆盖全部渠道、渠道存在且不重复');
        }

        const routing: RoutingRule = { pairId, channelIds: [...channelIds] };
        return {
          ok: true,
          next: {
            ...state,
            fxConfig: {
              ...state.fxConfig,
              routing: state.fxConfig.routing.map((r) => (r.pairId === pairId ? routing : r)),
            },
          },
          data: { routing },
        };
      },
    };
  },

  /** 保存加点：对称点差每侧 bps，范围 0–1000（设计文档 §10.3） */
  saveMarkup(
    operatorId: string,
    pairId: PairId,
    halfSpreadBps: number,
  ): DomainCommand<{ markup: MarkupConfig }> {
    return {
      run: (state): DomainResult<{ markup: MarkupConfig }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        if (!pairExists(state, pairId)) {
          return fail('PAIR_NOT_FOUND', '币对不存在');
        }
        if (!Number.isInteger(halfSpreadBps) || halfSpreadBps < 0 || halfSpreadBps > 1000) {
          return fail('INVALID_BPS', '每侧点差须为 0–1000 的整数 bps');
        }

        const markup: MarkupConfig = { pairId, halfSpreadBps };
        return {
          ok: true,
          next: {
            ...state,
            fxConfig: {
              ...state.fxConfig,
              markups: state.fxConfig.markups.map((m) => (m.pairId === pairId ? markup : m)),
            },
          },
          data: { markup },
        };
      },
    };
  },

  /**
   * 单行模拟采集（决策 D5）：按该币对持久化的 nextIndex 取步长，推进该渠道价格并刷新采集时间，
   * 随后 nextIndex 循环前移。同一初始状态 + now 的结果完全确定。
   */
  collect(operatorId: string, pairId: PairId, channelId: string): DomainCommand<CollectResult> {
    return {
      run: (state, ctx): DomainResult<CollectResult> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        if (!pairExists(state, pairId)) {
          return fail('PAIR_NOT_FOUND', '币对不存在');
        }
        if (!state.fxConfig.channels.some((c) => c.id === channelId)) {
          return fail('CHANNEL_NOT_FOUND', '渠道不存在');
        }

        const seqIndex = state.fxConfig.collectSteps.findIndex((s) => s.pairId === pairId);
        const seq = state.fxConfig.collectSteps[seqIndex];
        if (!seq) {
          return fail('COLLECT_STEPS_MISSING', '该币对未配置采集步长');
        }
        const pct = stepAt(seq);
        if (pct === null) {
          return fail('INVALID_COLLECT_STEPS', '采集步长配置非法');
        }

        const priceIndex = state.fxConfig.rawPrices.findIndex(
          (r) => r.pairId === pairId && r.channelId === channelId,
        );
        const existing = state.fxConfig.rawPrices[priceIndex];
        // 首采基准（§5.4）：渠道无既有价（新增渠道）时以该币对最新一条原始价为基准；
        // 整对无任何价格则无可采基准，拒绝且零变更
        const baseMid = (existing ?? latestPairPrice(state, pairId))?.mid;
        if (baseMid === undefined) {
          return fail('PRICE_NOT_FOUND', '该币对暂无可采集基准价');
        }

        const rawPrice: RawPrice = {
          pairId,
          channelId,
          mid: applyStep(baseMid, pct),
          collectedAt: ctx.now,
          // 首采价默认可报价；既有行推进仅刷新行情，开关维持原值
          quoteEnabled: existing?.quoteEnabled ?? true,
        };
        const rawPrices = [...state.fxConfig.rawPrices];
        if (priceIndex >= 0) rawPrices[priceIndex] = rawPrice;
        else rawPrices.push(rawPrice);
        const collectSteps = state.fxConfig.collectSteps.map((s, index) =>
          index === seqIndex ? { ...s, nextIndex: nextIndexAfter(s) } : s,
        );

        return {
          ok: true,
          next: {
            ...state,
            fxConfig: { ...state.fxConfig, rawPrices, collectSteps },
          },
          data: { rawPrice },
        };
      },
    };
  },

  /**
   * 全部模拟采集：每个币对用同一个当前步长推进其全部渠道，nextIndex 每币对仅前移一次。
   * WHY 同一步长：采集池的一行代表“同一时刻的渠道报价”，同币对各渠道须按相同百分比变动，
   * 才能保持渠道间价差关系；单行采集只推进该币对游标，语义一致。
   */
  collectAll(operatorId: string): DomainCommand<CollectAllResult> {
    return {
      run: (state, ctx): DomainResult<CollectAllResult> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }

        const stepByPair = new Map<PairId, ReturnType<typeof D>>();
        const nextIndexByPair = new Map<PairId, number>();
        const baseMidByPair = new Map<PairId, string>();
        for (const seq of state.fxConfig.collectSteps) {
          const pct = stepAt(seq);
          if (pct === null) continue;
          stepByPair.set(seq.pairId, pct);
          nextIndexByPair.set(seq.pairId, nextIndexAfter(seq));
          const base = latestPairPrice(state, seq.pairId);
          if (base !== undefined) baseMidByPair.set(seq.pairId, base.mid);
        }

        const rawPrices = state.fxConfig.rawPrices.map((price) => {
          const pct = stepByPair.get(price.pairId);
          if (!pct) return price;
          return { ...price, mid: applyStep(price.mid, pct), collectedAt: ctx.now };
        });

        // 补齐无价渠道首采（§5.4）：与已有渠道同一步长，基准为采集前该币对最新一条原始价
        for (const channel of state.fxConfig.channels) {
          for (const [pairId, pct] of stepByPair) {
            const baseMid = baseMidByPair.get(pairId);
            if (baseMid === undefined) continue;
            if (rawPrices.some((r) => r.pairId === pairId && r.channelId === channel.id)) continue;
            rawPrices.push({
              pairId,
              channelId: channel.id,
              mid: applyStep(baseMid, pct),
              collectedAt: ctx.now,
              quoteEnabled: true,
            });
          }
        }
        const collectSteps = state.fxConfig.collectSteps.map((seq) => {
          const nextIndex = nextIndexByPair.get(seq.pairId);
          return nextIndex === undefined ? seq : { ...seq, nextIndex };
        });

        return {
          ok: true,
          next: {
            ...state,
            fxConfig: { ...state.fxConfig, rawPrices, collectSteps },
          },
          data: { rawPrices },
        };
      },
    };
  },
};
