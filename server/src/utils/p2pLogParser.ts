import type { P2pPeer } from '../types/index.js';

export const PEER_LATENCY_STALE_MS = 30_000;
export const P2P_PEER_METRICS = {
  source: 'local-log', metric: 'rtt', unit: 'ms', staleAfterMs: PEER_LATENCY_STALE_MS, requiredLogLevel: -1,
  uploadsAutomatically: false
} as const;

export function logTimeMs(value: string): number | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const stamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(stamp);
  return year >= 1970 && year <= 9999 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59 ? stamp : null;
}

export function localWallClockMs(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}

export function parseP2pPeers(log: string, nowMs = localWallClockMs()): P2pPeer[] {
  type Entry = Omit<P2pPeer, 'nodeId' | 'latencyStale'> & { online: boolean; stamp: number | null };
  const entries = new Map<string, Entry>(), appNames = new Map<string, string>(), appIds = new Map<string, string>(), tids = new Map<string, string>();
  const get = (name: string): Entry => {
    let e = entries.get(name);
    if (!e) { e = { online: false, direction: 'in', transport: '', ports: [], lastSeen: '', appId: '', latencyMs: null, latencyUpdatedAt: null, latencySource: null, stamp: null }; entries.set(name, e); }
    return e;
  };
  const after = (line: string, mark: string): string | null => {
    const pos = line.indexOf(mark); if (pos < 0) return null;
    const name = line.slice(pos + mark.length).trimStart().split(/[\s,:]/)[0];
    return name.length >= 2 && (!/^\d+$/.test(name) || name.length === 16) && name !== 'retryApp' && !/error|[:\\/]/.test(name) && !name.startsWith('appid') ? name : null;
  };
  const clear = (name: string) => {
    const e = entries.get(name);
    if (e) { e.online = false; e.latencyMs = null; e.latencyUpdatedAt = null; e.latencySource = null; e.stamp = null; }
    for (const [tid, peer] of tids) if (peer === name) tids.delete(tid);
    for (const [id, peer] of appIds) if (peer === name) appIds.delete(id);
  };
  const numeric = (line: string, mark: string) => {
    const pos = line.indexOf(mark); if (pos < 0) return null;
    const match = /^[\d.-]+/.exec(line.slice(pos + mark.length).trimStart());
    return match ? Number(match[0]) : null;
  };
  for (const line of log.split(/\r?\n/)) {
    if (line.includes('P2PNetwork init start')) { entries.clear(); appNames.clear(); appIds.clear(); tids.clear(); }
    const appId = /appid:(\d+)/.exec(line)?.[1] || /addApp (\d+)(?:\s|$)/.exec(line)?.[1];
    const ts = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/.exec(line.trimStart())?.[0] || '';
    if (line.includes('addApp ')) {
      const peer = after(line, ' to '), appName = /addApp (\S+)/.exec(line)?.[1];
      if (peer && appName) appNames.set(appName, peer);
      if (peer && appId) appIds.set(appId, peer);
    }
    if (line.includes('offline')) {
      const peer = after(line, 'detect peer ') || after(line, 'checkDirectTunnel ') || after(line, 'checkRelayTunnel ');
      if (peer) clear(peer);
    }
    if (line.includes('error') || line.includes('offline')) continue;
    let sample: { peer: string; value: number; source: 'tunnel-heartbeat' | 'relay-heartbeat' } | null = null;
    if (line.includes(' read tunnel heartbeat ack')) {
      const tid = line.slice(0, line.indexOf(' read tunnel heartbeat ack')).trim().split(/\s+/).at(-1)!;
      const peer = tids.get(tid), value = numeric(line, 'rtt=');
      if (peer && value !== null) sample = { peer, value, source: 'tunnel-heartbeat' };
    } else if (line.includes('relay heartbeat ') && line.includes(' store rtt ')) {
      const peer = appId && appIds.get(appId), value = numeric(line, ' store rtt ');
      if (peer && value !== null) sample = { peer, value, source: 'relay-heartbeat' };
    }
    if (sample) {
      const e = entries.get(sample.peer), stamp = logTimeMs(ts);
      if (e && stamp !== null && Number.isFinite(sample.value) && sample.value >= 0 && sample.value <= 60000) {
        Object.assign(e, { online: true, lastSeen: ts, latencyMs: sample.value, latencyUpdatedAt: ts, latencySource: sample.source, stamp, transport: sample.source === 'relay-heartbeat' ? 'relay' : 'direct' });
      }
      continue;
    }
    const transport = /Relay|relay/.test(line) ? 'relay' : /Direct|direct/.test(line) ? 'direct' : '';
    const addedPeer = after(line, ' to ');
    if (line.includes('addApp') && addedPeer) {
      const e = get(addedPeer); e.online = true; e.lastSeen = ts;
      if (appId) e.appId = appId; if (transport) e.transport = transport;
      continue;
    }
    if (line.includes(' online,')) { const peer = after(line, 'INFO '); if (peer) { const e = get(peer); e.online = true; if (ts) e.lastSeen = ts; } continue; }
    if (line.includes('p2ptunnel close')) { const peer = after(line, 'p2ptunnel close '); if (peer) clear(peer); continue; }
    if (line.includes('disconnect')) { const peer = after(line, 'detect peer '); if (peer) clear(peer); continue; }
    if (line.includes('buildDirectTunnel ok') || line.includes('start p2pTunnel to') || line.includes('addRelayTunnel to')) {
      const alias = /buildDirectTunnel ok\. (\S+)/.exec(line)?.[1];
      const name = (alias && appNames.get(alias)) || after(line, 'buildDirectTunnel ok. ') || after(line, 'start p2pTunnel to') || after(line, 'addRelayTunnel to');
      if (name) {
        const peer = appNames.get(name) || name, e = get(peer);
        if (appId) { appIds.set(appId, peer); e.appId = appId; }
        const tid = / use tid (\d+)/.exec(line)?.[1];
        if (tid && line.includes('buildDirectTunnel ok')) tids.set(tid, peer);
        e.online = true; e.direction = 'out'; if (ts) e.lastSeen = ts; if (transport) e.transport = transport;
      }
      continue;
    }
    if (/(?:tcp|udp) accept on port/.test(line) && line.includes('start')) {
      const port = Number(/on port (\d+)/.exec(line)?.[1]), protocol = line.includes('udp accept') ? 'udp' : 'tcp';
      if (port >= 0 && port <= 65535) { const e = get(`local:${protocol}:${port}`); e.online = true; if (ts) e.lastSeen = ts; if (!e.transport) e.transport = 'direct'; if (appId) e.appId = appId; if (!e.ports.includes(port)) e.ports.push(port); }
    }
  }
  return [...entries].filter(([, e]) => e.online).map(([name, e]) => {
    const { online: _online, stamp, ...fields } = e;
    const local = /^local:(\w+):(\d+)$/.exec(name);
    return { nodeId: local ? `有玩家接入（${local[1].toUpperCase()} :${local[2]}）` : name, ...fields, transport: e.transport || 'direct', latencyStale: stamp !== null && (nowMs < stamp || nowMs - stamp > PEER_LATENCY_STALE_MS) };
  }).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.nodeId.localeCompare(b.nodeId));
}
