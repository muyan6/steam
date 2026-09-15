import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomicAsync } from '../utils/atomicJson.js';

export class TokenService {
  private tokensDb: Record<string, string> = {};
  private isLoaded = false;
  private saveBlocked = false;
  // 令牌计数缓存：/api/stats 与同步日志每次 Object.keys() 会为 30 万条
  // 分配一个字符串数组，属于纯粹的重复开销
  private cachedCount = -1;

  constructor() {
    this.loadTokensDb();
  }

  public loadTokensDb(): void {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_tokens.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.tokensDb = JSON.parse(content);
        this.cachedCount = -1;
        this.isLoaded = true;
        console.log(`[TokenService] 成功加载 AccessToken 数据库，共收录 ${Object.keys(this.tokensDb).length} 款应用令牌！`);
      } else {
        console.log(`[TokenService] 未找到 steam_tokens.json 文件，将在首次同步时自动创建。`);
        this.tokensDb = {};
        this.cachedCount = 0;
        this.isLoaded = true;
      }
    } catch (e) {
      // fail-closed：损坏文件备份为 .corrupt（已存在则跳过，保留首次完整备份），
      // 保留已加载数据并置为已加载，禁止空库覆写与反复重载
      try {
        const dbPath = path.join(CONFIG.DATA_DIR, 'steam_tokens.json');
        if (fs.existsSync(dbPath) && !fs.existsSync(dbPath + '.corrupt')) {
          fs.copyFileSync(dbPath, dbPath + '.corrupt');
        }
      } catch {}
      this.isLoaded = true;
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

  // 落盘串行化：手动同步与定时同步可能并发触发，避免两路写争用同一临时文件
  private saveChain: Promise<boolean> = Promise.resolve(true);

  public async saveTokens(tokens: Record<string, string>): Promise<boolean> {
    if (this.saveBlocked) {
      console.error('[TokenService] 数据文件已损坏（.corrupt），拒绝写入以保护数据。');
      return false;
    }
    const run = async (): Promise<boolean> => {
      try {
        // 合并而非整库替换：上游返回子集/截断数据时不会丢掉本地已有 token。
        // 原地 Object.assign，避免 {...旧, ...新} 产生一份与主库等大的瞬时副本
        const before = Object.keys(this.tokensDb).length;
        Object.assign(this.tokensDb, tokens);
        // 计数缓存增量维护：只在确有新增时失效，避免每次落盘都重新数一遍
        if (Object.keys(this.tokensDb).length !== before) this.cachedCount = -1;
        const dbPath = path.join(CONFIG.DATA_DIR, 'steam_tokens.json');
        // 异步原子写：同步写整库会阻塞事件循环
        await writeJsonAtomicAsync(dbPath, this.tokensDb);
        this.isLoaded = true;
        console.log(`[TokenService] 已成功持久化保存 ${this.getTotalTokensCount()} 条 AccessToken 到 ${dbPath}`);
        return true;
      } catch (e: any) {
        console.error('[TokenService] 保存 AccessToken 数据库失败:', e.message);
        return false;
      }
    };
    const next = this.saveChain.then(run, run);
    this.saveChain = next.catch(() => false);
    return next;
  }

  public getTotalTokensCount(): number {
    if (!this.isLoaded) this.loadTokensDb();
    if (this.cachedCount < 0) this.cachedCount = Object.keys(this.tokensDb).length;
    return this.cachedCount;
  }
}

export const tokenService = new TokenService();
