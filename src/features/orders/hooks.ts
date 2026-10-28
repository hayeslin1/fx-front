import { useMemo } from 'react';
import type { Order, WalletBill } from '@/domain/types';
import { useAppStore } from '@/store';
import { getCustomerOrders, getOrderBills, getOrderById } from '@/store/selectors';
import { channelNameOf } from '@/features/exchange/labels';

// 订单 feature 薄 hooks（设计文档 §7.2）：列表/详情的 store 读写收敛在此。

export interface CustomerOrdersView {
  customerId: string | null;
  /** 当前客户订单（成交时间倒序） */
  orders: Order[];
  channelName: (channelId: string) => string;
}

/** 订单列表视图：当前登录客户的订单（PRD §3.4） */
export function useCustomerOrders(): CustomerOrdersView {
  const data = useAppStore((state) => state.data);
  const customerId = useAppStore((state) => state.session.client?.customerId ?? null);
  const orders = useMemo(
    () => (customerId !== null ? getCustomerOrders(data, customerId) : []),
    [data, customerId],
  );
  const channels = data.fxConfig.channels;
  return {
    customerId,
    orders,
    channelName: (channelId: string) => channelNameOf(channels, channelId),
  };
}

export interface OrderDetailView {
  order: Order | undefined;
  /** 该订单关联的钱包流水（兑换扣款/到账两条，时间正序） */
  bills: WalletBill[];
  channelName: (channelId: string) => string;
}

/**
 * 订单详情视图（PRD §3.4）：仅允许查看本人订单（订单号非本客户时按不存在处理，
 * 避免通过 URL 猜测他人订单）。
 */
export function useOrderDetail(orderId: string): OrderDetailView {
  const data = useAppStore((state) => state.data);
  const customerId = useAppStore((state) => state.session.client?.customerId ?? null);
  const order = useMemo(() => {
    const found = getOrderById(data, orderId);
    return found !== undefined && found.customerId === customerId ? found : undefined;
  }, [data, orderId, customerId]);
  const bills = useMemo(
    () => (order !== undefined ? getOrderBills(data, order.id) : []),
    [data, order],
  );
  const channels = data.fxConfig.channels;
  return {
    order,
    bills,
    channelName: (channelId: string) => channelNameOf(channels, channelId),
  };
}
