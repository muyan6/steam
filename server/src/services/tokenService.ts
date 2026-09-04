import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export class TokenService {
  private tokensDb: Record<string, string> = {};
  private isLoaded = false;
  private saveBlocked = false;

  constructor() {
    this.loadTokensDb();
  }

  public loadTokensDb(): void {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_tokens.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.tokensDb = JSON.parse(content);
        this.isLoaded = true;
        console.log(`[TokenService] 成功加载 AccessToken 数据库，共收录 ${Object.keys(this.tokensDb).length} 款应用令牌！`);
      } else {
        console.log(`[TokenService] 未找到 steam_tokens.json 文件，将在首次同步时自动创建。`);
        this.tokensDb = {};
        this.isLoaded = true;
      }
    } catch (e) {
      // fail-closed：损坏文件备份为 .corrupt，保留已加载数据，禁止空库覆写
      try { const dbPath = path.join(CONFIG.DATA_DIR, 'steam_tokens.json'); if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbPath + '.corrupt'); } catch {}
      this.saveBlocked = true;
      console.error('[TokenService] AccessToken 数据库损坏！已备份到 .corrupt，写入功能已禁用，请修复文件后重启服务:', e);
    }
  }

  public getTokenByAppId(appId: number | string): string | null {
    if (!this.isLoaded) {
      this.loadTokensDb();
    }
    const sAppId = appId.toString();
    return this.tokensDb[sAppId] || null;
  }

  public saveTokens(tokens: Record<string, string>): boolean {
    if (this.saveBlocked) {
      console.error('[TokenService] 数据文件已损坏（.corrupt），拒绝写入以保护数据。');
      return false;
    }
    try {
      // 合并而非整库替换：上游返回子集/截断数据时不会丢掉本地已有 token
      this.tokensDb = { ...this.tokensDb, ...tokens };
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_tokens.json');
      writeJsonAtomic(dbPath, this.tokensDb);
      this.isLoaded = true;
      console.log(`[TokenService] 已成功持久化保存 ${Object.keys(tokens).length} 条 AccessToken 到 ${dbPath}`);
      return true;
    } catch (e: any) {
      console.error('[TokenService] 保存 AccessToken 数据库失败:', e.message);
      return false;
    }
  }

  public getTotalTokensCount(): number {
    if (!this.isLoaded) this.loadTokensDb();
    return Object.keys(this.tokensDb).length;
  }
}

export const tokenService = new TokenService();
