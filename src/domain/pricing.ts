import { uuid } from '@/lib/uuid';
import {
  DEFAULT_HALF_SPREAD_BPS,
  FEE,
  LIMIT_MAX_USD,
  LIMIT_MIN_USD,
  PRICE_FRESH_MS,
  QUOTE_CCY,
  QUOTE_TTL_MS,
} from './constants';
import {
  D,
  Decimal,
  ccyDp,
  deriveClientRate,
  isValidAmountInput,
  roundCcy,
  toRateSig12,
} from './money';
import type {
  Channel,
  Currency,
  CurrencyPair,
  DecimalStr,
  MarkupConfig,
  PairId,
  Quote,
  RawPrice,
  RoutingRule,
  TradeDirection,
} from './types';

/**
 * 报价引擎只依赖运营配置的五个切片（设计文档附录 B）。
 * WHY 不直接使用 FxConfigState：报价与采集步长无关，收窄入参可避免
 * 报价逻辑意外依赖采集/持久化细节，也便于服务层与 API 契约层复用。
 */
export interface PricingConfig {
  channels: Channel[];
  pairs: CurrencyPair[];
  rawPrices: RawPrice[];
  routing: RoutingRule[];
  markups: MarkupConfig[];
}

/**
 * 取价失败原因。
 * 附录 B 仅列出 PAIR_DISABLED / NO_QUOTE，但设计文档 §6.2 步骤 5 明确要求
 * 限额失败返回 BELOW_MIN / ABOVE_MAX，且步骤 5 还要求校验来源金额格式，
 * 因此此处补充三个业务失败码（文档缺口已上报，未自行修改文档）。
 */
export type NoQuoteReason =
  | 'PAIR_DISABLED'
  | 'NO_QUOTE'
  | 'BELOW_MIN'
  | 'ABOVE_MAX'
  | 'INVALID_AMOUNT';

/** 单渠道诊断：逐渠道说明为何不能用于本次报价（PRD §4.1 无有效报价原因展示） */
export interface ChannelDiag {
  channelId: string;
  reason: 'CHANNEL_DISABLED' | 'PRICE_DISABLED' | 'PRICE_STALE' | 'NO_PRICE' | 'NOT_IN_ROUTING';
}

/** 对外返回结构：成功携带完整报价快照，失败携带原因与逐渠道诊断 */
type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: NoQuoteReason; diagnostics: ChannelDiag[] };

/** 渠道评估结果：可用时携带原始价与已归一化的中间价，否则携带诊断原因 */
type ChannelEvaluation =
  | { available: true; price: RawPrice; mid: Decimal }
  | { available: false; reason: ChannelDiag['reason'] };

/**
 * 解析原始中间价。
 * WHY 做防御：持久化数据可能被手工篡改，非法/非正价格不能让整个报价页抛异常，
 * 统一按“无有效价格”处理并进入原因诊断。
 */
function parseMid(raw: RawPrice): Decimal | null {
  try {
    const value = D(raw.mid);
    return value.isFinite() && value.gt(0) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 取某渠道某币对“最新一条”原始价（设计文档 §6.2 步骤 3）。
 * WHY 不用数组首条：采集池会持续更新，历史条目可能残留，必须按采集时间取最新。
 * 同一采集时间时保留先出现者，保证纯函数结果确定。
 */
function latestPriceOf(
  cfg: PricingConfig,
  pairId: PairId,
  channelId: string,
): RawPrice | undefined {
  let latest: RawPrice | undefined;
  for (const raw of cfg.rawPrices) {
    if (raw.pairId !== pairId || raw.channelId !== channelId) continue;
    if (latest === undefined || raw.collectedAt > latest.collectedAt) latest = raw;
  }
  return latest;
}

/**
 * 评估单个渠道能否提供本次报价（设计文档 §6.2 步骤 2）。
 * 条件顺序即诊断优先级：不在路由 → 渠道停用 → 无有效原始价 → 报价开关停用 → 采集价过期。
 * WHY 先判渠道再判价格：渠道整体停用时，价格新旧/开关已无意义，诊断应给最根本原因。
 */
function evaluateChannel(
  cfg: PricingConfig,
  pairId: PairId,
  channelId: string,
  now: number,
  inRouting: boolean,
): ChannelEvaluation {
  if (!inRouting) return { available: false, reason: 'NOT_IN_ROUTING' };

  const channel = cfg.channels.find((item) => item.id === channelId);
  if (channel === undefined || !channel.enabled) {
    return { available: false, reason: 'CHANNEL_DISABLED' };
  }

  const raw = latestPriceOf(cfg, pairId, channelId);
  if (raw === undefined) return { available: false, reason: 'NO_PRICE' };

  const mid = parseMid(raw);
  if (mid === null) return { available: false, reason: 'NO_PRICE' };

  if (!raw.quoteEnabled) return { available: false, reason: 'PRICE_DISABLED' };

  // 新鲜度边界：now - collectedAt 恰为 10 分钟仍有效，超过 1ms 即失效（PRD §4.1）
  if (now - raw.collectedAt > PRICE_FRESH_MS) {
    return { available: false, reason: 'PRICE_STALE' };
  }

  return { available: true, price: raw, mid: toRateSig12(mid) };
}

/**
 * 生成逐渠道诊断（PRD §4.1 / §10.2“无报价 → 展示原因诊断”）。
 * 覆盖 cfg.channels 全部渠道；路由中引用了但未配置的渠道也补一条 CHANNEL_DISABLED，
 * 保证“逐渠道给出原因”不因配置残缺而缺失条目。
 */
function buildDiagnostics(
  cfg: PricingConfig,
  pairId: PairId,
  now: number,
  routingIds: readonly string[],
): ChannelDiag[] {
  const diagnostics: ChannelDiag[] = [];
  const inRouting = new Set(routingIds);
  const seen = new Set<string>();

  for (const channel of cfg.channels) {
    seen.add(channel.id);
    const evaluation = evaluateChannel(cfg, pairId, channel.id, now, inRouting.has(channel.id));
    if (!evaluation.available) {
      diagnostics.push({ channelId: channel.id, reason: evaluation.reason });
    }
  }

  for (const channelId of routingIds) {
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    // 路由引用了不存在的渠道：视作渠道停用，避免无报价时漏掉该路由项
    diagnostics.push({ channelId, reason: 'CHANNEL_DISABLED' });
  }

  return diagnostics;
}

/** 读取币对加点；缺失或非法配置回退默认 50bps，避免 NaN 污染报价 */
function resolveHalfSpreadBps(cfg: PricingConfig, pairId: PairId): number {
  const markup = cfg.markups.find((item) => item.pairId === pairId);
  const bps = markup?.halfSpreadBps;
  return bps !== undefined && Number.isFinite(bps) ? bps : DEFAULT_HALF_SPREAD_BPS;
}

/**
 * 获取客户报价（设计文档 §6.2，严格按步骤执行）。
 *
 * 纯领域函数：不读真实时钟（now 由调用方注入）、不访问 React/store、不修改入参。
 * 返回的 Quote 是纯数据快照：之后任何配置变更都不会影响已发出的报价（PRD §4.1/§9-5）。
 */
export function getQuote(
  cfg: PricingConfig,
  req: { pairId: PairId; direction: TradeDirection; sourceAmount: DecimalStr },
  now: number,
): QuoteResult {
  const { pairId, direction, sourceAmount: sourceAmountInput } = req;

  // 步骤 1：币对启用校验。停用币对双向均不可报价（PRD §5.5）。
  const pair = cfg.pairs.find((item) => item.id === pairId);
  if (pair === undefined || !pair.enabled) {
    return { ok: false, reason: 'PAIR_DISABLED', diagnostics: [] };
  }

  // 步骤 2：按路由优先级选源。只有“渠道启用 && 报价启用 && 有价格 && 10min 内”才可命中。
  const routingIds = cfg.routing.find((item) => item.pairId === pairId)?.channelIds ?? [];
  let selected: Extract<ChannelEvaluation, { available: true }> | undefined;
  for (const channelId of routingIds) {
    const evaluation = evaluateChannel(cfg, pairId, channelId, now, true);
    if (evaluation.available) {
      selected = evaluation;
      break;
    }
  }
  if (selected === undefined) {
    return {
      ok: false,
      reason: 'NO_QUOTE',
      diagnostics: buildDiagnostics(cfg, pairId, now, routingIds),
    };
  }

  // 步骤 3：选中渠道的原始中间价（已归一化到 12 位有效位）。
  const mid = selected.mid;

  // 买卖方向对应的来源币/目标币：USD 为枢纽，另一腿即报价币。
  const quoteCcy = QUOTE_CCY[pairId];
  const sourceCurrency: Currency = direction === 'SELL_USD' ? 'USD' : quoteCcy;
  const targetCurrency: Currency = direction === 'SELL_USD' ? quoteCcy : 'USD';

  // 步骤 4：读取该币对点差并推导客户成交价（SELL 用 bid，BUY 用 ask，服务费恒为 0）。
  const halfSpreadBps = resolveHalfSpreadBps(cfg, pairId);
  const clientRate = deriveClientRate(mid, halfSpreadBps, direction);

  // 步骤 5：来源金额格式校验（正数 + 币种精度；JPY 仅整数）。
  // WHY 先校验格式再折算：非法字符串无法参与 Decimal 运算，且输入层同样会拦截。
  if (!isValidAmountInput(sourceAmountInput, sourceCurrency)) {
    return { ok: false, reason: 'INVALID_AMOUNT', diagnostics: [] };
  }
  const sourceAmount = D(sourceAmountInput);

  // 限额按原始中间价折算，不计客户点差（PRD §4.3）；边界 1 与 10,000 均含。
  const usdEquivalent =
    direction === 'SELL_USD' ? sourceAmount : sourceAmount.div(mid);
  if (usdEquivalent.lt(D(LIMIT_MIN_USD))) {
    return { ok: false, reason: 'BELOW_MIN', diagnostics: [] };
  }
  if (usdEquivalent.gt(D(LIMIT_MAX_USD))) {
    return { ok: false, reason: 'ABOVE_MAX', diagnostics: [] };
  }

  // 步骤 6：目标金额按目标币精度 ROUND_HALF_UP（D7：中间计算保留高精度，出口才舍入）。
  const targetAmount =
    direction === 'SELL_USD'
      ? roundCcy(sourceAmount.mul(clientRate), targetCurrency)
      : roundCcy(sourceAmount.div(clientRate), targetCurrency);

  // 步骤 7：生成报价快照。金额/汇率一律以普通十进制字符串固化，避免 number 精度问题。
  // quoteId 是一次性标识，使用 UUID 防止不同客户端同毫秒取价发生碰撞（成交防重依赖它）。
  const quote: Quote = {
    quoteId: uuid(),
    pairId,
    direction,
    channelId: selected.price.channelId,
    mid: mid.toString(),
    priceCollectedAt: selected.price.collectedAt,
    halfSpreadBps,
    clientRate: toRateSig12(clientRate).toString(),
    sourceCurrency,
    sourceAmount: sourceAmount.toFixed(ccyDp(sourceCurrency)),
    targetCurrency,
    targetAmount: targetAmount.toFixed(ccyDp(targetCurrency)),
    fee: FEE,
    createdAt: now,
    expiresAt: now + QUOTE_TTL_MS,
  };

  return { ok: true, quote };
}
