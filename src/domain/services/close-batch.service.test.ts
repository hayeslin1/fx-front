import { beforeEach, describe, expect, it } from 'vitest';
import { PRICE_FRESH_MS } from '../constants';
import { buildSeed } from '../seed';
import type { DataState, DomainCommand, DomainResult, RawPrice } from '../types';
import {
  closeBatchCommands,
  type CloseBatchDraft,
  type CloseBatchRetryInput,
  type CloseExposureSnapshot,
} from './close-batch.service';

// 渠道平仓（§6.5）：可平金额/渠道/新鲜度校验、尝试审计、失败零变更、重试重新锁价
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const FRESH_AT = NOW - 120_000; // seed 采集时间（NOW 前 2 分钟）
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

const LONG_2000: CloseExposureSnapshot = { netUsd: '2000.00', side: 'LONG' };

function draft(overrides: Partial<CloseBatchDraft> = {}): CloseBatchDraft {
  return {
    pairId: 'USD/EUR',
    usdAmount: '1000.00',
    channelId: 'CH-01',
    simulatedResult: 'SUCCESS',
    exposure: LONG_2000,
    ...overrides,
  };
}

function withRawPrice(
  source: DataState,
  patch: Partial<RawPrice> & Pick<RawPrice, 'pairId' | 'channelId'>,
): DataState {
  return {
    ...source,
    fxConfig: {
      ...source.fxConfig,
      rawPrices: source.fxConfig.rawPrices.map((raw) =>
        raw.pairId === patch.pairId && raw.channelId === patch.channelId
          ? { ...raw, ...patch }
          : raw,
      ),
    },
  };
}

async function run<T>(command: DomainCommand<T>, source: DataState): Promise<DomainResult<T>> {
  return command.run(source, { now: NOW });
}

function expectFailure<T>(result: DomainResult<T>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe('createBatch 成功与审计字段', () => {
  it('成功创建：批次与首次尝试字段齐全，锁定 10 分钟内的渠道原始价', async () => {
    const before = structuredClone(state);
    const result = await run(closeBatchCommands.createBatch(draft()), state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const batch = result.data;
    expect(batch).toEqual({
      id: 'CB-20261028-0001',
      pairId: 'USD/EUR',
      side: 'SHORT', // 净多头 → 反方向
      usdAmount: '1000.00',
      channelId: 'CH-01',
      createdAt: NOW,
      status: 'SUCCESS',
      attempts: [
        {
          id: 'CB-20261028-0001-A1',
          index: 1,
          simulatedResult: 'SUCCESS',
          status: 'SUCCESS',
          channelId: 'CH-01',
          lockedMid: '0.92', // seed USD/EUR CH-01 = 0.9200，12 位有效位
          priceCollectedAt: FRESH_AT,
          createdAt: NOW,
          executedAt: NOW,
          allocations: [],
        },
      ],
    });

    // 仅新增批次与计数器；钱包/订单/流水/敞口事实均不变（成功也由引擎重放冲减）
    expect(result.next.closeBatches).toHaveLength(before.closeBatches.length + 1);
    expect(result.next.counters.CB).toEqual({ day: '20261028', seq: 1 });
    expect(result.next.wallets).toEqual(before.wallets);
    expect(result.next.orders).toEqual(before.orders);
    expect(result.next.bills).toEqual(before.bills);
    expect(result.next.tickets).toEqual(before.tickets);
    expect(state).toEqual(before);
  });

  it('净空头 → 批次方向 LONG，按 |netUsd| 上限可平', async () => {
    const result = await run(
      closeBatchCommands.createBatch(
        draft({ usdAmount: '800.00', exposure: { netUsd: '-800.00', side: 'SHORT' } }),
      ),
      state,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.side).toBe('LONG');
  });

  it('多次采集取最新一条原始价锁定', async () => {
    const withNewPrice: DataState = {
      ...state,
      fxConfig: {
        ...state.fxConfig,
        rawPrices: [
          ...state.fxConfig.rawPrices,
          {
            pairId: 'USD/EUR',
            channelId: 'CH-01',
            mid: '0.9300',
            collectedAt: NOW - 1_000,
            quoteEnabled: true,
          },
        ],
      },
    };
    const result = await run(closeBatchCommands.createBatch(draft()), withNewPrice);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attempts[0]?.lockedMid).toBe('0.93');
      expect(result.data.attempts[0]?.priceCollectedAt).toBe(NOW - 1_000);
    }
  });

  it('不校验采集池 quoteEnabled 开关：停用仍可平仓（口径见 §6.5）', async () => {
    const patched = withRawPrice(state, {
      pairId: 'USD/EUR',
      channelId: 'CH-01',
      quoteEnabled: false,
    });
    const result = await run(closeBatchCommands.createBatch(draft()), patched);
    expect(result.ok).toBe(true);
  });
});

describe('createBatch 校验（失败零变更）', () => {
  it('金额精确等于可平金额通过；超 1 分拒绝', async () => {
    const exact = await run(
      closeBatchCommands.createBatch(
        draft({ usdAmount: '2000.00', exposure: { netUsd: '2000.00', side: 'LONG' } }),
      ),
      state,
    );
    expect(exact.ok).toBe(true);

    const before = structuredClone(state);
    const over = await run(
      closeBatchCommands.createBatch(draft({ usdAmount: '2000.01' })),
      state,
    );
    expectFailure(over, 'CLOSE_AMOUNT_EXCEEDED');
    expect(state).toEqual(before);
  });

  it('金额零/负/超过 2 位小数/非数字拒绝（不静默舍入）', async () => {
    for (const usdAmount of ['0', '-100.00', '1.234', 'abc']) {
      const before = structuredClone(state);
      const result = await run(closeBatchCommands.createBatch(draft({ usdAmount })), state);
      expectFailure(result, 'INVALID_AMOUNT');
      expect(state).toEqual(before);
    }
  });

  it('FLAT 敞口或可平金额为零拒绝（零变更）', async () => {
    const before = structuredClone(state);
    const flat = await run(
      closeBatchCommands.createBatch(
        draft({ exposure: { netUsd: '0.00', side: 'FLAT' } }),
      ),
      state,
    );
    expectFailure(flat, 'EXPOSURE_FLAT');

    const zero = await run(
      closeBatchCommands.createBatch(draft({ exposure: { netUsd: '0.00', side: 'LONG' } })),
      state,
    );
    expectFailure(zero, 'EXPOSURE_FLAT');
    expect(state).toEqual(before);
  });

  it('渠道停用或不存在拒绝（零变更）', async () => {
    const before = structuredClone(state);
    const disabled = await run(closeBatchCommands.createBatch(draft({ channelId: 'CH-03' })), state);
    expectFailure(disabled, 'CHANNEL_DISABLED');

    const unknown = await run(
      closeBatchCommands.createBatch(draft({ channelId: 'CH-99' })),
      state,
    );
    expectFailure(unknown, 'CHANNEL_DISABLED');
    expect(state).toEqual(before);
  });

  it('渠道无该币对原始价拒绝', async () => {
    const withNewChannel: DataState = {
      ...state,
      fxConfig: {
        ...state.fxConfig,
        channels: [
          ...state.fxConfig.channels,
          { id: 'CH-99', name: '新渠道', enabled: true, createdAt: NOW },
        ],
      },
    };
    const before = structuredClone(withNewChannel);
    const result = await run(
      closeBatchCommands.createBatch(draft({ channelId: 'CH-99' })),
      withNewChannel,
    );
    expectFailure(result, 'NO_PRICE');
    expect(withNewChannel).toEqual(before);
  });

  it('新鲜度边界：恰 10 分钟有效，超 1ms 拒绝', async () => {
    const boundary = withRawPrice(state, {
      pairId: 'USD/EUR',
      channelId: 'CH-01',
      collectedAt: NOW - PRICE_FRESH_MS,
    });
    const ok = await run(closeBatchCommands.createBatch(draft()), boundary);
    expect(ok.ok).toBe(true);

    const stale = withRawPrice(state, {
      pairId: 'USD/EUR',
      channelId: 'CH-01',
      collectedAt: NOW - PRICE_FRESH_MS - 1,
    });
    const before = structuredClone(stale);
    const rejected = await run(closeBatchCommands.createBatch(draft()), stale);
    expectFailure(rejected, 'PRICE_STALE');
    expect(stale).toEqual(before);
  });

  it('模拟失败缺原因拒绝', async () => {
    const before = structuredClone(state);
    const result = await run(
      closeBatchCommands.createBatch(
        draft({ simulatedResult: 'FAILED', failReason: '  ' }),
      ),
      state,
    );
    expectFailure(result, 'FAIL_REASON_REQUIRED');
    expect(state).toEqual(before);
  });
});

describe('createBatch 模拟失败', () => {
  it('失败尝试照常记录原因，除批次/计数器外事实零变更', async () => {
    const before = structuredClone(state);
    const result = await run(
      closeBatchCommands.createBatch(
        draft({ simulatedResult: 'FAILED', failReason: '渠道拒单（模拟）' }),
      ),
      state,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe('FAILED');
    expect(result.data.attempts).toEqual([
      {
        id: 'CB-20261028-0001-A1',
        index: 1,
        simulatedResult: 'FAILED',
        status: 'FAILED',
        channelId: 'CH-01',
        lockedMid: '0.92',
        priceCollectedAt: FRESH_AT,
        createdAt: NOW,
        executedAt: NOW,
        failReason: '渠道拒单（模拟）',
        allocations: [],
      },
    ]);
    expect(result.next.wallets).toEqual(before.wallets);
    expect(result.next.orders).toEqual(before.orders);
    expect(result.next.bills).toEqual(before.bills);
    expect(result.next.closeBatches).toHaveLength(before.closeBatches.length + 1);
  });
});

describe('retry', () => {
  /** 先落一个失败批次作为重试对象 */
  async function failedBatch(source: DataState): Promise<{ source: DataState; batchId: string }> {
    const created = await run(
      closeBatchCommands.createBatch(
        draft({ simulatedResult: 'FAILED', failReason: '首次模拟失败' }),
      ),
      source,
    );
    if (!created.ok) throw new Error(created.code);
    return { source: created.next, batchId: created.data.id };
  }

  it('追加尝试并重新锁定新渠道的当前原始价，保留原尝试快照', async () => {
    const { source, batchId } = await failedBatch(state);
    // 重试改选 CH-02，且该渠道已重新采集（新价 0.9250 / 1 分钟前）
    const refreshed = withRawPrice(source, {
      pairId: 'USD/EUR',
      channelId: 'CH-02',
      mid: '0.9250',
      collectedAt: NOW - 60_000,
    });

    const input: CloseBatchRetryInput = {
      channelId: 'CH-02',
      simulatedResult: 'SUCCESS',
      exposure: LONG_2000,
    };
    const before = structuredClone(refreshed);
    const result = await run(closeBatchCommands.retry(batchId, input), refreshed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const batch = result.data;
    expect(batch.createdAt).toBe(NOW); // 创建时间保持首次提交
    expect(batch.usdAmount).toBe('1000.00'); // 金额沿用原批次
    expect(batch.channelId).toBe('CH-02');
    expect(batch.status).toBe('SUCCESS');
    expect(batch.attempts).toHaveLength(2);
    // 原尝试 A1 快照不被篡改
    expect(batch.attempts[0]?.channelId).toBe('CH-01');
    expect(batch.attempts[0]?.lockedMid).toBe('0.92');
    expect(batch.attempts[0]?.failReason).toBe('首次模拟失败');
    // 新尝试 A2：index+1、重新锁定新渠道价、无失败原因
    expect(batch.attempts[1]).toEqual({
      id: 'CB-20261028-0001-A2',
      index: 2,
      simulatedResult: 'SUCCESS',
      status: 'SUCCESS',
      channelId: 'CH-02',
      lockedMid: '0.925',
      priceCollectedAt: NOW - 60_000,
      createdAt: NOW,
      executedAt: NOW,
      allocations: [],
    });

    // 零货币/订单写入；计数器不再新增（批次号不变）
    expect(result.next.wallets).toEqual(before.wallets);
    expect(result.next.orders).toEqual(before.orders);
    expect(result.next.counters).toEqual(before.counters);
    expect(result.next.closeBatches).toHaveLength(before.closeBatches.length);
  });

  it('连续重试 index 与尝试号递增（A2 → A3）', async () => {
    const { source, batchId } = await failedBatch(state);
    const first = await run(
      closeBatchCommands.retry(batchId, {
        channelId: 'CH-01',
        simulatedResult: 'FAILED',
        failReason: '再次模拟失败',
        exposure: LONG_2000,
      }),
      source,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await run(
      closeBatchCommands.retry(batchId, {
        channelId: 'CH-02',
        simulatedResult: 'SUCCESS',
        exposure: LONG_2000,
      }),
      first.next,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.attempts.map((attempt) => attempt.id)).toEqual([
      'CB-20261028-0001-A1',
      'CB-20261028-0001-A2',
      'CB-20261028-0001-A3',
    ]);
    expect(second.data.attempts.map((attempt) => attempt.index)).toEqual([1, 2, 3]);
  });

  it('已成功的批次不可重试', async () => {
    const created = await run(closeBatchCommands.createBatch(draft()), state);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = structuredClone(created.next);
    const result = await run(
      closeBatchCommands.retry(created.data.id, {
        channelId: 'CH-01',
        simulatedResult: 'SUCCESS',
        exposure: LONG_2000,
      }),
      created.next,
    );
    expectFailure(result, 'BATCH_ALREADY_SUCCESS');
    expect(created.next).toEqual(before);
  });

  it('批次不存在拒绝', async () => {
    const result = await run(
      closeBatchCommands.retry('CB-20990101-0001', {
        channelId: 'CH-01',
        simulatedResult: 'SUCCESS',
        exposure: LONG_2000,
      }),
      state,
    );
    expectFailure(result, 'BATCH_NOT_FOUND');
  });

  it('重试金额超过当前可平金额拒绝（零变更）', async () => {
    const created = await run(
      closeBatchCommands.createBatch(
        draft({
          usdAmount: '1500.00',
          exposure: { netUsd: '2000.00', side: 'LONG' },
          simulatedResult: 'FAILED',
          failReason: '模拟失败',
        }),
      ),
      state,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = structuredClone(created.next);
    // 期间其他批次已消耗敞口：当前可平仅剩 1000
    const result = await run(
      closeBatchCommands.retry(created.data.id, {
        channelId: 'CH-01',
        simulatedResult: 'SUCCESS',
        exposure: { netUsd: '1000.00', side: 'LONG' },
      }),
      created.next,
    );
    expectFailure(result, 'CLOSE_AMOUNT_EXCEEDED');
    expect(created.next).toEqual(before);
  });

  it('重试时净敞口方向已翻转拒绝（避免反向开仓）', async () => {
    const { source, batchId } = await failedBatch(state); // 批次 side = SHORT
    const before = structuredClone(source);
    const result = await run(
      closeBatchCommands.retry(batchId, {
        channelId: 'CH-01',
        simulatedResult: 'SUCCESS',
        exposure: { netUsd: '-500.00', side: 'SHORT' },
      }),
      source,
    );
    expectFailure(result, 'EXPOSURE_SIDE_CHANGED');
    expect(source).toEqual(before);
  });

  it('重试时敞口已归零/价格过期拒绝（零变更）', async () => {
    const { source, batchId } = await failedBatch(state);

    const flat = await run(
      closeBatchCommands.retry(batchId, {
        channelId: 'CH-01',
        simulatedResult: 'SUCCESS',
        exposure: { netUsd: '0.00', side: 'FLAT' },
      }),
      source,
    );
    expectFailure(flat, 'EXPOSURE_FLAT');

    const stale = withRawPrice(source, {
      pairId: 'USD/EUR',
      channelId: 'CH-02',
      collectedAt: NOW - PRICE_FRESH_MS - 1,
    });
    const before = structuredClone(stale);
    const rejected = await run(
      closeBatchCommands.retry(batchId, {
        channelId: 'CH-02',
        simulatedResult: 'SUCCESS',
        exposure: LONG_2000,
      }),
      stale,
    );
    expectFailure(rejected, 'PRICE_STALE');
    expect(stale).toEqual(before);
  });

  it('重试选择模拟失败仍必须填写原因', async () => {
    const { source, batchId } = await failedBatch(state);
    const before = structuredClone(source);
    const result = await run(
      closeBatchCommands.retry(batchId, {
        channelId: 'CH-01',
        simulatedResult: 'FAILED',
        exposure: LONG_2000,
      }),
      source,
    );
    expectFailure(result, 'FAIL_REASON_REQUIRED');
    expect(source).toEqual(before);
  });
});
