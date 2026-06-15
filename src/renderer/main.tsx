import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('[渲染端] 全局错误:', event.error);
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[渲染端] 未处理的 Promise rejection:', event.reason);
  event.preventDefault();
});

// 监听主进程异常通知
window.geoAgent?.onMainProcessError?.((detail: { type: string; message: string }) => {
  console.error('[主进程异常]', detail.type, detail.message);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
