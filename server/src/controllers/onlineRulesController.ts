import { Request, Response } from 'express';
import {
  AUTHORITATIVE_ONLINE_RULES,
  ONLINE_RULES_VERSION,
  ONLINE_RULES_UPDATED_AT
} from '../data/onlineRules.js';

export const getOnlineRules = async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      version: ONLINE_RULES_VERSION,
      updatedAt: ONLINE_RULES_UPDATED_AT,
      count: AUTHORITATIVE_ONLINE_RULES.length,
      data: AUTHORITATIVE_ONLINE_RULES
    });
  } catch (e) {
    console.error('获取联机规则库失败:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};
