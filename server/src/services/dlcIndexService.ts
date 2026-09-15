import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeStringAtomicAsync } from '../utils/atomicJson.js';

/**
 * 应用元数据索引（data/dlc_index.json）
 *
 * 为什么需要它：
 * 元数据接口原本每次都要并行查 Steam Store API + SteamCMD API 才能拿到
 * 「游戏名 + DLC 列表 + 分包清单」。但这些数据**变化极低频**（游戏加 DLC、
 * 增加分包都是罕见事件），而 Steam Store API 从服务器侧实测 30 秒完全不可达 ——
 * 两者被 Promise.allSettled 包着就是「等最慢的那个」，于是每次首访都要
 * 白等 4 秒超时。这是「首次 8 秒」的主因。
 *
 * 本服务把 SteamCMD 的产出持久化到磁盘，使这些稳定数据也进入「全本地」阵营
 * （与 28.8 万条 DepotKey、AccessToken 一致）：
 *   索引命中 → 零上游请求，毫秒级返回
 *   索引未命中 → 只查一次 SteamCMD（实测 0.3~1.6 秒），结果落盘
 *
 * 铁律：只缓存**稳定**数据。清单 GID 会随官方更新变化，绝不入索引 ——
 * 「锁定版本」模式（needGid=1）始终实时查 SteamCMD。
 */

/** 索引中记录的单个分包（不含 manifestGid：它随官方更新变化） */
export interface IndexedDepot {
  depotId: string;
  depotKey?: string;
}

export interface DlcIndexEntry {
  /** 游戏名（SteamCMD common.name），仅用于兜底回显 */
  name?: string;
  /** DLC 的 AppID 列表（SteamCMD extended.listofdlc） */
  dlcIds: string[];
  /**
   * DLC AppID -> 该 DLC 的内容分包 DepotID 列表。
   * 来自 SteamCMD depots[].dlcappid，是权威的「DLC→分包」关联，
   * 缺失它 dlcDepots 字段就构造不出来。
   */
  dlcDepots: Record<string, string[]>;
  /**
   * 权威分包清单（preset + SteamCMD depots）。
   * 必须一并缓存：否则命中索引时只能靠 depotService 的
   * 「appId + 0..100」启发式扫描，返回的分包集合会与首次请求不一致。
   */
  depots: IndexedDepot[];
  updatedAt: string;
}

export class DlcIndexService {
  private filePath: string;
  private index: Map<number, DlcIndexEntry> = new Map();
  /** 文件损坏时置位：禁止落盘，防止空索引覆写已有积累 */
  private saveBlocked = false;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // 每条约几百字节，10000 条约几 MB；用紧凑序列化避免美格缩进把文件撑大数倍
  private static MAX_ENTRIES = 10000;
  private static FLUSH_DEBOUNCE_MS = 2000;

  constructor() {
    this.filePath = path.join(CONFIG.DATA_DIR, 'dlc_index.json');
    this.load();
    // 进程退出前落盘：索引只在 2 秒防抖窗口结束后写盘，
    // 若在此期间崩溃/重启，本次采集到的 DLC 与分包集合会全部丢失
    const flushOnExit = () => {
      try { this.flush(); } catch {}
    };
    process.once('beforeExit', flushOnExit);
    process.once('SIGINT', () => { flushOnExit(); process.exit(0); });
    process.once('SIGTERM', () => { flushOnExit(); process.exit(0); });
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.log('[DlcIndex] 尚无索引文件，将在首次查询后自动建立');
        return;
      }
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      for (const [k, v] of Object.entries(obj)) {
        const appId = parseInt(k, 10);
        if (isNaN(appId) || !v || typeof v !== 'object') continue;
        const e = v as any;

        const dlcIds = Array.isArray(e.dlcIds)
          ? e.dlcIds.map((x: any) => String(x)).filter((x: string) => /^\d+$/.test(x))
          : [];

        const dlcDepots: Record<string, string[]> = {};
        if (e.dlcDepots && typeof e.dlcDepots === 'object') {
          for (const [dlc, depots] of Object.entries(e.dlcDepots)) {
            if (!/^\d+$/.test(dlc) || !Array.isArray(depots)) continue;
            dlcDepots[dlc] = (depots as any[])
              .map((d) => String(d))
              .filter((d) => /^\d+$/.test(d));
          }
        }

        const depots: IndexedDepot[] = [];
        if (Array.isArray(e.depots)) {
          for (const d of e.depots) {
            if (!d || typeof d !== 'object') continue;
            const id = String((d as any).depotId ?? '');
            if (!/^\d+$/.test(id)) continue;
            const key = (d as any).depotKey;
            const depotKey =
              typeof key === 'string' && key.length >= 32 && !/^0+$/.test(key) ? key : undefined;
            depots.push({ depotId: id, depotKey });
          }
        }

        this.index.set(appId, {
          name: typeof e.name === 'string' ? e.name : undefined,
          dlcIds,
          dlcDepots,
          depots,
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date().toISOString()
        });
      }
      console.log(`[DlcIndex] 成功载入 ${this.index.size} 条应用元数据索引`);
    } catch (e) {
      // fail-closed：损坏文件备份为 .corrupt 并禁止落盘，
      // 防止空索引覆写已积累的数据（会导致后续每次都重新查上游，且丢失分包集合）
      try {
        if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, `${this.filePath}.corrupt`);
      } catch {}
      this.saveBlocked = true;
      console.error(
        '[DlcIndex] 索引文件损坏！已备份到 .corrupt，写入已禁用，请修复后重启服务:',
        (e as Error).message
      );
    }
  }

  /** 查询索引；未收录返回 null */
  public get(appId: number): DlcIndexEntry | null {
    return this.index.get(appId) || null;
  }

  /** 写入/更新索引（与已有条目合并，避免部分数据覆盖完整数据） */
  public set(
    appId: number,
    entry: { name?: string; dlcIds: string[]; dlcDepots: Record<string, string[]>; depots: IndexedDepot[] }
  ): void {
    if (this.saveBlocked) {
      console.warn('[DlcIndex] 索引处于损坏保护状态，拒绝写入。请修复 dlc_index.json 后重启服务。');
      return;
    }
    // 没有实质内容就不写：避免把空结果固化成索引，导致后续跳过上游后拿不到 DLC 与分包
    if (entry.dlcIds.length === 0 && entry.depots.length === 0 && Object.keys(entry.dlcDepots).length === 0) {
      return;
    }

    const prev = this.index.get(appId);

    // 分包按 depotId 去重合并，密钥以「先到且有效」为准（不因新值缺失而丢掉已有有效密钥）
    const depotMap = new Map<string, IndexedDepot>();
    for (const d of prev?.depots || []) depotMap.set(d.depotId, d);
    for (const d of entry.depots) {
      const old = depotMap.get(d.depotId);
      depotMap.set(d.depotId, {
        depotId: d.depotId,
        depotKey: d.depotKey || old?.depotKey
      });
    }

    // 真正的 LRU 语义：Map 对已存在的 key 执行 set 不会改变插入序，
    // 热点 AppID 会因「插入早」被优先淘汰。这里先删后插把它移到队尾。
    this.index.delete(appId);
    this.index.set(appId, {
      name: entry.name || prev?.name,
      dlcIds: Array.from(new Set([...(prev?.dlcIds || []), ...entry.dlcIds])),
      dlcDepots: { ...(prev?.dlcDepots || {}), ...entry.dlcDepots },
      depots: Array.from(depotMap.values()),
      updatedAt: new Date().toISOString()
    });
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, DlcIndexService.FLUSH_DEBOUNCE_MS);
    (this.flushTimer as any).unref?.();
  }

  private flushing = false;

  /** 立即落盘（进程退出前可由调用方触发）。异步实现：不阻塞事件循环 */
  public async flush(): Promise<void> {
    if (!this.dirty || this.saveBlocked || this.flushing) return;
    this.flushing = true;
    try {
      // 超限时按插入序淘汰最旧，防止被脚本灌海量 AppID 撑爆内存与磁盘
      while (this.index.size > DlcIndexService.MAX_ENTRIES) {
        const oldest = this.index.keys().next().value;
        if (oldest === undefined) break;
        this.index.delete(oldest);
      }
      const obj: Record<string, DlcIndexEntry> = {};
      for (const [appId, entry] of this.index) obj[String(appId)] = entry;
      // 紧凑序列化：美格缩进会让这个数万条的索引膨胀数倍
      await writeStringAtomicAsync(this.filePath, JSON.stringify(obj));
      this.dirty = false;
    } catch (e) {
      console.error('[DlcIndex] 保存索引失败:', (e as Error).message);
    } finally {
      this.flushing = false;
    }
  }

  public size(): number {
    return this.index.size;
  }

  /**
   * 删除单个 AppID 的索引条目，强制下次查询重新采集上游。
   *
   * 使用场景：某次采集恰好碰上 SteamCMD 抖动（超时或只回部分字段），
   * 导致该条目的 DLC 列表不完整。虽然 writeIndex 已加守卫避免固化残缺数据，
   * 但已经落盘的条目仍需一个手动出口 —— 否则只能等文件被清空。
   */
  public delete(appId: number): boolean {
    const existed = this.index.delete(appId);
    if (existed) {
      this.markDirty();
      console.log(`[DlcIndex] 已删除 AppID ${appId} 的索引条目，下次查询将重新采集`);
    }
    return existed;
  }
}

export const dlcIndexService = new DlcIndexService();
