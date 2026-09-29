import type { P2pAppConfig, P2pPeer, SavedP2pTunnel } from '../../types';

export function matchesTunnelConfig(app: P2pAppConfig, tunnel: SavedP2pTunnel): boolean {
  const peer = String(app.peerNode || '').trim().toLowerCase();
  const protocol = String(app.protocol || '').toLowerCase();
  return !!peer && ['tcp', 'udp'].includes(protocol) && app.srcPort === tunnel.localPort
    && app.dstPort === tunnel.remotePort
    && peer === String(tunnel.peerUid || '').trim().toLowerCase()
    && protocol === String(tunnel.protocol || '').toLowerCase();
}

export function peerLatencyLabel(peer: P2pPeer): string {
  if (typeof peer.latencyMs !== 'number' || !Number.isFinite(peer.latencyMs) || peer.latencyMs < 0) return '未采样';
  if (peer.latencyStale) return '已过期';
  return `${peer.latencyMs < 1 ? peer.latencyMs.toFixed(1) : Math.round(peer.latencyMs)} ms`;
}

export function peerLatencyClass(peer: P2pPeer): string {
  if (peer.latencyStale || typeof peer.latencyMs !== 'number' || !Number.isFinite(peer.latencyMs) || peer.latencyMs < 0) return 'text-slate-400';
  if (peer.latencyMs <= 60) return 'text-emerald-600 dark:text-emerald-400';
  if (peer.latencyMs <= 150) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}
