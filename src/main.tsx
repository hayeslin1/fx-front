import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { bootstrapStore } from '@/store';

// 先完成存储恢复 / seed 构建再渲染，保证首帧即完整数据（设计文档 §5.3）
await bootstrapStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
