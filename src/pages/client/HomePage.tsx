import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Repeat2, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import type { Currency } from '@/domain/types';
import { DIRECTION_LABELS } from '@/features/exchange/labels';
import { BILL_TYPE_LABELS, CURRENCY_ACCOUNT_LABELS } from '@/features/wallet/labels';
import { formatDateTime } from '@/lib/format';
import { useAppStore } from '@/store';
import { getCustomerById, getCustomerUsdValuation, getCustomerWallets } from '@/store/selectors';

interface ActivityRow {
  key: string;
  at: number;
  title: string;
  amount: string;
  currency: Currency;
  to?: string;
}

// 首页（设计文档 §10.2）：六币种余额卡 + USD 参考估值 + 快捷入口 + 近期活动
export function HomePage() {
  const session = useAppStore((s) => s.session);
  const data = useAppStore((s) => s.data);
  const customer = session.client ? getCustomerById(data, session.client.customerId) : undefined;
  const customerId = customer?.id;
  const wallets = useMemo(
    () => (customerId ? getCustomerWallets(data, customerId) : []),
    [data, customerId],
  );

  // USD 参考估值：统一复用选择器（单一实现，D6；外币 ÷ 最新原始中间价，无价币种跳过并提示）
  const valuation = useMemo(
    () => getCustomerUsdValuation(data, customerId ?? ''),
    [data, customerId],
  );

  const activities = useMemo<ActivityRow[]>(() => {
    if (!customerId) return [];
    const billRows: ActivityRow[] = data.bills
      .filter((b) => b.customerId === customerId)
      .map((b) => ({
        key: b.id,
        at: b.createdAt,
        title: BILL_TYPE_LABELS[b.type],
        amount: b.amount,
        currency: b.currency,
      }));
    const orderRows: ActivityRow[] = data.orders
      .filter((o) => o.customerId === customerId)
      .map((o) => ({
        key: o.id,
        at: o.createdAt,
        title: `${DIRECTION_LABELS[o.direction]} · ${o.pairId}`,
        amount: o.targetAmount,
        currency: o.targetCurrency,
        to: `/app/orders/${o.id}`,
      }));
    return [...billRows, ...orderRows].sort((a, b) => b.at - a.at).slice(0, 5);
  }, [customerId, data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`你好，${customer?.name ?? '客户'}`}
        description="欢迎使用跨境汇兑演示平台"
      />

      <Card className="bg-gradient-to-br from-accent to-card">
        <CardContent className="space-y-1 p-6">
          <p className="text-sm text-muted-foreground">资产参考估值（按最新中间价折算）</p>
          <p className="text-3xl font-semibold tracking-tight">
            {/* 估值统一折算为 USD：前置货币符号 $（设计文档 §10.2）。
                符号对读屏隐藏，避免与 Money 输出的币种代码重复播报。 */}
            <span aria-hidden="true">$</span>
            <Money value={valuation.totalUsd} currency="USD" />
          </p>
          {valuation.missing.length > 0 ? (
            <p className="text-xs text-warning">
              有 {valuation.missing.length} 种币种暂缺参考价，未计入估值
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {wallets.map((wallet) => (
          <Card key={wallet.currency}>
            <CardContent className="flex items-center justify-between gap-2 p-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {CURRENCY_ACCOUNT_LABELS[wallet.currency]}
                </p>
                <Money
                  value={wallet.balance}
                  currency={wallet.currency}
                  className="text-lg font-semibold"
                />
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                演示资金
              </Badge>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/app/exchange">
            <Repeat2 className="size-4" />
            立即兑换
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/app/top-up">
            <Wallet className="size-4" />
            充值
          </Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/app/wallet">
            查看钱包
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">近期活动</CardTitle>
          <CardDescription>最近 5 条流水与订单</CardDescription>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <EmptyState title="暂无活动" description="完成一笔兑换或充值后，这里会显示最近动态。" />
          ) : (
            <ul className="divide-y">
              {activities.map((activity) => (
                <li
                  key={activity.key}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{activity.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(activity.at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money value={activity.amount} currency={activity.currency} />
                    {activity.to ? (
                      <Link to={activity.to} className="text-xs text-primary hover:underline">
                        详情
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
