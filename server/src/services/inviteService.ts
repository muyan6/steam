import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';
import { licenseService } from './licenseService.js';
import { deviceService } from './deviceService.js';
import { appSettingsService } from './appSettingsService.js';

/**
 * 邀请有礼（Invite）服务
 *
 * 设计要点：
 * 1. 邀请码不单独生成、不单独存储 —— 直接取「设备码（CFD-XXXX-XXXX-XXXX-XXXX）」
 *    去掉前缀与连字符后的后 12 位 hex，格式化为 `XXXX-XXXX-XXXX`。
 *    设备码为 64bit SHA256 截断，取后 48bit 作为邀请码，5 万台设备的碰撞概率
 *    约 4e-5，可忽略；映射关系在需要时由「已绑定卡密的设备 + 已心跳的设备」实时重建。
 * 2. 每个「被邀请设备」终身仅能绑定一次邀请码（invite_records.json 落盘，删卡不丢）。
 * 3. 邀请人可无限次邀请，多邀多得；奖励天数由后台统一配置，双方同步生效。
 * 4. 邀请人与被邀请人的奖励统一走 licenseService.grantInviteDays()：
 *    有在期卡密则顺延，无卡密则自动新建一张 invite 类型奖励卡。
 */

/** 邀请码取设备码尾部多少位 hex（12 位 = 3 组） */
const INVITE_TAIL_HEX = 12;

export interface InviteRecord {
  id: string;
  /** 归一化后的邀请码（12 位 hex，无分隔符） */
  inviteCode: string;
  /** 展示用邀请码（XXXX-XXXX-XXXX） */
  inviteCodeDisplay: string;
  inviterDeviceId: string;
  inviteeDeviceId: string;
  /** 邀请人实际到账天数（永久卡或落盘失败时为 0） */
  inviterDays: number;
  /** 被邀请人实际到账天数 */
  inviteeDays: number;
  createdAt: string;
}

export interface InviteStatus {
  deviceId: string;
  /** 本机邀请码（展示格式），设备码非法时为空串 */
  inviteCode: string;
  /** 本机成功邀请的设备数 */
  invitedCount: number;
  /** 本机作为邀请人累计获得的天数 */
  earnedDays: number;
  /** 本机是否已绑定过他人的邀请码（每设备仅一次） */
  hasBoundInvite: boolean;
  boundInviteCode: string;
  boundAt: string;
  /** 当前后台配置的单次奖励天数（邀请人与被邀请人相同） */
  rewardDays: number;
}

export interface InviteBindingResult {
  success: boolean;
  message: string;
  rewardDays?: number;
  status?: InviteStatus;
}

/** 设备码 -> 纯 hex 串（去掉 CFD- 前缀与连字符） */
export function deviceIdToHex(deviceId: string): string {
  return String(deviceId || '')
    .toUpperCase()
    .replace(/^CFD-/, '')
    .replace(/[^0-9A-F]/g, '');
}

/**
 * 由设备码派生邀请码（展示格式 XXXX-XXXX-XXXX）。
 * 与客户端 tauriBridge.deriveInviteCode 必须保持完全一致的算法。
 */
export function deriveInviteCode(deviceId: string): string {
  const hex = deviceIdToHex(deviceId);
  if (hex.length < INVITE_TAIL_HEX) return '';
  const tail = hex.slice(-INVITE_TAIL_HEX);
  return `${tail.slice(0, 4)}-${tail.slice(4, 8)}-${tail.slice(8, 12)}`;
}

/**
 * 归一化用户输入的邀请码：允许带连字符、小写，甚至直接粘贴完整设备码，
 * 一律取其中后 12 位 hex 作为匹配键。
 */
export function normalizeInviteCodeInput(code: string): string {
  const hex = String(code || '')
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '');
  if (hex.length < INVITE_TAIL_HEX) return '';
  return hex.slice(-INVITE_TAIL_HEX);
}

export class InviteService {
  private filePath: string;
  private records: InviteRecord[] = [];
  private degraded = false;

  constructor() {
    this.filePath = path.join(CONFIG.DATA_DIR, 'invite_records.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.records) ? raw.records : [];
        for (const r of list) {
          if (r && r.inviteeDeviceId && r.inviterDeviceId) {
            this.records.push({
              id: String(r.id || crypto.randomUUID()),
              inviteCode: String(r.inviteCode || ''),
              inviteCodeDisplay: String(r.inviteCodeDisplay || ''),
              inviterDeviceId: String(r.inviterDeviceId),
              inviteeDeviceId: String(r.inviteeDeviceId),
              inviterDays: Number(r.inviterDays) || 0,
              inviteeDays: Number(r.inviteeDays) || 0,
              createdAt: String(r.createdAt || new Date().toISOString())
            });
          }
        }
        console.log(`[InviteService] 成功载入 ${this.records.length} 条邀请绑定记录`);
      }
    } catch (e) {
      // fail-closed：损坏文件备份为 .corrupt 并拒绝写回，防止空记录覆写导致
      // 「每设备仅一次」约束失效（被邀请人可重复领取奖励）
      try {
        if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, this.filePath + '.corrupt');
      } catch {}
      this.degraded = true;
      console.error('[InviteService] 邀请记录文件损坏！已备份到 .corrupt，写入功能已禁用，请修复后重启服务:', e);
      this.records = [];
    }
  }

  private saveRecords(): boolean {
    if (this.degraded) {
      console.error('[InviteService] 数据文件已损坏（.corrupt），拒绝写入以保护数据。');
      return false;
    }
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeJsonAtomic(this.filePath, this.records);
      return true;
    } catch (e) {
      console.error('[InviteService] 保存邀请记录失败:', (e as Error).message);
      return false;
    }
  }

  private getRecords(): InviteRecord[] {
    return this.records;
  }

  /**
   * 实时构建「归一化邀请码 -> 邀请人设备码」索引。
   * 数据源为「已绑定卡密的设备」与「已上报心跳的设备」的并集：
   * 前者保证赞助用户的邀请码永不失效，后者让未激活的普通用户也能邀请好友。
   */
  private resolveInviter(normCode: string): string | null {
    if (!normCode) return null;
    const ids = new Set<string>();
    try {
      for (const d of licenseService.getBoundDeviceIds()) ids.add(d);
    } catch {}
    try {
      for (const d of deviceService.getAllDeviceIds()) ids.add(d);
    } catch {}

    let matched: string | null = null;
    const collisions: string[] = [];
    for (const id of ids) {
      const hex = deviceIdToHex(id);
      if (hex.length < INVITE_TAIL_HEX) continue;
      if (hex.slice(-INVITE_TAIL_HEX) !== normCode) continue;
      if (!matched) matched = id;
      else if (matched.toLowerCase() !== id.toLowerCase()) collisions.push(id);
    }
    if (collisions.length > 0) {
      // 概率极低（1/2^48），出现即说明存在异常设备码；保留首个匹配并告警，不阻断业务
      console.warn(
        `[InviteService] 邀请码 ${normCode} 命中多个设备码（${matched}, ${collisions.join(', ')}），已取首个匹配`
      );
    }
    return matched;
  }

  /** 本机邀请状态（客户端「邀请有礼」标签页展示） */
  public getStatus(deviceId: string): InviteStatus {
    const id = String(deviceId || '').trim();
    const lower = id.toLowerCase();
    const rewardDays = appSettingsService.getInviteRewardDays();
    const inviteCode = deriveInviteCode(id);

    if (!id) {
      return {
        deviceId: '',
        inviteCode: '',
        invitedCount: 0,
        earnedDays: 0,
        hasBoundInvite: false,
        boundInviteCode: '',
        boundAt: '',
        rewardDays
      };
    }

    const mine = this.records.filter(r => r.inviterDeviceId.toLowerCase() === lower);
    const bound = this.records.find(r => r.inviteeDeviceId.toLowerCase() === lower) || null;

    return {
      deviceId: id,
      inviteCode,
      invitedCount: mine.length,
      earnedDays: mine.reduce((sum, r) => sum + (r.inviterDays || 0), 0),
      hasBoundInvite: !!bound,
      boundInviteCode: bound?.inviteCodeDisplay || '',
      boundAt: bound?.createdAt || '',
      rewardDays
    };
  }

  /**
   * 绑定邀请码：被邀请人获得 rewardDays 天赞助版，邀请人同步获得 rewardDays 天。
   *
   * 校验顺序（任何一步失败都不产生副作用）：
   * 1. 邀请码格式可归一化；
   * 2. 不能是自己的邀请码；
   * 3. 本设备尚未绑定过任何邀请码（每设备仅一次）；
   * 4. 本设备当前不是已激活赞助用户；
   * 5. 邀请码能反查到真实邀请人设备。
   */
  public bindInviteCode(rawCode: string, inviteeDeviceId: string): InviteBindingResult {
    const codeInput = String(rawCode || '').trim();
    const invitee = String(inviteeDeviceId || '').trim();

    if (!codeInput) return { success: false, message: '请输入邀请码。' };
    if (!invitee) return { success: false, message: '未获取到本机设备码，无法绑定邀请码。' };
    if (codeInput.length > 64 || invitee.length > 128) {
      return { success: false, message: '邀请码或设备码格式非法。' };
    }

    const normCode = normalizeInviteCodeInput(codeInput);
    if (!normCode) {
      return {
        success: false,
        message: '邀请码格式不正确，请填写 12 位邀请码（如 A1B2-C3D4-E5F6）。'
      };
    }

    const ownInvite = deriveInviteCode(invitee);
    if (ownInvite && normalizeInviteCodeInput(ownInvite) === normCode) {
      return { success: false, message: '不能填写自己的邀请码，快去邀请好友填写你的邀请码吧！' };
    }

    const lowerInvitee = invitee.toLowerCase();
    if (this.records.some(r => r.inviteeDeviceId.toLowerCase() === lowerInvitee)) {
      return { success: false, message: '本设备已绑定过邀请码，每个设备仅能绑定一次。' };
    }

    // 已激活赞助用户不可再填写邀请码（防止老用户回填刷天数）
    try {
      const info = licenseService.verify(invitee);
      if (info.isActivated) {
        return { success: false, message: '本设备已是赞助用户，无需填写邀请码。' };
      }
    } catch {}

    const inviter = this.resolveInviter(normCode);
    if (!inviter) {
      return { success: false, message: '邀请码不存在或邀请人设备尚未注册，请核对后重试。' };
    }
    if (inviter.toLowerCase() === lowerInvitee) {
      return { success: false, message: '不能填写自己的邀请码。' };
    }

    const rewardDays = appSettingsService.getInviteRewardDays();
    const record: InviteRecord = {
      id: crypto.randomUUID ? crypto.randomUUID() : `inv_${Date.now()}`,
      inviteCode: normCode,
      inviteCodeDisplay: `${normCode.slice(0, 4)}-${normCode.slice(4, 8)}-${normCode.slice(8, 12)}`,
      inviterDeviceId: inviter,
      inviteeDeviceId: invitee,
      inviterDays: 0,
      inviteeDays: 0,
      createdAt: new Date().toISOString()
    };

    // 先落盘绑定记录：确保「每设备仅一次」约束先于发奖生效，避免并发/重启重复领取
    this.records.push(record);
    if (!this.saveRecords()) {
      this.records.pop();
      return { success: false, message: '数据保存失败，请稍后重试。' };
    }

    const inviteeGrant = licenseService.grantInviteDays(
      invitee,
      rewardDays,
      `绑定邀请码 ${record.inviteCodeDisplay} 奖励`
    );
    if (!inviteeGrant.success) {
      // 发奖失败则回滚绑定记录，允许用户稍后重试（不吞掉这一次机会）
      const idx = this.records.findIndex(r => r.id === record.id);
      if (idx >= 0) this.records.splice(idx, 1);
      this.saveRecords();
      return { success: false, message: inviteeGrant.message || '奖励发放失败，请稍后重试。' };
    }
    record.inviteeDays = inviteeGrant.grantedDays;

    // 邀请人奖励：尽力而为，失败不回滚被邀请人已到账的奖励
    const inviterGrant = licenseService.grantInviteDays(
      inviter,
      rewardDays,
      `邀请设备 ${invitee} 奖励`
    );
    if (inviterGrant.success) {
      record.inviterDays = inviterGrant.grantedDays;
    } else {
      console.warn(`[InviteService] 邀请人 [${inviter}] 奖励发放失败: ${inviterGrant.message}`);
    }
    this.saveRecords();

    console.log(
      `[InviteService] 邀请绑定成功: 邀请码 ${record.inviteCodeDisplay} · 邀请人 ${inviter} +${record.inviterDays}天 · 被邀请人 ${invitee} +${record.inviteeDays}天`
    );

    return {
      success: true,
      message: inviterGrant.success && inviterGrant.grantedDays > 0
        ? `绑定成功！已获得 ${record.inviteeDays} 天赞助版，邀请人同步获得 ${record.inviterDays} 天奖励。`
        : `绑定成功！已获得 ${record.inviteeDays} 天赞助版。`,
      rewardDays: record.inviteeDays,
      status: this.getStatus(invitee)
    };
  }

  /** 管理端：邀请记录 + 概览统计（含邀请排行榜） */
  public getAdminOverview(query: { page?: number; limit?: number; search?: string }): {
    list: InviteRecord[];
    total: number;
    page: number;
    limit: number;
    stats: {
      totalBindings: number;
      totalInvitees: number;
      totalInviters: number;
      totalDaysGranted: number;
      rewardDays: number;
      todayBindings: number;
      topInviters: Array<{ deviceId: string; inviteCode: string; count: number; days: number }>;
    };
  } {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = String(query.search || '').trim().toLowerCase();

    let all = this.records.slice();
    if (search) {
      all = all.filter(
        r =>
          r.inviteCodeDisplay.toLowerCase().includes(search) ||
          r.inviteCode.toLowerCase().includes(search) ||
          r.inviterDeviceId.toLowerCase().includes(search) ||
          r.inviteeDeviceId.toLowerCase().includes(search)
      );
    }
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const inviterAgg = new Map<string, { deviceId: string; inviteCode: string; count: number; days: number }>();
    let totalDaysGranted = 0;
    let todayBindings = 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const r of this.records) {
      totalDaysGranted += (r.inviterDays || 0) + (r.inviteeDays || 0);
      if (r.createdAt.slice(0, 10) === todayStr) todayBindings++;
      const key = r.inviterDeviceId.toLowerCase();
      const cur = inviterAgg.get(key);
      if (cur) {
        cur.count++;
        cur.days += r.inviterDays || 0;
      } else {
        inviterAgg.set(key, {
          deviceId: r.inviterDeviceId,
          inviteCode: r.inviteCodeDisplay,
          count: 1,
          days: r.inviterDays || 0
        });
      }
    }

    const topInviters = Array.from(inviterAgg.values())
      .sort((a, b) => b.count - a.count || b.days - a.days)
      .slice(0, 10);

    const start = (page - 1) * limit;
    return {
      list: all.slice(start, start + limit),
      total: all.length,
      page,
      limit,
      stats: {
        totalBindings: this.records.length,
        totalInvitees: new Set(this.records.map(r => r.inviteeDeviceId.toLowerCase())).size,
        totalInviters: inviterAgg.size,
        totalDaysGranted,
        rewardDays: appSettingsService.getInviteRewardDays(),
        todayBindings,
        topInviters
      }
    };
  }
}

export const inviteService = new InviteService();