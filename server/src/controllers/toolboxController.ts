import { Request, Response } from 'express';
import { toolboxService } from '../services/toolboxService.js';

export const getManifestNodes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const nodes = toolboxService.getManifestNodes();
    res.json({
      success: true,
      nodes,
      total: nodes.length
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `获取清单节点失败: ${error.message}` });
  }
};

export const getSha256PackageInfo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = toolboxService.getSha256PackageInfo();
    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `获取SHA256数据失败: ${error.message}` });
  }
};

export const reportRepairLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const { actionType, success, deviceId, details } = req.body;
    if (!actionType) {
      res.status(400).json({ success: false, message: '缺少 actionType 参数' });
      return;
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const record = toolboxService.recordRepairLog({
      actionType,
      success: Boolean(success),
      deviceId: deviceId || '',
      details: details || '',
      ip
    });

    res.json({
      success: true,
      data: record
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `上报修复日志失败: ${error.message}` });
  }
};

export const getToolboxAdminStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = toolboxService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `获取工具箱统计失败: ${error.message}` });
  }
};

export const getSteamlessInfo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const info = toolboxService.getSteamlessInfo();
    res.json({
      success: true,
      data: info
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `获取Steamless信息失败: ${error.message}` });
  }
};

export const getOnlineModes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const modes = toolboxService.getOnlineModesInfo();
    res.json({
      success: true,
      data: modes
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `获取联机模式失败: ${error.message}` });
  }
};

export const searchOnlineFix = async (req: Request, res: Response): Promise<void> => {
  try {
    const appId = req.query.appId as string;
    const gameName = req.query.gameName as string;
    if (!appId) {
      res.status(400).json({ success: false, message: '缺少 appId 参数' });
      return;
    }
    const result = await toolboxService.searchOnlineFix(appId, gameName);
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `检索Online-Fix失败: ${error.message}` });
  }
};

