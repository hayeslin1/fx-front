import { ALL_CURRENCIES } from '../constants';
import { nextId } from '../ids';
import { D, ccyDp, isValidAmountInput, roundCcy } from '../money';
import type {
  Currency,
  DataState,
  DomainCommand,
  DomainResult,
  Wallet,
  WalletBill,
} from '../types';

// 钱包领域服务（设计文档 §8.4 wallet.ts / ops-wallet.ts、PRD §3.2 / §5.4）
// 统一约束：
// - 金额只经 money.ts 计算，余额按币种精度 ROUND_HALF_UP 落库；
// - 流水 amount 带符号（充值恒为正）、balanceBefore/After 与钱包余额严格衔接；
// - 任何失败均零状态变更（不返回 next）。

export interface TopUpResult {
  wallet: Wallet;
  bill: WalletBill;
}

/** 运行期币种合法性校验（类型系统之外的边界防护） */
function isCurrency(value: string): value is Currency {
  return (ALL_CURRENCIES as readonly string[]).includes(value);
}

function fail(code: string, message: string): DomainResult<never> {
  return { ok: false, code, message };
}

interface CreditInput {
  state: DataState;
  customerId: string;
  currency: Currency;
  amount: string;
  now: number;
  type: 'TOPUP_SELF' | 'TOPUP_OPS';
  operatorId?: string;
  remark?: string;
}

/**
 * 充值入账唯一实现：校验币种/金额 → 更新钱包 → 追加带符号流水。
 * WHY 抽公共函数：自助充值（TOPUP_SELF）与运营代客充值（TOPUP_OPS）除审计字段外
 * 记账口径必须完全一致，避免两套实现导致余额链分叉。
 */
function creditWallet(input: CreditInput): DomainResult<TopUpResult> {
  const { state, customerId, currency, amount, now, type, operatorId, remark } = input;

  if (!isCurrency(currency)) {
    return fail('INVALID_CURRENCY', '不支持的币种');
  }
  if (!isValidAmountInput(amount, currency)) {
    return fail('INVALID_AMOUNT', '充值金额须为正数且符合币种精度');
  }

  const customer = state.customers.find((c) => c.id === customerId);
  if (!customer) {
    return fail('CUSTOMER_NOT_FOUND', '客户不存在');
  }

  const walletIndex = state.wallets.findIndex(
    (w) => w.customerId === customerId && w.currency === currency,
  );
  if (walletIndex < 0) {
    return fail('WALLET_NOT_FOUND', '客户钱包不存在');
  }

  const currentWallet = state.wallets[walletIndex];
  if (!currentWallet) {
    return fail('WALLET_NOT_FOUND', '客户钱包不存在');
  }

  // 入账金额按币种精度归一化；balanceBefore 保留钱包原值以维持流水链
  const amountValue = roundCcy(D(amount), currency);
  const amountStr = amountValue.toFixed(ccyDp(currency));
  const beforeValue = D(currentWallet.balance);
  const afterValue = roundCcy(beforeValue.plus(amountValue), currency);
  const afterStr = afterValue.toFixed(ccyDp(currency));

  const nextWallet: Wallet = { ...currentWallet, balance: afterStr };

  const { id: billId, counters } = nextId(state.counters, 'BL', now);
  const bill: WalletBill = {
    id: billId,
    customerId,
    currency,
    type,
    amount: amountStr,
    balanceBefore: currentWallet.balance,
    balanceAfter: afterStr,
    ...(operatorId === undefined ? {} : { operatorId }),
    ...(remark === undefined ? {} : { remark }),
    createdAt: now,
  };

  const wallets = [...state.wallets];
  wallets[walletIndex] = nextWallet;

  return {
    ok: true,
    next: {
      ...state,
      wallets,
      bills: [...state.bills, bill],
      counters,
    },
    data: { wallet: nextWallet, bill },
  };
}

export const walletCommands = {
  /** 客户自助模拟充值（PRD §3.2）：正数 + 币种精度，立即入账并留流水 */
  selfTopUp(customerId: string, currency: Currency, amount: string): DomainCommand<TopUpResult> {
    return {
      run: (state, ctx): DomainResult<TopUpResult> =>
        creditWallet({
          state,
          customerId,
          currency,
          amount,
          now: ctx.now,
          type: 'TOPUP_SELF',
        }),
    };
  },

  /**
   * 运营代客充值（PRD §5.4）：运营账号必须存在；备注必填并写入流水作为审计字段。
   * WHY 先校验运营：代客充值属于运营权限操作，非法操作者不得触发任何余额变更。
   */
  opsTopUp(
    operatorId: string,
    customerId: string,
    currency: Currency,
    amount: string,
    remark: string,
  ): DomainCommand<TopUpResult> {
    return {
      run: (state, ctx): DomainResult<TopUpResult> => {
        if (!state.opsAccounts.some((a) => a.id === operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const normalizedRemark = remark.trim();
        if (!normalizedRemark) {
          return fail('REMARK_REQUIRED', '代客充值备注必填');
        }
        return creditWallet({
          state,
          customerId,
          currency,
          amount,
          now: ctx.now,
          type: 'TOPUP_OPS',
          operatorId,
          remark: normalizedRemark,
        });
      },
    };
  },
};
