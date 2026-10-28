import { BrowserRouter } from 'react-router';
import { AppProviders } from './app/providers';
import { AppRoutes } from './app/routes';

// 声明式路由模式（react-router v8 中 react-router-dom 已并入 react-router）
// basename 取 Vite 的 BASE_URL：GitHub Pages 项目站点挂在子路径 /fx-front/（见 vite.config.ts），
// 资源路径由 base 处理，但路由匹配必须靠 basename——否则线上 /fx-front/app/login 会按根路径
// 匹配失败、整站落入 404 页。本地 base 为 /，BASE_URL 即 /，行为不变。
export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
