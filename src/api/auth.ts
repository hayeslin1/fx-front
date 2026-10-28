// 认证模块 API（§8.4 auth.ts）。本期仅类型化契约，不接 UI、不发真实请求。
import type {
  ClientLoginReq,
  ClientLoginResp,
  EmptyReq,
  EmptyResp,
  OpsLoginReq,
  OpsLoginResp,
  RegisterReq,
  RegisterResp,
} from './dto';
import { request } from './http';

/** 注册（幂等，邮箱唯一）：requestId 由 http 层自动注入，服务端按值去重 */
export function register(input: Omit<RegisterReq, 'requestId'>): Promise<RegisterResp> {
  return request<RegisterReq, RegisterResp>('/api/auth/register', input, { idempotent: true });
}

/** 客户登录；登录不区分端前缀，仅校验客户身份 */
export function clientLogin(input: ClientLoginReq): Promise<ClientLoginResp> {
  return request<ClientLoginReq, ClientLoginResp>('/api/auth/client/login', input);
}

/** 运营登录；返回的 token 后续用于 /api/ops/** 端点 */
export function opsLogin(input: OpsLoginReq): Promise<OpsLoginResp> {
  return request<OpsLoginReq, OpsLoginResp>('/api/auth/ops/login', input);
}

/** 登出；无业务入参，仍发送 JSON `{}` 以符合全 POST 约定 */
export function logout(): Promise<EmptyResp> {
  return request<EmptyReq, EmptyResp>('/api/auth/logout', {});
}
