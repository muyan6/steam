import { Request, Response } from 'express';
import { toolboxService } from '../services/toolboxService.js';
import { ToolboxRepairLog } from '../types/index.js';

// 客户端上报的合法修复动作白名单（与 ToolboxRepairLog.actionType 枚举对齐）
const VALID_ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  'clear_cache',
  'repair_kernel',
  'fill_sha256',
  'auto_switch_manifest'
]);

// 统一兜底错误响应：不向客户端透出内部异常细节
const internalError = (res: Response, logTag: string, e: unknown): void => {
  console.error(logTag, e);
  res.status(500).json({ success: false, message: '服务器内部错误' });
};

export const getManifestNodes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const nodes = toolboxService.getManifestNodes();
    res.json({
      success: true,
      nodes,
      total: nodes.length
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 获取清单节点失败:', error);
  }
};

export const getSha256PackageInfo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = toolboxService.getSha256PackageInfo();
    res.json({
      success: true,
      data
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 获取SHA256数据失败:', error);
  }
};

export const reportRepairLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const { actionType, success, deviceId, details } = req.body;
    // 动作类型白名单校验并截断，防止任意字符串写入日志文件
    if (!actionType || typeof actionType !== 'string') {
      res.status(400).json({ success: false, message: '缺少 actionType 参数' });
      return;
    }
    const cleanActionType = actionType.slice(0, 32);
    if (!VALID_ACTION_TYPES.has(cleanActionType)) {
      res.status(400).json({
        success: false,
        message: `非法的 actionType，支持: ${Array.from(VALID_ACTION_TYPES).join(', ')}`
      });
      return;
    }

    const ip = req.socket.remoteAddress || '127.0.0.1';
    const record = toolboxService.recordRepairLog({
      actionType: cleanActionType as ToolboxRepairLog['actionType'],
      success: Boolean(success),
      deviceId: deviceId || '',
      details: details || '',
      ip
    });

    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 上报修复日志失败:', error);
  }
};

export const getToolboxAdminStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = toolboxService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 获取工具箱统计失败:', error);
  }
};

export const getSteamlessInfo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const info = toolboxService.getSteamlessInfo();
    res.json({
      success: true,
      data: info
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 获取Steamless信息失败:', error);
  }
};

export const getOnlineModes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const modes = toolboxService.getOnlineModesInfo();
    res.json({
      success: true,
      data: modes
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 获取联机模式失败:', error);
  }
};

export const searchOnlineFix = async (req: Request, res: Response): Promise<void> => {
  try {
    const appId = req.query.appId as string;
    if (!appId) {
      res.status(400).json({ success: false, message: '缺少 appId 参数' });
      return;
    }
    const result = await toolboxService.searchOnlineFix(appId);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    internalError(res, '[ToolboxController] 检索Online-Fix失败:', error);
  }
};

