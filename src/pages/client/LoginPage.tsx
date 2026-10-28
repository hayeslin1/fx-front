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
import { loginClient } from '@/store';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';

// 校验：zod 显式正则（避免各版本对 string().email() 的废弃差异）
const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, '请输入邮箱')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
});
type LoginValues = z.infer<typeof loginSchema>;

// 客户登录（设计文档 §10.2）：演示凭证提示 + 一键填入；登录成功进首页
export function LoginPage() {
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
      const result = await loginClient(values.email, values.password);
      if (!result.ok) {
        toast.error(result.message);
        setError('root', { message: result.message });
        return;
      }
      toast.success(`欢迎回来，${result.data.customer.name}`);
      navigate('/app/home', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (email: string, password: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', password, { shouldValidate: true });
  };

  return (
    <div className="space-y-4">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>使用演示账号，或注册新账号体验完整流程</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...register('email')}
              />
              {formState.errors.email ? (
                <p className="text-xs text-danger">{formState.errors.email.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {formState.errors.password ? (
                <p className="text-xs text-danger">{formState.errors.password.message}</p>
              ) : null}
            </div>
            {formState.errors.root ? (
              <p className="text-xs text-danger">{formState.errors.root.message}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            还没有账号？
            <Link className="font-medium text-primary hover:underline" to="/app/register">
              立即注册
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-sm">演示账号（仅演示数据）</CardTitle>
          <CardDescription>点击「填入」自动填写登录表单</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {SEED_CUSTOMERS.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.email} / {c.password}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fillDemo(c.email, c.password)}
              >
                填入
              </Button>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            运营人员请走
            <Link className="mx-1 font-medium text-primary hover:underline" to="/ops/login">
              运营入口
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
