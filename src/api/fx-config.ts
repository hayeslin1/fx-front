// 汇率运营配置 API（§8.4 fx-config.ts）：渠道/币对/采集池/路由/加点/计算器。
import type {
  Channel,
  ChannelSaveReq,
  ChannelToggleReq,
  CurrencyPair,
  EmptyReq,
  ExchangeQuoteReq,
  MarkupConfig,
  MarkupSaveReq,
  PairToggleReq,
  PoolCollectReq,
  PoolPrice,
  Quote,
  QuoteEnabledToggleReq,
  RawPrice,
  RoutingRule,
  RoutingSaveReq,
} from './dto';
import { request } from './http';

// ---------- 渠道 ----------
export function channelsQuery(): Promise<Channel[]> {
  return request<EmptyReq, Channel[]>('/api/ops/fx/channels/query', {});
}

/** 新增/编辑渠道：无 id 为新增，有 id 为编辑（不物理删除，仅启停） */
export function channelSave(input: ChannelSaveReq): Promise<Channel> {
  return request<ChannelSaveReq, Channel>('/api/ops/fx/channels/save', input);
}

export function channelToggle(input: ChannelToggleReq): Promise<Channel> {
  return request<ChannelToggleReq, Channel>('/api/ops/fx/channels/toggle', input);
}

// ---------- 币对 ----------
export function pairsQuery(): Promise<CurrencyPair[]> {
  return request<EmptyReq, CurrencyPair[]>('/api/ops/fx/pairs/query', {});
}

/** 币对启停；停用后双向不可报价 */
export function pairToggle(input: PairToggleReq): Promise<CurrencyPair> {
  return request<PairToggleReq, CurrencyPair>('/api/ops/fx/pairs/toggle', input);
}

// ---------- 采集池 ----------
/** 采集池快照，附带服务端计算的有效状态（渠道启用 && 10 分钟内） */
export function poolQuery(): Promise<PoolPrice[]> {
  return request<EmptyReq, PoolPrice[]>('/api/ops/fx/pool/query', {});
}

/** 单行模拟采集（演示机制，对接期去留待定，§8.6） */
export function collect(input: PoolCollectReq): Promise<RawPrice> {
  return request<PoolCollectReq, RawPrice>('/api/ops/fx/pool/collect', input);
}

/** 全部模拟采集 */
export function collectAll(): Promise<RawPrice[]> {
  return request<EmptyReq, RawPrice[]>('/api/ops/fx/pool/collect-all', {});
}

/** 报价启用开关（仅约束客户报价，不影响平仓渠道校验） */
export function quoteEnabledToggle(input: QuoteEnabledToggleReq): Promise<RawPrice> {
  return request<QuoteEnabledToggleReq, RawPrice>('/api/ops/fx/pool/toggle-quote-enabled', input);
}

// ---------- 路由 ----------
export function routingQuery(): Promise<RoutingRule[]> {
  return request<EmptyReq, RoutingRule[]>('/api/ops/fx/routing/query', {});
}

/** 保存渠道优先级（数组顺序即优先级，首位为主渠道） */
export function routingSave(input: RoutingSaveReq): Promise<RoutingRule> {
  return request<RoutingSaveReq, RoutingRule>('/api/ops/fx/routing/save', input);
}

// ---------- 加点 ----------
export function markupsQuery(): Promise<MarkupConfig[]> {
  return request<EmptyReq, MarkupConfig[]>('/api/ops/fx/markups/query', {});
}

/** 保存每侧点差 bps（对称），仅影响新报价 */
export function markupSave(input: MarkupSaveReq): Promise<MarkupConfig> {
  return request<MarkupSaveReq, MarkupConfig>('/api/ops/fx/markups/save', input);
}

// ---------- 报价计算器 ----------
/** 只读试算：复用取价契约，不生成 quoteId 之外的任何副作用 */
export function calculator(input: ExchangeQuoteReq): Promise<Quote> {
  return request<ExchangeQuoteReq, Quote>('/api/ops/fx/calculator', input);
}
