import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DemoNotice } from '@/components/common/DemoNotice';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { ALL_CURRENCIES } from '@/domain/constants';
import { ccyDp, fmtMoney } from '@/domain/money';
import type { Currency } from '@/domain/types';
import { CURRENCY_LABELS } from '@/features/wallet/labels';
import { useSelfTopUp, useWalletBalance, validateTopUpAmount } from '@/features/wallet/hooks';

// 表单校验复用 hooks.validateTopUpAmount（内部即 domain/money.isValidAmountInput），
// 避免页面与领域服务出现两套金额口径
const topUpSchema = z
  .object({
    currency: z.enum(['USD', 'GBP', 'EUR', 'JPY', 'CNH', 'HKD']),
    amount: z.string(),
  })
  .superRefine((values, ctx) => {
    const message = validateTopUpAmount(values.amount, values.currency);
    if (message !== null) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message });
    }
  });
type TopUpValues = z.infer<typeof topUpSchema>;

interface Receipt {
  currency: Currency;
  amount: string;
  balanceAfter: string;
}

// 自助充值（设计文档 §10.2 / PRD §3.2）：即时入账 + 流水 + toast，pending 期间禁用防重复
export function TopUpPage() {
  const { pending, submit } = useSelfTopUp();
  const form = useForm<TopUpValues>({
    resolver: zodResolver(topUpSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { currency: 'USD', amount: '' },
  });
  const { register, handleSubmit, watch, resetField, trigger, clearErrors, setError, formState } =
    form;
  const currency = watch('currency');
  const balance = useWalletBalance(currency);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const onSubmit = async (values: TopUpValues) => {
    clearErrors('root');
    const amount = values.amount.trim();
    const result = await submit(values.currency, amount);
    if (!result.ok) {
      // 领域服务失败不写状态：仅提示，余额与流水零变更
      toast.error(result.message);
      setError('root', { message: result.message });
      return;
    }
    toast.success(`充值成功，${fmtMoney(result.data.bill.amount, values.currency)} 已入账`);
    setReceipt({
      currency: values.currency,
      amount: result.data.bill.amount,
      balanceAfter: result.data.wallet.balance,
    });
    resetField('amount');
  };

  const dp = ccyDp(currency);

  return (
    <div className="space-y-6">
      <PageHeader
        title="充值"
        description="模拟充值即时入账并生成流水，不收取手续费"
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/wallet">查看钱包</Link>
          </Button>
        }
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">自助充值</CardTitle>
          <CardDescription>选择币种并输入金额，确认后余额立即增加</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">当前余额</span>
            <span className="flex items-center gap-2">
              {balance === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Money value={balance} currency={currency} className="font-medium" />
              )}
              <DemoNotice />
            </span>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="currency">币种</Label>
              <select
                id="currency"
                disabled={pending}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                {...register('currency', {
                  onChange: () => {
                    setReceipt(null);
                    if (form.getValues('amount').trim()) void trigger('amount');
                  },
                })}
              >
                {ALL_CURRENCIES.map((option) => (
                  <option key={option} value={option}>
                    {CURRENCY_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">充值金额</Label>
              <Input
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                disabled={pending}
                placeholder={dp === 0 ? '整数金额，如 150000' : '最多 2 位小数，如 100.00'}
                aria-invalid={formState.errors.amount ? true : undefined}
                {...register('amount', { onChange: () => setReceipt(null) })}
              />
              {formState.errors.amount ? (
                <p className="text-xs text-rose-600">{formState.errors.amount.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {dp === 0 ? '该币种金额须为整数' : `最多保留 ${dp} 位小数`}
                  ；充值即时入账，不形成兑换订单。
                </p>
              )}
            </div>

            {formState.errors.root ? (
              <p className="text-xs text-rose-600">{formState.errors.root.message}</p>
            ) : null}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? '充值中…' : '确认充值'}
            </Button>
          </form>

          {receipt ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-sm text-emerald-800">
              <p className="font-medium">充值成功</p>
              <p>
                本次到账 <Money value={receipt.amount} currency={receipt.currency} />
                ，当前余额 <Money value={receipt.balanceAfter} currency={receipt.currency} />
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/app/wallet">查看钱包流水</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
