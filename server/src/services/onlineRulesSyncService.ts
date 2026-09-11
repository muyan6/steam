import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';
import {
  AUTHORITATIVE_ONLINE_RULES,
  OnlineRuleItem,
  OnlineNetType,
  OnlineRecommendScheme
} from '../data/onlineRules.js';

export interface SyncStats {
  version: string;
  updatedAt: string;
  count: number;
  charts: {
    mostPlayedCount: number;
    topSellersCount: number;
    mergedUnique: number;
  };
}

export interface StoredOnlineRulesDb {
  version: string;
  updatedAt: string;
  count: number;
  charts?: {
    mostPlayedCount: number;
    topSellersCount: number;
    mergedUnique: number;
  };
  data: OnlineRuleItem[];
}

export class OnlineRulesSyncService {
  private dbFilePath: string;
  private rulesMap: Map<number, OnlineRuleItem> = new Map();
  private stats: SyncStats = {
    version: '2026.09.08.1',
    updatedAt: new Date().toISOString(),
    count: AUTHORITATIVE_ONLINE_RULES.length,
    charts: {
      mostPlayedCount: 0,
      topSellersCount: 0,
      mergedUnique: 0
    }
  };
  private isSyncing = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;

  // 常见第三方平台与大型发行商（独立账号/自建网络）
  private static THIRDPARTY_PUBLISHERS = [
    'Electronic Arts', 'EA', 'Ubisoft', 'Blizzard Entertainment',
    'Rockstar Games', 'Take-Two', '2K', 'Gaggle Studios', 'Pocketpair'
  ];

  constructor() {
    this.dbFilePath = path.join(CONFIG.DATA_DIR, 'online_rules_db.json');
    this.initDatabase();
  }

  /**
   * 初始化：从本地持久化磁盘读取，若无则载入内置核心规则并延迟启动双榜同步
   */
  private initDatabase(): void {
    // 1. 先载入硬编码核心权威规则
    for (const item of AUTHORITATIVE_ONLINE_RULES) {
      this.rulesMap.set(item.appId, { ...item, source: 'curated' } as any);
    }

    // 2. 尝试读取磁盘缓存
    try {
      if (fs.existsSync(this.dbFilePath)) {
        const raw = fs.readFileSync(this.dbFilePath, 'utf-8');
        const parsed: StoredOnlineRulesDb = JSON.parse(raw);
        if (Array.isArray(parsed.data) && parsed.data.length > 0) {
          for (const item of parsed.data) {
            const existing = this.rulesMap.get(item.appId) as any;
            // 内置精选规则（source=curated）优先级最高：磁盘/榜单数据绝不覆盖，
            // 否则旧 DB（不含 source 标记）会在重启后抹掉精选规则的高精度 notes
            if (existing && existing.source === 'curated') continue;
            this.rulesMap.set(item.appId, item);
          }
          this.stats = {
            version: parsed.version || this.stats.version,
            updatedAt: parsed.updatedAt || this.stats.updatedAt,
            count: this.rulesMap.size,
            charts: parsed.charts || this.stats.charts
          };
          console.log(`[OnlineRulesService] 成功从磁盘载入 ${this.rulesMap.size} 款联机权威规则！`);
        }
      }
    } catch (e) {
      console.warn('[OnlineRulesService] 读取 online_rules_db.json 失败，回退内置规则:', e);
    }

    this.stats.count = this.rulesMap.size;
  }

  /**
   * 获取当前全部权威规则列表
   */
  public getRules(): { stats: SyncStats; rules: OnlineRuleItem[] } {
    const list = Array.from(this.rulesMap.values()).sort((a, b) => a.appId - b.appId);
    return {
      stats: {
        ...this.stats,
        count: list.length
      },
      rules: list
    };
  }

  /**
   * 启动后台定时同步计划任务（服务启动 5 秒后先拉一次，之后每 24 小时自动更新一次）
   */
  public startScheduledSync(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.syncFromSteamCharts().catch(e => {
        console.warn('[OnlineRulesService] 启动自同步失败:', e);
      });
    }, 5000);
    // 启动探测计时器不应阻止进程退出（定时同步本身已是常驻 interval）
    (this.initialTimer as any).unref?.();

    // 每 24 小时周期同步
    this.syncTimer = setInterval(() => {
      this.syncFromSteamCharts().catch(() => {});
    }, 24 * 60 * 60 * 1000);
    (this.syncTimer as any).unref?.();
  }

  /**
   * 联网从 SteamDB / Steam 双榜（Most Played Top 100 + Top Sellers Top 100）同步最新热门规则
   */
  public async syncFromSteamCharts(): Promise<{ success: boolean; count: number; message: string }> {
    if (this.isSyncing) {
      return { success: false, count: this.rulesMap.size, message: '同步任务正在进行中，请勿重复调用' };
    }
    this.isSyncing = true;
    console.log('[OnlineRulesService] 正在从 SteamDB / Steam 双榜同步热门规则...');

    try {
      // 1. Steam Most Played Top 100
      const mostPlayedRes = await this.fetchJsonWithTimeout('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/', 7000);
      const mostPlayedList: Array<{ appId: number; rank: number; peak: number }> =
        (mostPlayedRes?.response?.ranks || []).map((x: any) => ({
          appId: x.appid,
          rank: x.rank,
          peak: x.peak_in_game
        }));

      // 2. Steam Global Top Sellers Top 100
      const topSellersRes = await this.fetchJsonWithTimeout('https://store.steampowered.com/search/results/?query&start=0&count=100&filter=topsellers&json=1', 7000);
      const topSellersList: Array<{ appId: number; name: string }> = [];
      for (const item of (topSellersRes?.items || [])) {
        const m = (item.logo || '').match(/apps\/(\d+)\//);
        if (m) {
          topSellersList.push({
            appId: Number(m[1]),
            name: item.name
          });
        }
      }

      if (mostPlayedList.length === 0 && topSellersList.length === 0) {
        console.warn('[OnlineRulesService] 未能拉取到 Steam 榜单数据，保留现有数据库');
        return { success: false, count: this.rulesMap.size, message: '未能连接到 Steam 榜单接口，保留现有数据' };
      }

      // 3. 去重合并双榜
      const mergedApps = new Map<number, { appId: number; name?: string; mostPlayedRank?: number; topSellerRank?: number }>();
      for (const mp of mostPlayedList) {
        mergedApps.set(mp.appId, { appId: mp.appId, mostPlayedRank: mp.rank });
      }
      for (let i = 0; i < topSellersList.length; i++) {
        const ts = topSellersList[i];
        if (mergedApps.has(ts.appId)) {
          const obj = mergedApps.get(ts.appId)!;
          obj.topSellerRank = i + 1;
          if (!obj.name) obj.name = ts.name;
        } else {
          mergedApps.set(ts.appId, {
            appId: ts.appId,
            topSellerRank: i + 1,
            name: ts.name
          });
        }
      }

      const uncachedList: Array<{ appId: number; name?: string; mostPlayedRank?: number; topSellerRank?: number }> = [];

      // 4. 遍历检查是否已有规则
      for (const [appId, info] of mergedApps.entries()) {
        if (this.rulesMap.has(appId)) {
          const existing = this.rulesMap.get(appId)!;
          if (info.mostPlayedRank && !existing.signals.some(s => s.includes('热门榜'))) {
            existing.signals.unshift(`SteamDB热门榜 Top ${info.mostPlayedRank}`);
          }
          if (info.topSellerRank && !existing.signals.some(s => s.includes('热销榜'))) {
            existing.signals.unshift(`Steam热销榜 Top ${info.topSellerRank}`);
          }
        } else {
          uncachedList.push(info);
        }
      }

      // 5. 并发拉取新游商店元信息并智能定性
      const CONCURRENCY = 5;
      for (let i = 0; i < uncachedList.length; i += CONCURRENCY) {
        const chunk = uncachedList.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (info) => {
          try {
            const detailsRes = await this.fetchJsonWithTimeout(`https://store.steampowered.com/api/appdetails?appids=${info.appId}&l=schinese`, 5000);
            const appData = detailsRes ? detailsRes[info.appId]?.data : null;

            if (!appData) {
              this.rulesMap.set(info.appId, {
                appId: info.appId,
                name: info.name || `Steam App ${info.appId}`,
                nameZh: info.name || `Steam App ${info.appId}`,
                netType: 'steamworks',
                recommend: 'scheme1',
                signals: [
                  ...(info.mostPlayedRank ? [`SteamDB热门榜 Top ${info.mostPlayedRank}`] : []),
                  ...(info.topSellerRank ? [`Steam热销榜 Top ${info.topSellerRank}`] : []),
                  'Steamworks联机'
                ],
                notes: 'Steam 热门榜单应用，推荐优先尝试方案一免改直启'
              });
              return;
            }

            const name = appData.name || info.name || `Steam App ${info.appId}`;
            const nameZh = appData.name || info.name || name;
            const type = appData.type;
            const categories = ((appData.categories || []) as any[]).map(c => c.description);
            const genres = ((appData.genres || []) as any[]).map(g => g.description);
            const publishers = (appData.publishers || []) as string[];
            const isFree = !!appData.is_free;

            const isTool = type === 'application' || genres.some(g => ['实用工具', '设计和插画', '照片编辑', '动画制作和建模'].includes(g));
            const hasMulti = categories.some(c => c.includes('多人') || c.includes('合作') || c.includes('对战'));
            const isMmo = genres.includes('大型多人在线') || (isFree && categories.some(c => c.includes('线上玩家对战')));
            const isThirdpartyPub = publishers.some(p =>
              OnlineRulesSyncService.THIRDPARTY_PUBLISHERS.some(tp => p.toLowerCase().includes(tp.toLowerCase()))
            );

            let netType: OnlineNetType = 'steamworks';
            let recommend: OnlineRecommendScheme = 'scheme1';
            let note = 'Steam 热门榜单收录，推荐方案一免改直启';
            const signals: string[] = [];

            if (info.mostPlayedRank) signals.push(`SteamDB热门榜 Top ${info.mostPlayedRank}`);
            if (info.topSellerRank) signals.push(`Steam热销榜 Top ${info.topSellerRank}`);

            if (isTool) {
              netType = 'tool';
              recommend = 'single_player';
              note = '实用软件/辅助工具，无需联机';
              signals.push('桌面工具应用');
            } else if (isMmo) {
              netType = 'official_server';
              recommend = 'unsupported';
              note = '官方专属竞技/MMO服务器与反作弊鉴权，无法自建大厅';
              signals.push('官方大型多人在线竞技');
            } else if (!hasMulti) {
              netType = 'single_player';
              recommend = 'single_player';
              note = '纯单机游戏，无需联机大厅通道';
              signals.push('单人游戏模式');
            } else if (isThirdpartyPub) {
              netType = 'thirdparty';
              recommend = 'scheme2';
              note = `${publishers[0] || '第三方'} 官方专属网络体系，推荐方案二联机补丁`;
              signals.push(`${publishers[0] || '第三方'} 账号体系`);
            } else {
              const coopCat = categories.find(c => c.includes('合作'));
              signals.push(coopCat || '多人联机');
              if (categories.includes('在线合作')) {
                signals.push('Steam 在线合作');
              }
            }

            this.rulesMap.set(info.appId, {
              appId: info.appId,
              name,
              nameZh,
              netType,
              recommend,
              signals,
              notes: note
            });
          } catch {}
        }));
      }

      // 6. 落盘持久化
      const resultList = Array.from(this.rulesMap.values()).sort((a, b) => a.appId - b.appId);
      const newVersion = new Date().toISOString().slice(0, 10).replace(/-/g, '.') + '.charts';
      const newUpdatedAt = new Date().toISOString();

      this.stats = {
        version: newVersion,
        updatedAt: newUpdatedAt,
        count: resultList.length,
        charts: {
          mostPlayedCount: mostPlayedList.length,
          topSellersCount: topSellersList.length,
          mergedUnique: mergedApps.size
        }
      };

      const payload: StoredOnlineRulesDb = {
        version: newVersion,
        updatedAt: newUpdatedAt,
        count: resultList.length,
        charts: this.stats.charts,
        data: resultList
      };

      writeJsonAtomic(this.dbFilePath, payload);
      console.log(`[OnlineRulesService] 成功同步 Steam 双榜！全库收录达 ${resultList.length} 款热门应用规则。`);

      return {
        success: true,
        count: resultList.length,
        message: `成功同步 SteamDB/Steam 双榜数据，全库收录达 ${resultList.length} 款规则！`
      };
    } catch (err: any) {
      console.error('[OnlineRulesService] 同步双榜规则失败:', err);
      return {
        success: false,
        count: this.rulesMap.size,
        message: `同步失败: ${err?.message || '网络连接超时'}`
      };
    } finally {
      this.isSyncing = false;
    }
  }

  private async fetchJsonWithTimeout(url: string, ms: number = 6000): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timer);
      return null;
    }
  }
}

export const onlineRulesSyncService = new OnlineRulesSyncService();
