/// <reference types="vite/client" />

import type { createTauriBridge } from './api/tauriBridge';

type TauriBridge = ReturnType<typeof createTauriBridge>;

declare global {
  interface Window {
    /** 客户端桥接：由 renderer/main.ts 注入（Tauri invoke 通道） */
    electronAPI: TauriBridge;
  }
}
