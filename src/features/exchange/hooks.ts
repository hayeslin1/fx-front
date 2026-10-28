import { useMemo } from 'react';
import { LIMIT_MAX_USD, LIMIT_MIN_USD } from '@/domain/constants';
import { D, ccyDp } from '@/domain/money';
import { directionFor, pairIdFor } from '@/domain/pairs';
import { getQuote, type ChannelDiag, type NoQuoteReason } from '@/domain/pricing';
import { exchangeCommands, type ExchangeSubmitData } from '@/domain/services/exchange.service';
import type {
  Channel,
  Currency,
  Customer,
  DecimalStr,
  DomainResult,
  Quote,
  Wallet,
} from '@/domain/types';
import { now } from '@/lib/clock';
import { clearQuote, setQuote, useAppStore } from '@/store';
import { getCustomerById, getCustomerWallets, getLatestRawMid } from '@/store/selectors';
import { channelNameOf } from './labels';

// 兑换 feature 薄 hooks（设计文档 §7.2）：store 读写全部收敛在此，页面不直接触达 store。
// 对接期只需把本文件内部实现替换为 src/api 调用，页面无需改动。

export interface ExchangeContext {
  customer: Customer | undefined;
  /** 当前客户六币种钱包（缺项不补），用于展示来源币可用余额 */
  wallets: Wallet[];
  /** 当前内存态报价（刷新即失效，PRD §4.1） */
  quote: Quote | null;
  channels: Channel[];
  channelName: (channelId: string) => string;
}

/** 兑换页所需的客户/钱包/报价读取视图 */
export function useExchange(): ExchangeContext {
  const data = useAppStore((state) => state.data);
  const customerId = useAppStore((state) => state.session.client?.customerId ?? null);
  const quote = useAppStore((state) => state.ui.quote);

  const customer = customerId !== null ? getCustomerById(data, customerId) : undefined;
  const wallets = useMemo(
    () => (customerId !== null ? getCustomerWallets(data, customerId) : []),
    [data, customerId],
  );
  const channels = data.fxConfig.channels;
  const channelName = (channelId: string) => channelNameOf(channels, channelId);

  return { customer, wallets, quote, channels, channelName };
}

export interface ExchangeLimitHint {
  /** 参考中间价（1 USD = R 来源币）；来源为 USD 时恒为 "1" */
  mid: DecimalStr;
  /** 按参考中间价折算的来源币最小金额（等值 1 USD） */
  minSource: DecimalStr;
  /** 按参考中间价折算的来源币最大金额（等值 10,000 USD） */
  maxSource: DecimalStr;
}

/**
 * 限额提示（PRD §4.3）：1–10,000 USD 按来源币对应原始中间价折算、不计点差。
 * WHY 用“最新原始中间价”只做提示：报价校验以 pricing.getQuote 为准，提示不参与成交判定。
 * 无参考价（外币缺价）返回 null，页面改为不展示折算区间。
 */
export function useExchangeLimitHint(sourceCurrency: Currency): ExchangeLimitHint | null {
  const data = useAppStore((state) => state.data);

  return useMemo(() => {
    if (sourceCurrency === 'USD') {
      return { mid: '1', minSource: LIMIT_MIN_USD, maxSource: LIMIT_MAX_USD };
    }
    const pairId = pairIdFor('USD', sourceCurrency);
    if (pairId === null) return null;
    const mid = getLatestRawMid(data, pairId);
    if (mid === undefined) return null;
    const dp = ccyDp(sourceCurrency);
    return {
      mid,
      minSource: D(LIMIT_MIN_USD).times(mid).toFixed(dp),
      maxSource: D(LIMIT_MAX_USD).times(mid).toFixed(dp),
    };
  }, [data, sourceCurrency]);
}

export interface QuoteRequestInput {
  sourceCurrency: Currency;
  targetCurrency: Currency;
  sourceAmount: string;
}

/** 与 domain/pricing.getQuote 返回结构一致的对外结果（失败携带逐渠道诊断） */
export type RequestQuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: NoQuoteReason; diagnostics: ChannelDiag[] };

/**
 * 取价（PRD §3.3）：读取当前运营配置调用报价引擎；成功即写入内存态报价供页面展示。
 * 失败不产生任何写入（store apply 语义之外，这里连 ui.quote 也不覆盖旧值）。
 */
export function requestQuote(input: QuoteRequestInput): RequestQuoteResult {
  const { data } = useAppStore.getState();
  const pairId = pairIdFor(input.sourceCurrency, input.targetCurrency);
  if (pairId === null) {
    // 页面方向选择已约束为 USD 枢纽 10 向，此处仅防御非法调用
    return { ok: false, reason: 'INVALID_AMOUNT', diagnostics: [] };
  }
  const result = getQuote(
    data.fxConfig,
    {
      pairId,
      direction: directionFor(input.sourceCurrency),
      sourceAmount: input.sourceAmount,
    },
    now(),
  );
  if (result.ok) setQuote(result.quote);
  return result;
}

/**
 * 确认成交（PRD §3.3）：经 store.apply 走领域服务原子写入。
 * 成功后立即清空当前报价（§6.3），失败（含余额不足）零变更且报价保留。
 * 重复提交由领域服务按 quoteId 拒绝（§6.3 步骤 5）。
 */
export async function submitCurrentQuote(): Promise<DomainResult<ExchangeSubmitData> | null> {
  const state = useAppStore.getState();
  const customerId = state.session.client?.customerId;
  const quote = state.ui.quote;
  if (customerId === undefined || quote === null) return null;

  const result = await state.apply(exchangeCommands.submit(customerId, quote));
  if (result.ok) clearQuote();
  return result;
}

/** 丢弃当前报价（客户修改金额/币种后旧报价不再适用；不产生任何事实变更） */
export function discardQuote(): void {
  clearQuote();
}
