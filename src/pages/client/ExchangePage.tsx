import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Repeat2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Countdown } from '@/components/common/Countdown';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { ALL_CURRENCIES } from '@/domain/constants';
import { ccyDp, isValidAmountInput } from '@/domain/money';
import { directionFor, pairIdFor } from '@/domain/pairs';
import type { Currency } from '@/domain/types';
import {
  CHANNEL_DIAG_REASON_LABELS,
  DIRECTION_LABELS,
  NO_QUOTE_REASON_LABELS,
} from '@/features/exchange/labels';
import {
  discardQuote,
  requestQuote,
  submitCurrentQuote,
  useExchange,
  useExchangeLimitHint,
  type RequestQuoteResult,
} from '@/features/exchange/hooks';
import { formatDateTime } from '@/lib/format';
import { now } from '@/lib/clock';

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const FOREIGN_CURRENCIES = ALL_CURRENCIES.filter((currency) => currency !== 'USD');
type QuoteFailure = Extract<RequestQuoteResult, { ok: false }>;

// 兑换页（设计文档 §10.2）：10 向报价 → 30 秒锁价 → 原子成交 → 跳订单详情。
// 客户侧仅展示自身成交价/中间价/到账，不展示平台损益（PRD §3.4）。
export function ExchangePage() {
  const navigate = useNavigate();
  const { customer, wallets, quote, channelName } = useExchange();

  const [sourceCurrency, setSourceCurrency] = useState<Currency>('USD');
  const [targetCurrency, setTargetCurrency] = useState<Currency>('EUR');
  const [amount, setAmount] = useState('');
  const [failure, setFailure] = useState<QuoteFailure | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const limitHint = useExchangeLimitHint(sourceCurrency);
  const targetOptions: Currency[] = sourceCurrency === 'USD' ? FOREIGN_CURRENCIES : ['USD'];

  const pairId = pairIdFor(sourceCurrency, targetCurrency);
  const direction = directionFor(sourceCurrency);
  const sourceWallet = wallets.find((wallet) => wallet.currency === sourceCurrency);

  const amountError =
    amount === ''
      ? null
      : !isValidAmountInput(amount, sourceCurrency)
        ? `请输入大于 0 的金额，${sourceCurrency} 最多 ${ccyDp(sourceCurrency)} 位小数`
        : null;

  // 修改方向/金额后旧报价不再对应当前输入：清空报价与失败态，避免误成交
  const resetQuoteState = () => {
    if (quote !== null) discardQuote();
    setFailure(null);
    setExpired(false);
  };

  const handleSourceChange = (next: Currency) => {
    setSourceCurrency(next);
    setTargetCurrency(next === 'USD' ? (targetCurrency === 'USD' ? 'EUR' : targetCurrency) : 'USD');
    resetQuoteState();
  };

  const handleTargetChange = (next: Currency) => {
    setTargetCurrency(next);
    resetQuoteState();
  };

  const handleAmountChange = (next: string) => {
    setAmount(next);
    resetQuoteState();
  };

  const handleRequestQuote = () => {
    if (amount === '' || amountError !== null) return;
    // 先丢弃旧报价：失败时页面只展示原因，不残留不可成交的旧快照
    if (quote !== null) discardQuote();
    setExpired(false);
    const result = requestQuote({ sourceCurrency, targetCurrency, sourceAmount: amount });
    if (result.ok) {
      setFailure(null);
      return;
    }
    setFailure(result);
  };

  const handleConfirm = async () => {
    if (quote === null) return;
    setSubmitting(true);
    try {
      const result = await submitCurrentQuote();
      if (result === null) return;
      if (!result.ok) {
        // 余额不足/过期/重复报价：领域服务保证零变更，仅提示（PRD §9-6）
        toast.error(result.message);
        return;
      }
      toast.success(`兑换成功，订单号 ${result.data.order.id}`);
      navigate(`/app/orders/${result.data.order.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const isExpired = quote !== null && (expired || now() >= quote.expiresAt);
  const canRequestQuote = customer !== undefined && amount !== '' && amountError === null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="兑换"
        description="USD 与五种外币双向兑换 · 报价锁价 30 秒，过期须重新取价"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>兑换方向与金额</CardTitle>
            <CardDescription>当前共 10 个有向兑换方向，不开放外币间交叉兑换</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="source-currency">来源币</Label>
                <select
                  id="source-currency"
                  className={SELECT_CLASS}
                  value={sourceCurrency}
                  onChange={(event) => handleSourceChange(event.target.value as Currency)}
                >
                  {ALL_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target-currency">目标币</Label>
                <select
                  id="target-currency"
                  className={SELECT_CLASS}
                  value={targetCurrency}
                  disabled={sourceCurrency !== 'USD'}
                  onChange={(event) => handleTargetChange(event.target.value as Currency)}
                >
                  {targetOptions.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
                {sourceCurrency !== 'USD' ? (
                  <p className="text-xs text-muted-foreground">外币→仅支持兑换为 USD，不支持外币间交叉兑换</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{pairId ?? '—'}</Badge>
              <span className="text-muted-foreground">
                {DIRECTION_LABELS[direction]} · 来源 {sourceCurrency} → 目标 {targetCurrency}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="source-amount">来源金额（{sourceCurrency}）</Label>
              <Input
                id="source-amount"
                inputMode="decimal"
                placeholder={ccyDp(sourceCurrency) === 0 ? '例如 150000' : '例如 1000.00'}
                value={amount}
                onChange={(event) => handleAmountChange(event.target.value)}
                aria-invalid={amountError !== null}
              />
              {amountError !== null ? <p className="text-xs text-danger">{amountError}</p> : null}
              <p className="text-xs text-muted-foreground">
                可用余额：
                {sourceWallet !== undefined ? (
                  <Money value={sourceWallet.balance} currency={sourceCurrency} />
                ) : (
                  '—'
                )}
              </p>
            </div>

            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">单笔限额：等值 1 – 10,000 USD</p>
              {limitHint !== null ? (
                sourceCurrency === 'USD' ? (
                  <p>USD 金额即为等值金额；以报价校验为准。</p>
                ) : (
                  <p>
                    按最新原始中间价折算约{' '}
                    <Money value={limitHint.minSource} currency={sourceCurrency} /> –{' '}
                    <Money value={limitHint.maxSource} currency={sourceCurrency} />
                    （等值 1–10,000 USD，以报价校验为准）。
                  </p>
                )
              ) : (
                <p>该币种暂缺参考价，限额以报价校验为准。</p>
              )}
            </div>

            <Button className="w-full" onClick={handleRequestQuote} disabled={!canRequestQuote}>
              {quote !== null ? '重新取价' : '获取报价'}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {quote !== null ? (
            <Card>
              <CardHeader>
                <CardTitle>报价详情</CardTitle>
                <CardDescription>
                  报价快照在 30 秒内有效，成交时不再重新取价（PRD §4.1）
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">原始中间价</dt>
                  <dd className="text-right">
                    <Rate value={quote.mid} />
                  </dd>
                  <dt className="text-muted-foreground">客户成交价</dt>
                  <dd className="text-right font-semibold">
                    <Rate value={quote.clientRate} />
                  </dd>
                  <dt className="text-muted-foreground">服务费</dt>
                  <dd className="text-right">
                    <Money value={quote.fee} currency={quote.sourceCurrency} />
                  </dd>
                  <dt className="text-muted-foreground">来源金额</dt>
                  <dd className="text-right">
                    <Money value={quote.sourceAmount} currency={quote.sourceCurrency} />
                  </dd>
                  <dt className="text-muted-foreground">预计到账</dt>
                  <dd className="text-right text-base font-semibold">
                    <Money value={quote.targetAmount} currency={quote.targetCurrency} />
                  </dd>
                  <dt className="text-muted-foreground">报价渠道</dt>
                  <dd className="text-right">{channelName(quote.channelId)}</dd>
                  <dt className="text-muted-foreground">原始价采集时间</dt>
                  <dd className="text-right">{formatDateTime(quote.priceCollectedAt)}</dd>
                </dl>

                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2">
                  <Countdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />
                  {isExpired ? (
                    <Button variant="outline" size="sm" onClick={handleRequestQuote}>
                      重新取价
                    </Button>
                  ) : null}
                </div>

                <Button
                  className="w-full"
                  onClick={handleConfirm}
                  disabled={isExpired || submitting}
                >
                  {submitting ? '提交中…' : '确认成交'}
                </Button>
              </CardContent>
            </Card>
          ) : failure !== null ? (
            <Card className="border-danger">
              <CardHeader>
                <CardTitle className="text-danger">无法获取报价</CardTitle>
                <CardDescription>{NO_QUOTE_REASON_LABELS[failure.reason]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {failure.diagnostics.length > 0 ? (
                  <>
                    <p className="font-medium">逐渠道诊断</p>
                    <ul className="space-y-1 text-muted-foreground">
                      {failure.diagnostics.map((diagnostic) => (
                        <li key={`${diagnostic.channelId}-${diagnostic.reason}`}>
                          {channelName(diagnostic.channelId)}：
                          {CHANNEL_DIAG_REASON_LABELS[diagnostic.reason]}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    请检查金额与币种精度后重试，或联系运营确认币对状态。
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<Repeat2 className="size-8" />}
              title="输入金额后获取报价"
              description="报价将展示原始中间价、客户成交价、服务费、预计到账、渠道与 30 秒倒计时。"
            />
          )}
        </div>
      </div>
    </div>
  );
}
