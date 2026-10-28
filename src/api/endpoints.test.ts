import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  authApi,
  configureHttp,
  ERROR_CODE,
  exchangeApi,
  fxConfigApi,
  opsCustomerApi,
  opsWalletApi,
  ordersApi,
  overviewApi,
  resetHttp,
  resolveError,
  setAuthToken,
  supportApi,
  tradingApi,
  walletApi,
} from './index';

interface Capture {
  url: string;
  init: RequestInit;
}

/** 安装可控 fetch 并记录调用；response data 由各用例决定 */
function installFetch(
  handler: (capture: Capture) => Promise<Response> = async () => okResponse({}),
): Capture[] {
  const captures: Capture[] = [];
  configureHttp({
    fetchImpl: async (url, init) => {
      const capture = { url, init };
      captures.push(capture);
      return handler(capture);
    },
  });
  return captures;
}

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBody(capture: Capture): Record<string, unknown> {
  return JSON.parse(String(capture.init.body)) as Record<string, unknown>;
}

interface EndpointCase {
  name: string;
  invoke: () => Promise<unknown>;
  path: string;
  /** 期望 JSON body（幂等端点不含 requestId，测试内单独校验） */
  body: Record<string, unknown>;
  idempotent?: boolean;
}

// §8.4 映射表逐条落成用例：新增/改名端点时必须同步此表，防止契约腐化。
const ENDPOINT_CASES: EndpointCase[] = [
  // ---------- auth.ts ----------
  {
    name: 'auth.register',
    invoke: () =>
      authApi.register({ name: '张三', email: 'demo@example.com', password: 'abc12345' }),
    path: '/api/auth/register',
    body: { name: '张三', email: 'demo@example.com', password: 'abc12345' },
    idempotent: true,
  },
  {
    name: 'auth.clientLogin',
    invoke: () => authApi.clientLogin({ email: 'demo@example.com', password: 'abc12345' }),
    path: '/api/auth/client/login',
    body: { email: 'demo@example.com', password: 'abc12345' },
  },
  {
    name: 'auth.opsLogin',
    invoke: () => authApi.opsLogin({ email: 'ops@example.com', password: 'abc12345' }),
    path: '/api/auth/ops/login',
    body: { email: 'ops@example.com', password: 'abc12345' },
  },
  {
    name: 'auth.logout',
    invoke: () => authApi.logout(),
    path: '/api/auth/logout',
    body: {},
  },

  // ---------- wallet.ts ----------
  {
    name: 'wallet.balances',
    invoke: () => walletApi.balances(),
    path: '/api/wallet/balances/query',
    body: {},
  },
  {
    name: 'wallet.bills',
    invoke: () =>
      walletApi.bills({ page: 1, pageSize: 20, currency: 'USD', type: 'TOPUP_SELF' }),
    path: '/api/wallet/bills/query',
    body: { page: 1, pageSize: 20, currency: 'USD', type: 'TOPUP_SELF' },
  },
  {
    name: 'wallet.topUp',
    invoke: () => walletApi.topUp({ currency: 'USD', amount: '100.00' }),
    path: '/api/wallet/top-up',
    body: { currency: 'USD', amount: '100.00' },
    idempotent: true,
  },

  // ---------- exchange.ts ----------
  {
    name: 'exchange.quote',
    invoke: () =>
      exchangeApi.quote({
        sourceCurrency: 'USD',
        targetCurrency: 'EUR',
        sourceAmount: '100.00',
      }),
    path: '/api/exchange/quote',
    body: { sourceCurrency: 'USD', targetCurrency: 'EUR', sourceAmount: '100.00' },
  },
  {
    name: 'exchange.execute',
    invoke: () => exchangeApi.execute({ quoteId: 'Q-0001' }),
    path: '/api/exchange/execute',
    body: { quoteId: 'Q-0001' },
    idempotent: true,
  },

  // ---------- orders.ts ----------
  {
    name: 'orders.query',
    invoke: () => ordersApi.query({ page: 1, pageSize: 20, pairId: 'USD/EUR' }),
    path: '/api/orders/query',
    body: { page: 1, pageSize: 20, pairId: 'USD/EUR' },
  },
  {
    name: 'orders.detail',
    invoke: () => ordersApi.detail({ orderId: 'EX-20261028-0001' }),
    path: '/api/orders/detail',
    body: { orderId: 'EX-20261028-0001' },
  },

  // ---------- support.ts ----------
  {
    name: 'support.createTicket',
    invoke: () =>
      supportApi.createTicket({
        subject: '充值未到账',
        content: '请协助核查',
        relatedOrderId: 'EX-20261028-0001',
      }),
    path: '/api/support/tickets/create',
    body: {
      subject: '充值未到账',
      content: '请协助核查',
      relatedOrderId: 'EX-20261028-0001',
    },
    idempotent: true,
  },
  {
    name: 'support.queryTickets',
    invoke: () => supportApi.queryTickets({ status: 'PENDING', page: 1, pageSize: 20 }),
    path: '/api/support/tickets/query',
    body: { status: 'PENDING', page: 1, pageSize: 20 },
  },
  {
    name: 'support.ticketDetail',
    invoke: () => supportApi.ticketDetail({ ticketId: 'TK-20261028-0001' }),
    path: '/api/support/tickets/detail',
    body: { ticketId: 'TK-20261028-0001' },
  },
  {
    name: 'support.replyTicket',
    invoke: () => supportApi.replyTicket({ ticketId: 'TK-20261028-0001', content: '补充说明' }),
    path: '/api/support/tickets/reply',
    body: { ticketId: 'TK-20261028-0001', content: '补充说明' },
    idempotent: true,
  },
  {
    name: 'support.opsQuery',
    invoke: () =>
      supportApi.opsQuery({
        status: 'IN_PROGRESS',
        assigneeId: 'OPS-002',
        keyword: '充值',
        page: 1,
        pageSize: 20,
      }),
    path: '/api/ops/support/tickets/query',
    body: { status: 'IN_PROGRESS', assigneeId: 'OPS-002', keyword: '充值', page: 1, pageSize: 20 },
  },
  {
    name: 'support.opsAssign',
    invoke: () => supportApi.opsAssign({ ticketId: 'TK-20261028-0001', assigneeId: 'OPS-002' }),
    path: '/api/ops/support/tickets/assign',
    body: { ticketId: 'TK-20261028-0001', assigneeId: 'OPS-002' },
  },
  {
    name: 'support.opsSetStatus',
    invoke: () =>
      supportApi.opsSetStatus({ ticketId: 'TK-20261028-0001', status: 'IN_PROGRESS' }),
    path: '/api/ops/support/tickets/status',
    body: { ticketId: 'TK-20261028-0001', status: 'IN_PROGRESS' },
  },
  {
    name: 'support.opsClose',
    invoke: () => supportApi.opsClose({ ticketId: 'TK-20261028-0001' }),
    path: '/api/ops/support/tickets/close',
    body: { ticketId: 'TK-20261028-0001' },
    idempotent: true,
  },
  {
    name: 'support.assignees',
    invoke: () => supportApi.assignees(),
    path: '/api/ops/support/assignees/query',
    body: {},
  },

  // ---------- fx-config.ts ----------
  {
    name: 'fxConfig.channelsQuery',
    invoke: () => fxConfigApi.channelsQuery(),
    path: '/api/ops/fx/channels/query',
    body: {},
  },
  {
    name: 'fxConfig.channelSave',
    invoke: () => fxConfigApi.channelSave({ id: 'CH-001', name: '渠道 A', enabled: true }),
    path: '/api/ops/fx/channels/save',
    body: { id: 'CH-001', name: '渠道 A', enabled: true },
  },
  {
    name: 'fxConfig.channelToggle',
    invoke: () => fxConfigApi.channelToggle({ channelId: 'CH-001', enabled: false }),
    path: '/api/ops/fx/channels/toggle',
    body: { channelId: 'CH-001', enabled: false },
  },
  {
    name: 'fxConfig.pairsQuery',
    invoke: () => fxConfigApi.pairsQuery(),
    path: '/api/ops/fx/pairs/query',
    body: {},
  },
  {
    name: 'fxConfig.pairToggle',
    invoke: () => fxConfigApi.pairToggle({ pairId: 'USD/EUR', enabled: true }),
    path: '/api/ops/fx/pairs/toggle',
    body: { pairId: 'USD/EUR', enabled: true },
  },
  {
    name: 'fxConfig.poolQuery',
    invoke: () => fxConfigApi.poolQuery(),
    path: '/api/ops/fx/pool/query',
    body: {},
  },
  {
    name: 'fxConfig.collect',
    invoke: () => fxConfigApi.collect({ pairId: 'USD/EUR', channelId: 'CH-001' }),
    path: '/api/ops/fx/pool/collect',
    body: { pairId: 'USD/EUR', channelId: 'CH-001' },
  },
  {
    name: 'fxConfig.collectAll',
    invoke: () => fxConfigApi.collectAll(),
    path: '/api/ops/fx/pool/collect-all',
    body: {},
  },
  {
    name: 'fxConfig.quoteEnabledToggle',
    invoke: () =>
      fxConfigApi.quoteEnabledToggle({
        pairId: 'USD/EUR',
        channelId: 'CH-001',
        quoteEnabled: false,
      }),
    path: '/api/ops/fx/pool/toggle-quote-enabled',
    body: { pairId: 'USD/EUR', channelId: 'CH-001', quoteEnabled: false },
  },
  {
    name: 'fxConfig.routingQuery',
    invoke: () => fxConfigApi.routingQuery(),
    path: '/api/ops/fx/routing/query',
    body: {},
  },
  {
    name: 'fxConfig.routingSave',
    invoke: () => fxConfigApi.routingSave({ pairId: 'USD/EUR', channelIds: ['CH-001', 'CH-002'] }),
    path: '/api/ops/fx/routing/save',
    body: { pairId: 'USD/EUR', channelIds: ['CH-001', 'CH-002'] },
  },
  {
    name: 'fxConfig.markupsQuery',
    invoke: () => fxConfigApi.markupsQuery(),
    path: '/api/ops/fx/markups/query',
    body: {},
  },
  {
    name: 'fxConfig.markupSave',
    invoke: () => fxConfigApi.markupSave({ pairId: 'USD/EUR', halfSpreadBps: 50 }),
    path: '/api/ops/fx/markups/save',
    body: { pairId: 'USD/EUR', halfSpreadBps: 50 },
  },
  {
    name: 'fxConfig.calculator',
    invoke: () =>
      fxConfigApi.calculator({
        sourceCurrency: 'USD',
        targetCurrency: 'JPY',
        sourceAmount: '100.00',
      }),
    path: '/api/ops/fx/calculator',
    body: { sourceCurrency: 'USD', targetCurrency: 'JPY', sourceAmount: '100.00' },
  },

  // ---------- trading.ts ----------
  {
    name: 'trading.ordersQuery',
    invoke: () =>
      tradingApi.ordersQuery({ customerId: 'C-0001', pairId: 'USD/EUR', page: 1, pageSize: 20 }),
    path: '/api/ops/trading/orders/query',
    body: { customerId: 'C-0001', pairId: 'USD/EUR', page: 1, pageSize: 20 },
  },
  {
    name: 'trading.orderDetail',
    invoke: () => tradingApi.orderDetail({ orderId: 'EX-20261028-0001' }),
    path: '/api/ops/trading/orders/detail',
    body: { orderId: 'EX-20261028-0001' },
  },
  {
    name: 'trading.exposureQuery',
    invoke: () => tradingApi.exposureQuery(),
    path: '/api/ops/trading/exposure/query',
    body: {},
  },
  {
    name: 'trading.closeBatchesQuery',
    invoke: () =>
      tradingApi.closeBatchesQuery({ pairId: 'USD/EUR', status: 'SUCCESS', page: 1, pageSize: 20 }),
    path: '/api/ops/trading/close-batches/query',
    body: { pairId: 'USD/EUR', status: 'SUCCESS', page: 1, pageSize: 20 },
  },
  {
    name: 'trading.closeBatchCreate',
    invoke: () =>
      tradingApi.closeBatchCreate({
        pairId: 'USD/EUR',
        usdAmount: '50.00',
        channelId: 'CH-001',
        simulatedResult: 'SUCCESS',
      }),
    path: '/api/ops/trading/close-batches/create',
    body: {
      pairId: 'USD/EUR',
      usdAmount: '50.00',
      channelId: 'CH-001',
      simulatedResult: 'SUCCESS',
    },
    idempotent: true,
  },
  {
    name: 'trading.closeBatchRetry',
    invoke: () =>
      tradingApi.closeBatchRetry({
        batchId: 'CB-20261028-0001',
        pairId: 'USD/EUR',
        usdAmount: '50.00',
        channelId: 'CH-001',
        simulatedResult: 'FAILED',
      }),
    path: '/api/ops/trading/close-batches/retry',
    body: {
      batchId: 'CB-20261028-0001',
      pairId: 'USD/EUR',
      usdAmount: '50.00',
      channelId: 'CH-001',
      simulatedResult: 'FAILED',
    },
    idempotent: true,
  },
  {
    name: 'trading.closeBatchDetail',
    invoke: () => tradingApi.closeBatchDetail({ batchId: 'CB-20261028-0001' }),
    path: '/api/ops/trading/close-batches/detail',
    body: { batchId: 'CB-20261028-0001' },
  },
  {
    name: 'trading.profitOrdersQuery',
    invoke: () =>
      tradingApi.profitOrdersQuery({ pairId: 'USD/EUR', status: 'PARTIAL', page: 1, pageSize: 20 }),
    path: '/api/ops/trading/profit-orders/query',
    body: { pairId: 'USD/EUR', status: 'PARTIAL', page: 1, pageSize: 20 },
  },
  {
    name: 'trading.profitOrderDetail',
    invoke: () => tradingApi.profitOrderDetail({ profitOrderId: 'PO-20261028-0001' }),
    path: '/api/ops/trading/profit-orders/detail',
    body: { profitOrderId: 'PO-20261028-0001' },
  },

  // ---------- ops-wallet.ts ----------
  {
    name: 'opsWallet.balancesQuery',
    invoke: () => opsWalletApi.balancesQuery({ keyword: '张三', page: 1, pageSize: 20 }),
    path: '/api/ops/wallet/balances/query',
    body: { keyword: '张三', page: 1, pageSize: 20 },
  },
  {
    name: 'opsWallet.billsQuery',
    invoke: () =>
      opsWalletApi.billsQuery({ customerId: 'C-0001', type: 'TOPUP_OPS', page: 1, pageSize: 20 }),
    path: '/api/ops/wallet/bills/query',
    body: { customerId: 'C-0001', type: 'TOPUP_OPS', page: 1, pageSize: 20 },
  },
  {
    name: 'opsWallet.assistedTopUp',
    invoke: () =>
      opsWalletApi.assistedTopUp({
        customerId: 'C-0001',
        currency: 'USD',
        amount: '100.00',
        remark: '演示代客充值',
      }),
    path: '/api/ops/wallet/assisted-top-up',
    body: {
      customerId: 'C-0001',
      currency: 'USD',
      amount: '100.00',
      remark: '演示代客充值',
    },
    idempotent: true,
  },

  // ---------- ops-customer.ts ----------
  {
    name: 'opsCustomer.customersQuery',
    invoke: () => opsCustomerApi.customersQuery({ keyword: '张三', page: 1, pageSize: 20 }),
    path: '/api/ops/customers/query',
    body: { keyword: '张三', page: 1, pageSize: 20 },
  },
  {
    name: 'opsCustomer.customerDetail',
    invoke: () => opsCustomerApi.customerDetail({ customerId: 'C-0001' }),
    path: '/api/ops/customers/detail',
    body: { customerId: 'C-0001' },
  },
  {
    name: 'opsCustomer.createCustomer',
    invoke: () =>
      opsCustomerApi.createCustomer({
        name: '王五',
        email: 'wangwu@demo.fx',
        password: 'Demo1234',
      }),
    path: '/api/ops/customers/create',
    body: { name: '王五', email: 'wangwu@demo.fx', password: 'Demo1234' },
    idempotent: true,
  },
  {
    name: 'opsCustomer.updateCustomer',
    invoke: () => opsCustomerApi.updateCustomer({ customerId: 'C-0001', name: '张三' }),
    path: '/api/ops/customers/update',
    body: { customerId: 'C-0001', name: '张三' },
  },
  {
    name: 'opsCustomer.resetPassword',
    invoke: () =>
      opsCustomerApi.resetPassword({ customerId: 'C-0001', newPassword: 'NewDemo123' }),
    path: '/api/ops/customers/reset-password',
    body: { customerId: 'C-0001', newPassword: 'NewDemo123' },
    idempotent: true,
  },

  // ---------- overview.ts ----------
  {
    name: 'overview.summary',
    invoke: () => overviewApi.summary({ range: { type: 'LAST_7D' } }),
    path: '/api/ops/overview/summary',
    body: { range: { type: 'LAST_7D' } },
  },
];

describe('§8.4 端点契约', () => {
  beforeEach(() => {
    resetHttp();
  });

  afterEach(() => {
    resetHttp();
  });

  it('端点用例数与映射表一致（52 个）', () => {
    expect(ENDPOINT_CASES).toHaveLength(52);
  });

  it.each(ENDPOINT_CASES)('$name → $path', async (testCase) => {
    const captures = installFetch();

    await testCase.invoke();

    expect(captures).toHaveLength(1);
    const capture = captures[0]!;
    expect(capture.url).toBe(testCase.path);
    expect(capture.init.method).toBe('POST');
    expect((capture.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );

    const payload = parseBody(capture);
    if (testCase.idempotent) {
      // 幂等端点必须带 requestId，且 body 其余字段与映射表完全一致
      expect(typeof payload.requestId).toBe('string');
      expect((payload.requestId as string).length).toBeGreaterThan(0);
      delete payload.requestId;
    } else {
      expect(payload).not.toHaveProperty('requestId');
    }
    expect(payload).toEqual(testCase.body);
  });

  it('金额字段一律序列化为十进制字符串（非 number）', async () => {
    const captures = installFetch();

    await walletApi.topUp({ currency: 'USD', amount: '100.00' });
    await exchangeApi.quote({
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      sourceAmount: '250.50',
    });
    await tradingApi.closeBatchCreate({
      pairId: 'USD/EUR',
      usdAmount: '50.00',
      channelId: 'CH-001',
      simulatedResult: 'SUCCESS',
    });
    await opsWalletApi.assistedTopUp({
      customerId: 'C-0001',
      currency: 'USD',
      amount: '25.50',
      remark: '演示代客充值',
    });

    const amountFields = ['amount', 'sourceAmount', 'usdAmount', 'amount'];
    captures.forEach((capture, index) => {
      const payload = parseBody(capture);
      const field = amountFields[index]!;
      expect(typeof payload[field]).toBe('string');
      expect(payload[field]).not.toBeTypeOf('number');
    });
  });

  it('成功包裹解包后直接返回 data', async () => {
    installFetch(async () => okResponse({ customerId: 'C-0001', token: 'token-1' }));

    const result = await authApi.register({
      name: '张三',
      email: 'demo@example.com',
      password: 'abc12345',
    });

    expect(result).toEqual({ customerId: 'C-0001', token: 'token-1' });
  });

  it('业务失败码经模块函数透传为 ApiError', async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify({ code: 40901, message: '报价已过期', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const error: unknown = await exchangeApi
      .execute({ quoteId: 'Q-0001' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(40901);
  });

  it('HTTP 非 2xx 经模块函数归一为网络错误', async () => {
    installFetch(async () => new Response('bad gateway', { status: 502 }));

    const error: unknown = await ordersApi.query({ page: 1, pageSize: 20 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(-1);
  });

  it('设置 token 后模块请求携带 Bearer 头', async () => {
    setAuthToken('token-xyz');
    const captures = installFetch();

    await overviewApi.summary({ range: { type: 'TODAY' } });

    expect((captures[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-xyz',
    );
  });
});

describe('错误码策略', () => {
  it('401xx 跳登录、报价过期刷新、未登记码回退服务端 message', () => {
    expect(resolveError(new ApiError(ERROR_CODE.UNAUTHORIZED, 'ignored'))).toEqual({
      text: '登录已失效，请重新登录',
      action: 'toLogin',
    });
    expect(resolveError(new ApiError(ERROR_CODE.QUOTE_EXPIRED, 'ignored'))).toEqual({
      text: '报价已过期，请重新取价',
      action: 'refresh',
    });
    expect(resolveError(new ApiError(49999, '服务端新增错误文案'))).toEqual({
      text: '服务端新增错误文案',
      action: 'toast',
    });
  });
});
