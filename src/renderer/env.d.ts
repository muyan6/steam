/// <reference types="vite/client" />

import type { createTauriBridge } from './api/tauriBridge';

type TauriBridge = ReturnType<typeof createTauriBridge>;

declare global {
  /**
   * 构建期注入的应用版本号，源头为 src-tauri/tauri.conf.json。
   * 由 vite.config.ts 的 define 替换为字符串字面量，禁止手写维护。
   */
  const __APP_VERSION__: string;

  interface Window {
    /** 客户端桥接：由 renderer/main.ts 注入（Tauri invoke 通道） */
    electronAPI: TauriBridge;
  }
}
