import { randomSalt, sha256Hex } from '@/lib/hash';
import { ALL_CURRENCIES, NEW_CUSTOMER_GIFT } from '../constants';
import { nextCustomerId, nextId } from '../ids';
import type {
  Customer,
  CustomerCredential,
  DataState,
  DomainCommand,
  DomainResult,
  Wallet,
  WalletBill,
} from '../types';

// 客户领域服务（设计文档附录 B customerService、§8.4 ops-customer.ts）
// 说明：§8.4 运营客户端点表仅定义只读查询；本文件额外提供运营建户/编辑/重置密码
// 三个写命令，沿用 auth 的演示级凭证方案（SHA-256(salt:password)），供运营侧表单复用。
// 所有运营写操作要求 operatorId 存在于 opsAccounts；失败零状态变更。

export interface CreateCustomerInput {
  name: string;
  email: string;
  password: string;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
}

export interface ResetPasswordResult {
  customerId: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code: string, message: string): DomainResult<never> {
  return { ok: false, code, message };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function opsExists(state: DataState, operatorId: string): boolean {
  return state.opsAccounts.some((a) => a.id === operatorId);
}

/** 密码规则与注册一致：至少 8 位且含字母与数字（auth.service.register） */
function isValidPassword(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
}

/** 邮箱判重：忽略大小写与首尾空格 */
function emailTaken(state: DataState, email: string, exceptCustomerId?: string): boolean {
  return state.customers.some((c) => c.id !== exceptCustomerId && c.email.toLowerCase() === email);
}

export const customerCommands = {
  /** 登录成功时刷新最近登录时间（附录 B 明确签名） */
  touchLastLogin(customerId: string): DomainCommand<{ customer: Customer }> {
    return {
      run: (state, ctx): DomainResult<{ customer: Customer }> => {
        const customer = state.customers.find((c) => c.id === customerId);
        if (!customer) {
          return fail('CUSTOMER_NOT_FOUND', '客户不存在');
        }
        const updated: Customer = { ...customer, lastLoginAt: ctx.now };
        return {
          ok: true,
          next: {
            ...state,
            customers: state.customers.map((c) => (c.id === customerId ? updated : c)),
          },
          data: { customer: updated },
        };
      },
    };
  },

  /**
   * 运营建户：与客户注册同口径（六币种演示初始余额 + INITIAL_GIFT 流水），
   * 邮箱忽略大小写判重，密码存 SHA-256(salt:password)。
   */
  createCustomer(
    operatorId: string,
    input: CreateCustomerInput,
  ): DomainCommand<{ customer: Customer }> {
    return {
      run: async (state, ctx): Promise<DomainResult<{ customer: Customer }>> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const name = input.name.trim();
        const email = normalizeEmail(input.email);
        if (!name) {
          return fail('INVALID_NAME', '请输入姓名');
        }
        if (!EMAIL_RE.test(email)) {
          return fail('INVALID_EMAIL', '邮箱格式不正确');
        }
        if (!isValidPassword(input.password)) {
          return fail('WEAK_PASSWORD', '密码至少 8 位，且需包含字母和数字');
        }
        if (emailTaken(state, email)) {
          return fail('EMAIL_TAKEN', '该邮箱已注册');
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

        // 初始余额与流水与 register 完全一致，保证“余额 = Σ流水”恒等
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

  /** 运营编辑客户资料：仅姓名/邮箱；邮箱改动同样忽略大小写判重 */
  updateCustomer(
    operatorId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): DomainCommand<{ customer: Customer }> {
    return {
      run: (state): DomainResult<{ customer: Customer }> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        const customer = state.customers.find((c) => c.id === customerId);
        if (!customer) {
          return fail('CUSTOMER_NOT_FOUND', '客户不存在');
        }

        let name = customer.name;
        if (input.name !== undefined) {
          name = input.name.trim();
          if (!name) {
            return fail('INVALID_NAME', '请输入姓名');
          }
        }

        let email = customer.email;
        if (input.email !== undefined) {
          email = normalizeEmail(input.email);
          if (!EMAIL_RE.test(email)) {
            return fail('INVALID_EMAIL', '邮箱格式不正确');
          }
          if (emailTaken(state, email, customerId)) {
            return fail('EMAIL_TAKEN', '该邮箱已被其他客户使用');
          }
        }

        const updated: Customer = { ...customer, name, email };
        return {
          ok: true,
          next: {
            ...state,
            customers: state.customers.map((c) => (c.id === customerId ? updated : c)),
          },
          data: { customer: updated },
        };
      },
    };
  },

  /** 运营重置密码：重新生成盐并以 SHA-256(salt:password) 覆盖凭证（演示方案） */
  resetPassword(
    operatorId: string,
    customerId: string,
    newPassword: string,
  ): DomainCommand<ResetPasswordResult> {
    return {
      run: async (state): Promise<DomainResult<ResetPasswordResult>> => {
        if (!opsExists(state, operatorId)) {
          return fail('OPS_NOT_FOUND', '运营账号不存在');
        }
        if (!state.customers.some((c) => c.id === customerId)) {
          return fail('CUSTOMER_NOT_FOUND', '客户不存在');
        }
        const credential = state.credentials.find((c) => c.customerId === customerId);
        if (!credential) {
          return fail('CREDENTIAL_NOT_FOUND', '客户登录凭证不存在');
        }
        if (!isValidPassword(newPassword)) {
          return fail('WEAK_PASSWORD', '密码至少 8 位，且需包含字母和数字');
        }

        const salt = randomSalt();
        const passwordHash = await sha256Hex(salt, newPassword);
        const nextCredential: CustomerCredential = {
          customerId,
          salt,
          passwordHash,
        };
        return {
          ok: true,
          next: {
            ...state,
            credentials: state.credentials.map((c) =>
              c.customerId === customerId ? nextCredential : c,
            ),
          },
          data: { customerId },
        };
      },
    };
  },
};
