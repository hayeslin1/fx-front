// 领域类型全集（对应技术设计文档附录 A）。
// Decimal 一律以普通十进制字符串持久化（DecimalStr），禁止在持久化数据中出现 number 金额。

// ---------- 基础 ----------
export type Currency = 'USD' | 'GBP' | 'EUR' | 'JPY' | 'CNH' | 'HKD';
export type PairId = 'USD/EUR' | 'USD/GBP' | 'USD/JPY' | 'USD/CNH' | 'USD/HKD';
/** 客户视角方向：卖 USD 买外币 / 卖外币买 USD（共 10 个有向兑换方向） */
export type TradeDirection = 'SELL_USD' | 'BUY_USD';
/** 平台 USD 敞口方向：多头 = 客户卖 USD */
export type PlatformSide = 'LONG' | 'SHORT';
export type DecimalStr = string;

// ---------- 客户与钱包 ----------
export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  lastLoginAt: number | null;
}

/** 客户登录凭证（演示级：SHA-256(salt:password)，设计文档 §4.3） */
export interface CustomerCredential {
  customerId: string;
  salt: string;
  passwordHash: string;
}

export type BillType =
  'INITIAL_GIFT' | 'TOPUP_SELF' | 'TOPUP_OPS' | 'EXCHANGE_DEBIT' | 'EXCHANGE_CREDIT';

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
  /** 带符号金额（扣款为负） */
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

/** 采集池：各启用渠道 × 五币对的最新原始中间价（1 USD = R 报价币） */
export interface RawPrice {
  pairId: PairId;
  channelId: string;
  mid: DecimalStr;
  collectedAt: number;
  /** 采集报价启用开关（仅约束客户报价，见设计文档 §14 口径说明） */
  quoteEnabled: boolean;
}

export interface RoutingRule {
  pairId: PairId;
  /** 渠道优先级顺序（首位为主渠道） */
  channelIds: string[];
}

export interface MarkupConfig {
  pairId: PairId;
  /** 对称点差：bid/ask 每侧 bps，默认 50（总宽度 100bps） */
  halfSpreadBps: number;
}

/** 模拟采集的确定性步长序列（百分比字符串，如 "-0.12"），循环使用（决策 D5） */
export interface CollectStepSeq {
  pairId: PairId;
  steps: string[];
  nextIndex: number;
}

export interface FxConfigState {
  channels: Channel[];
  pairs: CurrencyPair[];
  rawPrices: RawPrice[];
  routing: RoutingRule[];
  markups: MarkupConfig[];
  collectSteps: CollectStepSeq[];
}

// ---------- 报价与订单 ----------
/** 客户报价（内存态，30 秒有效，不持久化） */
export interface Quote {
  quoteId: string;
  pairId: PairId;
  direction: TradeDirection;
  channelId: string;
  /** 成交时原始中间价（1 USD = R 报价币，12 位有效位） */
  mid: DecimalStr;
  priceCollectedAt: number;
  halfSpreadBps: number;
  /** 客户成交价（bid 或 ask，含点差、无服务费） */
  clientRate: DecimalStr;
  sourceCurrency: Currency;
  sourceAmount: DecimalStr;
  targetCurrency: Currency;
  targetAmount: DecimalStr;
  /** 恒为 "0"（PRD §4.2） */
  fee: DecimalStr;
  createdAt: number;
  expiresAt: number;
}

/** 订单价格快照（PRD §6.1 必需字段） */
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
  /** 原型仅成功成交生成订单（PRD §3.3） */
  status: 'COMPLETED';
  snapshot: OrderPriceSnapshot;
  createdAt: number;
}

// ---------- 派生账本（由重放引擎生成，不持久化，设计文档 §5.1） ----------
export interface OpenLot {
  orderId: string;
  pairId: PairId;
  side: PlatformSide;
  /** 建仓基准价 = 订单成交时原始中间价 */
  openMid: DecimalStr;
  usdPrincipal: DecimalStr;
  usdRemaining: DecimalStr;
  openedAt: number;
}

export type PnlSource = 'NATURAL_HEDGE' | 'CHANNEL_CLOSE';

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
  /** 该段总损益（高精度，不做逐段舍入） */
  pnl: DecimalStr;
  /** 本次归属该收益单的金额 */
  share: DecimalStr;
  /** 尾差标记：归 FIFO 较早的收益订单 */
  isRemainder: boolean;
  currency: Currency;
  createdAt: number;
}

export type ProfitOrderStatus = 'PENDING' | 'PARTIAL' | 'SETTLED';

export interface ProfitOrder {
  id: string;
  customerOrderId: string;
  pairId: PairId;
  side: PlatformSide;
  /** 订单原始 USD 名义金额 */
  usdNotional: DecimalStr;
  usdOpen: DecimalStr;
  /** 累计已实现损益（高精度；展示按报价币精度舍入，决策 D7） */
  realizedPnl: DecimalStr;
  /** = 币对报价币，不同报价币不得相加（PRD §6.2） */
  pnlCurrency: Currency;
  status: ProfitOrderStatus;
  allocations: PnlAllocation[];
}

// ---------- 平仓 ----------
export type SimulatedResult = 'SUCCESS' | 'FAILED';

export interface CloseAttempt {
  id: string;
  /** 从 1 递增 */
  index: number;
  simulatedResult: SimulatedResult;
  status: SimulatedResult;
  channelId: string;
  /** 提交时锁定的渠道原始价快照 */
  lockedMid: DecimalStr;
  priceCollectedAt: number;
  createdAt: number;
  executedAt: number;
  failReason?: string;
  /** 由重放引擎派生填充（M2）；持久化事实中为空数组占位 */
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
export type TicketStatus = 'PENDING' | 'IN_PROGRESS' | 'CLOSED';

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
}

/** 运营账号（含演示登录账号与处理人名单的凭证扩展） */
export interface OpsAccount extends OpsUser {
  salt: string;
  passwordHash: string;
  isDemoAccount: boolean;
}

/** 编号计数器：{ [prefix]: { day: 'YYYYMMDD'|'GLOBAL', seq } }（附录 D） */
export type Counters = Record<string, { day: string; seq: number }>;

export interface Meta {
  schemaVersion: number;
  seededAt: number;
  resetCount: number;
  /** seed 锚点时间（相对时间回推基准） */
  anchorAt: number;
}

// ---------- 全局状态 ----------
export interface DataState {
  customers: Customer[];
  credentials: CustomerCredential[];
  opsAccounts: OpsAccount[];
  assignees: OpsUser[];
  wallets: Wallet[];
  bills: WalletBill[];
  orders: Order[];
  closeBatches: CloseBatch[];
  tickets: Ticket[];
  ticketMessages: TicketMessage[];
  fxConfig: FxConfigState;
  counters: Counters;
  meta: Meta;
}

export interface SessionState {
  client: { customerId: string } | null;
  ops: { opsAccountId: string } | null;
}

// ---------- 领域服务契约（设计文档 §7.2/附录 B） ----------
export interface DomainContext {
  now: number;
}

export type DomainResult<T> =
  { ok: true; next: DataState; data: T } | { ok: false; code: string; message: string };

export interface DomainCommand<T> {
  run: (state: DataState, ctx: DomainContext) => DomainResult<T> | Promise<DomainResult<T>>;
}
