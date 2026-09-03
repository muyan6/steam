import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { Announcement } from '../types/index.js';

export class NoticeService {
  private noticeFilePath: string;

  constructor() {
    this.noticeFilePath = path.join(CONFIG.DATA_DIR, 'notice.json');
    this.ensureNoticeFile();
  }

  private ensureNoticeFile() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.noticeFilePath)) {
      const defaultNotice: Announcement = {
        id: 'notice_default',
        title: '🎉 欢迎使用 SteamMaster 商业版！',
        content: 'SteamMaster 商业版云端引擎已上线，支持 18 万+ 游戏秒搜与 28 万+ 密钥实时匹配。',
        type: 'popup',
        popupOnce: false,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.noticeFilePath, JSON.stringify(defaultNotice, null, 2), 'utf-8');
    }
  }

  public getLatestNotice(): Announcement | null {
    try {
      this.ensureNoticeFile();
      const content = fs.readFileSync(this.noticeFilePath, 'utf-8');
      const notice: Announcement = JSON.parse(content);
      if (notice && notice.enabled) {
        return notice;
      }
      return null;
    } catch (e) {
      console.error('[NoticeService] 读取公告失败:', e);
      return null;
    }
  }

  public updateNotice(data: Partial<Announcement>): Announcement {
    this.ensureNoticeFile();
    let current: Announcement;
    try {
      current = JSON.parse(fs.readFileSync(this.noticeFilePath, 'utf-8'));
    } catch {
      current = {
        id: `notice_${Date.now()}`,
        title: '',
        content: '',
        type: 'popup',
        popupOnce: false,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    const updated: Announcement = {
      ...current,
      ...data,
      id: data.id || current.id || `notice_${Date.now()}`,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(this.noticeFilePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }
}

export const noticeService = new NoticeService();
