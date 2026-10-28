import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DemoNotice } from '@/components/common/DemoNotice';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { ALL_CURRENCIES } from '@/domain/constants';
import { ccyDp, fmtMoney } from '@/domain/money';
import type { Currency } from '@/domain/types';
import { CURRENCY_LABELS } from '@/features/wallet/labels';
import {
  filterCustomersByKeyword,
  useOpsCustomerBalance,
  useOpsTopUp,
  useOpsWalletContext,
  validateOpsTopUpAmount,
} from '@/features/ops-wallet/hooks';

// 运营代客充值（设计文档 §10.3 钱包管理段、PRD §5.4）：
// 选客户/币种 → 金额（正数 + 币种精度，JPY 整数）→ 必填备注 → ConfirmDialog 二次确认 →
// walletCommands.opsTopUp 经 store.apply 原子入账（operatorId 取当前运营会话）。
// 失败（校验/领域服务）一律只提示、零变更；pending 期间禁用提交防重复。

// 校验口径复用 hooks.validateOpsTopUpAmount（内部即 domain/money.isValidAmountInput），
// 与领域服务 wallet.service 完全一致，避免页面出现第二套金额规则
const opsTopUpSchema = z
  .object({
    customerId: z.string().min(1, '请选择客户'),
    currency: z.enum(['USD', 'GBP', 'EUR', 'JPY', 'CNH', 'HKD']),
    amount: z.string(),
    remark: z.string(),
  })
  .superRefine((values, ctx) => {
    const amountMessage = validateOpsTopUpAmount(values.amount, values.currency);
    if (amountMessage !== null) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: amountMessage });
    }
    if (!values.remark.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['remark'],
        message: '代客充值备注必填，将随流水写入作为审计字段',
      });
    }
  });
type OpsTopUpValues = z.infer<typeof opsTopUpSchema>;

interface Receipt {
  customerName: string;
  currency: Currency;
  amount: string;
  balanceAfter: string;
}

const controlClassName =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function AssistedTopUpPage() {
  const { customers } = useOpsWalletContext();
  const { pending, submit } = useOpsTopUp();
  const form = useForm<OpsTopUpValues>({
    resolver: zodResolver(opsTopUpSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { customerId: '', currency: 'USD', amount: '', remark: '' },
  });
  const { register, handleSubmit, watch, resetField, clearErrors, setError, formState } = form;
  const [keyword, setKeyword] = useState('');
  const [confirmValues, setConfirmValues] = useState<OpsTopUpValues | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // WHY ref 守卫：ConfirmDialog 无 disabled 属性，弹窗内重复点击需同步拦截（hook 内另有 pending 守卫兜底）
  const submittingRef = useRef(false);

  const selectedCustomerId = watch('customerId');
  const currency = watch('currency');
  const balance = useOpsCustomerBalance(
    selectedCustomerId === '' ? null : selectedCustomerId,
    currency,
  );
  // 确认弹窗的客户展示取自被确认的那份快照，避免表单后续改动与弹窗描述不一致
  const confirmCustomer =
    confirmValues === null
      ? undefined
      : customers.find((customer) => customer.id === confirmValues.customerId);

  // 关键词过滤下拉候选项；已选中客户始终保留，避免搜索时选中值从列表中消失
  const visibleCustomers = useMemo(() => {
    const matched = filterCustomersByKeyword(customers, keyword);
    const selected = customers.find((customer) => customer.id === selectedCustomerId);
    if (selected !== undefined && !matched.some((customer) => customer.id === selected.id)) {
      return [selected, ...matched];
    }
    return matched;
  }, [customers, keyword, selectedCustomerId]);

  const dp = ccyDp(currency);

  /** 表单通过校验：改为打开二次确认弹窗，尚未产生任何写入 */
  const onSubmit = (values: OpsTopUpValues) => {
    clearErrors('root');
    setReceipt(null);
    setConfirmValues(values);
  };

  /** 弹窗确认：真正提交领域服务；失败零变更，仅 toast + 表单根错误 */
  const handleConfirm = async () => {
    if (confirmValues === null || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const result = await submit({
        customerId: confirmValues.customerId,
        currency: confirmValues.currency,
        amount: confirmValues.amount.trim(),
        remark: confirmValues.remark,
      });
      if (!result.ok) {
        toast.error(result.message);
        setError('root', { message: result.message });
        return;
      }
      const bill = result.data.bill;
      const wallet = result.data.wallet;
      toast.success(`代客充值成功，${fmtMoney(bill.amount, bill.currency)} 已入账`);
      setReceipt({
        customerName:
          customers.find((customer) => customer.id === bill.customerId)?.name ?? bill.customerId,
        currency: bill.currency,
        amount: bill.amount,
        balanceAfter: wallet.balance,
      });
      resetField('amount');
      resetField('remark');
    } finally {
      submittingRef.current = false;
      setConfirmValues(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="代客充值"
        description="运营代客入账：选择客户与币种、输入正数金额并填写必填备注，二次确认后即时入账并写入客户流水；除代客充值外无任何手工调账入口"
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">代客充值表单</CardTitle>
          <CardDescription>
            记录运营账号、时间、币种、金额与备注；提交前需二次确认，失败不产生任何余额或流水变更。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="customer-keyword">客户搜索</Label>
              <Input
                id="customer-keyword"
                value={keyword}
                autoComplete="off"
                disabled={pending}
                placeholder="输入姓名或邮箱关键词过滤下方客户下拉"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerId">客户</Label>
              <select
                id="customerId"
                disabled={pending}
                className={controlClassName}
                {...register('customerId')}
              >
                <option value="">请选择客户</option>
                {visibleCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}（{customer.email}）
                  </option>
                ))}
              </select>
              {formState.errors.customerId ? (
                <p className="text-xs text-rose-600">{formState.errors.customerId.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">币种</Label>
              <select
                id="currency"
                disabled={pending}
                className={controlClassName}
                {...register('currency', {
                  onChange: () => {
                    setReceipt(null);
                    if (form.getValues('amount').trim()) void form.trigger('amount');
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

            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">客户当前余额</span>
              <span className="flex items-center gap-2">
                {balance === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Money value={balance} currency={currency} className="font-medium" />
                )}
                <DemoNotice />
              </span>
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
                  {dp === 0 ? '该币种金额须为整数' : `最多保留 ${dp} 位小数`}；即时入账，不形成兑换订单。
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="remark">备注（必填）</Label>
              <Input
                id="remark"
                autoComplete="off"
                disabled={pending}
                placeholder="如：客诉补偿入账（写入客户流水作为审计字段）"
                aria-invalid={formState.errors.remark ? true : undefined}
                {...register('remark', { onChange: () => setReceipt(null) })}
              />
              {formState.errors.remark ? (
                <p className="text-xs text-rose-600">{formState.errors.remark.message}</p>
              ) : null}
            </div>

            {formState.errors.root ? (
              <p className="text-xs text-rose-600">{formState.errors.root.message}</p>
            ) : null}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? '入账中…' : '提交代客充值'}
            </Button>
          </form>

          {receipt ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-sm text-emerald-800">
              <p className="font-medium">代客充值成功</p>
              <p>
                {receipt.customerName} 本次到账{' '}
                <Money value={receipt.amount} currency={receipt.currency} />
                ，客户新余额{' '}
                <Money value={receipt.balanceAfter} currency={receipt.currency} />
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/ops/wallets/bills">查看账单流水</Link>
              </Button>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            除代客充值外无手工调账入口：本演示不提供提现、扣款或其他余额调整操作。
          </p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmValues !== null}
        onOpenChange={(open) => {
          if (open) return;
          if (submittingRef.current) return; // 入账中不允许关闭弹窗
          setConfirmValues(null);
        }}
        title="确认代客充值？"
        description={
          confirmValues === null ? null : (
            <span>
              客户 {confirmCustomer?.name ?? confirmValues.customerId}（
              {confirmCustomer?.email ?? '—'}）；入账金额{' '}
              <Money value={confirmValues.amount.trim()} currency={confirmValues.currency} />；
              备注：{confirmValues.remark.trim()}。确认后立即入账并写入客户流水，不可撤销。
            </span>
          )
        }
        confirmText={pending ? '入账中…' : '确认入账'}
        onConfirm={() => {
          void handleConfirm();
        }}
      />
    </div>
  );
}
