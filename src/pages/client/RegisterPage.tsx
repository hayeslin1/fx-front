import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRegisterCustomer } from '@/features/wallet/hooks';
import { SEED_CUSTOMERS } from '@/mocks/seed-script';

// 校验口径与 domain/services/auth.service 保持一致：邮箱去空格、密码 ≥8 位含字母数字
const registerSchema = z.object({
  name: z.string().trim().min(1, '请输入姓名'),
  email: z
    .string()
    .trim()
    .min(1, '请输入邮箱')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '邮箱格式不正确'),
  password: z
    .string()
    .min(8, '密码至少 8 位')
    .regex(/[a-zA-Z]/, '密码需包含字母')
    .regex(/\d/, '密码需包含数字'),
});
type RegisterValues = z.infer<typeof registerSchema>;

// 客户注册（设计文档 §10.2）：姓名/邮箱/密码，成功即自动登录并进入首页
export function RegisterPage() {
  const navigate = useNavigate();
  const { pending, submit } = useRegisterCustomer();
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const { register, handleSubmit, setError, formState } = form;

  const onSubmit = async (values: RegisterValues) => {
    const result = await submit(values);
    if (!result.ok) {
      toast.error(result.message);
      setError('root', { message: result.message });
      return;
    }
    toast.success(`注册成功，欢迎 ${result.data.customer.name}`);
    navigate('/app/home', { replace: true });
  };

  return (
    <div className="space-y-4">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>注册</CardTitle>
          <CardDescription>
            仅需姓名、邮箱和密码；注册后自动登录并发放六币种演示初始资金
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="name">姓名</Label>
              <Input
                id="name"
                type="text"
                placeholder="请输入姓名"
                autoComplete="name"
                {...register('name')}
              />
              {formState.errors.name ? (
                <p className="text-xs text-danger">{formState.errors.name.message}</p>
              ) : null}
            </div>
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
                placeholder="至少 8 位，包含字母和数字"
                autoComplete="new-password"
                {...register('password')}
              />
              {formState.errors.password ? (
                <p className="text-xs text-danger">{formState.errors.password.message}</p>
              ) : null}
            </div>
            {formState.errors.root ? (
              <p className="text-xs text-danger">{formState.errors.root.message}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? '注册中…' : '注册并登录'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            已有账号？
            <Link className="font-medium text-primary hover:underline" to="/app/login">
              去登录
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-sm">演示账号（仅演示数据）</CardTitle>
          <CardDescription>也可以直接使用以下预置客户账号登录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {SEED_CUSTOMERS.map((c) => (
            <div key={c.id} className="text-sm">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {c.email} / {c.password}
              </p>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            注册数据仅保存在本机浏览器，可随时在首页重置演示数据。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
