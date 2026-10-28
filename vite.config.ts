import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages 项目站点发布在子路径 /fx-front/（见 .github/workflows/deploy-pages.yml）。
  // WHY 条件化：base 必须是绝对前缀，SPA 深链（/fx-front/app/login）下相对资源路径会解析错位；
  // 但本地 dev/preview 需要根路径访问，故仅在 CI 环境（GITHUB_ACTIONS）下启用子路径。
  base: process.env.GITHUB_ACTIONS ? '/fx-front/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // 默认 Node 环境（纯函数/存储层用例）；渲染冒烟用例在文件头用
    // @vitest-environment jsdom 单文件切换（设计文档 §12.1 实现注记 2026-10-28）
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
});
