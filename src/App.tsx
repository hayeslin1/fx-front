import { BrowserRouter } from 'react-router';
import { AppProviders } from './app/providers';
import { AppRoutes } from './app/routes';

// 声明式路由模式（react-router v8 中 react-router-dom 已并入 react-router）
export function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
