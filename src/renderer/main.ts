import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { createTauriBridge, startTauriHeartbeat } from './api/tauriBridge';
import { initThemeEarly } from './composables/useTheme';

// 注入客户端桥接（Tauri invoke 通道）
if (typeof window !== 'undefined') {
  (window as any).electronAPI = createTauriBridge();
}

// 在挂载前应用主题，避免浅色主题冷启动闪变
initThemeEarly();

createApp(App).mount('#app');

// 设备心跳（启动一次 + 每 30 分钟）
startTauriHeartbeat();
