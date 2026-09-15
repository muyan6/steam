import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'fs'

// 应用版本号的唯一源头 = Tauri 的 tauri.conf.json（安装包与 exe 的版本即由此决定）。
// 构建期注入 __APP_VERSION__，前端不再维护手写常量。
// 历史事故：2.7.7 发布时只改了 package.json / tauri.conf.json / version.json /
// versions.json，漏改 src/config/appConfig.ts，导致客户端始终自称 2.7.6，
// 服务端判定有更新，用户装完 2.7.7 仍被无限提示更新。
const tauriConf = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf-8')
) as { version: string }

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(tauriConf.version)
  },
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
