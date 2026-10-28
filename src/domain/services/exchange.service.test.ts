import { beforeEach, describe, expect, it } from 'vitest';
import { D } from '../money';
import { getQuote } from '../pricing';
import { buildSeed } from '../seed';
import type { Currency, DataState, DomainResult, PairId, Quote, TradeDirection, Wallet } from '../types';
import { exchangeCommands } from './exchange.service';

// 成交提交（§6.3）：过期/余额/防篡改/防重复校验与单次原子写入
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const CUSTOMER_ID = 'C-001';
let state: DataState;

beforeEach(async () => {
  state = await buildSeed(NOW);
});

function walletOf(source: DataState, customerId: string, currency: Currency): Wallet {
  const wallet = source.wallets.find(
    (item) => item.customerId === customerId && item.currency === currency,
  );
  if (!wallet) throw new Error(`钱包不存在：${customerId} ${currency}`);
  return wallet;
}

/** 手工构造报价：用于边界与篡改用例；正常情况下一律经 pricing.getQuote 生成 */
function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    quoteId: 'Q-MANUAL-1',
    pairId: 'USD/EUR',
    direction: 'SELL_USD',
    channelId: 'CH-01',
    mid: '0.9200',
    priceCollectedAt: NOW - 120_000,
    halfSpreadBps: 50,
    clientRate: '0.9154',
    sourceCurrency: 'USD',
    sourceAmount: '500.00',
    targetCurrency: 'EUR',
    targetAmount: '457.70',
    fee: '0',
    createdAt: NOW,
    expiresAt: NOW + 30_000,
    ...overrides,
  };
}

async function runQuote(
  source: DataState,
  direction: TradeDirection,
  pairId: PairId,
  amount: string,
): Promise<Quote> {
  const quoted = getQuote(source.fxConfig, { pairId, direction, sourceAmount: amount }, NOW);
  if (!quoted.ok) throw new Error(`取价失败：${quoted.reason}`);
  return quoted.quote;
}

function expectFailure<T>(result: DomainResult<T>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe('submit 成功（单次原子写入）', () => {
  it('卖 USD：两腿余额、两条流水、订单快照与编号一次写入，其余事实不变', async () => {
    const quote = await runQuote(state, 'SELL_USD', 'USD/EUR', '500.00');
    expect(quote.targetAmount).toBe('457.70'); // 500 × 0.92 × 0.995，EUR 2 位

    const usdBefore = walletOf(state, CUSTOMER_ID, 'USD').balance;
    const eurBefore = walletOf(state, CUSTOMER_ID, 'EUR').balance;
    const before = structuredClone(state);

    const result = await exchangeCommands.submit(CUSTOMER_ID, quote).run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 订单：编号 EX、完成态、fee 0、quoteId 落库、快照字段完整
    const order = result.data.order;
    expect(order.id).toBe('EX-20261028-0001');
    expect(order.customerId).toBe(CUSTOMER_ID);
    expect(order.status).toBe('COMPLETED');
    expect(order.fee).toBe('0');
    expect(order.quoteId).toBe(quote.quoteId);
    expect(order.sourceCurrency).toBe('USD');
    expect(order.targetCurrency).toBe('EUR');
    expect(order.sourceAmount).toBe('500.00');
    expect(order.targetAmount).toBe('457.70');
    expect(order.createdAt).toBe(NOW);
    expect(order.snapshot).toEqual({
      clientRate: quote.clientRate,
      mid: quote.mid,
      channelId: quote.channelId,
      priceCollectedAt: quote.priceCollectedAt,
      executedAt: NOW,
    });

    // 钱包：来源精确扣减、目标精确入账（币种精度 2 位）
    const usdAfter = walletOf(result.next, CUSTOMER_ID, 'USD');
    const eurAfter = walletOf(result.next, CUSTOMER_ID, 'EUR');
    expect(usdAfter.balance).toBe('20000.00');
    expect(eurAfter.balance).toBe('8660.85');
    expect(D(usdBefore).minus(usdAfter.balance).eq(500)).toBe(true);
    expect(D(eurAfter.balance).minus(eurBefore).eq('457.70')).toBe(true);

    // 流水链：DEBIT 负数 / CREDIT 正数、前后余额、关联订单
    expect(result.data.bills.map((bill) => bill.id)).toEqual([
      'BL-20261028-0001',
      'BL-20261028-0002',
    ]);
    const [debit, credit] = result.data.bills;
    expect(debit).toEqual({
      id: 'BL-20261028-0001',
      customerId: CUSTOMER_ID,
      currency: 'USD',
      type: 'EXCHANGE_DEBIT',
      amount: '-500.00',
      balanceBefore: '20500.00',
      balanceAfter: '20000.00',
      relatedOrderId: order.id,
      createdAt: NOW,
    });
    expect(credit).toEqual({
      id: 'BL-20261028-0002',
      customerId: CUSTOMER_ID,
      currency: 'EUR',
      type: 'EXCHANGE_CREDIT',
      amount: '457.70',
      balanceBefore: '8203.15',
      balanceAfter: '8660.85',
      relatedOrderId: order.id,
      createdAt: NOW,
    });
    // 流水前后余额与钱包恒等（余额 = Σ流水链）
    expect(debit?.balanceAfter).toBe(usdAfter.balance);
    expect(credit?.balanceAfter).toBe(eurAfter.balance);

    // 计数器：EX +1、BL +2；其余切片逐一同引用（无账本/其他写入）
    expect(result.next.counters.EX).toEqual({ day: '20261028', seq: 1 });
    expect(result.next.counters.BL).toEqual({ day: '20261028', seq: 2 });
    expect(result.next.orders).toHaveLength(before.orders.length + 1);
    expect(result.next.bills).toHaveLength(before.bills.length + 2);
    expect(result.next.closeBatches).toEqual(before.closeBatches);
    expect(result.next.tickets).toEqual(before.tickets);
    expect(result.next.fxConfig).toEqual(before.fxConfig);
    expect(result.next.customers).toEqual(before.customers);
    expect(result.next.meta).toEqual(before.meta);
    // 未参与兑换客户的钱包不变
    expect(
      result.next.wallets.filter((wallet) => wallet.customerId !== CUSTOMER_ID),
    ).toEqual(before.wallets.filter((wallet) => wallet.customerId !== CUSTOMER_ID));

    // 纯函数：入参 state 未被原地修改
    expect(state).toEqual(before);
  });

  it('买 USD：来源扣报价币、目标入 USD，金额沿用报价快照', async () => {
    const quote = await runQuote(state, 'BUY_USD', 'USD/JPY', '300000');
    expect(quote.sourceCurrency).toBe('JPY');
    expect(quote.targetCurrency).toBe('USD');

    const before = structuredClone(state);
    const result = await exchangeCommands.submit('C-002', quote).run(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const jpyAfter = walletOf(result.next, 'C-002', 'JPY');
    const usdAfter = walletOf(result.next, 'C-002', 'USD');
    expect(jpyAfter.balance).toBe(
      D(walletOf(before, 'C-002', 'JPY').balance).minus('300000').toFixed(0),
    );
    expect(usdAfter.balance).toBe(
      D(walletOf(before, 'C-002', 'USD').balance).plus(quote.targetAmount).toFixed(2),
    );
    expect(result.data.order.targetAmount).toBe(quote.targetAmount);
    expect(result.data.bills[0]?.currency).toBe('JPY');
    expect(result.data.bills[1]?.currency).toBe('USD');
  });
});

describe('submit 校验顺序与边界', () => {
  it('客户不存在拒绝，且优先于过期校验', async () => {
    const quote = makeQuote({ expiresAt: NOW - 1 });
    const before = structuredClone(state);
    const result = await exchangeCommands.submit('C-999', quote).run(state, { now: NOW });
    expectFailure(result, 'CUSTOMER_NOT_FOUND');
    expect(state).toEqual(before);
  });

  it('报价币种与方向不一致（篡改）拒绝，且优先于过期校验', async () => {
    const forged = makeQuote({
      sourceCurrency: 'EUR',
      targetCurrency: 'USD',
      expiresAt: NOW - 1,
    });
    const before = structuredClone(state);
    const result = await exchangeCommands.submit(CUSTOMER_ID, forged).run(state, { now: NOW });
    expectFailure(result, 'QUOTE_MISMATCH');
    expect(state).toEqual(before);
  });

  it('过期边界：now == expiresAt 即过期（零变更），expiresAt - 1ms 仍可成交', async () => {
    const quote = makeQuote();

    const before = structuredClone(state);
    const expired = await exchangeCommands
      .submit(CUSTOMER_ID, quote)
      .run(state, { now: quote.expiresAt });
    expectFailure(expired, 'QUOTE_EXPIRED');
    expect(state).toEqual(before);

    const ok = await exchangeCommands
      .submit(CUSTOMER_ID, quote)
      .run(state, { now: quote.expiresAt - 1 });
    expect(ok.ok).toBe(true);
  });

  it('余额边界：恰好等于余额可成交（余额归零），多 1 分拒绝且零变更', async () => {
    const usdBalance = walletOf(state, CUSTOMER_ID, 'USD').balance;
    const exact = makeQuote({
      quoteId: 'Q-EXACT',
      sourceAmount: D(usdBalance).toFixed(2),
      targetAmount: '1.00',
    });
    const ok = await exchangeCommands.submit(CUSTOMER_ID, exact).run(state, { now: NOW });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(walletOf(ok.next, CUSTOMER_ID, 'USD').balance).toBe('0.00');
    }

    const over = makeQuote({
      quoteId: 'Q-OVER',
      sourceAmount: D(usdBalance).plus('0.01').toFixed(2),
    });
    const before = structuredClone(state);
    const rejected = await exchangeCommands.submit(CUSTOMER_ID, over).run(state, { now: NOW });
    expectFailure(rejected, 'INSUFFICIENT_BALANCE');
    expect(state).toEqual(before);
  });

  it('过期优先于余额不足与 quoteId 重复', async () => {
    // 先成功一次，使 quoteId 进入“已使用”集合
    const quote = makeQuote({ quoteId: 'Q-ORDER-1' });
    const first = await exchangeCommands.submit(CUSTOMER_ID, quote).run(state, { now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const expiredAgain = await exchangeCommands
      .submit(CUSTOMER_ID, quote)
      .run(first.next, { now: quote.expiresAt });
    expectFailure(expiredAgain, 'QUOTE_EXPIRED');

    const broke = makeQuote({
      quoteId: 'Q-BROKE',
      sourceAmount: '999999.00',
      expiresAt: NOW - 1,
    });
    const rejected = await exchangeCommands.submit(CUSTOMER_ID, broke).run(state, { now: NOW });
    expectFailure(rejected, 'QUOTE_EXPIRED');
  });

  it('同一 quoteId 二次提交拒绝，且第二次零变更', async () => {
    const quote = makeQuote({ quoteId: 'Q-ONCE' });
    const first = await exchangeCommands.submit(CUSTOMER_ID, quote).run(state, { now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const afterFirst = structuredClone(first.next);
    const second = await exchangeCommands.submit(CUSTOMER_ID, quote).run(first.next, { now: NOW });
    expectFailure(second, 'QUOTE_DUPLICATE');
    expect(first.next).toEqual(afterFirst);
    expect(first.next.orders).toHaveLength(afterFirst.orders.length);
  });

  it('目标钱包缺失时拒绝（避免只扣不进的半笔写入）', async () => {
    const broken: DataState = {
      ...state,
      wallets: state.wallets.filter(
        (wallet) => !(wallet.customerId === CUSTOMER_ID && wallet.currency === 'EUR'),
      ),
    };
    const before = structuredClone(broken);
    const result = await exchangeCommands
      .submit(CUSTOMER_ID, makeQuote())
      .run(broken, { now: NOW });
    expectFailure(result, 'WALLET_NOT_FOUND');
    expect(broken).toEqual(before);
  });
});
