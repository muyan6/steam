import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer')
    }
  },
  // Tauri 环境变量注入点：tauri dev/build 时由 Tauri CLI 设置
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'chrome105',
    minify: 'esbuild',
    sourcemap: false
  }
})
