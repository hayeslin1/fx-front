import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginOps } from '@/store';
import { SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, '请输入账号')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
});
type LoginValues = z.infer<typeof loginSchema>;

// 运营登录（设计文档 §10.3）：独立入口，客户账号一律不可进入（PRD §2）
export function OpsLoginPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { register, handleSubmit, setValue, setError, formState } = form;

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      const result = await loginOps(values.email, values.password);
      if (!result.ok) {
        toast.error(result.message);
        setError('root', { message: result.message });
        return;
      }
      toast.success(`欢迎，${result.data.opsAccount.name}`);
      navigate('/ops/overview', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>运营登录</CardTitle>
          <CardDescription>仅限运营账号；客户端账号无法进入运营端</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="ops-email">账号</Label>
              <Input id="ops-email" type="email" autoComplete="email" {...register('email')} />
              {formState.errors.email ? (
                <p className="text-xs text-rose-600">{formState.errors.email.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ops-password">密码</Label>
              <Input
                id="ops-password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {formState.errors.password ? (
                <p className="text-xs text-rose-600">{formState.errors.password.message}</p>
              ) : null}
            </div>
            {formState.errors.root ? (
              <p className="text-xs text-rose-600">{formState.errors.root.message}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">演示账号（仅演示数据）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {SEED_OPS_ACCOUNTS.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.email} / {a.password}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setValue('email', a.email, { shouldValidate: true });
                  setValue('password', a.password, { shouldValidate: true });
                }}
              >
                填入
              </Button>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            我是客户，去
            <Link className="mx-1 font-medium text-primary hover:underline" to="/app/login">
              客户入口
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
