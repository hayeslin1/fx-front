import { useMemo } from 'react';
import type { Currency, Customer, Order, Wallet, WalletBill } from '@/domain/types';
import { useAppStore } from '@/store';
import {
  getCustomerById,
  getCustomerOrders,
  getCustomerUsdValuation,
  getCustomerWallets,
  getWalletBills,
  type UsdValuation,
} from '@/store/selectors';

// 运营客户管理薄 hooks（设计文档 §7.2/§7.3）：列表/详情对 store 的读取全部收敛在此，
// 页面组件不直接触达 store；对接后端时仅替换本文件实现，页面不动。
// WHY 无写入 hook：PRD §5.2 明确本模块仅查询，不做 KYC/冻结/改资料。

/** 详情页概览区块最多展示的条数（最近订单/最近流水） */
export const RECENT_LIMIT = 5;

export interface OpsCustomerRow {
  customer: Customer;
  /** 六币种钱包（固定顺序 USD/GBP/EUR/JPY/CNH/HKD，缺项不补） */
  wallets: Wallet[];
  /** USD 参考估值（D6 口径，与 store/selectors.getCustomerUsdValuation 完全一致） */
  valuation: UsdValuation;
}

/** 取行内某币种钱包；缺项返回 undefined，列表六币种列据此渲染占位符 */
export function walletOf(row: OpsCustomerRow, currency: Currency): Wallet | undefined {
  return row.wallets.find((wallet) => wallet.currency === currency);
}

/** 姓名/邮箱关键词过滤：大小写不敏感、忽略前后空白；空关键词返回原列表（即时过滤） */
export function filterCustomerRows(rows: OpsCustomerRow[], keyword: string): OpsCustomerRow[] {
  const key = keyword.trim().toLowerCase();
  if (!key) return rows;
  return rows.filter(
    (row) =>
      row.customer.name.toLowerCase().includes(key) ||
      row.customer.email.toLowerCase().includes(key),
  );
}

/** 全部客户（预置 3 位 + 运行期注册）及其六币种余额与 USD 估值 */
export function useOpsCustomerRows(): OpsCustomerRow[] {
  const data = useAppStore((state) => state.data);
  return useMemo(
    () =>
      data.customers.map((customer) => ({
        customer,
        wallets: getCustomerWallets(data, customer.id),
        valuation: getCustomerUsdValuation(data, customer.id),
      })),
    [data],
  );
}

export interface OpsCustomerDetail {
  customer: Customer | undefined;
  wallets: Wallet[];
  valuation: UsdValuation | undefined;
  /** 最近订单（成交时间倒序，最多 RECENT_LIMIT 条） */
  recentOrders: Order[];
  /** 最近流水（时间倒序，最多 RECENT_LIMIT 条） */
  recentBills: WalletBill[];
}

/** 详情缺省视图（未匹配到客户）：页面据此渲染空态 */
const EMPTY_DETAIL: OpsCustomerDetail = {
  customer: undefined,
  wallets: [],
  valuation: undefined,
  recentOrders: [],
  recentBills: [],
};

/** 客户详情视图（PRD §5.2）：资料 + 六币种余额 + USD 估值 + 最近订单/流水概览 */
export function useOpsCustomerDetail(customerId: string | undefined): OpsCustomerDetail {
  const data = useAppStore((state) => state.data);
  return useMemo(() => {
    if (customerId === undefined) return EMPTY_DETAIL;
    const customer = getCustomerById(data, customerId);
    if (customer === undefined) return EMPTY_DETAIL;
    return {
      customer,
      wallets: getCustomerWallets(data, customer.id),
      valuation: getCustomerUsdValuation(data, customer.id),
      recentOrders: getCustomerOrders(data, customer.id).slice(0, RECENT_LIMIT),
      recentBills: getWalletBills(data, customer.id).slice(0, RECENT_LIMIT),
    };
  }, [data, customerId]);
}
