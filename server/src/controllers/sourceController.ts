import { Request, Response } from 'express';
import { sourceRegistryService } from '../services/sourceRegistryService.js';
import { syncService } from '../services/syncService.js';

export const getSourcesList = (req: Request, res: Response) => {
  try {
    const sources = sourceRegistryService.getAllSources();
    res.json({
      success: true,
      message: '获取数据源与上游引用清单成功',
      data: {
        totalSources: sources.length,
        sources
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
    }
};

export const triggerSyncFromSources = async (req: Request, res: Response) => {
  try {
    const result = await syncService.syncAll();
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
    }
};
