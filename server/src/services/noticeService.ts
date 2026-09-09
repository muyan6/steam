import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
            content: '1. 本工具仅供学习和技术研究用途，严禁用于任何商业用途。\n\n2. 本工具所生成的文件内容由用户自行上传，开发者不对内容的合法性、准确性、完整性承担任何责任。\n\n3. 使用本工具所产生的一切后果由使用者自行承担，与开发者无关。\n\n4. 本工具不提供任何破解、盗版相关的技术支持或服务。\n\n5. 如有权利方认为本工具涉及侵权，请联系 huasjj@163.com 进行下架处理。',
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
            content: '苏大猫 993499094 及全量清单密钥与 PICS Token 每日自动更新。',
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
        // mtime 缓存：公告文件读多写少，内容未变化时避免每次请求同步读盘
        const stat = fs.statSync(this.noticesFilePath);
        if (this.readCache && this.readCacheMtimeMs === stat.mtimeMs) {
          return this.readCache;
        }
        const content = fs.readFileSync(this.noticesFilePath, 'utf-8');
        const list: Announcement[] = JSON.parse(content);
        const result = Array.isArray(list) ? list : [];
        this.readCache = result;
        this.readCacheMtimeMs = stat.mtimeMs;
        return result;
      }
    } catch (e) {
      console.error('[NoticeService] 读取公告列表失败:', e);
    }
    return [];
  }

  // 公告文件 mtime 缓存（写路径失效）
  private readCache: Announcement[] | null = null;
  private readCacheMtimeMs: number = -1;

  private saveAll(notices: Announcement[]) {
    try {
      writeJsonAtomic(this.noticesFilePath, notices);
      // 写入后立即失效缓存，保证同进程读写一致
      this.readCache = null;
      this.readCacheMtimeMs = -1;
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
      if (item.targetVersion && item.targetVersion !== '*') {
        // 客户端未上报版本号时按不匹配处理（fail-closed）：
        // 定向公告不能因参数缺失而对全量客户端放开
        if (!clientVersion) {
          return false;
        }
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

  /**
   * 公告字段白名单清洗：类型校验 + 长度截断 + 优先级夹取。
   * 管理端创建/更新接口一律经此清洗后再落盘，防止任意字段注入与超大 payload。
   */
  private sanitizeNoticeData(data: Partial<Announcement>): Partial<Announcement> {
    const cleanStr = (v: unknown, max: number): string | undefined =>
      typeof v === 'string' ? v.replace(/[\x00-\x1F\x7F]/g, '').slice(0, max) : undefined;
    const out: Partial<Announcement> = {};

    const title = cleanStr(data.title, 100);
    if (title !== undefined) out.title = title;
    const content = cleanStr(data.content, 5000);
    if (content !== undefined) out.content = content;

    if (data.type === 'popup' || data.type === 'banner' || data.type === 'notification') {
      out.type = data.type;
    }
    if (data.level === 'info' || data.level === 'warning' || data.level === 'danger' || data.level === 'success') {
      out.level = data.level;
    }
    if (typeof data.priority === 'number' && !isNaN(data.priority)) {
      out.priority = Math.min(1000, Math.max(0, Math.floor(data.priority)));
    }
    if (typeof data.popupOnce === 'boolean') {
      out.popupOnce = data.popupOnce;
    }
    if (data.interaction === 'confirm' || data.interaction === 'consent') {
      out.interaction = data.interaction;
    }
    const link = cleanStr(data.link, 500);
    if (link !== undefined) out.link = link;
    const targetVersion = cleanStr(data.targetVersion, 64);
    if (targetVersion !== undefined) out.targetVersion = targetVersion;
    if (typeof data.enabled === 'boolean') {
      out.enabled = data.enabled;
    }
    const startTime = cleanStr(data.startTime, 40);
    if (startTime !== undefined) out.startTime = startTime;
    const endTime = cleanStr(data.endTime, 40);
    if (endTime !== undefined) out.endTime = endTime;

    return out;
  }

  public createNotice(data: Partial<Announcement>): Announcement {
    const list = this.readAll();
    const clean = this.sanitizeNoticeData(data);
    const newNotice: Announcement = {
      id: data.id || `notice_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      title: clean.title || '新公告',
      content: clean.content || '',
      type: clean.type || 'popup',
      level: clean.level || 'info',
      priority: typeof clean.priority === 'number' ? clean.priority : 10,
      popupOnce: Boolean(clean.popupOnce),
      interaction: clean.interaction === 'consent' ? 'consent' : 'confirm',
      link: clean.link || '',
      targetVersion: clean.targetVersion || '*',
      enabled: clean.enabled !== false,
      startTime: clean.startTime || undefined,
      endTime: clean.endTime || undefined,
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

    // 白名单字段逐项赋值，绝不整包 ...data 透传（防止 id/createdAt 等被注入篡改）
    const clean = this.sanitizeNoticeData(data);
    const updated: Announcement = {
      ...list[index],
      ...(clean.title !== undefined && { title: clean.title }),
      ...(clean.content !== undefined && { content: clean.content }),
      ...(clean.type !== undefined && { type: clean.type }),
      ...(clean.level !== undefined && { level: clean.level }),
      ...(clean.priority !== undefined && { priority: clean.priority }),
      ...(clean.popupOnce !== undefined && { popupOnce: clean.popupOnce }),
      ...(clean.interaction !== undefined && { interaction: clean.interaction }),
      ...(clean.link !== undefined && { link: clean.link }),
      ...(clean.targetVersion !== undefined && { targetVersion: clean.targetVersion }),
      ...(clean.enabled !== undefined && { enabled: clean.enabled }),
      ...(clean.startTime !== undefined && { startTime: clean.startTime }),
      ...(clean.endTime !== undefined && { endTime: clean.endTime }),
      id,
      updatedAt: new Date().toISOString()
    };

    list[index] = updated;
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
