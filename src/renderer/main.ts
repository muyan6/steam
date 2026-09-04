import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { createTauriBridge, isTauriEnvironment, startTauriHeartbeat } from './api/tauriBridge';
import { initThemeEarly } from './composables/useTheme';

if (typeof window !== 'undefined' && (!window.electronAPI || isTauriEnvironment())) {
  (window as any).electronAPI = createTauriBridge();
}

// 在挂载前应用主题，避免浅色主题冷启动闪变
initThemeEarly();

createApp(App).mount('#app');

// Tauri 版设备心跳
startTauriHeartbeat();
