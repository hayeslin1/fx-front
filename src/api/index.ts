// API 契约层聚合出口（§8.1）：调用方只认 `xxxApi`，不直接依赖模块文件路径，
// 对接期替换实现时无需改动调用点。
export * as authApi from './auth';
export * as walletApi from './wallet';
export * as exchangeApi from './exchange';
export * as ordersApi from './orders';
export * as supportApi from './support';
export * as fxConfigApi from './fx-config';
export * as tradingApi from './trading';
export * as opsWalletApi from './ops-wallet';
export * as opsCustomerApi from './ops-customer';
export * as overviewApi from './overview';

// DTO 与错误策略随聚合入口一并暴露，页面无需深入子路径
export * from './dto';
export * from './errors';

// 会话与协议配置：token 注入、测试注入 fetch、基地址覆盖
export {
  ApiError,
  configureHttp,
  getAuthToken,
  resetHttp,
  setAuthToken,
  type Envelope,
  type FetchLike,
  type HttpConfig,
  type RequestOptions,
} from './http';
