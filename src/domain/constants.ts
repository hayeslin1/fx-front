import type { Currency, PairId } from './types';

// 全局常量（设计文档附录 C）
export const QUOTE_TTL_MS = 30_000; // 客户锁价 30 秒（PRD §4.3）
export const PRICE_FRESH_MS = 600_000; // 原始价新鲜度 10 分钟（PRD §4.1）
export const LIMIT_MIN_USD = '1'; // 单笔下限（按原始中间价折算，PRD §4.3）
export const LIMIT_MAX_USD = '10000'; // 单笔上限
export const DEFAULT_HALF_SPREAD_BPS = 50; // 每侧点差，bid/ask 对称（PRD §4.2）
export const FEE = '0'; // 独立服务费固定为零

export const CCY_DP: Record<Currency, 0 | 2> = {
  USD: 2,
  GBP: 2,
  EUR: 2,
  JPY: 0,
  CNH: 2,
  HKD: 2,
};

export const ALL_CURRENCIES: readonly Currency[] = ['USD', 'GBP', 'EUR', 'JPY', 'CNH', 'HKD'];

export const PAIR_IDS: readonly PairId[] = ['USD/EUR', 'USD/GBP', 'USD/JPY', 'USD/CNH', 'USD/HKD'];

/** 各币对的报价币（收益/损益记账币种，PRD §6.2） */
export const QUOTE_CCY: Record<PairId, Currency> = {
  'USD/EUR': 'EUR',
  'USD/GBP': 'GBP',
  'USD/JPY': 'JPY',
  'USD/CNH': 'CNH',
  'USD/HKD': 'HKD',
};

export const RATE_SIG_DIGITS = 12; // 汇率内部有效位（设计文档 §6.1）
export const DECIMAL_PRECISION = 20; // Decimal 全局精度

/** 新注册客户的演示初始余额（PRD §3.1） */
export const NEW_CUSTOMER_GIFT: Record<Currency, string> = {
  USD: '1000',
  GBP: '800',
  EUR: '900',
  JPY: '150000',
  CNH: '7200',
  HKD: '7800',
};

/** 持久化单键与版本（设计文档 §5.3） */
export const STORAGE_KEY = 'fxprot:state:v1';
export const STORAGE_VERSION = 1;

/** 模拟采集确定性步长序列默认值（决策 D5） */
export const COLLECT_STEPS_DEFAULT: readonly string[] = ['-0.12', '+0.20', '-0.08', '+0.15'];
