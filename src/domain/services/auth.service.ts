import { randomSalt, sha256Hex } from '@/lib/hash';
import { ALL_CURRENCIES, NEW_CUSTOMER_GIFT } from '../constants';
import { nextCustomerId, nextId } from '../ids';
import type {
  Customer,
  CustomerCredential,
  DomainCommand,
  DomainResult,
  OpsAccount,
  Wallet,
  WalletBill,
} from '../types';

// 认证服务（演示级）：注册、客户/运营登录。
// 密码存 SHA-256(salt:password) 哈希，明确非生产方案（设计文档 §4.3）。

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const authCommands = {
  /** 注册：仅姓名/邮箱/密码；邮箱忽略大小写判重；获六币种演示初始余额（PRD §3.1） */
  register(input: RegisterInput): DomainCommand<{ customer: Customer }> {
    return {
      run: async (state, ctx): Promise<DomainResult<{ customer: Customer }>> => {
        const name = input.name.trim();
        const email = normalizeEmail(input.email);
        if (!name) {
          return { ok: false, code: 'INVALID_NAME', message: '请输入姓名' };
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { ok: false, code: 'INVALID_EMAIL', message: '邮箱格式不正确' };
        }
        if (
          input.password.length < 8 ||
          !/[a-zA-Z]/.test(input.password) ||
          !/\d/.test(input.password)
        ) {
          return { ok: false, code: 'WEAK_PASSWORD', message: '密码至少 8 位，且需包含字母和数字' };
        }
        if (state.customers.some((c) => c.email.toLowerCase() === email)) {
          return { ok: false, code: 'EMAIL_TAKEN', message: '该邮箱已注册，请直接登录' };
        }

        const { id: customerId, counters: countersAfterCustomer } = nextCustomerId(state.counters);
        const customer: Customer = {
          id: customerId,
          name,
          email,
          createdAt: ctx.now,
          lastLoginAt: null,
        };
        const salt = randomSalt();
        const credential: CustomerCredential = {
          customerId,
          salt,
          passwordHash: await sha256Hex(salt, input.password),
        };

        // 六币种演示初始余额 + 赠送流水（balanceBefore 0，保证“余额 = Σ流水”恒等）
        const wallets: Wallet[] = [];
        const bills: WalletBill[] = [];
        let counters = countersAfterCustomer;
        for (const currency of ALL_CURRENCIES) {
          const gift = NEW_CUSTOMER_GIFT[currency];
          wallets.push({ customerId, currency, balance: gift });
          const { id: billId, counters: next } = nextId(counters, 'BL', ctx.now);
          counters = next;
          bills.push({
            id: billId,
            customerId,
            currency,
            type: 'INITIAL_GIFT',
            amount: gift,
            balanceBefore: '0',
            balanceAfter: gift,
            createdAt: ctx.now,
          });
        }

        return {
          ok: true,
          next: {
            ...state,
            customers: [...state.customers, customer],
            credentials: [...state.credentials, credential],
            wallets: [...state.wallets, ...wallets],
            bills: [...state.bills, ...bills],
            counters,
          },
          data: { customer },
        };
      },
    };
  },

  /** 客户登录：成功同时更新最近登录时间（单一写入，避免二次提交） */
  loginClient(emailRaw: string, password: string): DomainCommand<{ customer: Customer }> {
    return {
      run: async (state, ctx): Promise<DomainResult<{ customer: Customer }>> => {
        const email = normalizeEmail(emailRaw);
        const customer = state.customers.find((c) => c.email.toLowerCase() === email);
        const credential = customer
          ? state.credentials.find((c) => c.customerId === customer.id)
          : undefined;
        if (!customer || !credential) {
          return { ok: false, code: 'BAD_CREDENTIALS', message: '邮箱或密码不正确' };
        }
        const hash = await sha256Hex(credential.salt, password);
        if (hash !== credential.passwordHash) {
          return { ok: false, code: 'BAD_CREDENTIALS', message: '邮箱或密码不正确' };
        }
        const nextCustomer: Customer = { ...customer, lastLoginAt: ctx.now };
        return {
          ok: true,
          next: {
            ...state,
            customers: state.customers.map((c) => (c.id === customer.id ? nextCustomer : c)),
          },
          data: { customer: nextCustomer },
        };
      },
    };
  },

  /** 运营登录：仅运营账号；客户账号一律不可进入运营端（PRD §2） */
  loginOps(emailRaw: string, password: string): DomainCommand<{ opsAccount: OpsAccount }> {
    return {
      run: async (state): Promise<DomainResult<{ opsAccount: OpsAccount }>> => {
        const email = normalizeEmail(emailRaw);
        const account = state.opsAccounts.find((a) => a.email.toLowerCase() === email);
        if (!account) {
          return { ok: false, code: 'BAD_CREDENTIALS', message: '账号或密码不正确' };
        }
        const hash = await sha256Hex(account.salt, password);
        if (hash !== account.passwordHash) {
          return { ok: false, code: 'BAD_CREDENTIALS', message: '账号或密码不正确' };
        }
        return { ok: true, next: state, data: { opsAccount: account } };
      },
    };
  },
};
