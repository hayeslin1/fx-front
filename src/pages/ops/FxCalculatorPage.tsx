import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import { PAIR_IDS, QUOTE_CCY } from '@/domain/constants';
import { ccyDp } from '@/domain/money';
import type { Currency, PairId, TradeDirection } from '@/domain/types';
import { DIRECTION_LABELS } from '@/features/exchange/labels';
import { useCalculatorQuote, type CalculatorResult } from '@/features/fx-calculator/hooks';
import { formatDateTime } from '@/lib/format';

// 汇率运营-报价计算器（设计文档 §10.3 / PRD §5.5）：输入方向 + 来源金额，
// 按当前运营配置即时试算「原始中间价 → 选中渠道 → 客户成交价 → 舍入后到账」。
// 只读不成交：不写任何账户数据、不产生锁价（不触碰 ui.quote），也不修改任何运营配置；
// store 读取全部经 features/fx-calculator/hooks（§7.2），本页无任何 store.apply。

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function FxCalculatorPage() {
  const [pairId, setPairId] = useState<PairId>('USD/EUR');
  const [direction, setDirection] = useState<TradeDirection>('SELL_USD');
  const [amount, setAmount] = useState('');

  const result = useCalculatorQuote(pairId, direction, amount);

  // 来源/目标币种由方向推导（USD 为枢纽）：卖出 USD → 来源 USD、目标报价币；买入 USD 反之
  const quoteCcy = QUOTE_CCY[pairId];
  const sourceCurrency: Currency = direction === 'SELL_USD' ? 'USD' : quoteCcy;
  const targetCurrency: Currency = direction === 'SELL_USD' ? quoteCcy : 'USD';

  return (
    <div className="space-y-6">
      <PageHeader
        title="报价计算器"
        description="按当前渠道/币对/采集价/路由/加点配置试算客户报价；结果随配置实时变化"
      />

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        仅查询、不成交：本页不写任何账户数据（不产生订单/钱包/流水变更），不产生锁价（不占用 30
        秒报价），也不修改任何运营配置。
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>试算条件</CardTitle>
            <CardDescription>输入即算，无需提交</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="calc-pair">币对</Label>
                <select
                  id="calc-pair"
                  className={SELECT_CLASS}
                  value={pairId}
                  onChange={(event) => setPairId(event.target.value as PairId)}
                >
                  {PAIR_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="calc-direction">方向</Label>
                <select
                  id="calc-direction"
                  className={SELECT_CLASS}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as TradeDirection)}
                >
                  <option value="SELL_USD">{DIRECTION_LABELS.SELL_USD}</option>
                  <option value="BUY_USD">{DIRECTION_LABELS.BUY_USD}</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="calc-amount">来源金额（{sourceCurrency}）</Label>
              <Input
                id="calc-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder={ccyDp(sourceCurrency) === 0 ? '例如 150000' : '例如 1000.00'}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {DIRECTION_LABELS[direction]} · 来源 {sourceCurrency} → 目标 {targetCurrency} ·
                单笔限额等值 1 – 10,000 USD（按原始中间价折算，边界含）
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>试算结果</CardTitle>
            <CardDescription>
              客户价含每侧点差（卖出 USD 取 bid / 买入 USD 取 ask）；服务费固定 0
            </CardDescription>
          </CardHeader>
          <CardContent>
            {amount === '' || result === null ? (
              <p className="text-sm text-muted-foreground">请输入来源金额，将按当前配置即时试算。</p>
            ) : (
              <ResultPanel result={result} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** 结果面板：成功展示报价快照全字段；失败展示中文原因（NO_QUOTE 附逐渠道诊断，PRD §4.1） */
function ResultPanel({ result }: { result: CalculatorResult }) {
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-rose-600">{result.reasonLabel}</p>
        {result.diagnostics.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              逐渠道诊断（为什么该渠道不可用于本次报价）
            </p>
            <ul className="space-y-1">
              {result.diagnostics.map((diag) => (
                <li
                  key={diag.channelId}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm"
                >
                  <span>{diag.channelName}</span>
                  <span className="text-muted-foreground">{diag.reasonLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const { quote } = result;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">原始中间价</dt>
        <dd className="text-right">
          <Rate value={quote.mid} />
        </dd>
        <dt className="text-muted-foreground">选中渠道</dt>
        <dd className="text-right">
          {result.channelName}
          <span className="text-muted-foreground">
            （采集时间 {formatDateTime(quote.priceCollectedAt)}）
          </span>
        </dd>
        <dt className="text-muted-foreground">
          客户成交价（{quote.direction === 'SELL_USD' ? 'bid，卖出 USD' : 'ask，买入 USD'}）
        </dt>
        <dd className="text-right font-semibold">
          <Rate value={quote.clientRate} />
        </dd>
        <dt className="text-muted-foreground">来源金额</dt>
        <dd className="text-right">
          <Money value={quote.sourceAmount} currency={quote.sourceCurrency} />
        </dd>
        <dt className="text-muted-foreground">服务费（固定 0）</dt>
        <dd className="text-right">
          <Money value={quote.fee} currency={quote.sourceCurrency} />
        </dd>
        <dt className="text-muted-foreground">舍入后到账</dt>
        <dd className="text-right text-base font-semibold">
          <Money value={quote.targetAmount} currency={quote.targetCurrency} />
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        每侧点差 {quote.halfSpreadBps} bps；到账 = 来源金额 × 客户成交价（卖出 USD）/ ÷ 客户成交价（买入
        USD），按目标币 {quote.targetCurrency} 精度四舍五入。
      </p>
    </div>
  );
}
