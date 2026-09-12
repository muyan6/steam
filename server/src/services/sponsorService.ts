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
  sponsorUrl: '',
  updatedAt: new Date().toISOString()
};

const SEED_SPONSORS: SponsorItem[] = [];

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
      this.sponsorsCache = [];
      this.lastSource = 'cache';
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
          sponsorUrl: typeof raw.sponsorUrl === 'string' ? raw.sponsorUrl.trim() : '',
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

    // 若显式传入了 sponsorUrl（包含传入空串清空），同步更新 appLinks
    if (partial.sponsorUrl !== undefined) {
      try {
        appLinksService.updateLinks({ sponsorUrl: next.sponsorUrl });
      } catch (e) {
        console.warn('[SponsorService] 同步更新 appLinks 失败:', e);
      }
    }

    return next;
  }

  /** 读取原始赞助数组（不做排序/打标，供写入合并使用） */
  private readRawSponsors(): SponsorItem[] {
    try {
      if (fs.existsSync(this.sponsorsFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.sponsorsFilePath, 'utf-8'));
        if (Array.isArray(raw)) return raw;
      }
    } catch (e: any) {
      console.warn('[SponsorService] 读取赞助原始数据失败:', e.message);
    }
    return this.sponsorsCache || [];
  }

  public getSponsors(): SponsorDataResponse {
    // 优先使用内存缓存：赞助榜单是公开接口，避免每次请求都同步读盘并重新解析。
    // 仅在缓存为空时才首次读盘（写路径 writeJsonAtomic 后都会同步刷新缓存）。
    let list: SponsorItem[];
    if (this.sponsorsCache) {
      list = [...this.sponsorsCache];
    } else {
      list = [];
      try {
        if (fs.existsSync(this.sponsorsFilePath)) {
          const raw = JSON.parse(fs.readFileSync(this.sponsorsFilePath, 'utf-8'));
          if (Array.isArray(raw)) {
            list = raw;
          }
        }
      } catch (e: any) {
        console.warn('[SponsorService] 读取赞助数据失败:', e.message);
        list = this.sponsorsCache || [];
      }
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

    const afConfig = this.getAfdianConfig();
    const links = appLinksService.getLinks();
    // 优先取 appLinks 中管理员显式配置的跳转地址，未配置则为空，绝不强行回退跳转到爱发电首页
    const activeSponsorUrl = (links.sponsorUrl && links.sponsorUrl.trim()) || (afConfig.sponsorUrl && afConfig.sponsorUrl.trim()) || '';

    return {
      totalCount: rankedList.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      updatedAt: this.lastSyncTime || new Date().toISOString(),
      source: this.lastSource,
      sponsorUrl: activeSponsorUrl,
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
        message: '未配置爱发电开发者 User ID 或 API Token，请先在管理后台完成配置。',
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
            'User-Agent': 'ChunFengDu-Server/2.7.3'
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
            source: 'afdian',
            isLifetime: planName.includes('终身') || allSum >= 188,
            comment: item.remark || ''
          });
        }

        page++;
      }

      // 合并而非覆盖：爱发电数据按 id 覆盖，同时保留后台手动维护的本地条目，
      // 避免一次同步（尤其是接口返回空时）抹掉管理员手工添加的赞助者。
      const mergedMap = new Map<string, SponsorItem>();
      for (const s of this.readRawSponsors()) {
        if (s && s.source !== 'afdian') mergedMap.set(s.id, s);
      }
      for (const s of allFetchedSponsors) {
        mergedMap.set(s.id, s);
      }
      const merged = Array.from(mergedMap.values());

      writeJsonAtomic(this.sponsorsFilePath, merged);
      this.sponsorsCache = merged;
      this.lastSyncTime = new Date().toISOString();
      this.lastSource = 'afdian';
      console.log(
        `[SponsorService] 爱发电同步成功：拉取 ${allFetchedSponsors.length} 位，合并本地条目后共 ${merged.length} 位赞助者`
      );

      return {
        success: true,
        message:
          allFetchedSponsors.length > 0
            ? `爱发电同步成功，共获取 ${allFetchedSponsors.length} 位赞助者！`
            : '爱发电接口返回成功，当前暂无赞助记录。',
        count: allFetchedSponsors.length,
        data: this.getSponsors()
      };
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
      comment: item.comment || '',
      source: 'local'
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
