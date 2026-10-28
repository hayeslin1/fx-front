// API 契约 DTO（设计文档 §8.4/§8.5）。
// 与 src/domain/types.ts 同形但**独立定义**：后端字段演进时只改本文件与 api/*
// 映射，不触碰领域类型与 UI，避免联调期契约漂移反向污染前端领域层。
// 金额/汇率一律 DecimalStr（普通十进制字符串），时间一律 epoch 毫秒 number，
// 字段 camelCase（Jackson 默认）。

// ---------- 通用 ----------
export type DecimalStr = string;
export type Currency = 'USD' | 'GBP' | 'EUR' | 'JPY' | 'CNH' | 'HKD';
export type PairId = 'USD/EUR' | 'USD/GBP' | 'USD/JPY' | 'USD/CNH' | 'USD/HKD';
/** 客户视角方向：SELL_USD = 卖 USD 买外币；BUY_USD = 卖外币买 USD */
export type TradeDirection = 'SELL_USD' | 'BUY_USD';
/** 平台 USD 敞口方向：LONG = 客户卖 USD（平台多头） */
export type PlatformSide = 'LONG' | 'SHORT';
export type BillType =
  'INITIAL_GIFT' | 'TOPUP_SELF' | 'TOPUP_OPS' | 'EXCHANGE_DEBIT' | 'EXCHANGE_CREDIT';
export type TicketStatus = 'PENDING' | 'IN_PROGRESS' | 'CLOSED';
export type ProfitOrderStatus = 'PENDING' | 'PARTIAL' | 'SETTLED';
export type SimulatedResult = 'SUCCESS' | 'FAILED';
export type PnlSource = 'NATURAL_HEDGE' | 'CHANNEL_CLOSE';
/** 报价健康状态：正常 / 回退（命中非首位渠道）/ 无有效报价（§10.3） */
export type QuoteHealthStatus = 'NORMAL' | 'FALLBACK' | 'NO_QUOTE';

/** 统一分页响应（§8.2）：入参 page 从 1 开始 */
export interface Page<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 无请求字段的端点仍发送 JSON `{}`，保持“全部 POST + JSON”的协议一致性 */
export type EmptyReq = Record<string, never>;
export type EmptyResp = Record<string, never>;

// ---------- 客户与钱包 ----------
export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  lastLoginAt: number | null;
}

/** 运营列表内嵌的客户摘要，避免整份 Customer 重复下发 */
export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
}

export interface Wallet {
  customerId: string;
  currency: Currency;
  balance: DecimalStr;
}

export interface WalletBill {
  id: string;
  customerId: string;
  currency: Currency;
  type: BillType;
  /** 带符号金额，扣款为负（普通十进制字符串） */
  amount: DecimalStr;
  balanceBefore: DecimalStr;
  balanceAfter: DecimalStr;
  relatedOrderId?: string;
  operatorId?: string;
  remark?: string;
  createdAt: number;
}

// ---------- 汇率运营配置 ----------
export interface Channel {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
}

export interface CurrencyPair {
  id: PairId;
  enabled: boolean;
}

/** 采集池原始中间价（1 USD = R 报价币） */
export interface RawPrice {
  pairId: PairId;
  channelId: string;
  mid: DecimalStr;
  collectedAt: number;
  quoteEnabled: boolean;
}

/**
 * 采集池查询结果：在 RawPrice 上附加服务端实时计算的有效状态
 * （渠道启用 && 采集时间在 10 分钟内），避免客户端重复推导。
 */
export interface PoolPrice extends RawPrice {
  valid: boolean;
}

export interface RoutingRule {
  pairId: PairId;
  /** 渠道优先级顺序，首位为主渠道 */
  channelIds: string[];
}

export interface MarkupConfig {
  pairId: PairId;
  /** 对称点差：bid/ask 每侧 bps（非金额，允许 number） */
  halfSpreadBps: number;
}

// ---------- 报价与订单 ----------
export interface Quote {
  quoteId: string;
  pairId: PairId;
  direction: TradeDirection;
  channelId: string;
  mid: DecimalStr;
  priceCollectedAt: number;
  halfSpreadBps: number;
  clientRate: DecimalStr;
  sourceCurrency: Currency;
  sourceAmount: DecimalStr;
  targetCurrency: Currency;
  targetAmount: DecimalStr;
  /** 恒为 "0" */
  fee: DecimalStr;
  createdAt: number;
  expiresAt: number;
}

export interface OrderPriceSnapshot {
  clientRate: DecimalStr;
  mid: DecimalStr;
  channelId: string;
  priceCollectedAt: number;
  executedAt: number;
}

export interface Order {
  id: string;
  customerId: string;
  pairId: PairId;
  direction: TradeDirection;
  sourceCurrency: Currency;
  targetCurrency: Currency;
  sourceAmount: DecimalStr;
  targetAmount: DecimalStr;
  fee: DecimalStr;
  /** 原型仅成功成交生成订单 */
  status: 'COMPLETED';
  snapshot: OrderPriceSnapshot;
  createdAt: number;
}

// ---------- 派生账本 ----------
export interface OpenLot {
  orderId: string;
  pairId: PairId;
  side: PlatformSide;
  openMid: DecimalStr;
  usdPrincipal: DecimalStr;
  usdRemaining: DecimalStr;
  openedAt: number;
}

export interface PnlAllocation {
  id: string;
  profitOrderId: string;
  source: PnlSource;
  /** 自然对冲 = 对手订单 id；渠道平仓 = 批次尝试 id */
  refId: string;
  counterpartyOrderId?: string;
  fifoSeq: number;
  usdMatched: DecimalStr;
  openMid: DecimalStr;
  closeMid: DecimalStr;
  pnl: DecimalStr;
  share: DecimalStr;
  isRemainder: boolean;
  currency: Currency;
  createdAt: number;
}

export interface ProfitOrder {
  id: string;
  customerOrderId: string;
  pairId: PairId;
  side: PlatformSide;
  usdNotional: DecimalStr;
  usdOpen: DecimalStr;
  realizedPnl: DecimalStr;
  pnlCurrency: Currency;
  status: ProfitOrderStatus;
  allocations: PnlAllocation[];
}

export interface PairExposure {
  pairId: PairId;
  /** 正 = 平台 USD 多头 */
  netUsd: DecimalStr;
  side: PlatformSide | 'FLAT';
  closeableUsd: DecimalStr;
}

// ---------- 平仓 ----------
export interface CloseAttempt {
  id: string;
  /** 从 1 递增 */
  index: number;
  simulatedResult: SimulatedResult;
  status: SimulatedResult;
  channelId: string;
  lockedMid: DecimalStr;
  priceCollectedAt: number;
  createdAt: number;
  executedAt: number;
  failReason?: string;
  allocations: PnlAllocation[];
}

export interface CloseBatch {
  id: string;
  pairId: PairId;
  /** 与提交时净敞口相反 */
  side: PlatformSide;
  usdAmount: DecimalStr;
  channelId: string;
  createdAt: number;
  attempts: CloseAttempt[];
  /** 取最后一次尝试结果 */
  status: SimulatedResult;
}

// ---------- 工单 ----------
export interface Ticket {
  id: string;
  customerId: string;
  subject: string;
  relatedOrderId?: string;
  status: TicketStatus;
  assigneeId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorKind: 'CUSTOMER' | 'OPS';
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
}

// ---------- 运营与元数据 ----------
export interface OpsUser {
  id: string;
  name: string;
  email: string;
  isDemoAccount: boolean;
}

// ---------- 运营列表的组合视图 ----------
export interface OrderWithCustomer extends Order {
  customer: CustomerSummary;
}

export interface ProfitOrderWithCustomer extends ProfitOrder {
  customer: CustomerSummary;
}

export interface WalletBillWithCustomer extends WalletBill {
  customer: CustomerSummary;
}

export interface TicketWithCustomer extends Ticket {
  customer: CustomerSummary;
}

/** 运营钱包/账户余额视图：客户资料 + 六币种钱包 */
export interface CustomerBalances {
  customer: Customer;
  wallets: Wallet[];
}

/** 运营客户列表视图：在余额之外附加按最新中间价折算的 USD 估值 */
export interface CustomerOverview extends CustomerBalances {
  usdValuation: DecimalStr;
}

// ---------- 运营总览 ----------
export interface OverviewKpi {
  /** 区间成交额，按订单快照 mid 折算 USD */
  turnoverUsd: DecimalStr;
  /** 成功订单数 */
  orderCount: number;
}

export interface OverviewPoint {
  /** 服务端按区间返回的日期标签（YYYY-MM-DD） */
  date: string;
  turnoverUsd: DecimalStr;
  orderCount: number;
}

export interface QuoteHealthItem {
  pairId: PairId;
  /** 无有效报价时为 null，避免前端用空字符串伪装渠道 */
  selectedChannelId: string | null;
  collectedAt: number | null;
  /** 剩余新鲜度（毫秒）；无报价时为 null */
  remainingFreshMs: number | null;
  status: QuoteHealthStatus;
}

export interface OverviewSummaryResp {
  kpi: OverviewKpi;
  series: OverviewPoint[];
  exposureSnapshot: PairExposure[];
  quoteHealth: QuoteHealthItem[];
}

// ======================================================================
// 请求 / 响应 DTO（按 §8.4 端点清单逐条定义）
// 幂等写接口的 requestId 由 http 层自动注入，调用方通常无需传。
// ======================================================================

// ---------- auth.ts ----------
export interface RegisterReq {
  name: string;
  email: string;
  password: string;
  requestId?: string;
}

export interface RegisterResp {
  customerId: string;
  token: string;
}

export interface ClientLoginReq {
  email: string;
  password: string;
}

export interface ClientLoginResp {
  token: string;
  customer: Customer;
}

export interface OpsLoginReq {
  email: string;
  password: string;
}

export interface OpsLoginResp {
  token: string;
  opsUser: OpsUser;
}

// ---------- wallet.ts ----------
export interface WalletBillsReq {
  page: number;
  pageSize: number;
  currency?: Currency;
  type?: BillType;
  /** epoch 毫秒（§8.2 时间字段约定） */
  dateFrom?: number;
  dateTo?: number;
}

export interface TopUpReq {
  currency: Currency;
  amount: DecimalStr;
  requestId?: string;
}

export interface TopUpResp {
  wallet: Wallet;
  bill: WalletBill;
}

// ---------- exchange.ts ----------
export interface ExchangeQuoteReq {
  sourceCurrency: Currency;
  targetCurrency: Currency;
  sourceAmount: DecimalStr;
}

export interface ExchangeExecuteReq {
  quoteId: string;
  requestId?: string;
}

export interface ExchangeExecuteResp {
  order: Order;
  wallets: Wallet[];
  bills: WalletBill[];
}

// ---------- orders.ts ----------
export interface OrdersQueryReq {
  page: number;
  pageSize: number;
  pairId?: PairId;
  dateFrom?: number;
  dateTo?: number;
}

export interface OrderDetailReq {
  orderId: string;
}

export interface OrderDetailResp {
  order: Order;
  bills: WalletBill[];
}

// ---------- support.ts ----------
export interface TicketCreateReq {
  subject: string;
  content: string;
  relatedOrderId?: string;
  requestId?: string;
}

export interface TicketsQueryReq {
  status?: TicketStatus;
  page: number;
  pageSize: number;
}

export interface TicketDetailReq {
  ticketId: string;
}

export interface TicketDetailResp {
  ticket: Ticket;
  messages: TicketMessage[];
}

export interface TicketReplyReq {
  ticketId: string;
  content: string;
  requestId?: string;
}

export interface OpsTicketsQueryReq {
  status?: TicketStatus;
  assigneeId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface OpsTicketAssignReq {
  ticketId: string;
  assigneeId: string;
}

export interface OpsTicketStatusReq {
  ticketId: string;
  status: TicketStatus;
}

export interface OpsTicketCloseReq {
  ticketId: string;
  requestId?: string;
}

// ---------- fx-config.ts ----------
export interface ChannelSaveReq {
  /** 无 id 为新增，有 id 为编辑 */
  id?: string;
  name: string;
  enabled: boolean;
}

export interface ChannelToggleReq {
  channelId: string;
  enabled: boolean;
}

export interface PairToggleReq {
  pairId: PairId;
  enabled: boolean;
}

export interface PoolCollectReq {
  pairId: PairId;
  channelId: string;
}

export interface QuoteEnabledToggleReq {
  pairId: PairId;
  channelId: string;
  quoteEnabled: boolean;
}

export interface RoutingSaveReq {
  pairId: PairId;
  channelIds: string[];
}

export interface MarkupSaveReq {
  pairId: PairId;
  halfSpreadBps: number;
}

// ---------- trading.ts ----------
export interface OpsOrdersQueryReq {
  customerId?: string;
  pairId?: PairId;
  dateFrom?: number;
  dateTo?: number;
  page: number;
  pageSize: number;
}

export interface OpsOrderDetailReq {
  orderId: string;
}

export interface OpsOrderDetailResp {
  order: Order;
  lots: OpenLot[];
  bills: WalletBill[];
  profitOrder: ProfitOrder;
}

export interface ExposureQueryResp {
  pairs: PairExposure[];
  lots: OpenLot[];
}

export interface CloseBatchesQueryReq {
  pairId?: PairId;
  status?: SimulatedResult;
  page: number;
  pageSize: number;
}

export interface CloseBatchCreateReq {
  pairId: PairId;
  usdAmount: DecimalStr;
  channelId: string;
  /** 演示字段，对接期替换（§8.6） */
  simulatedResult: SimulatedResult;
  requestId?: string;
}

export interface CloseBatchRetryReq {
  batchId: string;
  pairId: PairId;
  usdAmount: DecimalStr;
  channelId: string;
  simulatedResult: SimulatedResult;
  requestId?: string;
}

export interface CloseBatchDetailReq {
  batchId: string;
}

export interface CloseBatchDetailResp {
  batch: CloseBatch;
  attempts: CloseAttempt[];
  allocations: PnlAllocation[];
}

export interface ProfitOrdersQueryReq {
  pairId?: PairId;
  status?: ProfitOrderStatus;
  page: number;
  pageSize: number;
}

export interface ProfitOrderDetailReq {
  profitOrderId: string;
}

// ---------- ops-wallet.ts ----------
export interface OpsWalletBalancesReq {
  customerId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface OpsBillsQueryReq {
  customerId?: string;
  type?: BillType;
  dateFrom?: number;
  dateTo?: number;
  page: number;
  pageSize: number;
}

export interface AssistedTopUpReq {
  customerId: string;
  currency: Currency;
  amount: DecimalStr;
  /** 代客充值必填，用于审计 */
  remark: string;
  requestId?: string;
}

export interface AssistedTopUpResp {
  wallet: Wallet;
  bill: WalletBill;
}

// ---------- ops-customer.ts ----------
export interface CustomersQueryReq {
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface CustomerDetailReq {
  customerId: string;
}

export interface CustomerDetailResp {
  customer: Customer;
  wallets: Wallet[];
  recentOrders: Order[];
}

// ---------- overview.ts ----------
export type OverviewRangeType = 'TODAY' | 'LAST_7D' | 'LAST_30D' | 'CUSTOM';

export interface OverviewRange {
  type: OverviewRangeType;
  /** CUSTOM 时必填；epoch 毫秒，起止均含当天（§10.3） */
  dateFrom?: number;
  dateTo?: number;
}

export interface OverviewSummaryReq {
  range: OverviewRange;
}
