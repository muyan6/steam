import { Request } from 'express';

/**
 * 统一的客户端 IP 取值口径。
 *
 * 为什么必须统一：限流器与配额用的是 `req.ip`（受 TRUST_PROXY 控制），
 * 而审计日志此前大量直接读 `req.socket.remoteAddress` —— 反向代理部署下
 * 后者恒为 `127.0.0.1`，于是"审计里全是本地地址、限流按真实 IP 计数"两套口径打架，
 * 锁定/封禁与审计对不上号。全部改走本函数后二者一致。
 */
export function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}
