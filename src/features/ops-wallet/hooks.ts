import { useCallback, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { walletCommands, type TopUpResult } from '@/domain/services/wallet.service';
import type {
  BillType,
  Currency,
  Customer,
  DataState,
  DomainResult,
  OpsAccount,
  Wallet,
  WalletBill,
} from '@/domain/types';
import { useAppStore } from '@/store';
import {
  getCustomerById,
  getCustomerUsdValuation,
  getCustomerWallets,
  getOpsAccountById,
  getOpsBills,
  type OpsBillFilter,
  type UsdValuation,
} from '@/store/selectors';
import { validateTopUpAmount } from '@/features/wallet/hooks';

// 运营钱包管理薄 hooks（设计文档 §7.2 / §10.3 钱包管理段、PRD §5.4）：
// 余额查询/账单流水/代客充值三页对 store 的读写全部收敛在本文件，页面不直接触达 store；
// 对接后端时只替换本文件的内部实现（本地选择器/领域服务 → src/api 调用），页面与测试不变。

// ---------- 纯函数（不依赖 React/store，可在 node 环境直接单测） ----------

/**
 * 客户关键词匹配：姓名或邮箱包含关键词（忽略大小写与首尾空格，空关键词恒匹配）。
 * WHY 大小写不敏感：演示邮箱域名为小写，但运营常直接粘贴带大写字母的邮箱片段。
 */
export function matchCustomerKeyword(customer: Customer, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return (
    customer.name.toLowerCase().includes(needle) || customer.email.toLowerCase().includes(needle)
  );
}

/** 按关键词过滤客户（保持入参顺序，列表稳定可比对） */
export function filterCustomersByKeyword(customers: Customer[], keyword: string): Customer[] {
  return customers.filter((customer) => matchCustomerKeyword(customer, keyword));
}

/**
 * 操作人展示名：运营账号姓名 → 原始 operatorId → “—”。
 * WHY 回退到原始 ID：历史流水可能引用已停用的运营账号，审计列必须留痕可追溯，不能空白。
 */
export function resolveOperatorName(data: DataState, operatorId?: string): string {
  if (!operatorId) return '—';
  return getOpsAccountById(data, operatorId)?.name ?? operatorId;
}

/** 代客充值金额校验：口径与自助充值完全一致（正数 + 币种精度，JPY 须为整数） */
export function validateOpsTopUpAmount(inputRaw: string, currency: Currency): string | null {
  const input = inputRaw.trim();
  if (!input) return '请输入代客充值金额';
  return validateTopUpAmount(input, currency);
}

const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateInput(input: string): boolean {
  return DATE_INPUT_RE.test(input) && dayjs(input).isValid();
}

export interface ParsedDateRange {
  /** 非空即区间非法：拒绝应用日期筛选（其余筛选照常生效） */
  error: string | null;
  /** epoch 毫秒，含端点当天 */
  from?: number;
  to?: number;
}

/**
 * 解析账单日期区间（输入来自 <input type="date"> 的 YYYY-MM-DD）。
 * 起止均含当天：from 取当日 00:00:00.000、to 取当日 23:59:59.999；
 * 非法输入（格式不符 / 起晚于止）一律拒绝，不静默按单边或半开区间查询。
 */
export function parseDateRange(dateFrom?: string, dateTo?: string): ParsedDateRange {
  const fromInput = (dateFrom ?? '').trim();
  const toInput = (dateTo ?? '').trim();
  if (!fromInput && !toInput) return { error: null };
  if (fromInput && !isValidDateInput(fromInput)) {
    return { error: '开始日期格式无效，应为 YYYY-MM-DD' };
  }
  if (toInput && !isValidDateInput(toInput)) {
    return { error: '结束日期格式无效，应为 YYYY-MM-DD' };
  }
  // YYYY-MM-DD 定长字符串可直接按字典序比较先后
  if (fromInput && toInput && fromInput > toInput) {
    return { error: '开始日期不能晚于结束日期' };
  }
  return {
    error: null,
    ...(fromInput ? { from: dayjs(fromInput).startOf('day').valueOf() } : {}),
    ...(toInput ? { to: dayjs(toInput).endOf('day').valueOf() } : {}),
  };
}

// ---------- 读取 hooks ----------

export interface OpsWalletContext {
  opsAccountId: string | null;
  opsAccount: OpsAccount | undefined;
  /** 全量客户（下拉与关键词搜索的数据源，保持 seed 顺序） */
  customers: Customer[];
}

/** 运营钱包三页共用上下文：当前运营账号 + 客户列表 */
export function useOpsWalletContext(): OpsWalletContext {
  const opsAccountId = useAppStore((s) => s.session.ops?.opsAccountId ?? null);
  const data = useAppStore((s) => s.data);
  return {
    opsAccountId,
    opsAccount: opsAccountId === null ? undefined : getOpsAccountById(data, opsAccountId),
    customers: data.customers,
  };
}

export interface OpsBalanceRow {
  customer: Customer;
  /** 六币种钱包（固定顺序 USD/GBP/EUR/JPY/CNH/HKD，缺项不补） */
  wallets: Wallet[];
  /** USD 参考估值（D6：非 USD 余额 × 该币对最新原始中间价） */
  valuation: UsdValuation;
}

/** 余额查询行（按客户搜索；空关键词返回全部客户，估值与余额同源于 data 引用） */
export function useOpsBalances(keyword: string): OpsBalanceRow[] {
  const data = useAppStore((s) => s.data);
  return useMemo(
    () =>
      filterCustomersByKeyword(data.customers, keyword).map((customer) => ({
        customer,
        wallets: getCustomerWallets(data, customer.id),
        valuation: getCustomerUsdValuation(data, customer.id),
      })),
    [data, keyword],
  );
}

/** 某客户某币种当前余额（代客充值页的实时余额展示；无钱包返回 null） */
export function useOpsCustomerBalance(
  customerId: string | null,
  currency: Currency,
): string | null {
  const data = useAppStore((s) => s.data);
  return useMemo(() => {
    if (customerId === null) return null;
    return (
      getCustomerWallets(data, customerId).find((wallet) => wallet.currency === currency)
        ?.balance ?? null
    );
  }, [data, customerId, currency]);
}

export interface OpsBillsQuery {
  customerId?: string;
  type?: BillType;
  /** YYYY-MM-DD，含当天；区间非法时由 dateError 拒绝应用 */
  dateFrom?: string;
  dateTo?: string;
}

export interface OpsBillRow {
  bill: WalletBill;
  customerName: string;
  /** 操作人展示名（非运营操作显示 “—”） */
  operatorName: string;
}

export interface OpsBillsView {
  rows: OpsBillRow[];
  dateError: string | null;
}

/** 运营账单列表（§7.3 getOpsBills 口径 + 客户名/操作人展示名映射，时间倒序） */
export function useOpsBillsView(query: OpsBillsQuery): OpsBillsView {
  const data = useAppStore((s) => s.data);
  const { customerId, type, dateFrom, dateTo } = query;
  return useMemo(() => {
    const range = parseDateRange(dateFrom, dateTo);
    const filter: OpsBillFilter = {
      ...(customerId === undefined ? {} : { customerId }),
      ...(type === undefined ? {} : { type }),
      // 区间非法 → 拒绝应用日期筛选（其余筛选照常），并回传提示供页面就地展示
      ...(range.error === null ? { from: range.from, to: range.to } : {}),
    };
    const rows = getOpsBills(data, filter).map((bill) => ({
      bill,
      customerName: getCustomerById(data, bill.customerId)?.name ?? bill.customerId,
      operatorName: resolveOperatorName(data, bill.operatorId),
    }));
    return { rows, dateError: range.error };
  }, [data, customerId, type, dateFrom, dateTo]);
}

// ---------- 写入 hooks ----------

export interface OpsTopUpInput {
  customerId: string;
  currency: Currency;
  amount: string;
  remark: string;
}

export interface OpsTopUpState {
  /** 提交中：用于禁用按钮/输入，防重复提交 */
  pending: boolean;
  submit: (input: OpsTopUpInput) => Promise<DomainResult<TopUpResult>>;
}

/**
 * 代客充值（PRD §5.4）：经 store.apply 提交 walletCommands.opsTopUp，
 * operatorId 取当前运营会话（领域服务再校验账号存在，非法操作者零变更）。
 * WHY 用 ref 同步守卫：setPending 是异步渲染，仅靠 disabled 挡不住同一帧内的双击。
 */
export function useOpsTopUp(): OpsTopUpState {
  const apply = useAppStore((s) => s.apply);
  const opsAccountId = useAppStore((s) => s.session.ops?.opsAccountId ?? null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (input: OpsTopUpInput): Promise<DomainResult<TopUpResult>> => {
      if (opsAccountId === null) {
        return { ok: false, code: 'NO_OPS_SESSION', message: '运营登录状态已失效，请重新登录' };
      }
      if (pendingRef.current) {
        return { ok: false, code: 'SUBMIT_PENDING', message: '正在提交，请勿重复操作' };
      }
      pendingRef.current = true;
      setPending(true);
      try {
        return await apply(
          walletCommands.opsTopUp(
            opsAccountId,
            input.customerId,
            input.currency,
            input.amount,
            input.remark,
          ),
        );
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [apply, opsAccountId],
  );

  return { pending, submit };
}
