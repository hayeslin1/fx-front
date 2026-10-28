import { useCallback, useMemo, useRef, useState } from 'react';
import { ccyDp, isValidAmountInput } from '@/domain/money';
import type { RegisterInput } from '@/domain/services/auth.service';
import { walletCommands, type TopUpResult } from '@/domain/services/wallet.service';
import type {
  Currency,
  Customer,
  DataState,
  DomainResult,
  Wallet,
  WalletBill,
} from '@/domain/types';
import { registerCustomer, useAppStore } from '@/store';
import { getCustomerById, getCustomerWallets, getWallet, getWalletBills } from '@/store/selectors';

// 客户端钱包/注册薄 hooks（设计文档 §7.2）：页面不直接触达 store，
// 读写统一经本文件暴露；对接后端时只替换 hook 内部实现，页面不动。
// WHY 注册 hook 也收敛在此：M3 纵切仅允许新增 features/wallet 共享能力，
// 注册与钱包同属客户首要链路，避免页面直接 import useAppStore。

// ---------- 纯函数（node 环境可直接单测） ----------

/** 充值金额前端校验：正数 + 币种精度，口径与 domain/money.isValidAmountInput 完全一致 */
export function validateTopUpAmount(inputRaw: string, currency: Currency): string | null {
  const input = inputRaw.trim();
  if (!input) return '请输入充值金额';
  if (!isValidAmountInput(input, currency)) {
    const dp = ccyDp(currency);
    return dp === 0 ? '请输入正数金额，该币种不支持小数' : `请输入正数金额，小数不超过 ${dp} 位`;
  }
  return null;
}

/** 客户流水读取（按币种筛选 + 时间倒序），复用 §7.3 选择器口径 */
export function selectCustomerBills(
  data: DataState,
  customerId: string,
  currency?: Currency,
): WalletBill[] {
  return getWalletBills(data, customerId, currency === undefined ? {} : { currency });
}

// ---------- 读取 hooks ----------

export interface WalletOverview {
  customerId: string | null;
  customer: Customer | undefined;
  /** 六币种钱包（固定顺序 USD/GBP/EUR/JPY/CNH/HKD） */
  wallets: Wallet[];
}

/** 当前登录客户与其六币种钱包（未登录时返回空集合，页面守卫兜底） */
export function useWalletOverview(): WalletOverview {
  const customerId = useAppStore((s) => s.session.client?.customerId ?? null);
  const data = useAppStore((s) => s.data);
  return useMemo(() => {
    if (customerId === null) {
      return { customerId: null, customer: undefined, wallets: [] };
    }
    return {
      customerId,
      customer: getCustomerById(data, customerId),
      wallets: getCustomerWallets(data, customerId),
    };
  }, [data, customerId]);
}

/** 当前客户流水；currency 为 undefined 时返回全部币种 */
export function useWalletBills(currency?: Currency): WalletBill[] {
  const customerId = useAppStore((s) => s.session.client?.customerId ?? null);
  const data = useAppStore((s) => s.data);
  return useMemo(
    () => (customerId === null ? [] : selectCustomerBills(data, customerId, currency)),
    [data, customerId, currency],
  );
}

/** 当前客户某币种余额（充值页展示实时余额，成功入账后自动刷新） */
export function useWalletBalance(currency: Currency): string | null {
  const customerId = useAppStore((s) => s.session.client?.customerId ?? null);
  const data = useAppStore((s) => s.data);
  return useMemo(
    () => (customerId === null ? null : (getWallet(data, customerId, currency)?.balance ?? null)),
    [data, customerId, currency],
  );
}

// ---------- 写入 hooks ----------

export interface SubmitState<TArgs extends unknown[], TResult> {
  /** 提交中：用于禁用按钮/输入，防重复提交 */
  pending: boolean;
  submit: (...args: TArgs) => Promise<TResult>;
}

/**
 * 自助充值（PRD §3.2）：经 store.apply 提交 walletCommands.selfTopUp。
 * WHY 用 ref 同步守卫：setPending 是异步渲染，仅靠 disabled 挡不住同一帧内的双击；
 * 失败时领域服务不返回 next，store 不写入，天然满足“只提示、零变更”。
 */
export function useSelfTopUp(): SubmitState<[Currency, string], DomainResult<TopUpResult>> {
  const apply = useAppStore((s) => s.apply);
  const customerId = useAppStore((s) => s.session.client?.customerId ?? null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (currency: Currency, amount: string): Promise<DomainResult<TopUpResult>> => {
      if (customerId === null) {
        return { ok: false, code: 'NO_CLIENT_SESSION', message: '登录状态已失效，请重新登录' };
      }
      if (pendingRef.current) {
        return { ok: false, code: 'SUBMIT_PENDING', message: '正在提交，请勿重复操作' };
      }
      pendingRef.current = true;
      setPending(true);
      try {
        return await apply(walletCommands.selfTopUp(customerId, currency, amount));
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [apply, customerId],
  );

  return { pending, submit };
}

/** 客户注册（成功自动登录由 store.registerCustomer 编排，PRD §3.1） */
export function useRegisterCustomer(): SubmitState<
  [RegisterInput],
  DomainResult<{ customer: Customer }>
> {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (input: RegisterInput): Promise<DomainResult<{ customer: Customer }>> => {
      if (pendingRef.current) {
        return { ok: false, code: 'SUBMIT_PENDING', message: '正在提交，请勿重复操作' };
      }
      pendingRef.current = true;
      setPending(true);
      try {
        return await registerCustomer(input);
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { pending, submit };
}
