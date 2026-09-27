import { Response } from 'express';
import { Readable } from 'stream';

/**
 * 把上游流管道到响应，并在总字节数超过 `maxBytes` 时中止，防止
 * 「无限/异常大的上游响应」耗尽带宽与连接（本服务对多类资源做流式中转）。
 *
 * 同时统一挂上游 error / 客户端断开处理，避免套接字与上游连接泄漏。
 *
 * 注意：上限只在**流式**路径生效（Content-Length 可被上游省略或伪造），
 * 因此按实际累计字节数判断，而不是信任响应头。
 */
export function pipeWithByteCap(
  upstream: Readable | NodeJS.ReadableStream,
  res: Response,
  maxBytes: number
): void {
  const src = upstream as Readable;
  let sent = 0;
  let aborted = false;

  src.on('data', (chunk: Buffer) => {
    sent += chunk.length;
    if (sent > maxBytes && !aborted) {
      aborted = true;
      console.error(`[StreamCap] 上游响应超过上限 ${maxBytes} 字节，已中止转发`);
      src.destroy();
      res.destroy();
    }
  });
  src.on('error', (e: unknown) => {
    console.error('[StreamCap] 上游传输中断:', (e as any)?.message || e);
    res.destroy();
  });
  // 客户端提前断开：取消上游，避免继续白耗带宽
  res.on('close', () => {
    src.destroy();
  });

  src.pipe(res);
}
