import { useMemo } from 'react';
import dayjs from 'dayjs';
import { D, roundCcy } from '@/domain/money';
import type {
  Customer,
  DecimalStr,
  OpenLot,
  Order,
  PairId,
  ProfitOrder,
  ProfitOrderStatus,
  WalletBill,
} from '@/domain/types';
import { channelNameOf } from '@/features/exchange/labels';
import { useAppStore } from '@/store';
import {
  getCustomerById,
  getOrderBills,
  getOrderById,
  selectLedger,
  selectPairLots,
  selectProfitOrders,
} from '@/store/selectors';

// 交易管理 feature 薄 hooks（设计文档 §7.2）：客户订单页/收益订单页的 store 读取
// 全部收敛在本文件，页面组件不直接 import useAppStore；对接期只替换本文件内部实现
// （本地选择器 → src/api 调用），页面与测试断言不动。

// ---------- 纯函数（页面与测试共用，node/jsdom 均可直接调用） ----------

/** 已平 USD = 名义本金 − 未平（收益单列表“已平/未平”两列口径，设计文档 §6.6） */
export function closedUsdOf(profitOrder: ProfitOrder): DecimalStr {
  return roundCcy(D(profitOrder.usdNotional).minus(profitOrder.usdOpen), 'USD').toFixed(2);
}

/** 未平 USD 汇总（订单级敞口 = 该订单剩余 lot 之和，设计文档 §6.4） */
export function openUsdOf(lots: OpenLot[], orderId: string): DecimalStr {
  return roundCcy(
    lots
      .filter((lot) => lot.orderId === orderId)
      .reduce((acc, lot) => acc.plus(D(lot.usdRemaining)), D(0)),
    'USD',
  ).toFixed(2);
}

export interface DateRangeResolution {
  /** epoch 毫秒，起点含当天 00:00:00 */
  from?: number;
  /** epoch 毫秒，终点含当天 23:59:59.999 */
  to?: number;
  /** 非法区间的中文提示；非空时 from/to 均为 undefined（拒绝筛选，不改变列表） */
  error: string | null;
}

/**
 * 日期范围解析（设计文档 §10.3：起止含当天，end >= start 校验）。
 * 输入为 `<input type="date">` 的 YYYY-MM-DD 字符串，空串表示不限。
 * WHY 非法区间返回 error 且不返回区间：筛选栏就地提示，列表保持现状（与客户充值“只提示零变更”同口径）。
 */
export function resolveDateRange(dateFrom: string, dateTo: string): DateRangeResolution {
  const from = dateFrom === '' ? undefined : dayjs(dateFrom).startOf('day').valueOf();
  const to = dateTo === '' ? undefined : dayjs(dateTo).endOf('day').valueOf();
  if (from !== undefined && to !== undefined && from > to) {
    return { error: '开始日期不能晚于结束日期' };
  }
  return { from, to, error: null };
}

// ---------- 客户订单 ----------

export interface TradingOrderFilter {
  customerId?: string;
  pairId?: PairId;
  /** epoch 毫秒，起点（含当天） */
  from?: number;
  /** epoch 毫秒，终点（含当天） */
  to?: number;
}

/** 客户订单行（运营视角）：订单事实 + 展示名 + 订单级未平敞口 + 1:1 关联收益单 */
export interface TradingOrderRow {
  order: Order;
  customerName: string;
  channelName: string;
  /** 该订单剩余未平 USD（账本 lots 汇总，2 位；已平尽为 '0.00'） */
  openUsd: DecimalStr;
  /** 未平 lot 的建仓基准价（已平尽为 undefined） */
  openMid?: DecimalStr;
  /** 关联收益单（设计文档 §6.6：每笔成功订单恰好一张） */
  profitOrder?: ProfitOrder;
}

export interface TradingOrdersView {
  rows: TradingOrderRow[];
  /** 客户筛选下拉数据源（按客户编号升序，保证选项顺序稳定） */
  customers: Customer[];
  channelName: (channelId: string) => string;
}

/** 全量客户订单（不区分登录客户，运营视角），按筛选条件收窄（设计文档 §10.3） */
export function useTradingOrders(filter: TradingOrderFilter = {}): TradingOrdersView {
  const data = useAppStore((state) => state.data);
  const { customerId, pairId, from, to } = filter;
  const channels = data.fxConfig.channels;

  return useMemo(() => {
    const ledger = selectLedger(data);
    const lotsByOrder = new Map<string, OpenLot[]>();
    for (const lot of ledger.lots) {
      const list = lotsByOrder.get(lot.orderId);
      if (list === undefined) lotsByOrder.set(lot.orderId, [lot]);
      else list.push(lot);
    }
    const profitByOrder = new Map(ledger.profitOrders.map((po) => [po.customerOrderId, po]));

    const rows = data.orders
      .filter((order) => customerId === undefined || order.customerId === customerId)
      .filter((order) => pairId === undefined || order.pairId === pairId)
      .filter((order) => from === undefined || order.createdAt >= from)
      .filter((order) => to === undefined || order.createdAt <= to)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .map((order) => {
        const lots = lotsByOrder.get(order.id) ?? [];
        return {
          order,
          customerName: getCustomerById(data, order.customerId)?.name ?? order.customerId,
          channelName: channelNameOf(channels, order.snapshot.channelId),
          openUsd: openUsdOf(lots, order.id),
          openMid: lots[0]?.openMid,
          profitOrder: profitByOrder.get(order.id),
        };
      });

    return {
      rows,
      customers: [...data.customers].sort((a, b) => a.id.localeCompare(b.id)),
      channelName: (channelId: string) => channelNameOf(channels, channelId),
    };
  }, [data, channels, customerId, pairId, from, to]);
}

export interface TradingOrderDetail {
  /** 关联订单（orderId 为空或不存在时为 undefined） */
  order?: Order;
  customerName: string;
  channelName: string;
  /** 关联钱包流水（兑换扣款/到账两条，时间正序） */
  bills: WalletBill[];
  /** 该订单在所属币对的未平 lot（已平尽为空数组） */
  lots: OpenLot[];
  /** 该订单剩余未平 USD（2 位；已平尽为 '0.00'） */
  openUsd: DecimalStr;
  /** 关联收益单（1:1） */
  profitOrder?: ProfitOrder;
}

/** 客户订单详情（行内展开）：关联流水 + 订单级敞口 + 关联收益单及分配明细（设计文档 §10.3） */
export function useTradingOrderDetail(orderId: string | null): TradingOrderDetail {
  const data = useAppStore((state) => state.data);
  const channels = data.fxConfig.channels;

  return useMemo(() => {
    const order = orderId === null ? undefined : getOrderById(data, orderId);
    if (order === undefined) {
      return {
        order: undefined,
        customerName: '—',
        channelName: '—',
        bills: [],
        lots: [],
        openUsd: '0.00',
      };
    }
    const lots = selectPairLots(data, order.pairId).filter((lot) => lot.orderId === order.id);
    return {
      order,
      customerName: getCustomerById(data, order.customerId)?.name ?? order.customerId,
      channelName: channelNameOf(channels, order.snapshot.channelId),
      bills: getOrderBills(data, order.id),
      lots,
      openUsd: openUsdOf(lots, order.id),
      profitOrder: selectLedger(data).profitOrders.find((po) => po.customerOrderId === order.id),
    };
  }, [data, channels, orderId]);
}

// ---------- 收益订单 ----------

export interface ProfitOrderFilterState {
  status?: ProfitOrderStatus;
  pairId?: PairId;
}

/** 收益订单行：收益单 + 关联客户订单/客户名 + 已平 USD 派生列 */
export interface ProfitOrderRow {
  profitOrder: ProfitOrder;
  /** 关联客户订单（1:1；事实缺失时为 undefined，作防御） */
  order?: Order;
  customerName: string;
  /** 已平 USD = 名义 − 未平（2 位） */
  usdClosed: DecimalStr;
}

/** 收益单列表（收益单号升序），状态/币对筛选复用 §7.3 选择器口径 */
export function useProfitOrders(filter: ProfitOrderFilterState = {}): ProfitOrderRow[] {
  const data = useAppStore((state) => state.data);
  const { status, pairId } = filter;

  return useMemo(
    () =>
      selectProfitOrders(data, { status, pairId }).map((profitOrder) => {
        const order = getOrderById(data, profitOrder.customerOrderId);
        return {
          profitOrder,
          order,
          customerName:
            order === undefined
              ? '—'
              : (getCustomerById(data, order.customerId)?.name ?? order.customerId),
          usdClosed: closedUsdOf(profitOrder),
        };
      }),
    [data, status, pairId],
  );
}
