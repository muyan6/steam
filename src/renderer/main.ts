import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { createTauriBridge, isTauriEnvironment } from './api/tauriBridge';

if (typeof window !== 'undefined' && (!window.electronAPI || isTauriEnvironment())) {
  (window as any).electronAPI = createTauriBridge();
}

createApp(App).mount('#app');

