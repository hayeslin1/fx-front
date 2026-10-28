import { PRICE_FRESH_MS } from '../constants';
import { nextId } from '../ids';
import { D, Decimal, isValidAmountInput, toRateSig12 } from '../money';
import type {
  CloseAttempt,
  CloseBatch,
  DataState,
  DecimalStr,
  DomainCommand,
  DomainResult,
  PairId,
  PlatformSide,
  RawPrice,
  SimulatedResult,
} from '../types';

// 渠道批量平仓（设计文档 §6.5）。
//
// WHY 净敞口以入参快照传入、而不是在服务内调用 buildLedger：
// 本服务只负责“校验 + 记录事实（批次/尝试）”，敞口与损益由重放引擎从事实派生。
// 两者解耦后，领域服务保持纯函数、无引擎依赖，也不会出现“服务写副本、引擎再算一遍”
// 的双口径问题；store 接线时把 buildLedger 的最新 pairExposure 快照传进来即可。
//
// 失败尝试只落审计记录，不改变钱包/订单/敞口；成功尝试同样不直接改敞口，
// 而是由 buildLedger 重放 §6.5 的 FIFO 冲减逻辑自动派生。

/** 平仓时可平金额的来源快照（buildLedger.pairExposure 的投影） */
export interface CloseExposureSnapshot {
  /** 平台净敞口：正 = USD 多头，负 = USD 空头 */
  netUsd: DecimalStr;
  side: PlatformSide | 'FLAT';
}

/** 新建平仓批次的输入（§8.4 closeBatchCreate 的领域侧形态） */
export interface CloseBatchDraft {
  pairId: PairId;
  usdAmount: DecimalStr;
  channelId: string;
  simulatedResult: SimulatedResult;
  failReason?: string;
  exposure: CloseExposureSnapshot;
}

/**
 * 整批重试输入：金额与币对沿用原批次（PRD §5.3“整批重试”），
 * 渠道/模拟结果/失败原因重新选择，敞口取当前最新快照。
 */
export interface CloseBatchRetryInput {
  channelId: string;
  simulatedResult: SimulatedResult;
  failReason?: string;
  exposure: CloseExposureSnapshot;
}

type ValidationResult =
  | {
      ok: true;
      /** 与净敞口相反的平仓方向（批次 side） */
      side: PlatformSide;
      /** 提交时锁定的渠道原始价快照 */
      lockedMid: DecimalStr;
      priceCollectedAt: number;
    }
  | { ok: false; code: string; message: string };

/** 取某渠道某币对“最新一条”原始价；同采集时间保留先出现者，保证纯函数确定性 */
function latestPriceOf(
  state: DataState,
  pairId: PairId,
  channelId: string,
): RawPrice | undefined {
  let latest: RawPrice | undefined;
  for (const raw of state.fxConfig.rawPrices) {
    if (raw.pairId !== pairId || raw.channelId !== channelId) continue;
    if (latest === undefined || raw.collectedAt > latest.collectedAt) latest = raw;
  }
  return latest;
}

/** 解析原始中间价；非法/非正价格按“无有效原始价”处理，避免脏数据抛异常 */
function parseMid(raw: RawPrice): Decimal | null {
  try {
    const value = D(raw.mid);
    return value.isFinite() && value.gt(0) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 平仓公共校验（新建与重试共用，§6.5）。
 * 任一失败返回错误码，调用方直接透传——保证失败零变更。
 *
 * 注意：此处刻意不校验采集池的 quoteEnabled 开关。
 * 该开关依 PRD §4.1 仅约束“客户报价”，运营平仓只需渠道启用 + 10 分钟内原始价。
 */
function validateClose(
  state: DataState,
  params: {
    pairId: PairId;
    usdAmount: DecimalStr;
    channelId: string;
    simulatedResult: SimulatedResult;
    failReason?: string;
    exposure: CloseExposureSnapshot;
    /** 重试时传入原批次方向，要求仍与当前净敞口相反 */
    expectedSide?: PlatformSide;
    now: number;
  },
): ValidationResult {
  const { pairId, usdAmount, channelId, simulatedResult, failReason, exposure, now } = params;

  // 1. 金额：正数且严格不超过 USD 2 位精度（多余精度拒绝，绝不静默舍入）
  if (!isValidAmountInput(usdAmount, 'USD')) {
    return {
      ok: false,
      code: 'INVALID_AMOUNT',
      message: '请输入正确的 USD 金额（大于 0，最多 2 位小数）',
    };
  }

  // 2. 必须存在非零净敞口，否则没有可平对象
  if (exposure.side === 'FLAT') {
    return { ok: false, code: 'EXPOSURE_FLAT', message: '当前无净敞口可平' };
  }
  let closeableUsd: Decimal;
  try {
    closeableUsd = D(exposure.netUsd).abs();
  } catch {
    return { ok: false, code: 'EXPOSURE_FLAT', message: '当前无净敞口可平' };
  }
  if (!closeableUsd.isFinite() || closeableUsd.lte(0)) {
    return { ok: false, code: 'EXPOSURE_FLAT', message: '当前无净敞口可平' };
  }

  // 3. 平仓方向必须与净敞口相反（净多头 → 卖出 USD 记为 SHORT）
  const side: PlatformSide = exposure.side === 'LONG' ? 'SHORT' : 'LONG';
  // 重试沿用原批次方向：若期间敞口方向已翻转，继续重试会变成反向开仓，必须拒绝
  if (params.expectedSide !== undefined && params.expectedSide !== side) {
    return {
      ok: false,
      code: 'EXPOSURE_SIDE_CHANGED',
      message: '净敞口方向已变化，请重新创建平仓批次',
    };
  }

  // 4. 金额不得超过当前可平金额（边界相等允许）
  if (D(usdAmount).gt(closeableUsd)) {
    return { ok: false, code: 'CLOSE_AMOUNT_EXCEEDED', message: '超出可平金额' };
  }

  // 5. 模拟失败必须记录原因（PRD §5.3 审计要求）
  if (simulatedResult === 'FAILED' && (failReason ?? '').trim() === '') {
    return { ok: false, code: 'FAIL_REASON_REQUIRED', message: '模拟失败必须填写失败原因' };
  }

  // 6. 渠道必须存在且启用
  const channel = state.fxConfig.channels.find((item) => item.id === channelId);
  if (channel === undefined || !channel.enabled) {
    return { ok: false, code: 'CHANNEL_DISABLED', message: '渠道不存在或已停用' };
  }

  // 7. 该渠道该币对必须存在有效原始价，且新鲜度 <= 10 分钟（边界相等有效）
  const raw = latestPriceOf(state, pairId, channelId);
  const mid = raw === undefined ? null : parseMid(raw);
  if (raw === undefined || mid === null) {
    return { ok: false, code: 'NO_PRICE', message: '该渠道暂无此币对的原始价' };
  }
  if (now - raw.collectedAt > PRICE_FRESH_MS) {
    return {
      ok: false,
      code: 'PRICE_STALE',
      message: '该渠道原始价已超过 10 分钟，请重新采集',
    };
  }

  return {
    ok: true,
    side,
    lockedMid: toRateSig12(mid).toString(),
    priceCollectedAt: raw.collectedAt,
  };
}

/** 构造一次尝试：locked 字段全部来自本次校验时点的快照，失败原因仅 FAILED 记录 */
function buildAttempt(params: {
  batchId: string;
  index: number;
  channelId: string;
  lockedMid: DecimalStr;
  priceCollectedAt: number;
  simulatedResult: SimulatedResult;
  failReason?: string;
  now: number;
}): CloseAttempt {
  const { batchId, index, channelId, lockedMid, priceCollectedAt, simulatedResult, now } = params;
  return {
    id: `${batchId}-A${index}`,
    index,
    simulatedResult,
    status: simulatedResult,
    channelId,
    lockedMid,
    priceCollectedAt,
    createdAt: now,
    executedAt: now,
    ...(simulatedResult === 'FAILED' ? { failReason: (params.failReason ?? '').trim() } : {}),
    // 分配明细由重放引擎派生（§6.7），持久化事实保持空数组占位
    allocations: [],
  };
}

export const closeBatchCommands = {
  /**
   * 新建平仓批次并记录第 1 次尝试。
   * 成功/失败尝试都落库：失败只影响批次状态，敞口与损益由引擎忽略失败尝试而保持不变。
   */
  createBatch(draft: CloseBatchDraft): DomainCommand<CloseBatch> {
    return {
      run: (state, ctx): DomainResult<CloseBatch> => {
        const validation = validateClose(state, {
          pairId: draft.pairId,
          usdAmount: draft.usdAmount,
          channelId: draft.channelId,
          simulatedResult: draft.simulatedResult,
          failReason: draft.failReason,
          exposure: draft.exposure,
          now: ctx.now,
        });
        if (!validation.ok) return validation;

        const { id: batchId, counters } = nextId(state.counters, 'CB', ctx.now);
        const attempt = buildAttempt({
          batchId,
          index: 1,
          channelId: draft.channelId,
          lockedMid: validation.lockedMid,
          priceCollectedAt: validation.priceCollectedAt,
          simulatedResult: draft.simulatedResult,
          failReason: draft.failReason,
          now: ctx.now,
        });

        const batch: CloseBatch = {
          id: batchId,
          pairId: draft.pairId,
          side: validation.side,
          usdAmount: D(draft.usdAmount).toFixed(2),
          channelId: draft.channelId,
          createdAt: ctx.now,
          attempts: [attempt],
          status: draft.simulatedResult,
        };

        return {
          ok: true,
          next: { ...state, closeBatches: [...state.closeBatches, batch], counters },
          data: batch,
        };
      },
    };
  },

  /**
   * 整批重试：金额/币对沿用原批次，渠道与价格必须重新校验并重新锁定（§6.5）。
   * 已成功的批次不可再重试（PRD §5.3 仅允许失败批次整批重试）。
   */
  retry(batchId: string, input: CloseBatchRetryInput): DomainCommand<CloseBatch> {
    return {
      run: (state, ctx): DomainResult<CloseBatch> => {
        const batch = state.closeBatches.find((item) => item.id === batchId);
        if (batch === undefined) {
          return { ok: false, code: 'BATCH_NOT_FOUND', message: '平仓批次不存在' };
        }
        if (batch.status === 'SUCCESS') {
          return {
            ok: false,
            code: 'BATCH_ALREADY_SUCCESS',
            message: '已成功的批次不可重试',
          };
        }

        const validation = validateClose(state, {
          pairId: batch.pairId,
          usdAmount: batch.usdAmount,
          channelId: input.channelId,
          simulatedResult: input.simulatedResult,
          failReason: input.failReason,
          exposure: input.exposure,
          expectedSide: batch.side,
          now: ctx.now,
        });
        if (!validation.ok) return validation;

        const lastIndex = batch.attempts.at(-1)?.index ?? 0;
        const index = lastIndex + 1;
        const attempt = buildAttempt({
          batchId: batch.id,
          index,
          channelId: input.channelId,
          lockedMid: validation.lockedMid,
          priceCollectedAt: validation.priceCollectedAt,
          simulatedResult: input.simulatedResult,
          failReason: input.failReason,
          now: ctx.now,
        });

        const nextBatch: CloseBatch = {
          ...batch,
          // 渠道与批次状态跟随最后一次尝试；创建时间/金额保持首次提交时的审计事实
          channelId: input.channelId,
          attempts: [...batch.attempts, attempt],
          status: input.simulatedResult,
        };

        return {
          ok: true,
          next: {
            ...state,
            closeBatches: state.closeBatches.map((item) =>
              item.id === batchId ? nextBatch : item,
            ),
          },
          data: nextBatch,
        };
      },
    };
  },
};
