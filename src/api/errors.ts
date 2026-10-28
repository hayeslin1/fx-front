// 业务错误码 → 中文文案与前端处理策略（设计文档 §8.2/§8.5）。
// 错误码分段为前端提议：400xx 参数、401xx 认证、403xx 权限、
// 409xx 状态冲突（报价过期/余额不足/工单已关闭/超可平金额）、5xxxx 系统。
import { ApiError } from './http';

/** 与后端约定的错误码常量；集中定义避免各页面散落魔法数字 */
export const ERROR_CODE = {
  /** 本地归一：网络异常/超时/HTTP 非 2xx/解析失败 */
  NETWORK: -1,
  INVALID_PARAM: 40001,
  UNAUTHORIZED: 40101,
  INVALID_CREDENTIALS: 40102,
  FORBIDDEN: 40301,
  QUOTE_EXPIRED: 40901,
  INSUFFICIENT_BALANCE: 40902,
  TICKET_CLOSED: 40903,
  CLOSE_AMOUNT_EXCEEDED: 40904,
  DUPLICATE_REQUEST: 40905,
  SYSTEM_ERROR: 50000,
} as const;

export const ERROR_TEXT: Record<number, string> = {
  [ERROR_CODE.NETWORK]: '网络异常，请稍后重试',
  [ERROR_CODE.INVALID_PARAM]: '请求参数有误，请检查后重试',
  [ERROR_CODE.UNAUTHORIZED]: '登录已失效，请重新登录',
  [ERROR_CODE.INVALID_CREDENTIALS]: '邮箱或密码错误',
  [ERROR_CODE.FORBIDDEN]: '当前账号无权执行此操作',
  [ERROR_CODE.QUOTE_EXPIRED]: '报价已过期，请重新取价',
  [ERROR_CODE.INSUFFICIENT_BALANCE]: '余额不足',
  [ERROR_CODE.TICKET_CLOSED]: '工单已关闭，不可回复，请新建工单',
  [ERROR_CODE.CLOSE_AMOUNT_EXCEEDED]: '超出可平金额',
  [ERROR_CODE.DUPLICATE_REQUEST]: '该操作已提交，请勿重复操作',
  [ERROR_CODE.SYSTEM_ERROR]: '系统繁忙，请稍后重试',
};

/**
 * toast = 就地提示可重试；toLogin = 清会话并跳对应登录页；
 * refresh = 当前数据已失效，重新拉取（如报价过期后重新取价）。
 */
export type ErrorAction = 'toast' | 'toLogin' | 'refresh';

export interface ResolvedError {
  text: string;
  action: ErrorAction;
}

/** 401xx 统一跳登录；其余按需刷新或就地提示 */
function resolveAction(code: number): ErrorAction {
  if (code >= 40100 && code < 40200) return 'toLogin';
  if (code === ERROR_CODE.QUOTE_EXPIRED || code === ERROR_CODE.DUPLICATE_REQUEST) {
    return 'refresh';
  }
  return 'toast';
}

/**
 * 归一错误供 UI 直接消费：
 * - 已登记 code 用本地中文文案；
 * - 未登记业务 code 回退服务端 message（后端新增错误码无需前端发版）；
 * - 非 ApiError（理论上不该出现，http 已归一）也给出可展示文案。
 */
export function resolveError(error: unknown): ResolvedError {
  if (error instanceof ApiError) {
    return {
      text: ERROR_TEXT[error.code] ?? error.message ?? ERROR_TEXT[ERROR_CODE.NETWORK]!,
      action: resolveAction(error.code),
    };
  }
  if (error instanceof Error && error.message) {
    return { text: error.message, action: 'toast' };
  }
  return { text: ERROR_TEXT[ERROR_CODE.NETWORK]!, action: 'toast' };
}
