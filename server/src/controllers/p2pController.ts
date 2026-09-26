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
