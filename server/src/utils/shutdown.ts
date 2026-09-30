import type { Server } from 'node:http';

type Hook = { name: string; flush: () => void | Promise<void> };
const hooks: Hook[] = [];
let server: Server | undefined;
let running: Promise<void> | undefined;

/** 服务只登记清理工作，退出进程由本模块统一负责。 */
export function registerShutdownHook(name: string, flush: Hook['flush']): void {
  hooks.push({ name, flush });
}

export function setShutdownServer(value: Server): void {
  server = value;
}

export function isShuttingDown(): boolean {
  return running !== undefined;
}

async function finishShutdown(): Promise<void> {
  let failed = false;
  // 防止半开 HTTP 连接永远阻止持久化；关闭连接后仍须执行所有落盘钩子。
  if (server?.listening) {
    const current = server;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        current.closeAllConnections();
        resolve();
      }, 5000);
      current.close(() => { clearTimeout(timeout); resolve(); });
      current.closeIdleConnections();
    });
  }
  // 一个服务失败不得跳过其余服务；异步写完成以后再决定退出状态。
  for (const hook of hooks) {
    try { await hook.flush(); }
    catch (error) { failed = true; console.error(`[Shutdown] ${hook.name} 落盘失败:`, error); }
  }
  process.exitCode = failed ? 1 : Number(process.exitCode || 0);
}

function shutdown(forceExit: boolean): void {
  if (running) return;
  const timeout = setTimeout(() => {
    console.error('[Shutdown] 清理超过 10 秒，按失败退出');
    process.exit(1);
  }, 10000);
  // 先设置门闩，再执行清理，重复信号不会重入或提前退出。
  running = Promise.resolve().then(finishShutdown).catch(error => {
    console.error('[Shutdown] 清理异常:', error);
    process.exitCode = 1;
  }).finally(() => clearTimeout(timeout)).then(() => {
    // 自然退出让 Node 完成自身句柄清理，不在 beforeExit 中强制二次关闭。
    if (forceExit) process.exit(Number(process.exitCode || 0));
  });
}

process.on('SIGINT', () => shutdown(true));
process.on('SIGTERM', () => shutdown(true));
process.once('beforeExit', () => shutdown(false));
