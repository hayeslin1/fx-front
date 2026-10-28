import { Navigate, Route, Routes } from 'react-router';
import { ClientAuthLayout } from '@/layouts/ClientAuthLayout';
import { ClientLayout } from '@/layouts/ClientLayout';
import { OpsAuthLayout } from '@/layouts/OpsAuthLayout';
import { OpsLayout } from '@/layouts/OpsLayout';
import { RedirectIfAuthed, RequireClient, RequireOps } from './guards';
import { useAppStore } from '@/store';

import { LoginPage } from '@/pages/client/LoginPage';
import { RegisterPage } from '@/pages/client/RegisterPage';
import { HomePage } from '@/pages/client/HomePage';
import { WalletPage } from '@/pages/client/WalletPage';
import { TopUpPage } from '@/pages/client/TopUpPage';
import { ExchangePage } from '@/pages/client/ExchangePage';
import { OrdersPage } from '@/pages/client/OrdersPage';
import { OrderDetailPage } from '@/pages/client/OrderDetailPage';
import { SupportListPage } from '@/pages/client/SupportListPage';
import { SupportNewPage } from '@/pages/client/SupportNewPage';
import { SupportDetailPage } from '@/pages/client/SupportDetailPage';
import { OpsLoginPage } from '@/pages/ops/OpsLoginPage';
import { OverviewPage } from '@/pages/ops/OverviewPage';
import { CustomersPage } from '@/pages/ops/CustomersPage';
import { CustomerDetailPage } from '@/pages/ops/CustomerDetailPage';
import { TradingOrdersPage } from '@/pages/ops/TradingOrdersPage';
import { ExposurePage } from '@/pages/ops/ExposurePage';
import { CloseBatchesPage } from '@/pages/ops/CloseBatchesPage';
import { ProfitOrdersPage } from '@/pages/ops/ProfitOrdersPage';
import { WalletBalancesPage } from '@/pages/ops/WalletBalancesPage';
import { WalletBillsPage } from '@/pages/ops/WalletBillsPage';
import { AssistedTopUpPage } from '@/pages/ops/AssistedTopUpPage';
import { FxChannelsPage } from '@/pages/ops/FxChannelsPage';
import { FxPairsPage } from '@/pages/ops/FxPairsPage';
import { FxPoolPage } from '@/pages/ops/FxPoolPage';
import { FxRoutingPage } from '@/pages/ops/FxRoutingPage';
import { FxMarkupsPage } from '@/pages/ops/FxMarkupsPage';
import { FxCalculatorPage } from '@/pages/ops/FxCalculatorPage';
import { SupportTicketsPage } from '@/pages/ops/SupportTicketsPage';
import { SupportTicketDetailPage } from '@/pages/ops/SupportTicketDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/** 根路径分流（设计文档 §4.3）：有客户会话去首页，否则去登录 */
function RootRedirect() {
  const client = useAppStore((s) => s.session.client);
  return <Navigate to={client ? '/app/home' : '/app/login'} replace />;
}

/** 路由总表（设计文档 §10.1，30 条业务路由 + 404） */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      {/* ---------- 客户端 ---------- */}
      <Route element={<ClientAuthLayout />}>
        <Route
          path="/app/login"
          element={
            <RedirectIfAuthed kind="client">
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/app/register"
          element={
            <RedirectIfAuthed kind="client">
              <RegisterPage />
            </RedirectIfAuthed>
          }
        />
      </Route>

      <Route
        path="/app"
        element={
          <RequireClient>
            <ClientLayout />
          </RequireClient>
        }
      >
        <Route index element={<Navigate to="/app/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="top-up" element={<TopUpPage />} />
        <Route path="exchange" element={<ExchangePage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="support" element={<SupportListPage />} />
        <Route path="support/new" element={<SupportNewPage />} />
        <Route path="support/:id" element={<SupportDetailPage />} />
      </Route>

      {/* ---------- 运营端 ---------- */}
      <Route element={<OpsAuthLayout />}>
        <Route
          path="/ops/login"
          element={
            <RedirectIfAuthed kind="ops">
              <OpsLoginPage />
            </RedirectIfAuthed>
          }
        />
      </Route>

      <Route
        path="/ops"
        element={
          <RequireOps>
            <OpsLayout />
          </RequireOps>
        }
      >
        <Route index element={<Navigate to="/ops/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="trading/orders" element={<TradingOrdersPage />} />
        <Route path="trading/exposure" element={<ExposurePage />} />
        <Route path="trading/close-batches" element={<CloseBatchesPage />} />
        <Route path="trading/profit-orders" element={<ProfitOrdersPage />} />
        <Route path="wallets/balances" element={<WalletBalancesPage />} />
        <Route path="wallets/bills" element={<WalletBillsPage />} />
        <Route path="wallets/assisted-top-up" element={<AssistedTopUpPage />} />
        <Route path="fx/channels" element={<FxChannelsPage />} />
        <Route path="fx/pairs" element={<FxPairsPage />} />
        <Route path="fx/pool" element={<FxPoolPage />} />
        <Route path="fx/routing" element={<FxRoutingPage />} />
        <Route path="fx/markups" element={<FxMarkupsPage />} />
        <Route path="fx/calculator" element={<FxCalculatorPage />} />
        <Route path="support/tickets" element={<SupportTicketsPage />} />
        <Route path="support/tickets/:id" element={<SupportTicketDetailPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
