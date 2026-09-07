import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export interface AppLinks {
  tutorialUrl: string;
  faqUrl: string;
  qqGroupUrl: string;
  sponsorUrl: string;
  updatedAt: string;
}

const DEFAULT_LINKS: AppLinks = {
  tutorialUrl: '',
  faqUrl: '',
  qqGroupUrl: '',
  sponsorUrl: '',
  updatedAt: new Date().toISOString()
};

/**
 * 应用内跳转链接（教程 / FAQ / QQ交流群 / 赞助支持）——由服务端数据文件配置，
 * 管理后台可更新，客户端启动时拉取；未配置的链接客户端按钮置灰或友好提示。
 */
export class AppLinksService {
  private filePath: string;
  private cache: AppLinks | null = null;

  constructor() {
    this.filePath = path.join(CONFIG.DATA_DIR, 'app_links.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.cache = {
          tutorialUrl: typeof raw.tutorialUrl === 'string' ? raw.tutorialUrl : '',
          faqUrl: typeof raw.faqUrl === 'string' ? raw.faqUrl : '',
          qqGroupUrl: typeof raw.qqGroupUrl === 'string' ? raw.qqGroupUrl : '',
          sponsorUrl: typeof raw.sponsorUrl === 'string' ? raw.sponsorUrl : '',
          updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : DEFAULT_LINKS.updatedAt
        };
      }
    } catch (e) {
      console.warn('[AppLinksService] 读取链接配置失败，使用默认值:', (e as Error).message);
      this.cache = null;
    }
  }

  public getLinks(): AppLinks {
    return this.cache || { ...DEFAULT_LINKS };
  }

  public updateLinks(partial: { tutorialUrl?: string; faqUrl?: string; qqGroupUrl?: string; sponsorUrl?: string }): AppLinks {
    const current = this.getLinks();
    const next: AppLinks = {
      tutorialUrl: this.sanitizeUrl(partial.tutorialUrl !== undefined ? partial.tutorialUrl : current.tutorialUrl),
      faqUrl: this.sanitizeUrl(partial.faqUrl !== undefined ? partial.faqUrl : current.faqUrl),
      qqGroupUrl: this.sanitizeUrl(partial.qqGroupUrl !== undefined ? partial.qqGroupUrl : current.qqGroupUrl),
      sponsorUrl: this.sanitizeUrl(partial.sponsorUrl !== undefined ? partial.sponsorUrl : current.sponsorUrl),
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(this.filePath, next);
    this.cache = next;
    console.log(`[AppLinksService] 链接配置已更新: tutorial=${next.tutorialUrl || '(空)'} faq=${next.faqUrl || '(空)'} qqGroup=${next.qqGroupUrl || '(空)'} sponsor=${next.sponsorUrl || '(空)'}`);
    return next;
  }

  /**
   * 仅接受 http(s) 或 tencent 协议链接或空字符串；空字符串表示"暂未开放"
   */
  private sanitizeUrl(url: string): string {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^(?:https?|tencent):\/\/.{1,500}$/i.test(trimmed)) return trimmed;
    return '';
  }
}

export const appLinksService = new AppLinksService();
