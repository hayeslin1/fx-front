import { beforeEach, describe, expect, it } from 'vitest';
import { D, toRateSig12 } from '../money';
import { buildSeed } from '../seed';
import type { DataState, DomainResult, PairId, RawPrice } from '../types';
import { fxConfigCommands } from './fx-config.service';

// 汇率运营配置：运营权限、配置合法性、模拟采集的确定性与步长循环
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

function stateJson(s: DataState): string {
  return JSON.stringify(s);
}

function expectFailedZero(result: DomainResult<unknown>, beforeJson: string): void {
  expect(result.ok).toBe(false);
  expect(stateJson(state)).toBe(beforeJson);
}

function rawPriceOf(s: DataState, pairId: PairId, channelId: string): RawPrice {
  const price = s.fxConfig.rawPrices.find((r) => r.pairId === pairId && r.channelId === channelId);
  if (!price) throw new Error(`raw price missing: ${pairId} ${channelId}`);
  return price;
}

/** 与实现同口径：百分比步长乘性推进 + 12 位有效位 */
function expectedMid(mid: string, step: string): string {
  return toRateSig12(D(mid).mul(D(1).plus(D(step).div(100)))).toString();
}

describe('销售渠道维护', () => {
  it('新增渠道：生成 CH 编号、createdAt=now，并追加到各币对路由末尾', async () => {
    const result = await fxConfigCommands
      .upsertChannel('OPS-001', { name: '  新渠道  ', enabled: true })
      .run(state, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.channel.name).toBe('新渠道');
    expect(result.data.channel.enabled).toBe(true);
    expect(result.data.channel.createdAt).toBe(NOW);
    expect(result.data.channel.id).toMatch(/^CH-\d{8}-\d{4}$/);
    expect(result.next.counters.CH?.seq).toBe(1);

    const channelId = result.data.channel.id;
    for (const rule of result.next.fxConfig.routing) {
      expect(rule.channelIds[rule.channelIds.length - 1]).toBe(channelId);
      expect(rule.channelIds).toHaveLength(state.fxConfig.channels.length + 1);
    }
    expect(stateJson(state)).not.toBe(stateJson(result.next));
  });

  it('编辑渠道：保留 id/createdAt，更新名称与启停', async () => {
    const original = state.fxConfig.channels[0];
    expect(original).toBeDefined();
    if (!original) return;

    const result = await fxConfigCommands
      .upsertChannel('OPS-001', { id: original.id, name: '华星清算（改）', enabled: false })
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.channel.id).toBe(original.id);
    expect(result.data.channel.createdAt).toBe(original.createdAt);
    expect(result.data.channel.name).toBe('华星清算（改）');
    expect(result.data.channel.enabled).toBe(false);
  });

  it('渠道启停与币对启停只改目标字段', async () => {
    const toggled = await fxConfigCommands
      .toggleChannel('OPS-001', 'CH-01', false)
      .run(state, { now: NOW });
    expect(toggled.ok).toBe(true);
    if (toggled.ok) expect(toggled.data.channel.enabled).toBe(false);

    const pair = await fxConfigCommands
      .togglePair('OPS-001', 'USD/EUR', false)
      .run(state, { now: NOW });
    expect(pair.ok).toBe(true);
    if (pair.ok) {
      expect(pair.data.pair.enabled).toBe(false);
      expect(pair.next.fxConfig.pairs.find((p) => p.id === 'USD/EUR')?.enabled).toBe(false);
      expect(pair.next.fxConfig.pairs.find((p) => p.id === 'USD/GBP')?.enabled).toBe(true);
    }
  });

  it('运营账号不存在、渠道不存在、名称为空均拒绝且零变更', async () => {
    const beforeJson = stateJson(state);
    const noOps = await fxConfigCommands
      .upsertChannel('OPS-999', { name: '渠道', enabled: true })
      .run(state, { now: NOW });
    expectFailedZero(noOps, beforeJson);
    if (!noOps.ok) expect(noOps.code).toBe('OPS_NOT_FOUND');

    const noName = await fxConfigCommands
      .upsertChannel('OPS-001', { name: '   ', enabled: true })
      .run(state, { now: NOW });
    expectFailedZero(noName, beforeJson);
    if (!noName.ok) expect(noName.code).toBe('INVALID_CHANNEL_NAME');

    const unknown = await fxConfigCommands
      .upsertChannel('OPS-001', { id: 'CH-99', name: '渠道', enabled: true })
      .run(state, { now: NOW });
    expectFailedZero(unknown, beforeJson);
    if (!unknown.ok) expect(unknown.code).toBe('CHANNEL_NOT_FOUND');

    const unknownPair = await fxConfigCommands
      .togglePair('OPS-001', 'USD/AUD' as PairId, true)
      .run(state, { now: NOW });
    expectFailedZero(unknownPair, beforeJson);
    if (!unknownPair.ok) expect(unknownPair.code).toBe('PAIR_NOT_FOUND');
  });
});

describe('采集池报价开关', () => {
  it('只切换目标渠道该币对的 quoteEnabled，价格与时间不变', async () => {
    const before = rawPriceOf(state, 'USD/EUR', 'CH-01');
    const result = await fxConfigCommands
      .toggleQuoteEnabled('OPS-001', 'USD/EUR', 'CH-01', false)
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = rawPriceOf(result.next, 'USD/EUR', 'CH-01');
    expect(after.quoteEnabled).toBe(false);
    expect(after.mid).toBe(before.mid);
    expect(after.collectedAt).toBe(before.collectedAt);
    expect(rawPriceOf(result.next, 'USD/EUR', 'CH-02').quoteEnabled).toBe(true);
    expect(rawPriceOf(result.next, 'USD/GBP', 'CH-01').quoteEnabled).toBe(true);
  });

  it('未知渠道/无采集价/无运营权限拒绝且零变更', async () => {
    const beforeJson = stateJson(state);
    const noChannel = await fxConfigCommands
      .toggleQuoteEnabled('OPS-001', 'USD/EUR', 'CH-99', false)
      .run(state, { now: NOW });
    expectFailedZero(noChannel, beforeJson);
    if (!noChannel.ok) expect(noChannel.code).toBe('CHANNEL_NOT_FOUND');

    // 新增渠道没有初始采集价
    const created = await fxConfigCommands
      .upsertChannel('OPS-001', { name: '无价渠道', enabled: true })
      .run(state, { now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const noPrice = await fxConfigCommands
      .toggleQuoteEnabled('OPS-001', 'USD/EUR', created.data.channel.id, false)
      .run(created.next, { now: NOW });
    expect(noPrice.ok).toBe(false);
    if (!noPrice.ok) expect(noPrice.code).toBe('PRICE_NOT_FOUND');
  });
});

describe('路由保存', () => {
  it('合法重排：顺序即优先级', async () => {
    const result = await fxConfigCommands
      .saveRouting('OPS-001', 'USD/EUR', ['CH-02', 'CH-01', 'CH-03'])
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routing.channelIds).toEqual(['CH-02', 'CH-01', 'CH-03']);
    expect(result.next.fxConfig.routing.find((r) => r.pairId === 'USD/EUR')?.channelIds).toEqual([
      'CH-02',
      'CH-01',
      'CH-03',
    ]);
    // 其他币对不变
    expect(result.next.fxConfig.routing.find((r) => r.pairId === 'USD/JPY')?.channelIds).toEqual([
      'CH-02',
      'CH-01',
      'CH-03',
    ]);
  });

  it('重复/未知/未覆盖全部渠道均拒绝且零变更', async () => {
    const candidates = [
      ['CH-01', 'CH-01', 'CH-02'],
      ['CH-01', 'CH-02', 'CH-99'],
      ['CH-01', 'CH-02'],
      [],
    ];
    for (const channelIds of candidates) {
      const beforeJson = stateJson(state);
      const result = await fxConfigCommands
        .saveRouting('OPS-001', 'USD/EUR', channelIds)
        .run(state, { now: NOW });
      expectFailedZero(result, beforeJson);
      if (!result.ok) expect(result.code).toBe('INVALID_ROUTING');
    }
  });
});

describe('加点保存', () => {
  it('合法 bps（含 0/1000 边界）保存成功', async () => {
    for (const bps of [0, 100, 1000]) {
      const result = await fxConfigCommands
        .saveMarkup('OPS-001', 'USD/EUR', bps)
        .run(state, { now: NOW });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.markup.halfSpreadBps).toBe(bps);
    }
  });

  it('负数/超上限/非整数/NaN 拒绝且零变更', async () => {
    for (const bps of [-1, 1001, 1.5, Number.NaN]) {
      const beforeJson = stateJson(state);
      const result = await fxConfigCommands
        .saveMarkup('OPS-001', 'USD/EUR', bps)
        .run(state, { now: NOW });
      expectFailedZero(result, beforeJson);
      if (!result.ok) expect(result.code).toBe('INVALID_BPS');
    }
  });
});

describe('模拟采集', () => {
  it('单行采集：按 nextIndex 推进价格、刷新采集时间并前移游标', async () => {
    const result = await fxConfigCommands
      .collect('OPS-001', 'USD/EUR', 'CH-01')
      .run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seq = result.next.fxConfig.collectSteps.find((s) => s.pairId === 'USD/EUR');
    expect(seq?.nextIndex).toBe(1);
    expect(result.data.rawPrice.mid).toBe(expectedMid('0.9200', '-0.12'));
    expect(result.data.rawPrice.collectedAt).toBe(NOW);
    expect(result.data.rawPrice.quoteEnabled).toBe(true);

    // 同币对其他渠道不动；其他币对不动
    expect(rawPriceOf(result.next, 'USD/EUR', 'CH-02').mid).toBe('0.9205');
    expect(rawPriceOf(result.next, 'USD/GBP', 'CH-01').collectedAt).not.toBe(NOW);
  });

  it('确定性：同一初始状态 + 同一 now 连续两次运行结果深等', async () => {
    const first = await fxConfigCommands
      .collect('OPS-001', 'USD/JPY', 'CH-02')
      .run(state, { now: NOW });
    const second = await fxConfigCommands
      .collect('OPS-001', 'USD/JPY', 'CH-02')
      .run(state, { now: NOW });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.next).toEqual(second.next);
  });

  it('步长序列循环：四次采集后 nextIndex 归零', async () => {
    let current = state;
    const indexes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await fxConfigCommands
        .collect('OPS-001', 'USD/EUR', 'CH-01')
        .run(current, { now: NOW + i });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      current = result.next;
      indexes.push(
        current.fxConfig.collectSteps.find((s) => s.pairId === 'USD/EUR')?.nextIndex ?? -1,
      );
    }
    expect(indexes).toEqual([1, 2, 3, 0]);
  });

  it('全部采集：每个币对用同一步长推进全部渠道，游标每币对仅前移一次', async () => {
    const result = await fxConfigCommands.collectAll('OPS-001').run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const pairId of state.fxConfig.pairs.map((p) => p.id)) {
      const seq = result.next.fxConfig.collectSteps.find((s) => s.pairId === pairId);
      expect(seq?.nextIndex).toBe(1);
    }
    expect(rawPriceOf(result.next, 'USD/EUR', 'CH-01').mid).toBe(expectedMid('0.9200', '-0.12'));
    expect(rawPriceOf(result.next, 'USD/EUR', 'CH-02').mid).toBe(expectedMid('0.9205', '-0.12'));
    expect(rawPriceOf(result.next, 'USD/EUR', 'CH-03').mid).toBe(expectedMid('0.9198', '-0.12'));
    expect(rawPriceOf(result.next, 'USD/JPY', 'CH-02').mid).toBe(expectedMid('151.00', '-0.12'));
    for (const price of result.next.fxConfig.rawPrices) {
      expect(price.collectedAt).toBe(NOW);
    }
    expect(result.next.fxConfig.rawPrices).toHaveLength(state.fxConfig.rawPrices.length);
  });

  it('采集失败（无价/缺步长）拒绝且零变更', async () => {
    const created = await fxConfigCommands
      .upsertChannel('OPS-001', { name: '无价渠道', enabled: true })
      .run(state, { now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeCreatedJson = stateJson(created.next);
    const noPrice = await fxConfigCommands
      .collect('OPS-001', 'USD/EUR', created.data.channel.id)
      .run(created.next, { now: NOW });
    expect(noPrice.ok).toBe(false);
    if (!noPrice.ok) expect(noPrice.code).toBe('PRICE_NOT_FOUND');
    expect(stateJson(created.next)).toBe(beforeCreatedJson);

    const corrupted: DataState = {
      ...state,
      fxConfig: {
        ...state.fxConfig,
        collectSteps: state.fxConfig.collectSteps.filter((s) => s.pairId !== 'USD/EUR'),
      },
    };
    const beforeCorruptedJson = stateJson(corrupted);
    const noSteps = await fxConfigCommands
      .collect('OPS-001', 'USD/EUR', 'CH-01')
      .run(corrupted, { now: NOW });
    expect(noSteps.ok).toBe(false);
    if (!noSteps.ok) expect(noSteps.code).toBe('COLLECT_STEPS_MISSING');
    expect(stateJson(corrupted)).toBe(beforeCorruptedJson);
  });
});

describe('运营权限口径', () => {
  it('全部写命令在操作者不存在时返回 OPS_NOT_FOUND 且零变更', async () => {
    const beforeJson = stateJson(state);
    const results = await Promise.all([
      fxConfigCommands
        .upsertChannel('OPS-999', { name: 'x', enabled: true })
        .run(state, { now: NOW }),
      fxConfigCommands.toggleChannel('OPS-999', 'CH-01', false).run(state, { now: NOW }),
      fxConfigCommands.togglePair('OPS-999', 'USD/EUR', false).run(state, { now: NOW }),
      fxConfigCommands
        .toggleQuoteEnabled('OPS-999', 'USD/EUR', 'CH-01', false)
        .run(state, { now: NOW }),
      fxConfigCommands
        .saveRouting('OPS-999', 'USD/EUR', ['CH-01', 'CH-02', 'CH-03'])
        .run(state, { now: NOW }),
      fxConfigCommands.saveMarkup('OPS-999', 'USD/EUR', 60).run(state, { now: NOW }),
      fxConfigCommands.collect('OPS-999', 'USD/EUR', 'CH-01').run(state, { now: NOW }),
      fxConfigCommands.collectAll('OPS-999').run(state, { now: NOW }),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('OPS_NOT_FOUND');
    }
    expect(stateJson(state)).toBe(beforeJson);
  });
});
