import { Request, Response } from 'express';
import { p2pService } from '../services/p2pService.js';

export const getP2pConfig = (req: Request, res: Response): void => {
  try {
    const config = p2pService.getP2pConfig();
    res.json(config);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || '获取 P2P 预设配置失败',
      presets: [],
    });
  }
};

/** 手动管理诊断，不采集或保存客户端日志。 */
export const inspectP2pLog = (req: Request, res: Response): void => {
  const log = req.body?.log;
  if (typeof log !== 'string' || Buffer.byteLength(log, 'utf8') > 64 * 1024) {
    res.status(400).json({ success: false, message: '日志必须为文本且不超过 64 KiB' });
    return;
  }
  res.json({ success: true, data: p2pService.inspectLog(log) });
};
