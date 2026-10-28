import { randomSalt, sha256Hex } from '@/lib/hash';
import {
  DAY,
  SEED_ASSIGNEES,
  SEED_CHANNELS,
  SEED_CLOSE_BATCHES,
  SEED_CUSTOMERS,
  SEED_MIDS,
  SEED_OPS_ACCOUNTS,
  SEED_ROUTING,
  SEED_TICKETS,
  SEED_TOPUPS,
  SEED_TRADES,
} from '@/mocks/seed-script';
import {
  ALL_CURRENCIES,
  COLLECT_STEPS_DEFAULT,
  DEFAULT_HALF_SPREAD_BPS,
  FEE,
  PAIR_IDS,
  QUOTE_CCY,
  STORAGE_VERSION,
} from './constants';
import { nextCustomerId, nextId } from './ids';
import { D, deriveClientRate, roundCcy, toRateSig12 } from './money';
import type {
  CollectStepSeq,
  Counters,
  Currency,
  Customer,
  CustomerCredential,
  DataState,
  MarkupConfig,
  OpsAccount,
  Order,
  RawPrice,
  RoutingRule,
  Ticket,
  TicketMessage,
  Wallet,
  WalletBill,
} from './types';

// 预置数据构建（设计文档 §5.4）：脚本化事实 + 引擎推导。
// 余额由「期初赠送流水 + 按时间序累计事件」得出，保证“余额 = Σ流水”恒等；
// 到账金额由报价公式（deriveClientRate + roundCcy）计算，与在线成交口径一致。
// 本函数为纯构建（除密码盐随机外无副作用），重复调用除盐值外结果确定。

const PRICE_SNAPSHOT_AHEAD_MS = 2 * 60_000; // 快照采集时间 = 成交前 2 分钟

export async function buildSeed(anchor: number): Promise<DataState> {
  let counters: Counters = {};

  // ---------- 运营账号 ----------
  const opsAccounts: OpsAccount[] = [];
  for (const spec of SEED_OPS_ACCOUNTS) {
    const salt = randomSalt();
    opsAccounts.push({
      id: spec.id,
      name: spec.name,
      email: spec.email,
      isDemoAccount: spec.isDemoAccount,
      salt,
      passwordHash: await sha256Hex(salt, spec.password),
    });
  }

  // ---------- 客户与凭证 ----------
  const customers: Customer[] = [];
  const credentials: CustomerCredential[] = [];
  for (const spec of SEED_CUSTOMERS) {
    const salt = randomSalt();
    customers.push({
      id: spec.id,
      name: spec.name,
      email: spec.email,
      createdAt: anchor - 7 * DAY,
      lastLoginAt: anchor - 3 * 3_600_000,
    });
    credentials.push({
      customerId: spec.id,
      salt,
      passwordHash: await sha256Hex(salt, spec.password),
    });
    const next = nextCustomerId(counters);
    counters = next.counters; // 保持客户计数器与预置客户数一致
  }

  const wallets: Wallet[] = [];
  const bills: WalletBill[] = [];
  const balances = new Map<string, string>(); // `${customerId}:${currency}` → 当前余额（普通十进制字符串）

  const balanceKey = (customerId: string, currency: Currency) => `${customerId}:${currency}`;

  const pushBill = (input: {
    customerId: string;
    currency: Currency;
    type: WalletBill['type'];
    signedAmount: string;
    at: number;
    relatedOrderId?: string;
    operatorId?: string;
    remark?: string;
  }): void => {
    const key = balanceKey(input.customerId, input.currency);
    const before = D(balances.get(key) ?? '0');
    const after = before.plus(input.signedAmount);
    const { id, counters: next } = nextId(counters, 'BL', input.at);
    counters = next;
    bills.push({
      id,
      customerId: input.customerId,
      currency: input.currency,
      type: input.type,
      amount: input.signedAmount,
      balanceBefore: before.toString(),
      balanceAfter: after.toString(),
      relatedOrderId: input.relatedOrderId,
      operatorId: input.operatorId,
      remark: input.remark,
      createdAt: input.at,
    });
    balances.set(key, after.toString());
  };

  // 期初赠送：每个钱包一条 INITIAL_GIFT 流水（余额链起点，展示名“初始演示资金”）
  for (const spec of SEED_CUSTOMERS) {
    for (const currency of ALL_CURRENCIES) {
      const amount = spec.initialBalances[currency];
      pushBill({
        customerId: spec.id,
        currency,
        type: 'INITIAL_GIFT',
        signedAmount: D(amount).toFixed(ccyDpOf(currency)),
        at: anchor - 7 * DAY,
        remark: '预置样例客户期初演示资金',
      });
    }
  }
  // 钱包余额快照（结息后的最终值在事件处理完后回写）
  const walletByKey = new Map<string, Wallet>();

  // ---------- 事件流（交易 + 充值），按时间序处理 ----------
  type Event =
    | { kind: 'TRADE'; offsetMs: number; spec: (typeof SEED_TRADES)[number] }
    | { kind: 'TOPUP'; offsetMs: number; spec: (typeof SEED_TOPUPS)[number] };
  const events: Event[] = [
    ...SEED_TRADES.map((spec): Event => ({ kind: 'TRADE', offsetMs: spec.offsetMs, spec })),
    ...SEED_TOPUPS.map((spec): Event => ({ kind: 'TOPUP', offsetMs: spec.offsetMs, spec })),
  ].sort((a, b) => a.offsetMs - b.offsetMs);

  const orders: Order[] = [];

  for (const event of events) {
    const at = anchor + event.offsetMs;
    if (event.kind === 'TOPUP') {
      const { spec } = event;
      pushBill({
        customerId: spec.customerId,
        currency: spec.currency,
        type: spec.type,
        signedAmount: D(spec.amount).toFixed(ccyDpOf(spec.currency)),
        at,
        operatorId: spec.operatorId,
        remark: spec.remark,
      });
      continue;
    }

    const { spec } = event;
    const mid = toRateSig12(spec.mid);
    const clientRate = deriveClientRate(mid, DEFAULT_HALF_SPREAD_BPS, spec.direction);
    const quoteCcy = QUOTE_CCY[spec.pairId];
    const sourceCurrency: Currency = spec.direction === 'SELL_USD' ? 'USD' : quoteCcy;
    const targetCurrency: Currency = spec.direction === 'SELL_USD' ? quoteCcy : 'USD';
    const sourceAmount = D(spec.sourceAmount);
    // 目标金额：卖 USD → 来源×clientRate；买 USD → 来源÷clientRate；按目标币精度 ROUND_HALF_UP
    const targetAmount =
      spec.direction === 'SELL_USD'
        ? roundCcy(sourceAmount.mul(clientRate), targetCurrency)
        : roundCcy(sourceAmount.div(clientRate), targetCurrency);

    const order: Order = {
      id: '',
      customerId: spec.customerId,
      pairId: spec.pairId,
      direction: spec.direction,
      sourceCurrency,
      targetCurrency,
      sourceAmount: sourceAmount.toFixed(ccyDpOf(sourceCurrency)),
      targetAmount: targetAmount.toFixed(ccyDpOf(targetCurrency)),
      fee: FEE,
      status: 'COMPLETED',
      snapshot: {
        clientRate: toRateSig12(clientRate).toString(),
        mid: mid.toString(),
        channelId: spec.channelId,
        priceCollectedAt: at - PRICE_SNAPSHOT_AHEAD_MS,
        executedAt: at,
      },
      createdAt: at,
    };
    const { id: orderId, counters: next } = nextId(counters, 'EX', at);
    counters = next;
    order.id = orderId;

    pushBill({
      customerId: spec.customerId,
      currency: sourceCurrency,
      type: 'EXCHANGE_DEBIT',
      signedAmount: sourceAmount.neg().toFixed(ccyDpOf(sourceCurrency)),
      at,
      relatedOrderId: orderId,
    });
    pushBill({
      customerId: spec.customerId,
      currency: targetCurrency,
      type: 'EXCHANGE_CREDIT',
      signedAmount: targetAmount.toFixed(ccyDpOf(targetCurrency)),
      at,
      relatedOrderId: orderId,
    });
    orders.push(order);
  }

  // 钱包快照回写（此时 balances 为最终值）
  for (const spec of SEED_CUSTOMERS) {
    for (const currency of ALL_CURRENCIES) {
      walletByKey.set(balanceKey(spec.id, currency), {
        customerId: spec.id,
        currency,
        balance: balances.get(balanceKey(spec.id, currency)) ?? '0',
      });
    }
  }
  wallets.push(...walletByKey.values());

  // ---------- 平仓批次（事实：尝试与锁定价格快照；分配明细由 M2 重放引擎派生） ----------
  const closeBatches = SEED_CLOSE_BATCHES.map((spec) => {
    const at = anchor + spec.offsetMs;
    const { id: batchId, counters: next } = nextId(counters, 'CB', at);
    counters = next;
    const attemptId = `${batchId}-A1`;
    return {
      id: batchId,
      pairId: spec.pairId,
      side: spec.side,
      usdAmount: D(spec.usdAmount).toFixed(2),
      channelId: spec.channelId,
      createdAt: at,
      status: spec.simulatedResult,
      attempts: [
        {
          id: attemptId,
          index: 1,
          simulatedResult: spec.simulatedResult,
          status: spec.simulatedResult,
          channelId: spec.channelId,
          lockedMid: toRateSig12(spec.lockedMid).toString(),
          priceCollectedAt: at - PRICE_SNAPSHOT_AHEAD_MS,
          createdAt: at,
          executedAt: at,
          failReason: spec.failReason,
          allocations: [],
        },
      ],
    };
  });

  // ---------- 工单与消息 ----------
  const tickets: Ticket[] = [];
  const ticketMessages: TicketMessage[] = [];
  for (const spec of SEED_TICKETS) {
    const at = anchor + spec.offsetMs;
    const { id: ticketId, counters: next } = nextId(counters, 'TK', at);
    counters = next;
    const customer = customers.find((c) => c.id === spec.customerId);
    const lastOffset = Math.max(...spec.messages.map((m) => m.offsetMs));
    let lastAt = at;
    spec.messages.forEach((message, index) => {
      const messageAt = anchor + message.offsetMs;
      const opsAuthor = message.authorId
        ? [...SEED_ASSIGNEES, ...opsAccounts].find((u) => u.id === message.authorId)
        : undefined;
      ticketMessages.push({
        id: `${ticketId}-M${index + 1}`,
        ticketId,
        authorKind: message.authorKind,
        authorId:
          message.authorKind === 'CUSTOMER' ? spec.customerId : (opsAuthor?.id ?? 'OPS-001'),
        authorName:
          message.authorKind === 'CUSTOMER'
            ? (customer?.name ?? '客户')
            : (opsAuthor?.name ?? '运营'),
        content: message.content,
        createdAt: messageAt,
      });
      lastAt = anchor + lastOffset;
    });
    tickets.push({
      id: ticketId,
      customerId: spec.customerId,
      subject: spec.subject,
      relatedOrderId: spec.relatedOrderId,
      status: spec.status,
      assigneeId: spec.assigneeId,
      createdAt: at,
      updatedAt: lastAt,
    });
  }

  // SEED_TICKETS 按文档业务序生成（TK-001 待处理…），而 offsetMs 并非时间序；
  // nextId 只记住“最后一次调用”的日期，会让 TK 计数器停在更早日期——
  // 之后新工单对今天从 seq=1 起编号，会与预置的 TK-…-0001 重号。
  // 这里把计数器回填为既有编号中 (day, seq) 最大者，与 nextId“当日递增”语义对齐。
  const tkMax = tickets.reduce(
    (max, ticket) => {
      const match = /^TK-(\d{8})-(\d+)$/.exec(ticket.id);
      if (!match) return max;
      const day = match[1] ?? '';
      const seq = Number(match[2] ?? '0');
      return day > max.day || (day === max.day && seq > max.seq) ? { day, seq } : max;
    },
    { day: '', seq: 0 },
  );
  counters = { ...counters, TK: tkMax };

  // ---------- 汇率运营配置 ----------
  const channels = SEED_CHANNELS.map((spec) => ({ ...spec, createdAt: anchor - 7 * DAY }));
  const rawPrices: RawPrice[] = [];
  for (const pairId of PAIR_IDS) {
    for (const channel of channels) {
      const mid = SEED_MIDS[pairId][channel.id];
      if (mid === undefined) continue;
      rawPrices.push({
        pairId,
        channelId: channel.id,
        mid: toRateSig12(mid).toString(),
        collectedAt: anchor - PRICE_SNAPSHOT_AHEAD_MS,
        quoteEnabled: true,
      });
    }
  }
  const routing: RoutingRule[] = PAIR_IDS.map((pairId) => ({
    pairId,
    channelIds: [...SEED_ROUTING[pairId]],
  }));
  const markups: MarkupConfig[] = PAIR_IDS.map((pairId) => ({
    pairId,
    halfSpreadBps: DEFAULT_HALF_SPREAD_BPS,
  }));
  const collectSteps: CollectStepSeq[] = PAIR_IDS.map((pairId) => ({
    pairId,
    steps: [...COLLECT_STEPS_DEFAULT],
    nextIndex: 0,
  }));

  return {
    customers,
    credentials,
    opsAccounts,
    assignees: [...SEED_ASSIGNEES],
    wallets,
    bills,
    orders,
    closeBatches,
    tickets,
    ticketMessages,
    fxConfig: {
      channels,
      pairs: PAIR_IDS.map((pairId) => ({ id: pairId, enabled: true })),
      rawPrices,
      routing,
      markups,
      collectSteps,
    },
    counters,
    meta: { schemaVersion: STORAGE_VERSION, seededAt: anchor, resetCount: 0, anchorAt: anchor },
  };
}

/** 币种精度（本地小工具，避免 seed 反向依赖展示层） */
function ccyDpOf(currency: Currency): number {
  return currency === 'JPY' ? 0 : 2;
}
