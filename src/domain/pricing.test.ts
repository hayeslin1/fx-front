import { describe, expect, it } from 'vitest';
import { D } from './money';
import { getQuote } from './pricing';
import type { PricingConfig } from './pricing';
import type { Channel, Currency, PairId, RawPrice, TradeDirection } from './types';

// 固定时间夹具：报价引擎不读真实时钟，所有新鲜度/有效期断言均以此为准。
const NOW = Date.UTC(2026, 9, 28, 8, 0, 0);
const TWO_MIN = 2 * 60_000;
const TEN_MIN = 10 * 60_000;

const PAIRS: PairId[] = ['USD/EUR', 'USD/GBP', 'USD/JPY', 'USD/CNH', 'USD/HKD'];

/** 与 §5.4 金样一致的渠道原始中间价（1 USD = R 报价币） */
const MIDS: Record<PairId, Record<string, string>> = {
  'USD/EUR': { 'CH-01': '0.9200', 'CH-02': '0.9205', 'CH-03': '0.9198' },
  'USD/GBP': { 'CH-01': '0.7850', 'CH-02': '0.7852', 'CH-03': '0.7848' },
  'USD/JPY': { 'CH-01': '151.20', 'CH-02': '151.00', 'CH-03': '150.90' },
  'USD/CNH': { 'CH-01': '7.2450', 'CH-02': '7.2460', 'CH-03': '7.2430' },
  'USD/HKD': { 'CH-01': '7.8100', 'CH-02': '7.8110', 'CH-03': '7.8080' },
};

/** USD/JPY 主渠道为 CH-02（路由首位），用于验证“主渠道非路由数组首位”的回退语义 */
const ROUTING: Record<PairId, string[]> = {
  'USD/EUR': ['CH-01', 'CH-02', 'CH-03'],
  'USD/GBP': ['CH-01', 'CH-02', 'CH-03'],
  'USD/JPY': ['CH-02', 'CH-01', 'CH-03'],
  'USD/CNH': ['CH-01', 'CH-02', 'CH-03'],
  'USD/HKD': ['CH-01', 'CH-02', 'CH-03'],
};

function makeChannel(id: string, enabled = true): Channel {
  return { id, name: id, enabled, createdAt: NOW - 86_400_000 };
}

/** 完整可用的报价配置：CH-03 停用，其余渠道有 2 分钟内的新鲜价 */
function makeConfig(): PricingConfig {
  const channels = [makeChannel('CH-01'), makeChannel('CH-02'), makeChannel('CH-03', false)];
  const pairs = PAIRS.map((id) => ({ id, enabled: true }));
  const rawPrices: RawPrice[] = [];
  for (const pairId of PAIRS) {
    for (const channel of channels) {
      rawPrices.push({
        pairId,
        channelId: channel.id,
        mid: MIDS[pairId]![channel.id]!,
        collectedAt: NOW - TWO_MIN,
        quoteEnabled: true,
      });
    }
  }
  return {
    channels,
    pairs,
    rawPrices,
    routing: PAIRS.map((pairId) => ({ pairId, channelIds: [...ROUTING[pairId]!] })),
    markups: PAIRS.map((pairId) => ({ pairId, halfSpreadBps: 50 })),
  };
}

/** 单渠道夹具：用于隔离新鲜度边界，避免其它渠道回退掩盖失败原因 */
function makeSingleChannelConfig(
  pairId: PairId,
  mid: string,
  collectedAt: number,
): PricingConfig {
  return {
    channels: [makeChannel('CH-01')],
    pairs: [{ id: pairId, enabled: true }],
    rawPrices: [{ pairId, channelId: 'CH-01', mid, collectedAt, quoteEnabled: true }],
    routing: [{ pairId, channelIds: ['CH-01'] }],
    markups: [{ pairId, halfSpreadBps: 50 }],
  };
}

function askQuote(
  cfg: PricingConfig,
  pairId: PairId,
  direction: TradeDirection,
  sourceAmount: string,
) {
  return getQuote(cfg, { pairId, direction, sourceAmount }, NOW);
}

/** 断言失败并返回收敛后的失败结构，避免每处重复 if (!ok) throw */
function expectFailure(result: ReturnType<typeof getQuote>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('预期取价失败，实际成功');
  return result;
}

// ---------- §12.1：10 个有向兑换方向的 bid/ask 公式 ----------

interface DirectionCase {
  pairId: PairId;
  direction: TradeDirection;
  sourceAmount: string;
  expectedSourceAmount: string;
  sourceCurrency: Currency;
  targetCurrency: Currency;
  expectedChannel: string;
  expectedMid: string;
  expectedClientRate: string;
  expectedTargetAmount: string;
}

const DIRECTION_CASES: DirectionCase[] = [
  // SELL_USD：bid = mid × (1 − 50/10000)，目标 = 来源 USD × bid
  {
    pairId: 'USD/EUR',
    direction: 'SELL_USD',
    sourceAmount: '1000.00',
    expectedSourceAmount: '1000.00',
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    expectedChannel: 'CH-01',
    expectedMid: '0.9200',
    expectedClientRate: '0.9154',
    expectedTargetAmount: '915.40',
  },
  {
    pairId: 'USD/GBP',
    direction: 'SELL_USD',
    sourceAmount: '1000.00',
    expectedSourceAmount: '1000.00',
    sourceCurrency: 'USD',
    targetCurrency: 'GBP',
    expectedChannel: 'CH-01',
    expectedMid: '0.7850',
    expectedClientRate: '0.781075',
    expectedTargetAmount: '781.08',
  },
  {
    pairId: 'USD/JPY',
    direction: 'SELL_USD',
    sourceAmount: '1000.00',
    expectedSourceAmount: '1000.00',
    sourceCurrency: 'USD',
    targetCurrency: 'JPY',
    expectedChannel: 'CH-02',
    expectedMid: '151.00',
    expectedClientRate: '150.245',
    expectedTargetAmount: '150245',
  },
  {
    pairId: 'USD/CNH',
    direction: 'SELL_USD',
    sourceAmount: '1000.00',
    expectedSourceAmount: '1000.00',
    sourceCurrency: 'USD',
    targetCurrency: 'CNH',
    expectedChannel: 'CH-01',
    expectedMid: '7.2450',
    expectedClientRate: '7.208775',
    expectedTargetAmount: '7208.78',
  },
  {
    pairId: 'USD/HKD',
    direction: 'SELL_USD',
    sourceAmount: '1000.00',
    expectedSourceAmount: '1000.00',
    sourceCurrency: 'USD',
    targetCurrency: 'HKD',
    expectedChannel: 'CH-01',
    expectedMid: '7.8100',
    expectedClientRate: '7.77095',
    expectedTargetAmount: '7770.95',
  },
  // BUY_USD：ask = mid × (1 + 50/10000)，目标 = 来源外币 ÷ ask
  {
    pairId: 'USD/EUR',
    direction: 'BUY_USD',
    sourceAmount: '920.00',
    expectedSourceAmount: '920.00',
    sourceCurrency: 'EUR',
    targetCurrency: 'USD',
    expectedChannel: 'CH-01',
    expectedMid: '0.9200',
    expectedClientRate: '0.9246',
    expectedTargetAmount: '995.02',
  },
  {
    pairId: 'USD/GBP',
    direction: 'BUY_USD',
    sourceAmount: '785.00',
    expectedSourceAmount: '785.00',
    sourceCurrency: 'GBP',
    targetCurrency: 'USD',
    expectedChannel: 'CH-01',
    expectedMid: '0.7850',
    expectedClientRate: '0.788925',
    expectedTargetAmount: '995.02',
  },
  {
    pairId: 'USD/JPY',
    direction: 'BUY_USD',
    sourceAmount: '151000',
    expectedSourceAmount: '151000',
    sourceCurrency: 'JPY',
    targetCurrency: 'USD',
    expectedChannel: 'CH-02',
    expectedMid: '151.00',
    expectedClientRate: '151.755',
    expectedTargetAmount: '995.02',
  },
  {
    pairId: 'USD/CNH',
    direction: 'BUY_USD',
    sourceAmount: '7245.00',
    expectedSourceAmount: '7245.00',
    sourceCurrency: 'CNH',
    targetCurrency: 'USD',
    expectedChannel: 'CH-01',
    expectedMid: '7.2450',
    expectedClientRate: '7.281225',
    expectedTargetAmount: '995.02',
  },
  {
    pairId: 'USD/HKD',
    direction: 'BUY_USD',
    sourceAmount: '7810.00',
    expectedSourceAmount: '7810.00',
    sourceCurrency: 'HKD',
    targetCurrency: 'USD',
    expectedChannel: 'CH-01',
    expectedMid: '7.8100',
    expectedClientRate: '7.84905',
    expectedTargetAmount: '995.02',
  },
];

describe('getQuote：10 个有向兑换方向的 bid/ask 公式', () => {
  it.each(DIRECTION_CASES)(
    '$pairId $direction：客户成交价与目标金额',
    (testCase) => {
      const result = askQuote(
        makeConfig(),
        testCase.pairId,
        testCase.direction,
        testCase.sourceAmount,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`预期取价成功，实际失败：${result.reason}`);

      const quote = result.quote;
      expect(quote.pairId).toBe(testCase.pairId);
      expect(quote.direction).toBe(testCase.direction);
      expect(quote.channelId).toBe(testCase.expectedChannel);
      expect(D(quote.mid).eq(testCase.expectedMid)).toBe(true);
      expect(quote.clientRate).toBe(testCase.expectedClientRate);
      expect(quote.sourceCurrency).toBe(testCase.sourceCurrency);
      expect(quote.targetCurrency).toBe(testCase.targetCurrency);
      expect(quote.sourceAmount).toBe(testCase.expectedSourceAmount);
      expect(quote.targetAmount).toBe(testCase.expectedTargetAmount);
      expect(quote.halfSpreadBps).toBe(50);
      expect(quote.fee).toBe('0');
      expect(quote.priceCollectedAt).toBe(NOW - TWO_MIN);
      expect(quote.createdAt).toBe(NOW);
      expect(quote.expiresAt).toBe(NOW + 30_000);
      expect(quote.quoteId.length).toBeGreaterThan(0);
    },
  );

  it('JPY 目标金额按 0 位小数 HALF_UP 舍入', () => {
    // 151.00 × 0.995 = 150.245；1000 × 150.245 = 150245，本身就是整数金样
    const result = askQuote(makeConfig(), 'USD/JPY', 'SELL_USD', '1000.00');
    if (!result.ok) throw new Error('预期取价成功');
    expect(result.quote.targetAmount).toBe('150245');
  });
});

// ---------- §12.1：限额边界（按原始 mid 折算，不计点差） ----------

describe('getQuote：单笔限额 1–10,000 USD（按 mid 折算）', () => {
  it('SELL_USD 恰为 1 USD：通过（下边界含）', () => {
    const result = askQuote(makeConfig(), 'USD/EUR', 'SELL_USD', '1.00');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quote.sourceAmount).toBe('1.00');
  });

  it('SELL_USD 恰为 10,000 USD：通过（上边界含）', () => {
    expect(askQuote(makeConfig(), 'USD/EUR', 'SELL_USD', '10000.00').ok).toBe(true);
  });

  it('SELL_USD 低于 1 USD：BELOW_MIN', () => {
    expect(expectFailure(askQuote(makeConfig(), 'USD/EUR', 'SELL_USD', '0.99')).reason).toBe(
      'BELOW_MIN',
    );
  });

  it('SELL_USD 高于 10,000 USD：ABOVE_MAX', () => {
    expect(
      expectFailure(askQuote(makeConfig(), 'USD/EUR', 'SELL_USD', '10000.01')).reason,
    ).toBe('ABOVE_MAX');
  });

  it('BUY_USD 按 mid 折算恰为 1 USD：通过（若误用 ask 会跌破下限）', () => {
    // 0.92 EUR ÷ mid 0.9200 = 1.00 USD；若按 ask 0.9246 折算仅 0.995 USD
    const result = askQuote(makeConfig(), 'USD/EUR', 'BUY_USD', '0.92');
    expect(result.ok).toBe(true);
  });

  it('BUY_USD 按 mid 折算恰为 10,000 USD：通过', () => {
    // 9,200 EUR ÷ 0.9200 = 10,000 USD
    expect(askQuote(makeConfig(), 'USD/EUR', 'BUY_USD', '9200.00').ok).toBe(true);
  });

  it('BUY_USD 按 mid 折算低于 1 USD：BELOW_MIN', () => {
    expect(expectFailure(askQuote(makeConfig(), 'USD/EUR', 'BUY_USD', '0.91')).reason).toBe(
      'BELOW_MIN',
    );
  });

  it('BUY_USD 按 mid 折算高于 10,000 USD：ABOVE_MAX（若误用 ask 会误判通过）', () => {
    // 9,200.01 EUR ÷ 0.9200 = 10,000.0108…；若按 ask 0.9246 仅 9,950.02
    expect(expectFailure(askQuote(makeConfig(), 'USD/EUR', 'BUY_USD', '9200.01')).reason).toBe(
      'ABOVE_MAX',
    );
  });
});

// ---------- §12.1：来源金额格式（JPY 仅整数） ----------

describe('getQuote：来源金额格式校验', () => {
  it('JPY 小数输入拒绝', () => {
    expect(
      expectFailure(askQuote(makeConfig(), 'USD/JPY', 'BUY_USD', '151200.5')).reason,
    ).toBe('INVALID_AMOUNT');
    expect(
      expectFailure(askQuote(makeConfig(), 'USD/JPY', 'BUY_USD', '151200.00')).reason,
    ).toBe('INVALID_AMOUNT');
  });

  it('JPY 整数输入通过', () => {
    expect(askQuote(makeConfig(), 'USD/JPY', 'BUY_USD', '151200').ok).toBe(true);
  });

  it('两位小数币种拒绝三位小数', () => {
    expect(
      expectFailure(askQuote(makeConfig(), 'USD/EUR', 'BUY_USD', '920.001')).reason,
    ).toBe('INVALID_AMOUNT');
  });

  it('拒绝非数字 / 负数 / 零', () => {
    for (const amount of ['abc', '-100.00', '0', '0.00', '']) {
      expect(
        expectFailure(askQuote(makeConfig(), 'USD/EUR', 'SELL_USD', amount)).reason,
      ).toBe('INVALID_AMOUNT');
    }
  });

  it('科学计数法不被接受', () => {
    expect(
      expectFailure(askQuote(makeConfig(), 'USD/EUR', 'SELL_USD', '1e3')).reason,
    ).toBe('INVALID_AMOUNT');
  });
});

// ---------- §12.1：目标金额舍入 ----------

describe('getQuote：目标金额按目标币精度 HALF_UP', () => {
  it('EUR 恰为 .005 时向上进位', () => {
    const cfg = makeConfig();
    // 构造 bid = 1.005：mid 1.005 + 0bps，1 USD → 1.005 EUR → 1.01
    cfg.markups = cfg.markups.map((item) =>
      item.pairId === 'USD/EUR' ? { ...item, halfSpreadBps: 0 } : item,
    );
    for (const raw of cfg.rawPrices) {
      if (raw.pairId === 'USD/EUR' && raw.channelId === 'CH-01') raw.mid = '1.005';
    }
    const result = askQuote(cfg, 'USD/EUR', 'SELL_USD', '1.00');
    if (!result.ok) throw new Error('预期取价成功');
    expect(result.quote.targetAmount).toBe('1.01');
  });

  it('JPY 恰为 .5 时向上进位', () => {
    const cfg = makeConfig();
    cfg.markups = cfg.markups.map((item) =>
      item.pairId === 'USD/JPY' ? { ...item, halfSpreadBps: 0 } : item,
    );
    for (const raw of cfg.rawPrices) {
      if (raw.pairId === 'USD/JPY' && raw.channelId === 'CH-02') raw.mid = '100.5';
    }
    const result = askQuote(cfg, 'USD/JPY', 'SELL_USD', '1.00');
    if (!result.ok) throw new Error('预期取价成功');
    expect(result.quote.targetAmount).toBe('101');
  });
});

// ---------- §12.1：采集价新鲜度边界 ----------

describe('getQuote：原始价 10 分钟新鲜度边界', () => {
  it('恰为 10 分钟：仍有效', () => {
    const cfg = makeSingleChannelConfig('USD/EUR', '0.9200', NOW - TEN_MIN);
    const result = askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00');
    expect(result.ok).toBe(true);
  });

  it('超过 10 分钟 1ms：失效并给出 PRICE_STALE 诊断', () => {
    const cfg = makeSingleChannelConfig('USD/EUR', '0.9200', NOW - TEN_MIN - 1);
    const result = expectFailure(askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00'));
    expect(result.reason).toBe('NO_QUOTE');
    expect(result.diagnostics).toEqual([{ channelId: 'CH-01', reason: 'PRICE_STALE' }]);
  });
});

// ---------- §12.1：路由回退与原因诊断 ----------

describe('getQuote：路由选源与回退', () => {
  it('首位渠道停用 → 回退次位', () => {
    const cfg = makeConfig();
    cfg.channels[0]!.enabled = false;
    const result = askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00');
    if (!result.ok) throw new Error('预期回退到次位渠道成功');
    expect(result.quote.channelId).toBe('CH-02');
    expect(D(result.quote.mid).eq('0.9205')).toBe(true);
    expect(result.quote.clientRate).toBe('0.9158975');
  });

  it('首位渠道报价停用 → 回退次位', () => {
    const cfg = makeConfig();
    const first = cfg.rawPrices.find(
      (raw) => raw.pairId === 'USD/EUR' && raw.channelId === 'CH-01',
    );
    if (first === undefined) throw new Error('夹具缺少 CH-01 价格');
    first.quoteEnabled = false;
    const result = askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00');
    if (!result.ok) throw new Error('预期回退到次位渠道成功');
    expect(result.quote.channelId).toBe('CH-02');
  });

  it('主渠道不在路由数组首位时，按路由优先级选中（USD/JPY → CH-02）', () => {
    const result = askQuote(makeConfig(), 'USD/JPY', 'SELL_USD', '1000.00');
    if (!result.ok) throw new Error('预期取价成功');
    expect(result.quote.channelId).toBe('CH-02');
    expect(D(result.quote.mid).eq('151.00')).toBe(true);
    expect(result.quote.clientRate).toBe('150.245');
  });

  it('全部渠道不可用 → NO_QUOTE 且逐渠道原因完整', () => {
    const cfg: PricingConfig = {
      channels: [
        makeChannel('CH-01', false),
        makeChannel('CH-02'),
        makeChannel('CH-03'),
        makeChannel('CH-04'),
        makeChannel('CH-05'),
      ],
      pairs: [{ id: 'USD/EUR', enabled: true }],
      rawPrices: [
        {
          pairId: 'USD/EUR',
          channelId: 'CH-01',
          mid: '0.9200',
          collectedAt: NOW - TWO_MIN,
          quoteEnabled: true,
        },
        {
          pairId: 'USD/EUR',
          channelId: 'CH-02',
          mid: '0.9205',
          collectedAt: NOW - TWO_MIN,
          quoteEnabled: false,
        },
        {
          pairId: 'USD/EUR',
          channelId: 'CH-03',
          mid: '0.9198',
          collectedAt: NOW - TEN_MIN - 1,
          quoteEnabled: true,
        },
        {
          pairId: 'USD/EUR',
          channelId: 'CH-04',
          mid: '0.9199',
          collectedAt: NOW - TWO_MIN,
          quoteEnabled: true,
        },
        // CH-05 在路由中但没有任何采集价
      ],
      routing: [
        { pairId: 'USD/EUR', channelIds: ['CH-01', 'CH-02', 'CH-03', 'CH-05'] },
      ],
      markups: [{ pairId: 'USD/EUR', halfSpreadBps: 50 }],
    };

    const result = expectFailure(askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00'));
    expect(result.reason).toBe('NO_QUOTE');
    expect(result.diagnostics).toEqual([
      { channelId: 'CH-01', reason: 'CHANNEL_DISABLED' },
      { channelId: 'CH-02', reason: 'PRICE_DISABLED' },
      { channelId: 'CH-03', reason: 'PRICE_STALE' },
      { channelId: 'CH-04', reason: 'NOT_IN_ROUTING' },
      { channelId: 'CH-05', reason: 'NO_PRICE' },
    ]);
  });

  it('无路由配置 → 全部渠道标记 NOT_IN_ROUTING', () => {
    const cfg = makeConfig();
    cfg.routing = [];
    const result = expectFailure(askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00'));
    expect(result.reason).toBe('NO_QUOTE');
    expect(result.diagnostics).toEqual([
      { channelId: 'CH-01', reason: 'NOT_IN_ROUTING' },
      { channelId: 'CH-02', reason: 'NOT_IN_ROUTING' },
      { channelId: 'CH-03', reason: 'NOT_IN_ROUTING' },
    ]);
  });

  it('币对停用 → PAIR_DISABLED（双向均不可报价）', () => {
    const cfg = makeConfig();
    cfg.pairs[0]!.enabled = false;
    expect(expectFailure(askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00')).reason).toBe(
      'PAIR_DISABLED',
    );
    expect(expectFailure(askQuote(cfg, 'USD/EUR', 'BUY_USD', '920.00')).reason).toBe(
      'PAIR_DISABLED',
    );
  });
});

// ---------- §12.1：报价快照语义 ----------

describe('getQuote：报价快照不随配置变更', () => {
  it('已发出的报价对象保持不变，重新取价才反映新配置', () => {
    const cfg = makeConfig();
    const first = askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00');
    if (!first.ok) throw new Error('预期首次取价成功');
    const snapshot = { ...first.quote };

    // 变更采集价、报价开关、路由、加点、渠道与币对启停
    for (const raw of cfg.rawPrices) {
      if (raw.pairId !== 'USD/EUR') continue;
      raw.mid = '9.9999';
      raw.collectedAt = NOW;
      raw.quoteEnabled = false;
    }
    cfg.routing = cfg.routing.map((item) =>
      item.pairId === 'USD/EUR'
        ? { ...item, channelIds: ['CH-02', 'CH-01', 'CH-03'] }
        : item,
    );
    cfg.markups = cfg.markups.map((item) =>
      item.pairId === 'USD/EUR' ? { ...item, halfSpreadBps: 500 } : item,
    );
    cfg.channels[0]!.enabled = false;
    cfg.pairs[0]!.enabled = false;

    // 旧报价是纯数据快照，不引用配置对象
    expect(first.quote).toEqual(snapshot);

    // 新报价重新读取配置：币对已停用，直接拒绝
    expect(expectFailure(askQuote(cfg, 'USD/EUR', 'SELL_USD', '1000.00')).reason).toBe(
      'PAIR_DISABLED',
    );
  });
});
