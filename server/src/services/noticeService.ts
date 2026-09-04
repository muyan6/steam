import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { Announcement } from '../types/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export class NoticeService {
  private noticesFilePath: string;
  private legacyNoticeFilePath: string;

  constructor() {
    this.noticesFilePath = path.join(CONFIG.DATA_DIR, 'notices.json');
    this.legacyNoticeFilePath = path.join(CONFIG.DATA_DIR, 'notice.json');
    this.ensureNoticeFiles();
  }

  private ensureNoticeFiles() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }

    let initialNotices: Announcement[] = [];

    // 如果旧版 notice.json 存在但 notices.json 不存在，则进行迁移
    if (fs.existsSync(this.legacyNoticeFilePath) && !fs.existsSync(this.noticesFilePath)) {
      try {
        const oldContent = fs.readFileSync(this.legacyNoticeFilePath, 'utf-8');
        const oldNotice = JSON.parse(oldContent);
        if (oldNotice && oldNotice.title) {
          initialNotices.push({
            id: oldNotice.id || `notice_${Date.now()}`,
            title: oldNotice.title,
            content: oldNotice.content || '',
            type: oldNotice.type || 'popup',
            level: 'info',
            priority: 10,
            popupOnce: Boolean(oldNotice.popupOnce),
            link: oldNotice.link || '',
            targetVersion: '*',
            enabled: oldNotice.enabled !== false,
            createdAt: oldNotice.createdAt || new Date().toISOString(),
            updatedAt: oldNotice.updatedAt || new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('[NoticeService] 迁移旧版公告失败:', e);
      }
    }

    if (!fs.existsSync(this.noticesFilePath)) {
      if (initialNotices.length === 0) {
        initialNotices = [
          {
            id: 'notice_disclaimer_01',
            title: '免责声明',
            content: '1. 本工具仅供学习和技术研究用途，严禁用于任何商业用途。\n\n2. 本工具所生成的文件内容由用户自行上传，开发者不对内容的合法性、准确性、完整性承担任何责任。\n\n3. 使用本工具所产生的一切后果由使用者自行承担，与开发者无关。\n\n4. 本工具不提供任何破解、盗版相关的技术支持或服务。\n\n5. 如有权利方认为本工具涉及侵权，请联系官网邮箱进行下架处理。',
            type: 'popup',
            level: 'warning',
            priority: 100,
            popupOnce: false,
            link: '',
            targetVersion: '*',
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          {
            id: 'notice_banner_01',
            title: '⚡ 云端数据源实时同步引擎已就绪',
            content: '苏大猫 993499094 及 ManifestHub 全量密钥与 PICS Token 每日自动更新。',
            type: 'banner',
            level: 'info',
            priority: 50,
            popupOnce: false,
            targetVersion: '*',
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ];
      }
      writeJsonAtomic(this.noticesFilePath, initialNotices);
    }

    this.syncLegacyFile();
  }

  private readAll(): Announcement[] {
    try {
      if (fs.existsSync(this.noticesFilePath)) {
        const content = fs.readFileSync(this.noticesFilePath, 'utf-8');
        const list: Announcement[] = JSON.parse(content);
        return Array.isArray(list) ? list : [];
      }
    } catch (e) {
      console.error('[NoticeService] 读取公告列表失败:', e);
    }
    return [];
  }

  private saveAll(notices: Announcement[]) {
    try {
      writeJsonAtomic(this.noticesFilePath, notices);
      this.syncLegacyFile();
    } catch (e) {
      console.error('[NoticeService] 保存公告列表失败:', e);
    }
  }

  /**
   * 同步更新旧版 notice.json（供兼容使用）
   */
  private syncLegacyFile() {
    try {
      const active = this.getActiveNotices();
      const top = active.length > 0 ? active[0] : null;
      if (top) {
        writeJsonAtomic(this.legacyNoticeFilePath, top);
      } else {
        const placeholder: Announcement = {
          id: 'notice_none',
          title: '',
          content: '',
          type: 'popup',
          popupOnce: false,
          enabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        writeJsonAtomic(this.legacyNoticeFilePath, placeholder);
      }
    } catch (e) {
      console.error('[NoticeService] 同步 legacyNoticeFile 失败:', e);
    }
  }

  public getAllNotices(): Announcement[] {
    const list = this.readAll();
    return list.sort((a, b) => {
      const prioA = a.priority ?? 0;
      const prioB = b.priority ?? 0;
      if (prioB !== prioA) return prioB - prioA;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  public getNoticeById(id: string): Announcement | null {
    const list = this.readAll();
    return list.find((n) => n.id === id) || null;
  }

  public getActiveNotices(clientVersion?: string): Announcement[] {
    const list = this.getAllNotices();
    const now = new Date().getTime();

    return list.filter((item) => {
      if (!item.enabled) return false;

      // 检查开始与结束时间
      if (item.startTime && new Date(item.startTime).getTime() > now) {
        return false;
      }
      if (item.endTime && new Date(item.endTime).getTime() < now) {
        return false;
      }

      // 版本号匹配规则（如有指定）
      if (item.targetVersion && item.targetVersion !== '*' && clientVersion) {
        // 如果指定了目标版本且与客户端不符
        if (!this.matchesVersionRule(clientVersion, item.targetVersion)) {
          return false;
        }
      }

      return true;
    });
  }

  private matchesVersionRule(clientVersion: string, rule: string): boolean {
    if (!rule || rule === '*') return true;
    const cleanClient = clientVersion.replace(/^v/i, '');
    const cleanRule = rule.replace(/^v/i, '');
    if (rule.startsWith('>=')) {
      return this.compareVersions(cleanClient, cleanRule.replace('>=', '')) >= 0;
    }
    if (rule.startsWith('<=')) {
      return this.compareVersions(cleanClient, cleanRule.replace('<=', '')) <= 0;
    }
    if (rule.startsWith('>')) {
      return this.compareVersions(cleanClient, cleanRule.replace('>', '')) > 0;
    }
    if (rule.startsWith('<')) {
      return this.compareVersions(cleanClient, cleanRule.replace('<', '')) < 0;
    }
    return cleanClient === cleanRule;
  }

  private compareVersions(v1: string, v2: string): number {
    const p1 = v1.split('.').map((n) => parseInt(n, 10) || 0);
    const p2 = v2.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      const a = p1[i] || 0;
      const b = p2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  public getLatestNotice(clientVersion?: string): Announcement | null {
    const active = this.getActiveNotices(clientVersion);
    return active.length > 0 ? active[0] : null;
  }

  public createNotice(data: Partial<Announcement>): Announcement {
    const list = this.readAll();
    const newNotice: Announcement = {
      id: data.id || `notice_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: data.title || '新公告',
      content: data.content || '',
      type: data.type || 'popup',
      level: data.level || 'info',
      priority: typeof data.priority === 'number' ? data.priority : 10,
      popupOnce: Boolean(data.popupOnce),
      link: data.link || '',
      targetVersion: data.targetVersion || '*',
      enabled: data.enabled !== false,
      startTime: data.startTime || undefined,
      endTime: data.endTime || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.unshift(newNotice);
    this.saveAll(list);
    return newNotice;
  }

  public updateNotice(id: string, data: Partial<Announcement>): Announcement {
    const list = this.readAll();
    const index = list.findIndex((n) => n.id === id);

    if (index === -1) {
      // 安全策略：指定 ID 不存在时直接报错，绝不静默覆盖第一条公告
      throw new Error(`公告 ID 不存在: ${id}，请刷新列表后重试`);
    }

    list[index] = {
      ...list[index],
      ...data,
      id,
      updatedAt: new Date().toISOString()
    };

    this.saveAll(list);
    return list[index];
  }

  public toggleNotice(id: string, enabled?: boolean): Announcement | null {
    const list = this.readAll();
    const index = list.findIndex((n) => n.id === id);
    if (index === -1) return null;

    list[index].enabled = enabled !== undefined ? enabled : !list[index].enabled;
    list[index].updatedAt = new Date().toISOString();
    this.saveAll(list);
    return list[index];
  }

  public deleteNotice(id: string): boolean {
    const list = this.readAll();
    const nextList = list.filter((n) => n.id !== id);
    if (nextList.length === list.length) {
      return false;
    }
    this.saveAll(nextList);
    return true;
  }
}

export const noticeService = new NoticeService();
