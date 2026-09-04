import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc';
import { licenseClientService } from './services/licenseClientService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

// 单实例锁：避免双开导致同时杀/启 Steam 与并发写入 lua 规则
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    let preloadPath = path.join(__dirname, 'preload.cjs');
    if (!fs.existsSync(preloadPath)) {
      preloadPath = path.join(__dirname, 'preload.js');
    }
    if (!fs.existsSync(preloadPath)) {
      preloadPath = path.join(__dirname, 'preload.mjs');
    }

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 980,
      minHeight: 660,
      frame: false, // 沉浸式无边框窗口
      backgroundColor: '#101726',
      title: '春风渡 - 游戏一键入库与联机工具',
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      },
      autoHideMenuBar: true
    });

    // 外部链接一律交给系统默认浏览器，禁止在应用内开新窗口；阻止导航离开本地页面
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      const current = mainWindow?.webContents.getURL() || '';
      if (url !== current) {
        event.preventDefault();
        if (url.startsWith('http://') || url.startsWith('https://')) {
          shell.openExternal(url);
        }
      }
    });

    // 页面加载失败兜底提示，避免静默白屏
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return; // ABORTED（正常跳转中断）
      console.error(`页面加载失败 (${errorCode}): ${errorDescription}`);
      mainWindow?.webContents.executeJavaScript(
        `document.body && (document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#94a3b8;font-family:sans-serif;">页面资源加载失败，请重新启动应用 (${errorCode})</div>')`
      ).catch(() => {});
    });

    // 根据环境加载页面
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.whenReady().then(() => {
    // 注册所有 IPC 处理函数（仅在应用就绪时注册一次，避免多窗口重建抛出重复注册异常）
    registerIpcHandlers();

    // 上报客户端启动心跳与活跃度
    licenseClientService.sendHeartbeat();
    heartbeatTimer = setInterval(() => {
      licenseClientService.sendHeartbeat();
    }, 30 * 60 * 1000);

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
