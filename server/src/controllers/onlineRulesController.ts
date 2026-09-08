import { Request, Response } from 'express';
import { onlineRulesSyncService } from '../services/onlineRulesSyncService.js';

/**
 * 获取云端权威联机规则库（基于内置核心规则 + SteamDB / Steam 热门榜与热销榜动态同步）
 */
export const getOnlineRules = async (_req: Request, res: Response) => {
  try {
    const { stats, rules } = onlineRulesSyncService.getRules();
    res.json({
      success: true,
      version: stats.version,
      updatedAt: stats.updatedAt,
      count: stats.count,
      charts: stats.charts,
      data: rules
    });
  } catch (e) {
    console.error('获取联机规则库失败:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/**
 * 手动触发从 SteamDB / Steam 双榜同步热门游戏规则
 */
export const syncOnlineRulesFromCharts = async (_req: Request, res: Response) => {
  try {
    const result = await onlineRulesSyncService.syncFromSteamCharts();
    res.json(result);
  } catch (e: any) {
    console.error('同步 Steam 双榜规则失败:', e);
    res.status(500).json({ success: false, message: e?.message || '同步异常' });
  }
};
