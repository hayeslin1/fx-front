import type {
  Currency,
  OpsUser,
  PairId,
  SimulatedResult,
  TicketStatus,
  TradeDirection,
} from '@/domain/types';

// 预置演示数据脚本（设计文档 §5.4）。本文件只有“事实描述”，
// 余额/到账金额/账本全部由 domain/seed.ts 用引擎计算，保证联动一致。

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

// ---------- 账号 ----------
export interface SeedCustomerSpec {
  id: string;
  name: string;
  email: string;
  password: string;
  /** 预置样例客户为“老客户”，期初余额大于新注册赠送（设计文档 §5.4） */
  initialBalances: Record<Currency, string>;
}

export const SEED_CUSTOMERS: SeedCustomerSpec[] = [
  {
    id: 'C-001',
    name: '林小满',
    email: 'linxiaoman@demo.fx',
    password: 'Demo1234',
    initialBalances: {
      USD: '30000',
      EUR: '5000',
      GBP: '3000',
      JPY: '500000',
      CNH: '20000',
      HKD: '30000',
    },
  },
  {
    id: 'C-002',
    name: '陈屿',
    email: 'chenyu@demo.fx',
    password: 'Demo1234',
    initialBalances: {
      USD: '15000',
      EUR: '8000',
      GBP: '2000',
      JPY: '900000',
      CNH: '50000',
      HKD: '10000',
    },
  },
  {
    id: 'C-003',
    name: '苏晚',
    email: 'suwan@demo.fx',
    password: 'Demo1234',
    initialBalances: {
      USD: '12000',
      EUR: '2000',
      GBP: '1000',
      JPY: '2000000',
      CNH: '30000',
      HKD: '5000',
    },
  },
];

export interface SeedOpsSpec {
  id: string;
  name: string;
  email: string;
  password: string;
  isDemoAccount: boolean;
}

export const SEED_OPS_ACCOUNTS: SeedOpsSpec[] = [
  {
    id: 'OPS-001',
    name: '演示管理员',
    email: 'ops@demo.fx',
    password: 'OpsDemo123',
    isDemoAccount: true,
  },
];

/** 工单分派用预置处理人名单（PRD §5.6） */
export const SEED_ASSIGNEES: OpsUser[] = [
  { id: 'OPS-002', name: '王倩', email: 'wangqian@demo.fx' },
  { id: 'OPS-003', name: '李昂', email: 'liang@demo.fx' },
  { id: 'OPS-004', name: '赵敏', email: 'zhaomin@demo.fx' },
];

// ---------- 汇率运营配置 ----------
export interface SeedChannelSpec {
  id: string;
  name: string;
  enabled: boolean;
}

export const SEED_CHANNELS: SeedChannelSpec[] = [
  { id: 'CH-01', name: '华星清算', enabled: true },
  { id: 'CH-02', name: '北岭报价', enabled: true },
  { id: 'CH-03', name: '青屿流动池', enabled: false },
];

/** 各渠道各币对原始中间价（1 USD = R 报价币）；CH-03 停用用于演示启用/停用 */
export const SEED_MIDS: Record<PairId, Record<string, string>> = {
  'USD/EUR': { 'CH-01': '0.9200', 'CH-02': '0.9205', 'CH-03': '0.9198' },
  'USD/GBP': { 'CH-01': '0.7850', 'CH-02': '0.7852', 'CH-03': '0.7848' },
  'USD/JPY': { 'CH-01': '151.20', 'CH-02': '151.00', 'CH-03': '150.90' },
  'USD/CNH': { 'CH-01': '7.2450', 'CH-02': '7.2460', 'CH-03': '7.2430' },
  'USD/HKD': { 'CH-01': '7.8100', 'CH-02': '7.8110', 'CH-03': '7.8080' },
};

/** USD/JPY 主渠道为 CH-02，演示“主渠道非路由首位”的回退语义 */
export const SEED_ROUTING: Record<PairId, string[]> = {
  'USD/EUR': ['CH-01', 'CH-02', 'CH-03'],
  'USD/GBP': ['CH-01', 'CH-02', 'CH-03'],
  'USD/JPY': ['CH-02', 'CH-01', 'CH-03'],
  'USD/CNH': ['CH-01', 'CH-02', 'CH-03'],
  'USD/HKD': ['CH-01', 'CH-02', 'CH-03'],
};

// ---------- 交易与平仓事件脚本 ----------
export interface SeedTradeSpec {
  customerId: string;
  pairId: PairId;
  direction: TradeDirection;
  sourceAmount: string;
  /** 成交时原始中间价快照 */
  mid: string;
  channelId: string;
  /** 相对锚点时间（负值） */
  offsetMs: number;
}

/** 9 笔成功订单，与设计文档 §5.4 交易事件脚本逐条对应（时间已错开保证排序确定） */
export const SEED_TRADES: SeedTradeSpec[] = [
  {
    customerId: 'C-001',
    pairId: 'USD/EUR',
    direction: 'SELL_USD',
    sourceAmount: '2000.00',
    mid: '0.9200',
    channelId: 'CH-01',
    offsetMs: -5 * DAY,
  },
  {
    customerId: 'C-002',
    pairId: 'USD/EUR',
    direction: 'BUY_USD',
    sourceAmount: '740.08',
    mid: '0.9205',
    channelId: 'CH-02',
    offsetMs: -4 * DAY,
  },
  {
    customerId: 'C-003',
    pairId: 'USD/JPY',
    direction: 'SELL_USD',
    sourceAmount: '5000.00',
    mid: '151.20',
    channelId: 'CH-01',
    offsetMs: -4 * DAY + 1 * HOUR,
  },
  {
    customerId: 'C-001',
    pairId: 'USD/EUR',
    direction: 'SELL_USD',
    sourceAmount: '1500.00',
    mid: '0.9195',
    channelId: 'CH-01',
    offsetMs: -3 * DAY,
  },
  {
    customerId: 'C-001',
    pairId: 'USD/GBP',
    direction: 'SELL_USD',
    sourceAmount: '6000.00',
    mid: '0.7850',
    channelId: 'CH-01',
    offsetMs: -3 * DAY + 1 * HOUR,
  },
  {
    customerId: 'C-002',
    pairId: 'USD/JPY',
    direction: 'BUY_USD',
    sourceAmount: '300000',
    mid: '151.00',
    channelId: 'CH-02',
    offsetMs: -2 * DAY,
  },
  {
    customerId: 'C-003',
    pairId: 'USD/CNH',
    direction: 'BUY_USD',
    sourceAmount: '8737.47',
    mid: '7.2450',
    channelId: 'CH-01',
    offsetMs: -2 * DAY + 2 * HOUR,
  },
  {
    customerId: 'C-002',
    pairId: 'USD/HKD',
    direction: 'BUY_USD',
    sourceAmount: '7850.06',
    mid: '7.8110',
    channelId: 'CH-02',
    offsetMs: -1 * DAY,
  },
  {
    customerId: 'C-003',
    pairId: 'USD/HKD',
    direction: 'SELL_USD',
    sourceAmount: '400.00',
    mid: '7.8100',
    channelId: 'CH-01',
    offsetMs: -12 * HOUR,
  },
];

export interface SeedTopupSpec {
  customerId: string;
  currency: Currency;
  type: 'TOPUP_SELF' | 'TOPUP_OPS';
  amount: string;
  operatorId?: string;
  remark?: string;
  offsetMs: number;
}

export const SEED_TOPUPS: SeedTopupSpec[] = [
  {
    customerId: 'C-003',
    currency: 'CNH',
    type: 'TOPUP_SELF',
    amount: '5000',
    offsetMs: -2 * DAY + 1 * HOUR,
  },
  {
    customerId: 'C-002',
    currency: 'USD',
    type: 'TOPUP_OPS',
    amount: '2000',
    operatorId: 'OPS-001',
    remark: '演示：客诉补偿入账',
    offsetMs: -1 * DAY + 2 * HOUR,
  },
];

export interface SeedCloseSpec {
  pairId: PairId;
  side: 'LONG' | 'SHORT';
  usdAmount: string;
  channelId: string;
  lockedMid: string;
  simulatedResult: SimulatedResult;
  failReason?: string;
  offsetMs: number;
}

export const SEED_CLOSE_BATCHES: SeedCloseSpec[] = [
  {
    pairId: 'USD/EUR',
    side: 'SHORT',
    usdAmount: '1000.00',
    channelId: 'CH-01',
    lockedMid: '0.9202',
    simulatedResult: 'SUCCESS',
    offsetMs: -2 * DAY + 3 * HOUR,
  },
  {
    pairId: 'USD/JPY',
    side: 'SHORT',
    usdAmount: '1500.00',
    channelId: 'CH-02',
    lockedMid: '151.00',
    simulatedResult: 'FAILED',
    failReason: '模拟失败（演示）',
    offsetMs: -1 * DAY + 1 * HOUR,
  },
];

// ---------- 工单 ----------
export interface SeedTicketMessageSpec {
  authorKind: 'CUSTOMER' | 'OPS';
  /** 运营消息填处理人 id；客户消息留空自动取客户本人 */
  authorId?: string;
  content: string;
  offsetMs: number;
}

export interface SeedTicketSpec {
  customerId: string;
  subject: string;
  relatedOrderId?: string;
  status: TicketStatus;
  assigneeId?: string;
  offsetMs: number;
  messages: SeedTicketMessageSpec[];
}

export const SEED_TICKETS: SeedTicketSpec[] = [
  {
    customerId: 'C-001',
    subject: 'EUR 到账金额与预期不一致',
    status: 'PENDING',
    offsetMs: -3 * HOUR,
    messages: [
      {
        authorKind: 'CUSTOMER',
        content:
          '你好，我前两天用 USD 兑换 EUR，到账金额似乎比页面预计的少了一点，麻烦帮忙核对一下，谢谢。',
        offsetMs: -3 * HOUR,
      },
    ],
  },
  {
    customerId: 'C-002',
    subject: '报价过期提示咨询',
    status: 'IN_PROGRESS',
    assigneeId: 'OPS-002',
    offsetMs: -1 * DAY,
    messages: [
      {
        authorKind: 'CUSTOMER',
        content: '取价后 30 秒没来得及确认，提示报价已过期，请问这是正常的吗？',
        offsetMs: -1 * DAY,
      },
      {
        authorKind: 'OPS',
        authorId: 'OPS-002',
        content:
          '您好，这是正常的锁价机制：报价有效期为 30 秒，过期后重新点击“获取报价”即可，价格可能随时间变化。',
        offsetMs: -1 * DAY + 2 * HOUR,
      },
    ],
  },
  {
    customerId: 'C-003',
    subject: '如何查看钱包账单明细',
    status: 'CLOSED',
    assigneeId: 'OPS-003',
    offsetMs: -2 * DAY,
    messages: [
      {
        authorKind: 'CUSTOMER',
        content: '想导出钱包流水，请问在哪里查看完整账单？',
        offsetMs: -2 * DAY,
      },
      {
        authorKind: 'OPS',
        authorId: 'OPS-003',
        content:
          '您好，进入「钱包」页面即可看到全部账单明细，当前演示版本暂不支持导出，后续会补充。',
        offsetMs: -2 * DAY + 1 * HOUR,
      },
    ],
  },
];
