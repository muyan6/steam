import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';
import { SponsorItem, SponsorDataResponse, AfdianConfig } from '../types/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';
import { appLinksService } from './appLinksService.js';

const DEFAULT_AFDIAN_CONFIG: AfdianConfig = {
  userId: '',
  token: '',
  autoSync: true,
  syncIntervalMinutes: 60,
  sponsorUrl: 'https://afdian.com/a/chunfengdu',
  updatedAt: new Date().toISOString()
};

const SEED_SPONSORS: SponsorItem[] = [
  {
    id: 'af_top01',
    name: '星海漫游者',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png',
    allSumAmount: 588.00,
    planTitle: '终身赞助者',
    lastPayTime: '2026-09-08',
    firstPayTime: '2026-08-01',
    isLifetime: true,
    comment: '感谢开发者无私奉献，Steam一键入库太好用了，永远支持春风渡！'
  },
  {
    id: 'af_top02',
    name: '云水禅心',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-blue.png',
    allSumAmount: 366.00,
    planTitle: '终身赞助者',
    lastPayTime: '2026-09-07',
    firstPayTime: '2026-08-10',
    isLifetime: true,
    comment: '联机补丁和创意工坊一键订阅功能非常强大，加油！'
  },
  {
    id: 'af_top03',
    name: 'CyberSamurai',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-green.png',
    allSumAmount: 288.00,
    planTitle: '终身赞助者',
    lastPayTime: '2026-09-06',
    firstPayTime: '2026-08-15',
    isLifetime: true,
    comment: '界面审美在线，极速入库很稳定，请喝几杯咖啡！'
  },
  {
    id: 'af_04',
    name: '极光幻梦',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-orange.png',
    allSumAmount: 168.00,
    planTitle: '豪华支持者',
    lastPayTime: '2026-09-05',
    firstPayTime: '2026-08-20',
    isLifetime: false,
    comment: '每日更新清单辛苦了，支持服务器续费！'
  },
  {
    id: 'af_05',
    name: '风之诺言',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-pink.png',
    allSumAmount: 128.00,
    planTitle: '豪华支持者',
    lastPayTime: '2026-09-05',
    firstPayTime: '2026-08-22',
    isLifetime: false,
    comment: '从旧版一路用过来，体验越来越棒了。'
  },
  {
    id: 'af_06',
    name: '秋水长天',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-yellow.png',
    allSumAmount: 99.00,
    planTitle: '月度先锋',
    lastPayTime: '2026-09-04',
    firstPayTime: '2026-08-25',
    isLifetime: false,
    comment: '全DLC自动匹配是真的香，帮了大忙！'
  },
  {
    id: 'af_07',
    name: 'NightOwl_99',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-teal.png',
    allSumAmount: 68.00,
    planTitle: '月度先锋',
    lastPayTime: '2026-09-03',
    firstPayTime: '2026-08-28',
    isLifetime: false,
    comment: '低调支持一下作者，好工具值得被看见。'
  },
  {
    id: 'af_08',
    name: '浮生若梦',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-indigo.png',
    allSumAmount: 50.00,
    planTitle: '爱心发电',
    lastPayTime: '2026-09-02',
    firstPayTime: '2026-09-01',
    isLifetime: false,
    comment: '给开发者加个鸡腿！'
  },
  {
    id: 'af_09',
    name: '代码写到天亮',
    avatar: 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png',
    allSumAmount: 30.00,
    planTitle: '爱心发电',
    lastPayTime: '2026-09-01',
    firstPayTime: '2026-09-01',
    isLifetime: false,
    comment: '同行支持，代码写得很规范优雅！'
  },
  {
    "id": "af_10",
    "name": "Steam重度爱好者",
    "avatar": "https://pic1.afdiancdn.com/default/avatar/avatar-blue.png",
    "allSumAmount": 20.00,
    "planTitle": "爱心发电",
    "lastPayTime": "2026-08-30",
    "firstPayTime": "2026-08-30",
    "isLifetime": false,
    "comment": "支持国产独立工具开源维护！"
  }
];

export class SponsorService {
  private sponsorsFilePath: string;
  private configFilePath: string;
  private sponsorsCache: SponsorItem[] | null = null;
  private configCache: AfdianConfig | null = null;
  private lastSyncTime: string = '';
  private lastSource: 'afdian' | 'cache' | 'fallback' = 'cache';

  constructor() {
    this.sponsorsFilePath = path.join(CONFIG.DATA_DIR, 'sponsors.json');
    this.configFilePath = path.join(CONFIG.DATA_DIR, 'afdian_config.json');
    this.ensureFiles();
  }

  private ensureFiles() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(this.sponsorsFilePath)) {
      writeJsonAtomic(this.sponsorsFilePath, SEED_SPONSORS);
      this.sponsorsCache = [...SEED_SPONSORS];
      this.lastSource = 'fallback';
    }

    if (!fs.existsSync(this.configFilePath)) {
      writeJsonAtomic(this.configFilePath, DEFAULT_AFDIAN_CONFIG);
      this.configCache = { ...DEFAULT_AFDIAN_CONFIG };
    }
  }

  public getAfdianConfig(): AfdianConfig {
    if (this.configCache) return this.configCache;
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.configFilePath, 'utf-8'));
        this.configCache = {
          userId: typeof raw.userId === 'string' ? raw.userId.trim() : '',
          token: typeof raw.token === 'string' ? raw.token.trim() : '',
          autoSync: Boolean(raw.autoSync ?? true),
          syncIntervalMinutes: typeof raw.syncIntervalMinutes === 'number' ? raw.syncIntervalMinutes : 60,
          sponsorUrl: typeof raw.sponsorUrl === 'string' ? raw.sponsorUrl.trim() : DEFAULT_AFDIAN_CONFIG.sponsorUrl,
          updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
        };
        return this.configCache;
      }
    } catch (e: any) {
      console.warn('[SponsorService] 读取爱发电配置失败:', e.message);
    }
    return { ...DEFAULT_AFDIAN_CONFIG };
  }

  public updateAfdianConfig(partial: Partial<AfdianConfig>): AfdianConfig {
    const current = this.getAfdianConfig();
    const next: AfdianConfig = {
      userId: partial.userId !== undefined ? String(partial.userId).trim() : current.userId,
      token: partial.token !== undefined ? String(partial.token).trim() : current.token,
      autoSync: partial.autoSync !== undefined ? Boolean(partial.autoSync) : current.autoSync,
      syncIntervalMinutes: typeof partial.syncIntervalMinutes === 'number' ? Math.max(5, partial.syncIntervalMinutes) : current.syncIntervalMinutes,
      sponsorUrl: partial.sponsorUrl !== undefined ? String(partial.sponsorUrl).trim() : current.sponsorUrl,
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(this.configFilePath, next);
    this.configCache = next;

    // 若更新了 sponsorUrl，且 appLinks 中的 sponsorUrl 为空或旧值，同步更新 appLinks
    if (next.sponsorUrl) {
      try {
        const links = appLinksService.getLinks();
        if (!links.sponsorUrl || links.sponsorUrl.includes('afdian.com')) {
          appLinksService.updateLinks({ sponsorUrl: next.sponsorUrl });
        }
      } catch (e) {
        console.warn('[SponsorService] 同步更新 appLinks 失败:', e);
      }
    }

    return next;
  }

  public getSponsors(): SponsorDataResponse {
    let list: SponsorItem[] = [];
    try {
      if (fs.existsSync(this.sponsorsFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.sponsorsFilePath, 'utf-8'));
        if (Array.isArray(raw)) {
          list = raw;
        }
      }
    } catch (e: any) {
      console.warn('[SponsorService] 读取赞助数据失败:', e.message);
      list = this.sponsorsCache || [...SEED_SPONSORS];
    }

    if (list.length === 0) {
      list = [...SEED_SPONSORS];
    }

    // 排序：累计金额降序，次要以最近支付日期降序
    list.sort((a, b) => {
      const diff = (b.allSumAmount || 0) - (a.allSumAmount || 0);
      if (diff !== 0) return diff;
      return (b.lastPayTime || '').localeCompare(a.lastPayTime || '');
    });

    // 重新打标 rank 排名
    const rankedList = list.map((item, index) => ({
      ...item,
      rank: index + 1
    }));

    const totalAmount = rankedList.reduce((acc, cur) => acc + (cur.allSumAmount || 0), 0);
    this.sponsorsCache = rankedList;

    return {
      totalCount: rankedList.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      updatedAt: this.lastSyncTime || new Date().toISOString(),
      source: this.lastSource,
      sponsors: rankedList
    };
  }

  /**
   * 从爱发电官方开发者接口拉取最新赞助榜单数据
   * 签名公式: md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
   */
  public async syncFromAfdian(): Promise<{ success: boolean; message: string; count: number; data?: SponsorDataResponse }> {
    const config = this.getAfdianConfig();
    if (!config.userId || !config.token) {
      return {
        success: false,
        message: '未配置爱发电开发者 User ID 或 API Token，请先在管理后台完成配置。当前展示预设榜单。',
        count: 0,
        data: this.getSponsors()
      };
    }

    try {
      console.log(`[SponsorService] 正在从爱发电拉取赞助者数据... (User: ${config.userId})`);
      const allFetchedSponsors: SponsorItem[] = [];
      let page = 1;
      let totalPage = 1;

      // 支持遍历前 5 页或所有赞助者（按每页 50 条计）
      while (page <= totalPage && page <= 10) {
        const paramsObj = { page, per_page: 50 };
        const paramsStr = JSON.stringify(paramsObj);
        const ts = Math.floor(Date.now() / 1000);
        const rawSignStr = `${config.token}params${paramsStr}ts${ts}user_id${config.userId}`;
        const sign = crypto.createHash('md5').update(rawSignStr).digest('hex');

        const requestBody = {
          user_id: config.userId,
          params: paramsStr,
          ts,
          sign
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const resp = await fetch('https://afdian.com/api/open/query-sponsor', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ChunFengDu-Server/2.6.1'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          throw new Error(`爱发电 HTTP 响应异常: ${resp.status} ${resp.statusText}`);
        }

        const json: any = await resp.json();
        if (json.ec !== 200) {
          throw new Error(`爱发电返回错误码 [${json.ec}]: ${json.em || '未知原因'}`);
        }

        const list = json.data?.list || [];
        totalPage = json.data?.total_page || 1;

        for (const item of list) {
          const user = item.user || {};
          const allSum = parseFloat(item.all_sum_amount) || 0;
          const lastPayTs = typeof item.last_pay_time === 'number' ? item.last_pay_time * 1000 : Date.now();
          const firstPayTs = typeof item.first_pay_time === 'number' ? item.first_pay_time * 1000 : lastPayTs;
          const planName = item.current_plan?.name || (item.sponsor_plans?.[0]?.name) || (allSum >= 188 ? '终身赞助者' : '爱心发电');

          allFetchedSponsors.push({
            id: user.user_id || `af_${Math.random().toString(36).slice(2, 9)}`,
            name: user.name || '爱发电爱心伙伴',
            avatar: user.avatar || 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png',
            allSumAmount: allSum,
            planTitle: planName,
            lastPayTime: new Date(lastPayTs).toISOString().slice(0, 10),
            firstPayTime: new Date(firstPayTs).toISOString().slice(0, 10),
            isLifetime: planName.includes('终身') || allSum >= 188,
            comment: item.remark || ''
          });
        }

        page++;
      }

      if (allFetchedSponsors.length > 0) {
        writeJsonAtomic(this.sponsorsFilePath, allFetchedSponsors);
        this.sponsorsCache = allFetchedSponsors;
        this.lastSyncTime = new Date().toISOString();
        this.lastSource = 'afdian';
        console.log(`[SponsorService] 爱发电数据同步成功，共获取 ${allFetchedSponsors.length} 位赞助者`);

        return {
          success: true,
          message: `爱发电同步成功，共获取 ${allFetchedSponsors.length} 位赞助者！`,
          count: allFetchedSponsors.length,
          data: this.getSponsors()
        };
      } else {
        return {
          success: true,
          message: '爱发电接口返回成功，但当前暂无赞助记录。',
          count: 0,
          data: this.getSponsors()
        };
      }
    } catch (e: any) {
      console.error('[SponsorService] 爱发电拉取异常:', e.message);
      return {
        success: false,
        message: `爱发电接口拉取失败: ${e.message}`,
        count: 0,
        data: this.getSponsors()
      };
    }
  }

  public saveSponsor(item: Partial<SponsorItem>): SponsorItem {
    const current = this.getSponsors().sponsors;
    const id = item.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const index = current.findIndex(s => s.id === id);

    const newItem: SponsorItem = {
      id,
      name: (item.name || '热心赞助者').trim(),
      avatar: (item.avatar || 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png').trim(),
      allSumAmount: typeof item.allSumAmount === 'number' ? item.allSumAmount : 50,
      planTitle: (item.planTitle || '爱心赞助').trim(),
      lastPayTime: item.lastPayTime || new Date().toISOString().slice(0, 10),
      firstPayTime: item.firstPayTime || item.lastPayTime || new Date().toISOString().slice(0, 10),
      isLifetime: Boolean(item.isLifetime),
      comment: item.comment || ''
    };

    if (index >= 0) {
      current[index] = newItem;
    } else {
      current.push(newItem);
    }

    writeJsonAtomic(this.sponsorsFilePath, current);
    this.sponsorsCache = current;
    return newItem;
  }

  public deleteSponsor(id: string): boolean {
    const current = this.getSponsors().sponsors;
    const filtered = current.filter(s => s.id !== id);
    if (filtered.length === current.length) return false;
    writeJsonAtomic(this.sponsorsFilePath, filtered);
    this.sponsorsCache = filtered;
    return true;
  }
}

export const sponsorService = new SponsorService();
