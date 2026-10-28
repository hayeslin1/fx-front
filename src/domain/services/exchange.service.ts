import { FEE, QUOTE_CCY } from '../constants';
import { nextId } from '../ids';
import { D, ccyDp, roundCcy } from '../money';
import type {
  Currency,
  DomainCommand,
  DomainResult,
  Order,
  Quote,
  Wallet,
  WalletBill,
} from '../types';

// 客户成交提交（设计文档 §6.3）。
// 纯领域服务：不取价、不校验运营配置、不读真实时钟，仅消费报价快照；
// 所有写入在同一个 next 对象中一次性完成，任一校验失败返回错误且零变更。
//
// 报价快照原则（PRD §4.1/§9-5）：成交时即使采集价/路由/加点/渠道状态已变化，
// 也按报价中的 clientRate/mid/channelId 记账——这些正是订单必需的价格快照。

/** 成交成功返回：与 API `exchange.execute` 的响应 data 对齐（§8.4） */
export interface ExchangeSubmitData {
  order: Order;
  wallets: Wallet[];
  bills: WalletBill[];
}

/**
 * 由兑换方向推导来源/目标币种（USD 为枢纽）。
 * WHY 抽成函数：成交前必须与报价快照比对，防止客户端篡改币种造成“凭空入账”。
 */
function deriveCurrencies(pairId: Quote['pairId'], direction: Quote['direction']): {
  sourceCurrency: Currency;
  targetCurrency: Currency;
} {
  const quoteCcy = QUOTE_CCY[pairId];
  return direction === 'SELL_USD'
    ? { sourceCurrency: 'USD', targetCurrency: quoteCcy }
    : { sourceCurrency: quoteCcy, targetCurrency: 'USD' };
}

export const exchangeCommands = {
  /**
   * 成交提交（§6.3）。校验顺序固定：
   * 客户存在 → 报价币种与方向一致（防篡改）→ 未过期 → 余额充足 → quoteId 未使用。
   *
   * 过期边界：`now === expiresAt` 即视为过期（半开区间 [createdAt, expiresAt)），
   * 与 PRD §3.3“30 秒有效”保持一致，不留 1ms 余量。
   */
  submit(customerId: string, quote: Quote): DomainCommand<ExchangeSubmitData> {
    return {
      run: (state, ctx): DomainResult<ExchangeSubmitData> => {
        // 1. 客户必须存在（客户被删除/伪造 id 时不允许写入事实）
        const customer = state.customers.find((item) => item.id === customerId);
        if (customer === undefined) {
          return { ok: false, code: 'CUSTOMER_NOT_FOUND', message: '客户不存在' };
        }

        // 2. 报价币种必须与 direction 推导结果一致，防止篡改 source/target 币种套利
        const expected = deriveCurrencies(quote.pairId, quote.direction);
        if (
          quote.sourceCurrency !== expected.sourceCurrency ||
          quote.targetCurrency !== expected.targetCurrency
        ) {
          return {
            ok: false,
            code: 'QUOTE_MISMATCH',
            message: '报价与兑换方向不一致，请重新取价',
          };
        }

        // 3. 有效期：now == expiresAt 即过期（无余量），必须重新取价
        if (ctx.now >= quote.expiresAt) {
          return { ok: false, code: 'QUOTE_EXPIRED', message: '报价已过期，请重新取价' };
        }

        // 4. 来源钱包余额 >= 报价来源金额（余额不足只提示，不产生任何副作用）
        const sourceWallet = state.wallets.find(
          (item) => item.customerId === customerId && item.currency === quote.sourceCurrency,
        );
        const targetWallet = state.wallets.find(
          (item) => item.customerId === customerId && item.currency === quote.targetCurrency,
        );
        if (sourceWallet === undefined || D(sourceWallet.balance).lt(D(quote.sourceAmount))) {
          return { ok: false, code: 'INSUFFICIENT_BALANCE', message: '余额不足' };
        }
        // 目标钱包缺失属于事实数据异常：必须拒绝，避免只扣不进的半笔写入
        if (targetWallet === undefined) {
          return { ok: false, code: 'WALLET_NOT_FOUND', message: '钱包数据异常，请联系运营' };
        }

        // 5. quoteId 单次有效：同一报价二次提交直接拒绝（防重复成交）
        if (state.orders.some((order) => order.quoteId === quote.quoteId)) {
          return { ok: false, code: 'QUOTE_DUPLICATE', message: '该报价已使用，请重新取价' };
        }

        // ---------- 以下为单次原子写入，全部成功或全部不发生 ----------
        const sourceDp = ccyDp(quote.sourceCurrency);
        const targetDp = ccyDp(quote.targetCurrency);

        // 记账值统一经 roundCcy 到币种精度（PRD §4.3），再固化为普通十进制字符串
        const debit = roundCcy(quote.sourceAmount, quote.sourceCurrency);
        const credit = roundCcy(quote.targetAmount, quote.targetCurrency);
        const sourceBefore = roundCcy(sourceWallet.balance, quote.sourceCurrency);
        const targetBefore = roundCcy(targetWallet.balance, quote.targetCurrency);
        const sourceAfter = roundCcy(sourceBefore.minus(debit), quote.sourceCurrency);
        const targetAfter = roundCcy(targetBefore.plus(credit), quote.targetCurrency);

        const sourceWalletNext: Wallet = {
          ...sourceWallet,
          balance: sourceAfter.toFixed(sourceDp),
        };
        const targetWalletNext: Wallet = {
          ...targetWallet,
          balance: targetAfter.toFixed(targetDp),
        };

        const { id: orderId, counters: countersAfterOrder } = nextId(
          state.counters,
          'EX',
          ctx.now,
        );
        const { id: debitBillId, counters: countersAfterDebit } = nextId(
          countersAfterOrder,
          'BL',
          ctx.now,
        );
        const { id: creditBillId, counters } = nextId(countersAfterDebit, 'BL', ctx.now);

        const order: Order = {
          id: orderId,
          customerId,
          pairId: quote.pairId,
          direction: quote.direction,
          // 币种与金额一律取自报价快照，成交时不再重算（§6.2 末段）
          sourceCurrency: quote.sourceCurrency,
          targetCurrency: quote.targetCurrency,
          sourceAmount: quote.sourceAmount,
          targetAmount: quote.targetAmount,
          fee: FEE,
          status: 'COMPLETED',
          quoteId: quote.quoteId,
          snapshot: {
            clientRate: quote.clientRate,
            mid: quote.mid,
            channelId: quote.channelId,
            priceCollectedAt: quote.priceCollectedAt,
            executedAt: ctx.now,
          },
          createdAt: ctx.now,
        };

        const debitBill: WalletBill = {
          id: debitBillId,
          customerId,
          currency: quote.sourceCurrency,
          type: 'EXCHANGE_DEBIT',
          amount: debit.neg().toFixed(sourceDp),
          balanceBefore: sourceBefore.toFixed(sourceDp),
          balanceAfter: sourceAfter.toFixed(sourceDp),
          relatedOrderId: orderId,
          createdAt: ctx.now,
        };
        const creditBill: WalletBill = {
          id: creditBillId,
          customerId,
          currency: quote.targetCurrency,
          type: 'EXCHANGE_CREDIT',
          amount: credit.toFixed(targetDp),
          balanceBefore: targetBefore.toFixed(targetDp),
          balanceAfter: targetAfter.toFixed(targetDp),
          relatedOrderId: orderId,
          createdAt: ctx.now,
        };

        return {
          ok: true,
          next: {
            ...state,
            wallets: state.wallets.map((wallet) => {
              if (
                wallet.customerId === customerId &&
                wallet.currency === quote.sourceCurrency
              ) {
                return sourceWalletNext;
              }
              if (
                wallet.customerId === customerId &&
                wallet.currency === quote.targetCurrency
              ) {
                return targetWalletNext;
              }
              return wallet;
            }),
            bills: [...state.bills, debitBill, creditBill],
            orders: [...state.orders, order],
            counters,
          },
          data: {
            order,
            wallets: [sourceWalletNext, targetWalletNext],
            bills: [debitBill, creditBill],
          },
        };
      },
    };
  },
};
